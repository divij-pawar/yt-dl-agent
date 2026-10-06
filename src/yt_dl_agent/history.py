"""What each run did, song by song: songs/.cache/runs/<when>-<id>.json.

cli.run_collection writes one record for every playlist/album/track it processes, whether it was started
from the command line, chat or the web UI:

  downloaded  fetched from YouTube this run
  reused      already in the library (from any playlist/album), so skipped
  failed      couldn't be downloaded, with the reason; retried on the next run
  links       --links-only: only the search link was written
  removed     no longer on the Spotify list since the last run (the MP3 is kept)

A run that couldn't even read the track list is recorded too, with its error. The web UI's History
page reads these; logs/ keep the raw detail.
"""

import json
import re
from datetime import datetime
from pathlib import Path

from . import log
from .models import Collection, Track

DIR = "runs"
BACKFILLED = "_from_logs.json"  # logs already turned into run records (names starting "_" aren't runs)
_OPTIONS = ("workers", "bitrate", "links_only", "no_playlist", "no_album_lookup", "limit", "cookies_from_browser")
_SPECIAL = {"imported", "library-songs"}  # collections that aren't something you can run again


def runs_dir(root: Path) -> Path:
    return root / ".cache" / DIR


def requeue_for(kind: str, sid: str, name: str, owner: str | None, tracks: list[Track]) -> dict | None:
    """How to run a collection again from the queue. Usually its link, but an artist link would mean the
    whole discography (an "artist" collection is their top tracks), and "search-…" isn't a Spotify ID."""
    if sid in _SPECIAL:
        return None
    if sid.startswith("search-"):
        return {"request": {"kind": "song", "title": tracks[0].title, "artist": tracks[0].artist}} if tracks else None
    if kind == "artist":
        return {"link": ["top", sid]}
    return {"link": [kind, sid]}


def _track(t: Track, outcome: str) -> dict:
    return {"outcome": outcome, "title": t.title, "artist": t.artist, "album": t.album,
            "spotify_track_id": t.spotify_track_id, "file_path": t.file_path, "duration_s": t.duration_s,
            "error": t.error if outcome == "failed" else None, "search_url": t.search_url}


class Run:
    def __init__(self, root: Path, kind: str, sid: str | None, args):
        self.root = root
        self.started = datetime.now()
        self.data: dict = {
            "id": None, "started": self.started.isoformat(timespec="seconds"), "finished": None,
            "status": "interrupted",  # ok | failed (some songs failed) | error (the run itself failed)
            "kind": kind, "spotify_id": sid, "name": sid or kind, "owner": None, "source": None,
            "options": {k: getattr(args, k, None) for k in _OPTIONS},
            "log": log.log_path.name if log.log_path else None,
            "job": getattr(args, "job", None),  # {"id", "label"} when it ran from the queue
            "counts": {"total": 0, "downloaded": 0, "reused": 0, "failed": 0, "removed": 0},
            "tracks": [], "removed": [], "playlist_file": None, "error": None, "requeue": None,
        }

    def collection(self, coll: Collection) -> None:
        self.data.update(kind=coll.kind, spotify_id=coll.spotify_id, name=coll.name, owner=coll.owner_or_artist,
                         source=coll.source)
        self.data["requeue"] = requeue_for(coll.kind, coll.spotify_id, coll.name, coll.owner_or_artist, coll.tracks)

    def removed(self, tracks: list[Track]) -> None:
        self.data["removed"] = [{"title": t.title, "artist": t.artist} for t in tracks]

    def outcome(self, tracks: list[Track], reused: set[str], links_only: bool) -> None:
        """tracks: the unique tracks of this run; reused: keys found in the library before downloading."""
        for t in tracks:
            if links_only:
                kind = "links"
            elif t.key in reused:
                kind = "reused"
            else:
                kind = "downloaded" if t.status == "done" else "failed"
            self.data["tracks"].append(_track(t, kind))

    def playlist_file(self, path: Path) -> None:
        self.data["playlist_file"] = path.name

    def fail(self, err: BaseException) -> None:
        self.data["status"], self.data["error"] = "error", log.explain(err)

    def save(self) -> None:
        d = self.data
        c = d["counts"]
        for k in ("downloaded", "reused", "failed"):
            c[k] = sum(t["outcome"] == k for t in d["tracks"])
        c["total"], c["removed"] = len(d["tracks"]), len(d["removed"])
        d["finished"] = datetime.now().isoformat(timespec="seconds")
        if d["status"] != "error" and d["tracks"]:
            d["status"] = "failed" if c["failed"] else "ok"
        if not d["spotify_id"]:  # nothing to save: the run never got as far as knowing what it was
            d["spotify_id"] = "unknown"
        d["id"] = f"{self.started:%Y%m%d-%H%M%S-%f}-{d['spotify_id']}"[:120]
        try:
            folder = runs_dir(self.root)
            folder.mkdir(parents=True, exist_ok=True)
            (folder / f"{d['id']}.json").write_text(json.dumps(d, indent=1, ensure_ascii=False), "utf-8")
        except OSError:  # history is a nice-to-have; never fail a run over it
            log.exception("couldn't write the run record")


# --- runs from before history existed: rebuilt from logs/run-*.log ---------------------

_LOG_LINE = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d),\d+ (DEBUG|INFO|WARNING|ERROR|CRITICAL)\s+(\S+) (.*)$")
_COLLECTION = re.compile(r"^(playlist|album|track|artist) '(.*)' by (.*): (\d+) tracks? \(from ([\w-]+)\)$")
_LINKS = re.compile(r"^search links -> .*?[\\/]\.cache[\\/](.+)\.links\.txt$")
_UP_TO_DATE = re.compile(r"^Up to date: all (\d+) songs?")
_SOME_NEW = re.compile(r"^(\d+) songs? already in the library; downloading \d+ new")
_JOB = re.compile(r"^=== job \d+: (.*)$")


def _cached_tracks(root: Path, sid: str | None) -> list[Track]:
    try:
        return Collection.model_validate_json((root / ".cache" / f"{sid}.json").read_text("utf-8")).tracks
    except (OSError, ValueError, TypeError):
        return []


def _rebuild(root: Path, r: dict, ok: list[str], failed: list[tuple[str, str]],
             removed: list[str], reused: int, finished: str | None) -> dict:
    """A run record from what a log said. Downloaded/failed songs are named in the log; which songs
    were reused isn't, so those come from the collection's cache (as it is now)."""
    cached = {f"{t.artist} - {t.title}": t for t in _cached_tracks(root, r["spotify_id"])}

    def track(label: str, outcome: str, error: str | None = None) -> dict:
        if t := cached.get(label):
            return _track(t, outcome) | {"error": error}
        artist, _, title = label.partition(" - ")
        return {"outcome": outcome, "title": title or label, "artist": artist, "album": None, "spotify_track_id": None,
                "file_path": None, "duration_s": None, "error": error, "search_url": None}

    named = set(ok) | {lbl for lbl, _ in failed}
    reused_tracks = [t for lbl, t in cached.items() if lbl not in named and t.status == "done"][:reused]
    r["tracks"] = ([track(lbl, "downloaded") for lbl in ok] + [track(lbl, "failed", err) for lbl, err in failed]
                   + [_track(t, "reused") for t in reused_tracks])
    r["removed"] = [dict(zip(("artist", "title"), lbl.split(" - ", 1))) for lbl in removed if " - " in lbl]
    c = r["counts"]
    c.update(downloaded=len(ok), failed=len(failed), reused=reused, removed=len(r["removed"]))
    c["total"] = c["downloaded"] + c["failed"] + c["reused"]
    if r["status"] != "error":
        r["status"] = "interrupted" if finished is None else "failed" if failed else "ok"
    r["finished"] = finished
    if r["spotify_id"]:
        r["requeue"] = requeue_for(r["kind"], r["spotify_id"], r["name"], r["owner"],
                                   [Track(title=t["title"], artist=t["artist"]) for t in r["tracks"][:1]])
    r["id"] = f"{r['started'].replace('-', '').replace(':', '').replace('T', '-')}-000000-{r['spotify_id'] or 'log'}"
    return r


def _from_log(root: Path, path: Path) -> list[dict]:
    runs: list[dict] = []
    state: dict[str, dict] = {}  # thread -> the collection being run on it

    def close(thread: str, finished: str | None) -> None:
        if s := state.pop(thread, None):
            runs.append(_rebuild(root, s["run"], s["ok"], s["failed"], s["removed"], s["reused"], finished))

    def new_run(when: str, thread: str, **fields) -> dict:
        run = {"started": when, "finished": None, "status": "interrupted", "kind": "playlist", "spotify_id": None,
               "name": "", "owner": None, "source": None, "options": {}, "log": path.name,
               "job": {"id": None, "label": jobs[thread]} if jobs.get(thread) else None,
               "counts": {"total": 0, "downloaded": 0, "reused": 0, "failed": 0, "removed": 0},
               "playlist_file": None, "error": None, "requeue": None, "from_log": True} | fields
        state[thread] = {"run": run, "ok": [], "failed": [], "removed": [], "reused": 0}
        return run

    jobs: dict[str, str] = {}
    for line in path.read_text("utf-8", errors="replace").splitlines():
        if not (m := _LOG_LINE.match(line)):
            continue
        when, level, thread, msg = m.group(1).replace(" ", "T"), m.group(2), m.group(3), m.group(4).strip()
        s = state.get(thread)
        if j := _JOB.match(msg):
            close(thread, None)
            jobs[thread] = j.group(1).strip()
        elif c := _COLLECTION.match(msg):
            close(thread, None)
            new_run(when, thread, kind=c.group(1), name=c.group(2),
                    owner=None if c.group(3) == "None" else c.group(3), source=c.group(5))
        elif s is None:
            if level == "WARNING" and msg.startswith("error ") and jobs.get(thread):  # failed before the track list
                run = new_run(when, thread, name=jobs[thread], status="error", error=msg.removeprefix("error ").strip())
                run["name"] = re.sub(r"^\w+\s+", "", run["name"]).strip()
                close(thread, when)
        elif lk := _LINKS.match(msg):
            s["run"]["spotify_id"] = lk.group(1)
        elif (u := _UP_TO_DATE.match(msg)) or (u := _SOME_NEW.match(msg)):
            s["reused"] = int(u.group(1))
        elif msg.startswith("ok "):
            s["ok"].append(msg[3:])
        elif msg.startswith("failed ") and level == "WARNING":
            label, _, err = msg[7:].partition(": ")
            s["failed"].append((label, err))
        elif msg.startswith("removed since last run: "):
            s["removed"].append(msg.removeprefix("removed since last run: "))
        elif msg.startswith("playlist file -> "):
            s["run"]["playlist_file"] = re.split(r"[\\/]", msg)[-1]
        elif re.match(r"^done \d+/\d+, failed \d+$", msg):
            close(thread, when)
        elif level == "WARNING" and msg.startswith("error "):
            s["run"]["status"], s["run"]["error"] = "error", msg.removeprefix("error ").strip()
            close(thread, when)
    for thread in list(state):
        close(thread, None)
    return [r for r in runs if r["spotify_id"] or r["status"] == "error"]


def backfill(root: Path, log_dir: Path) -> int:
    """Turn logs that have no run records (written before history existed) into records, once.
    Returns how many runs were added."""
    folder = runs_dir(root)
    marker = folder / BACKFILLED
    done = set(json.loads(marker.read_text("utf-8"))) if marker.exists() else set()
    logs = sorted(log_dir.glob("run-*.log")) if log_dir.exists() else []
    current = log.log_path.name if log.log_path else None
    todo = [p for p in logs if p.name not in done and p.name != current]
    if not todo:
        return 0
    recorded = set()
    for f in folder.glob("*.json") if folder.exists() else []:
        if not f.name.startswith("_"):
            try:
                recorded.add(json.loads(f.read_text("utf-8")).get("log"))
            except (OSError, ValueError):
                continue
    added = 0
    folder.mkdir(parents=True, exist_ok=True)
    for p in todo:
        if p.name not in recorded:  # runs with live records don't need rebuilding
            try:
                for r in _from_log(root, p):
                    (folder / f"{r['id']}.json").write_text(json.dumps(r, indent=1, ensure_ascii=False), "utf-8")
                    added += 1
            except OSError:
                log.exception(f"couldn't rebuild runs from {p.name}")
                continue
        done.add(p.name)
    marker.write_text(json.dumps(sorted(done), indent=1), "utf-8")
    if added:
        log.detail(f"history: rebuilt {added} runs from {len(todo)} old logs", log.INFO)
    return added
