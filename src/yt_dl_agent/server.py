"""HTTP API for the web UI (web/src/lib/api.ts), and the built UI itself (web/dist).

    yt-dl-agent serve        ->  http://127.0.0.1:8765      (API docs at /api/docs)

Downloads go through the same one-at-a-time queue as chat mode (chat.DownloadQueue), with each job's
own run options. Import, fix and undo answer directly but take the same library lock, so they never
change songs/ while a download is writing to it. Live progress comes from log.event().

Only local requests are served: the Host and any Origin header must be localhost, so other web
pages can't drive the app or read its settings.
"""

import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from argparse import Namespace
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, ConfigDict

from . import chat, cli, config, covers, fixer, history, importer, llm, log, plex, sources, spotify_url
from .library import sanitize
from .library_index import _NOT_COLLECTIONS, LibraryIndex
from .models import Collection, Track

DIST = Path(__file__).resolve().parents[2] / "web" / "dist"
# Caches that are collections on disk but aren't playlists or albums.
_SPECIAL = {importer.IMPORTED_CACHE, fixer.ORPHANS_CACHE, importer.SOURCES_CACHE}
_LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
# top: an artist's top tracks; tracks: comma-separated track IDs (songs picked in a preview)
_QUEUE_KINDS = {"playlist", "album", "track", "artist", "user", "top", "tracks"}
_SPOTIFY_ID = re.compile(r"[A-Za-z0-9]{22}")
_RUN_KEYS = {"out", "workers", "bitrate", "links_only", "no_playlist", "no_album_lookup", "limit",
             "cookies_from_browser", "no_plex"}
RECENT = 6

app = FastAPI(title="yt-dl-agent", docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
library_lock = threading.Lock()


@app.middleware("http")
async def local_only(request: Request, call_next):
    host = urllib.parse.urlsplit(f"//{request.headers.get('host', '')}").hostname
    origin = request.headers.get("origin")
    if host not in _LOCAL_HOSTS or (origin and urllib.parse.urlsplit(origin).hostname not in _LOCAL_HOSTS):
        return JSONResponse({"detail": "Only requests from this computer are accepted."}, status_code=403)
    return await call_next(request)


def _root() -> Path:
    return config.root()


# --- the queue -----------------------------------------------------------------------


def _args(job: chat.Job | None) -> Namespace:
    """A job's run options -> the argparse namespace cli.run_collection expects."""
    o = config.defaults() | {"links_only": False, "limit": None} | ((job.options if job else None) or {})
    return Namespace(out=Path(o["out"]), workers=max(1, int(o["workers"])), bitrate=int(o["bitrate"]),
                     links_only=bool(o["links_only"]), no_playlist=bool(o["no_playlist"]),
                     no_album_lookup=bool(o["no_album_lookup"]), limit=o["limit"] or None,
                     cookies_from_browser=o["cookies_from_browser"] or None, no_plex=bool(o["no_plex"]),
                     chat_mode=True, dry_run=False, undo=None,
                     job={"id": job.id, "label": job.label.strip()} if job else None)  # for history.Run


def _run_unit(kind, x) -> None:
    job = queue.current
    with library_lock:
        cli.run_unit(_args(job))(kind, x)


queue = chat.DownloadQueue(_run_unit)
progress: dict[str, dict] = {}  # job id -> UnitProgress of the unit running now
_retries: dict[str, str] = {}  # track label -> last retry message
_progress_lock = threading.Lock()


def _on_event(name: str, data: dict) -> None:
    """log.event() from cli.run_collection / download -> progress of the running job."""
    job = queue.current
    if job is None or name == "say":
        return
    with _progress_lock:
        if name == "phase" and data["phase"] == "resolving":
            progress[job.id] = {"collection": f"{data['kind']} {data.get('id') or ''}".strip(), "source": None,
                                "total": 0, "reused": 0, "done": 0, "failed": 0, "phase": "resolving",
                                "recent": []}
            return
        p = progress.get(job.id)
        if p is None:
            return
        if name == "collection":
            job.names[data["id"]] = data["name"]
            owner = f" by {data['owner']}" if data.get("owner") else ""
            p.update(collection=f"{data['kind']} '{data['name']}'{owner}", source=data["source"], total=data["total"])
        elif name == "phase":
            p["phase"] = data["phase"]
            if data["phase"] == "downloading":
                p.update(total=data["total"], reused=data["reused"])
        elif name == "retry":
            _retries[data["label"]] = f"retry {data['attempt']}/{data['of']}: {data['error']}"
        elif name == "track":
            p["done" if data["ok"] else "failed"] += 1
            entry = {"label": data["label"], "ok": data["ok"]}
            if not data["ok"] and data.get("error"):
                entry["error"] = data["error"]
            if retry := _retries.pop(data["label"], None):
                entry["retry"] = retry
            p["recent"] = [entry, *p["recent"]][:RECENT]


log.listen(_on_event)


def _unit_json(unit, names: dict) -> dict:
    kind, x = unit
    if kind == "bare":
        return {"kind": "bare", "track": {"title": x.title, "artist": x.artist}}
    if kind == "import":
        return {"kind": "import", "paths": list(x or [])}
    if kind == "fix":
        return {"kind": "fix"}
    return {"kind": kind, "id": x, "name": names.get(x)}


def _job_json(j: chat.Job) -> dict:
    link = None
    if j.link:
        kind, value = j.link
        link = [kind, value if isinstance(value, str) else ", ".join(value or [])]
    return {
        "id": j.id, "label": j.label, "request": j.request.model_dump() if j.request else None, "link": link,
        "status": j.status, "note": j.note, "units": [_unit_json(u, j.names) for u in j.units],
        "via": j.via or ("link" if j.link else "model"), "unit_index": j.unit_index,
        "progress": progress.get(j.id) if j.status == "working" else None, "queued_at": j.queued_at,
    }


@contextmanager
def _messages():
    """Collect what log.say() prints on this thread (e.g. "Couldn't understand that: ...")."""
    me, out = threading.get_ident(), []

    def grab(name, data):
        if name == "say" and threading.get_ident() == me:
            out.append(data["text"].strip())

    log.listen(grab)
    try:
        yield out
    finally:
        log.unlisten(grab)


class ParseIn(BaseModel):
    line: str


@app.post("/api/parse")
def parse(body: ParseIn) -> dict:
    """chat.parse_line: links, then the exact `kind: title - artist` form, then the model."""
    with _messages() as messages:
        jobs = chat.parse_line(body.line)
    rest = chat._LINK.sub("", body.line).strip(" ,;")
    explicit = bool(rest) and chat._explicit(rest) is not None
    for j in jobs:
        j.via = "link" if j.link else "explicit" if explicit else "model"
    return {"jobs": [_job_json(j) for j in jobs], "warnings": messages}


class JobIn(BaseModel):
    label: str = ""
    request: llm.Request | None = None
    link: list[str] | None = None
    via: str = ""
    units: list[dict] = []


class QueueIn(BaseModel):
    jobs: list[JobIn]
    options: dict = {}


@app.post("/api/queue")
def enqueue(body: QueueIn) -> list[dict]:
    options = {k: v for k, v in body.options.items() if k in _RUN_KEYS}
    jobs = []
    for ji in body.jobs:
        if ji.link:
            if len(ji.link) != 2 or ji.link[0] not in _QUEUE_KINDS:
                raise HTTPException(400, f"Can't queue a {ji.link[0]!r} link.")
            job = chat.Job(label=ji.label or f"link         {ji.link[0]} {ji.link[1]}",
                           link=(ji.link[0], ji.link[1]), via="link")
            job.names.update({u["id"]: u["name"] for u in ji.units if u.get("id") and u.get("name")})
        elif ji.request:
            job = chat.Job(label=chat.describe(ji.request), request=ji.request, via=ji.via or "model")
        else:
            raise HTTPException(400, "A job needs a request or a link.")
        job.options = options
        jobs.append(job)
    for job in jobs:  # validate everything first, then queue
        queue.add(job)
    return [_job_json(j) for j in jobs]


@app.get("/api/queue")
def get_queue() -> list[dict]:
    return [_job_json(j) for j in list(queue.jobs)]


@app.get("/api/profiles/{user_id}")
def profile_playlists(user_id: str) -> list[dict]:
    try:
        return [{"name": name, "id": pid} for name, pid in sources.user_playlists(user_id)]
    except Exception as e:  # noqa: BLE001 - shown to the user in plain words
        raise HTTPException(502, log.explain(e) if "no public playlists" not in str(e) else str(e)) from e


# --- the library -------------------------------------------------------------------------


def _collections(root: Path):
    for f in sorted((root / ".cache").glob("*.json")):
        if f.name in _NOT_COLLECTIONS or f.name in _SPECIAL:
            continue
        try:
            yield f, Collection.model_validate_json(f.read_text("utf-8"))
        except (OSError, ValueError):  # not a collection, or being written right now
            continue


def _clean_error(err: str | None) -> str | None:
    """Errors saved by older versions can carry yt-dlp's colour codes, or predate an explanation that exists
    now ("Unexpected error: ..."): explain those again, keeping the original if there's still nothing better."""
    if not err or not ("\x1b[" in err or err.startswith("Unexpected error:")):
        return err
    better = log.explain(err.removeprefix("Unexpected error:").strip())
    return err if better.startswith("Unexpected error") and "\x1b[" not in err else better


def _cover(root: Path, sid: str) -> str | None:
    """URL of the saved cover; the ?v= changes when it's downloaded again, so browsers refetch it."""
    f = covers.path(root, sid)
    return f"/api/collections/{sid}/cover?v={int(f.stat().st_mtime)}" if f.exists() else None


def _summary(f: Path, c: Collection, root: Path) -> dict:
    m3u8 = f"{sanitize(c.name)}.m3u8"
    return {
        "kind": c.kind, "spotify_id": c.spotify_id, "name": c.name, "owner_or_artist": c.owner_or_artist,
        "cover": _cover(root, c.spotify_id),
        "source": c.source or "embed", "total": len(c.tracks),
        "done": sum(t.status == "done" for t in c.tracks), "failed": sum(t.status == "failed" for t in c.tracks),
        "m3u8": m3u8 if c.kind == "playlist" and (root / m3u8).exists() else None,
        "updated": datetime.fromtimestamp(f.stat().st_mtime).isoformat(timespec="seconds"),
        "requeue": history.requeue_for(c.kind, c.spotify_id, c.name, c.owner_or_artist, c.tracks),
    }


@app.get("/api/collections")
def collections() -> list[dict]:
    root = _root()
    return [_summary(f, c, root) for f, c in _collections(root)]


def _cache_file(sid: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", sid):
        raise HTTPException(404)
    f = _root() / ".cache" / f"{sid}.json"
    if f.name in _NOT_COLLECTIONS or f.name in _SPECIAL or not f.exists():
        raise HTTPException(404, "No cached playlist or album with this ID.")
    return f


@app.get("/api/collections/{sid}")
def collection(sid: str) -> dict:
    c = Collection.model_validate_json(_cache_file(sid).read_text("utf-8"))
    for t in c.tracks:
        t.error = _clean_error(t.error)
    return c.model_dump() | {"requeue": history.requeue_for(c.kind, c.spotify_id, c.name, c.owner_or_artist, c.tracks),
                             "cover": _cover(_root(), sid)}


@app.get("/api/collections/{sid}/cover", include_in_schema=False)
def collection_cover(sid: str) -> FileResponse:
    _cache_file(sid)
    f = covers.path(_root(), sid)
    if not f.exists():
        raise HTTPException(404, "No cover saved for this one yet.")
    media = "image/png" if f.read_bytes()[:4] == b"\x89PNG" else "image/jpeg"
    return FileResponse(f, media_type=media, headers={"Cache-Control": "max-age=31536000, immutable"})


@app.post("/api/collections/{sid}/cover")
def refresh_cover(sid: str) -> dict:
    """Download the playlist/album cover from Spotify again, and put it on the Plex playlist."""
    f = _cache_file(sid)
    root = _root()
    with library_lock:
        c = Collection.model_validate_json(f.read_text("utf-8"))
        if not covers.ensure(root, c, refresh=True):
            raise HTTPException(502, "Spotify didn't return a cover for this one.")
        f.write_text(c.model_dump_json(indent=1), "utf-8")
        plex_note = plex.refresh_poster(root, c) if c.kind == "playlist" else None
    return {"cover": _cover(root, sid), "plex": plex_note}


def _added(f: Path) -> str:
    """When the file appeared in the library: its creation time (kept when fix moves it)."""
    st = f.stat()
    return datetime.fromtimestamp(getattr(st, "st_birthtime", st.st_ctime)).isoformat(timespec="seconds")


@app.get("/api/library")
def library() -> list[dict]:
    """Every song file, once, with the playlists/albums that use it."""
    root, songs = _root(), {}

    def add(t: Track, coll: Collection | None, imported: bool = False) -> None:
        if t.status != "done" or not t.file_path:
            return
        s = songs.get(t.file_path)
        if s is None:
            if not (root / t.file_path).exists():
                return
            s = songs[t.file_path] = {"path": t.file_path, "track": t.model_dump(), "in_collections": [],
                                      "format": Path(t.file_path).suffix.lower(), "imported": False,
                                      "added": _added(root / t.file_path)}
        s["imported"] = s["imported"] or imported
        if coll and all(c["spotify_id"] != coll.spotify_id for c in s["in_collections"]):
            s["in_collections"].append({"spotify_id": coll.spotify_id, "name": coll.name, "kind": coll.kind})

    for _, c in _collections(root):
        for t in c.tracks:
            add(t, c)
    for name in (importer.IMPORTED_CACHE, fixer.ORPHANS_CACHE):
        try:
            special = Collection.model_validate_json((root / ".cache" / name).read_text("utf-8"))
        except (OSError, ValueError):
            continue
        for t in special.tracks:
            add(t, None, imported=name == importer.IMPORTED_CACHE)
    return sorted(songs.values(), key=lambda s: s["path"].casefold())


@app.get("/api/failed")
def failed_songs() -> list[dict]:
    """Songs that failed in some playlist/album and still aren't in the library, newest attempt first."""
    root, out = _root(), {}
    index = LibraryIndex(root)
    for f, c in _collections(root):
        tried = datetime.fromtimestamp(f.stat().st_mtime).isoformat(timespec="seconds")
        requeue = history.requeue_for(c.kind, c.spotify_id, c.name, c.owner_or_artist, c.tracks)
        for t in c.tracks:
            if t.status != "failed" or index.find(t):  # failed here, but downloaded since by another run
                continue
            t.error = _clean_error(t.error)
            e = out.setdefault(t.spotify_track_id or t.key, {"track": t.model_dump(), "error": t.error,
                                                             "in_collections": [], "last_tried": tried})
            e["in_collections"].append({"spotify_id": c.spotify_id, "name": c.name, "kind": c.kind, "requeue": requeue})
            if tried > e["last_tried"]:
                e["last_tried"], e["error"] = tried, t.error
    return sorted(out.values(), key=lambda e: e["last_tried"], reverse=True)


# --- run history -------------------------------------------------------------------------


def _run_files(root: Path) -> list[Path]:
    d = history.runs_dir(root)
    files = d.glob("*.json") if d.exists() else []
    return sorted((f for f in files if not f.name.startswith("_")), reverse=True)  # "_…": bookkeeping, not runs


@app.get("/api/runs")
def runs(limit: int = 300, job: str | None = None, spotify_id: str | None = None) -> list[dict]:
    """Newest first, without the per-song lists (GET /api/runs/{id} has those). Logs from before history
    existed are turned into records first (once)."""
    history.backfill(_root(), _log_dir())
    out = []
    for f in _run_files(_root()):
        try:
            r = json.loads(f.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        if (job and (r.get("job") or {}).get("id") != job) or (spotify_id and r.get("spotify_id") != spotify_id):
            continue
        r.pop("tracks", None)
        r.pop("removed", None)
        out.append(r)
        if len(out) >= limit:
            break
    return out


@app.get("/api/runs/{run_id}")
def run_detail(run_id: str) -> dict:
    f = history.runs_dir(_root()) / f"{run_id}.json"
    if not re.fullmatch(r"[\w-]{1,120}", run_id) or run_id.startswith("_") or not f.exists():
        raise HTTPException(404, "No such run.")
    return json.loads(f.read_text("utf-8"))


# --- preview: a Spotify list before downloading it -------------------------------------

_PREVIEW_KINDS = {"playlist", "album", "track", "artist"}


def _rgb(c: dict | None) -> str | None:
    return f"rgb({c['red']}, {c['green']}, {c['blue']})" if c else None


@app.get("/api/preview/{kind}/{sid}")
def preview(kind: str, sid: str) -> dict:
    """What a Spotify link holds, and which songs are already in the library. Reads Spotify's embed page
    only (plain HTTP: no Tavily credits, no downloads). Albums for playlist songs come from the album cache."""
    if kind not in _PREVIEW_KINDS or not _SPOTIFY_ID.fullmatch(sid):
        raise HTTPException(404, "Preview works for playlist, album, track and artist links.")
    try:
        ent = sources.embed_entity(kind, sid)
        coll = sources.from_embed(kind, sid, ent)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Couldn't read it from Spotify: {log.explain(e)}") from e
    root = _root()
    index = LibraryIndex(root)
    albums_f = root / ".cache" / "albums.json"
    albums = json.loads(albums_f.read_text("utf-8")) if albums_f.exists() else {}
    cached = root / ".cache" / f"{sid}.json"
    before = {t.key: t for t in _cached_tracks(cached)}
    previews = {(t.get("uri") or "").rsplit(":", 1)[-1]: (t.get("audioPreview") or {}).get("url")
                for t in ent.get("trackList", [])}
    tracks = []
    for t in coll.tracks:
        album = t.album
        if not album:
            hit = albums.get(t.spotify_track_id or "") or albums.get(t.key)
            album = hit if isinstance(hit, str) else (hit or {}).get("album")
        old = before.get(t.key)
        tracks.append({"title": t.title, "artist": t.artist, "album": album, "duration_s": t.duration_s,
                       "explicit": t.explicit, "spotify_track_id": t.spotify_track_id,
                       "preview_url": previews.get(t.spotify_track_id or ""), "in_library": index.find(t),
                       "failed_before": bool(old and old.status == "failed"), "error": _clean_error(old.error) if old else None})
    vi = ent.get("visualIdentity") or {}
    return {
        "kind": kind, "spotify_id": sid, "name": coll.name, "owner": coll.owner_or_artist,
        "cover_url": sources.largest_image(ent),
        "colors": {"background": _rgb(vi.get("backgroundBase")), "tinted": _rgb(vi.get("backgroundTintedBase")),
                   "subdued": _rgb(vi.get("textSubdued"))},
        "year": int(y) if (y := ((ent.get("releaseDate") or {}).get("isoString") or "")[:4]).isdigit() else None,
        "duration_s": sum(t.duration_s or 0 for t in coll.tracks),
        "capped": kind == "playlist" and len(coll.tracks) >= sources.EMBED_LIMIT,
        "downloaded_before": datetime.fromtimestamp(cached.stat().st_mtime).isoformat(timespec="seconds")
        if cached.exists() else None,
        "requeue": history.requeue_for(kind, sid, coll.name, coll.owner_or_artist, coll.tracks),
        "tracks": tracks,
    }


def _cached_tracks(f: Path) -> list[Track]:
    try:
        return Collection.model_validate_json(f.read_text("utf-8")).tracks
    except (OSError, ValueError):
        return []


@app.get("/api/unsorted")
def unsorted() -> list[dict]:
    root = _root()
    f = root / ".cache" / "unsorted.json"
    data = json.loads(f.read_text("utf-8")) if f.exists() else {}
    return [{"path": k, "src": v.get("src", ""), "reason": v.get("reason", ""), "suggestion": v.get("suggestion", ""),
             "guesses": v.get("guesses", []), "when": v.get("when", "")}
            for k, v in sorted(data.items()) if (root / k).exists()]


# --- import / fix ----------------------------------------------------------------------


def _plan_json(p: importer.Plan) -> dict:
    return {"src": str(p.src), "status": p.status, "dest": p.dest, "replaced": p.replaced, "reason": p.reason,
            "suggestion": p.suggestion, "guesses": [list(g) for g in p.guesses],
            "model_guess": list(p.model_guess) if p.model_guess else None,
            "track": p.track.model_dump() if p.track else None}


def _import_result(plans: list, dry_run: bool, manifest: str | None) -> dict:
    return {"dry_run": dry_run, "files": len(plans), "skipped_unchanged": sum(p.skipped for p in plans),
            "plans": [_plan_json(p) for p in plans], "manifest": manifest}


class ImportIn(BaseModel):
    paths: list[str]
    dry_run: bool = True


@app.post("/api/import")
def import_files(body: ImportIn) -> dict:
    paths = [Path(p.strip().strip('"')) for p in body.paths if p.strip()]
    if not paths:
        raise HTTPException(400, "Give one or more files or folders to import.")
    if missing := [str(p) for p in paths if not p.exists()]:
        raise HTTPException(400, f"Not found: {', '.join(missing)}")
    root = _root()
    runs = root / ".cache" / "imports"
    before = set(runs.glob("*.json")) if runs.exists() else set()
    with library_lock:
        plans = importer.run_import(paths, root, dry_run=body.dry_run)
    new = sorted((set(runs.glob("*.json")) if runs.exists() else set()) - before)
    return _import_result(plans, body.dry_run, new[-1].stem if new else None)


@app.get("/api/imports")
def import_history() -> list[dict]:
    runs = _root() / ".cache" / "imports"
    out = []
    for f in sorted(runs.glob("*.json"), reverse=True) if runs.exists() else []:
        name = f.name.removesuffix(".json").removesuffix(".undone")
        try:
            data = json.loads(f.read_text("utf-8"))
            when = datetime.strptime(name, "%Y%m%d-%H%M%S").isoformat()
        except ValueError:
            continue
        out.append({"name": name, "when": when, "mode": data.get("mode", "copy"),
                    "undone": f.name.endswith(".undone.json"), "items": data.get("items", [])})
    return out


@app.post("/api/imports/{name}/undo", status_code=204)
def undo_import(name: str) -> Response:
    root = _root()
    if not re.fullmatch(r"\d{8}-\d{6}", name) or not (root / ".cache" / "imports" / f"{name}.json").exists():
        raise HTTPException(404, "No such import, or it was already undone.")
    with library_lock:
        importer.undo(root, f"{name}.json")
    return Response(status_code=204)


class DryRunIn(BaseModel):
    dry_run: bool = True


@app.post("/api/fix")
def fix(body: DryRunIn) -> dict:
    with library_lock:
        report = fixer.run_fix(_root(), dry_run=body.dry_run)
    retried = report["unsorted_retry"]
    report["unsorted_retry"] = _import_result(retried, body.dry_run, None) if retried is not None else None
    return report


# --- plex ------------------------------------------------------------------------------


class PlexIn(BaseModel):
    dry_run: bool = False
    ids: list[str] | None = None  # Spotify playlist IDs; all cached playlists when omitted


@app.post("/api/plex")
def plex_sync(body: PlexIn) -> dict:
    """plex.sync_all: create/update the cached playlists in Plex (Plex never reads the .m3u8 files)."""
    global _health_cache
    root = _root()
    only = None
    if body.ids is not None:
        wanted = set(body.ids)
        only = [c for c in plex.playlists(root) if c.spotify_id in wanted]
        if not only:
            raise HTTPException(404, "None of those are downloaded playlists.")
    try:
        with library_lock:
            report = plex.sync_all(root, dry_run=body.dry_run, only=only, raise_errors=True)
    except plex.PlexError as e:
        raise HTTPException(503, str(e)) from e
    _health_cache = None  # the Plex health line counts synced playlists
    return report


# --- logs ------------------------------------------------------------------------------

_LOG_NAME = re.compile(r"run-(\d{8}-\d{6})\.log")
_LINE = re.compile(r"^\d{4}-\d\d-\d\d (\d\d:\d\d:\d\d,\d{3}) (DEBUG|INFO|WARNING|ERROR|CRITICAL)\s+(\S+) (.*)$")
MAX_LOG_LINES = 5000


def _log_dir() -> Path:
    return Path(config.defaults()["log_dir"])


def _run_summary(first_line: str) -> str:
    """The args line of a run -> "playlist <id>", "chat", "serve", "import D:\\Music"..."""
    m = re.search(r"'urls': \[(.*?)\]", first_line)
    urls = re.findall(r"'([^']*)'", m.group(1)) if m else []
    if urls:
        if urls[0].lower() in ("import", "fix", "plex", "serve"):
            return " ".join(urls)
        parts = []
        for u in urls:
            try:
                parts.append(" ".join(spotify_url.parse(u)))
            except ValueError:
                parts.append(u)
        return ", ".join(parts)
    if m := re.search(r"'ask': \[(.*?)\]", first_line):
        return "ask " + ", ".join(re.findall(r"'([^']*)'", m.group(1)))
    return "chat"


@app.get("/api/logs")
def logs() -> list[dict]:
    out = []
    for f in sorted(_log_dir().glob("run-*.log"), reverse=True)[:200]:
        if not (m := _LOG_NAME.fullmatch(f.name)):
            continue
        lines = warnings = 0
        first = ""
        with f.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if not lines:
                    first = line
                lines += 1
                warnings += " WARNING " in line or " ERROR " in line
        out.append({"name": f.name, "started": datetime.strptime(m.group(1), "%Y%m%d-%H%M%S").isoformat(),
                    "args": _run_summary(first), "lines": lines, "warnings": warnings})
    return out


@app.get("/api/logs/{name}")
def log_lines(name: str) -> list[dict]:
    f = _log_dir() / name
    if not _LOG_NAME.fullmatch(name) or not f.exists():
        raise HTTPException(404)
    out: list[dict] = []
    for line in f.read_text("utf-8", errors="replace").splitlines():
        if m := _LINE.match(line):
            level = "ERROR" if m.group(2) == "CRITICAL" else m.group(2)
            out.append({"time": m.group(1), "level": level, "thread": m.group(3), "message": m.group(4)})
        elif out:  # traceback / multi-line message
            out[-1]["message"] += "\n" + line
    return out[-MAX_LOG_LINES:]


# --- health + settings -----------------------------------------------------------------

_health_cache: tuple[float, list] | None = None
HEALTH_TTL_S = 30


def _check_spotify() -> tuple:
    if not (os.getenv("SPOTIFY_CLIENT_ID") and os.getenv("SPOTIFY_CLIENT_SECRET")):
        return ("unknown", "Not set up (optional). Playlists stop at 100 tracks; albums come from a lookup.",
                "Add app credentials from developer.spotify.com/dashboard for full track lists.")
    try:
        token = sources._spotify_token()
    except urllib.error.HTTPError as e:
        return "down", f"Credentials rejected (HTTP {e.code}).", "Check SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET."
    except Exception as e:  # noqa: BLE001
        return "down", log.explain(e), None
    try:  # any public album: does the API answer, or does it want Premium?
        sources._get_json("https://api.spotify.com/v1/albums/4aawyAB9vmqN3uQ7FjRGTy", {"Authorization": f"Bearer {token}"})
    except urllib.error.HTTPError as e:
        if "premium" in e.read().decode(errors="replace").lower():
            return ("degraded", "403: the app owner needs Premium. Using embed pages (playlists stop at 100 tracks).",
                    "Optional. Subscribe the developer account that owns the app to Premium; "
                    "it can take a few hours to start working.")
        return "degraded", f"Spotify API answered HTTP {e.code}; using embed pages instead.", None
    except Exception as e:  # noqa: BLE001
        return "degraded", log.explain(e), None
    return "ok", "Full track lists, albums and track numbers.", None


def _check_tavily() -> tuple:
    if not os.getenv("TAVILY_API_KEY"):
        return "down", "TAVILY_API_KEY is missing.", "Get a free key at app.tavily.com and add it under Connections."
    return "ok", "Key set (checked on first use).", None


def _check_ollama() -> tuple:
    host = os.getenv("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
    model = os.getenv("OLLAMA_MODEL", "llama3.2:latest")
    try:
        with urllib.request.urlopen(f"{host}/api/tags", timeout=3) as r:
            names = {m.get("name") for m in json.load(r).get("models", [])}
    except Exception:  # noqa: BLE001
        return ("down", f"Not reachable at {host}.",
                "Start Ollama (`ollama serve` or the desktop app). Until then, use links or the exact form "
                "(album: Title - Artist).")
    if model in names or f"{model}:latest" in names:
        return "ok", f"{model} at {host}", None
    return "degraded", f"{model} isn't downloaded.", f"Run `ollama pull {model}` (see `ollama list`)."


def _version(exe: str) -> str:
    try:
        return subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=5).stdout.strip().splitlines()[0]
    except Exception:  # noqa: BLE001
        return "found"


def _check_ffmpeg() -> tuple:
    missing = [x for x in ("ffmpeg", "ffprobe") if not shutil.which(x)]
    if missing:
        return "down", f"{' and '.join(missing)} not on PATH.", "Install it: winget install Gyan.FFmpeg (then restart)."
    return "ok", "ffmpeg and ffprobe on PATH", None


def _check_js() -> tuple:
    for exe in ("deno", "node"):
        if path := shutil.which(exe):
            return "ok", f"{exe} {_version(path).removeprefix('deno ').removeprefix('v')}", None
    return "down", "No deno or node on PATH: YouTube downloads will fail.", "Install it: winget install OpenJS.NodeJS.LTS"


def _check_plex() -> tuple:
    return plex.status(_root())


def _check_ytdlp() -> tuple:
    from yt_dlp.version import __version__
    return "ok", __version__, None


_CHECKS = [("spotify", "Spotify API", _check_spotify), ("tavily", "Tavily", _check_tavily),
           ("ollama", "Ollama", _check_ollama), ("ffmpeg", "ffmpeg", _check_ffmpeg),
           ("js", "JS runtime", _check_js), ("ytdlp", "yt-dlp", _check_ytdlp), ("plex", "Plex", _check_plex)]


@app.get("/api/health")
def health(refresh: bool = False) -> list[dict]:
    global _health_cache
    if _health_cache and not refresh and time.monotonic() - _health_cache[0] < HEALTH_TTL_S:
        return _health_cache[1]

    def run(check):
        cid, name, fn = check
        try:
            state, detail, fix_hint = fn()
        except Exception as e:  # noqa: BLE001
            state, detail, fix_hint = "unknown", log.explain(e), None
        return {"id": cid, "name": name, "state": state, "detail": detail, **({"fix": fix_hint} if fix_hint else {})}

    with ThreadPoolExecutor(len(_CHECKS)) as pool:
        result = list(pool.map(run, _CHECKS))
    _health_cache = (time.monotonic(), result)
    return result


def _mask(v: str) -> str:
    return "" if not v else f"{v[:5]}…{v[-4:]}" if len(v) > 12 else "•" * len(v)


@app.get("/api/settings")
def get_settings() -> dict:
    env = config.read_env()
    out: dict = {k: _mask(env[k]) if k in config.SECRET_KEYS else env[k] for k in config.CONNECTION_KEYS}
    out["defaults"] = config.defaults() | {"links_only": False, "limit": None}
    return out


class DefaultsIn(BaseModel):
    model_config = ConfigDict(extra="allow")  # run defaults config.py adds later are kept too
    out: str
    workers: int
    bitrate: int
    no_playlist: bool = False
    no_album_lookup: bool = False
    cookies_from_browser: str | None = None
    yes: bool = False
    log_dir: str = "logs"
    no_plex: bool = False


class SettingsIn(BaseModel):
    model_config = ConfigDict(extra="allow")  # any other key in config.CONNECTION_KEYS
    TAVILY_API_KEY: str = ""
    OLLAMA_HOST: str = ""
    OLLAMA_MODEL: str = ""
    SPOTIFY_CLIENT_ID: str = ""
    SPOTIFY_CLIENT_SECRET: str = ""
    PLEX_URL: str | None = None  # None: an older UI that doesn't send it (keep what's in .env)
    PLEX_TOKEN: str | None = None
    defaults: DefaultsIn


@app.put("/api/settings", status_code=204)
def put_settings(body: SettingsIn) -> Response:
    global _health_cache
    d = body.defaults
    if not d.out.strip() or not d.log_dir.strip():
        raise HTTPException(400, "The library and log folders can't be empty.")
    if not 1 <= d.workers <= 16 or not 32 <= d.bitrate <= 320:
        raise HTTPException(400, "Parallel downloads must be 1-16 and the bitrate 32-320 kbps.")
    current = config.read_env()
    changes = {}
    for k in config.CONNECTION_KEYS:
        value = getattr(body, k, None)
        if value is None:  # not sent (e.g. a UI that doesn't know this key yet): keep what's there
            continue
        value = str(value).strip()
        if k in config.SECRET_KEYS and value == _mask(current[k]):
            continue  # the masked value came back unchanged: keep the real one
        if value != current[k]:
            changes[k] = value
    config.write_env(changes)
    config.write_defaults(d.model_dump())
    if {"SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"} & changes.keys():
        sources._api_disabled = None  # new credentials: let the next run try the API again
    _health_cache = None
    log.detail(f"settings saved; changed: {sorted(changes)}", log.INFO)
    return Response(status_code=204)


# --- the UI ------------------------------------------------------------------------------

if DIST.is_dir():
    @app.get("/{path:path}", include_in_schema=False)
    def ui(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(404)
        f = (DIST / path).resolve()
        if path and f.is_file() and f.is_relative_to(DIST):
            return FileResponse(f)
        return FileResponse(DIST / "index.html")  # client-side routes


def serve(port: int, log_file: Path) -> None:
    import uvicorn

    url = f"http://127.0.0.1:{port}"
    log.say(f"[bold]yt-dl-agent[/] web UI on [cyan]{url}[/]   (API docs: {url}/api/docs)")
    if not DIST.is_dir():
        log.warn("The UI isn't built yet, so only the API is served. Build it with: npm --prefix web run build")
    log.say(f"[dim]library: {_root().resolve()}   log: {log_file}   Ctrl+C to stop[/]")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
