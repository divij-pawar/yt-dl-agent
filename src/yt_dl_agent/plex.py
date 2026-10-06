"""Sync the app's playlists into Plex.

Plex never reads .m3u/.m3u8 files from library folders: a playlist only exists in Plex if it's created
through the server's API. This matches each playlist's files to the tracks Plex has indexed (by file
path) and creates or updates a Plex audio playlist with the same name and order. The .m3u8 files stay
for other players.

.env:
  PLEX_URL        default http://127.0.0.1:32400
  PLEX_TOKEN      required
  PLEX_LIBRARY    optional: the music library's name; default is the one whose folder holds songs/
  PLEX_PATH_MAP   optional, when Plex sees the files under another path (Docker, NAS):
                  "D:\\Code\\yt-dl-agent\\songs=/data/music"

Playlists this app creates are marked in their Plex summary, and only marked playlists are ever changed,
so a playlist you made yourself in Plex with the same name is left alone.
"""

import hashlib
import json
import os
import time
from pathlib import Path

from plexapi.exceptions import PlexApiException
from plexapi.server import PlexServer

from . import covers, log
from .library_index import _NOT_COLLECTIONS
from .models import Collection

MARK = "Synced by yt-dl-agent"
POSTERS_CACHE = "plex_posters.json"  # spotify id -> hash of the cover last uploaded as the Plex poster
SCAN_TIMEOUT_S = 600


def configured() -> bool:
    return bool(os.getenv("PLEX_TOKEN"))


def _key(path: str) -> str:
    return path.replace("\\", "/").rstrip("/").casefold()


class PlexSync:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.plex = PlexServer(os.getenv("PLEX_URL", "http://127.0.0.1:32400"), os.getenv("PLEX_TOKEN"), timeout=60)
        local, _, remote = (os.getenv("PLEX_PATH_MAP") or "").partition("=")
        self.local_prefix = _key(local.strip() or str(self.root))
        self.plex_prefix = _key(remote.strip() or str(self.root))
        self.section = self._find_section()
        self._tracks: dict | None = None
        self.scanned = False
        self._posters_f = self.root / ".cache" / POSTERS_CACHE
        self.posters: dict = json.loads(self._posters_f.read_text("utf-8")) if self._posters_f.exists() else {}

    def set_poster(self, pl, coll: Collection, force: bool = False) -> bool:
        """Upload the playlist's Spotify cover as its Plex poster, when it changed since the last upload."""
        f = covers.ensure(self.root, coll)
        if not f:
            return False
        digest = hashlib.sha1(f.read_bytes()).hexdigest()
        if not force and self.posters.get(coll.spotify_id) == digest:
            return False
        try:
            pl.uploadPoster(filepath=str(f))
        except PlexApiException as e:
            log.warn(f"Couldn't set the Plex poster for {coll.name!r}: {e}")
            return False
        self.posters[coll.spotify_id] = digest
        self._posters_f.write_text(json.dumps(self.posters, indent=1), "utf-8")
        return True

    def _find_section(self):
        name = os.getenv("PLEX_LIBRARY")
        music = [s for s in self.plex.library.sections() if s.type == "artist"]
        for s in music:
            if name and s.title == name:
                return s
            if not name and any(self.plex_prefix.startswith(_key(loc)) or _key(loc).startswith(self.plex_prefix)
                                for loc in s.locations):
                return s
        where = f"named {name!r}" if name else f"containing {self.plex_prefix}"
        raise RuntimeError(f"No Plex music library {where}. Add the songs folder to a Music library in Plex "
                           f"(or set PLEX_LIBRARY / PLEX_PATH_MAP in .env). Music libraries: "
                           f"{[s.title for s in music] or 'none'}")

    def plex_path(self, rel: str) -> str:
        return f"{self.plex_prefix}/{_key(rel)}"

    def tracks(self) -> dict:
        """Plex's file path -> track, for every track in the music library."""
        if self._tracks is None:
            self._tracks = {_key(part.file): t for t in self.section.searchTracks() for part in t.iterParts()}
            log.detail(f"plex: {len(self._tracks)} tracks indexed in {self.section.title!r}", log.INFO)
        return self._tracks

    def scan(self) -> None:
        """Ask Plex to scan the songs folder for new/moved files, and wait for it to finish."""
        if self.scanned:
            return
        log.say(f"asking Plex to scan {self.section.title!r} for new files...")
        self.section.update(path=self.plex_prefix if os.getenv("PLEX_PATH_MAP") else str(self.root))
        time.sleep(3)  # let the scan start before polling
        deadline = time.time() + SCAN_TIMEOUT_S
        while time.time() < deadline:
            if not self.plex.library.section(self.section.title).refreshing:
                break
            time.sleep(3)
        else:
            log.warn("Plex is still scanning; songs it hasn't reached yet will be added on the next sync.")
        self.scanned, self._tracks = True, None

    def _resolve(self, coll: Collection) -> tuple[list, list[str]]:
        items, missing, seen = [], [], set()
        for t in coll.tracks:
            if t.status != "done" or not t.file_path:
                continue
            item = self.tracks().get(self.plex_path(t.file_path))
            if item is None:
                missing.append(t.file_path)
            elif item.ratingKey not in seen:  # same song twice in a playlist: Plex keeps it once
                seen.add(item.ratingKey)
                items.append(item)
        return items, missing

    def sync(self, coll: Collection, dry_run: bool = False) -> dict:
        """Create/update one playlist. Returns {action, songs, added, removed, missing, message}:
        action is created | updated | up_to_date | skipped | would_create | would_update."""
        r = {"spotify_id": coll.spotify_id, "name": coll.name, "action": "", "songs": 0, "added": 0,
             "removed": 0, "missing": 0, "poster": False, "message": ""}
        items, missing = self._resolve(coll)
        if missing and not self.scanned and not dry_run:
            self.scan()
            items, missing = self._resolve(coll)
        for m in missing:
            log.detail(f"plex: not in Plex yet: {m}")
        r.update(songs=len(items), missing=len(missing))
        note = f" ({len(missing)} not in Plex yet)" if missing else ""
        if not items:
            return r | {"action": "skipped", "message": f"none of its {len(coll.tracks)} songs are in Plex yet"}

        same_name = [p for p in self.plex.playlists(playlistType="audio") if p.title == coll.name and not p.smart]
        ours = next((p for p in same_name if MARK in (p.summary or "")), None)
        if not ours and same_name:
            return r | {"action": "skipped",
                        "message": f"a playlist called {coll.name!r} already exists in Plex and wasn't made by this app"}
        if dry_run:
            if not ours:
                return r | {"action": "would_create", "added": len(items),
                            "message": f"would create with {len(items)} songs{note}"}
            current = {i.ratingKey for i in ours.items()}
            want = [i.ratingKey for i in items]
            add, gone = sum(k not in current for k in want), len(current - set(want))
            if not add and not gone and [i.ratingKey for i in ours.items()] == want:
                return r | {"action": "up_to_date", "message": f"up to date ({len(items)} songs){note}"}
            return r | {"action": "would_update", "added": add, "removed": gone,
                        "message": f"would update: {add} to add, {gone} to remove{note}"}
        summary = f"{MARK} from Spotify playlist https://open.spotify.com/playlist/{coll.spotify_id}"
        if not ours:
            pl = self.plex.createPlaylist(coll.name, section=self.section, items=items)
            pl.editSummary(summary)
            poster = self.set_poster(pl, coll, force=True)
            return r | {"action": "created", "added": len(items), "poster": poster,
                        "message": f"created with {len(items)} songs{note}"}

        poster = self.set_poster(ours, coll)
        current = ours.items()
        want = [i.ratingKey for i in items]
        if [i.ratingKey for i in current] == want:
            if poster:
                return r | {"action": "updated", "poster": True, "message": f"cover updated ({len(items)} songs){note}"}
            return r | {"action": "up_to_date", "message": f"up to date ({len(items)} songs){note}"}
        if gone := [i for i in current if i.ratingKey not in set(want)]:
            ours.removeItems(gone)
        have = {i.ratingKey for i in current}
        if new := [i for i in items if i.ratingKey not in have]:
            ours.addItems(new)
        ours.reload()
        if [i.ratingKey for i in ours.items()] != want:  # put everything in the Spotify order
            for n, item in enumerate(items):
                ours.moveItem(item, after=items[n - 1] if n else None)
        return r | {"action": "updated", "added": len(new), "removed": len(gone), "poster": poster,
                    "message": f"updated: {len(new)} added, {len(gone)} removed, {len(items)} songs{note}"
                               + ("; cover updated" if poster else "")}


def playlists(root: Path) -> list[Collection]:
    out = {}
    for f in sorted((root / ".cache").glob("*.json")):
        if f.name in _NOT_COLLECTIONS:
            continue
        try:
            c = Collection.model_validate_json(f.read_text("utf-8"))
        except ValueError:
            continue
        if c.kind == "playlist":
            out[c.spotify_id] = c
    return list(out.values())


class PlexError(Exception):
    """Plex isn't set up or can't be reached; the message says what to do."""


def connect(root: Path) -> PlexSync:
    if not configured():
        raise PlexError("Plex isn't set up: add PLEX_TOKEN (and PLEX_URL if it's not on this PC) in Settings or .env.")
    try:
        return PlexSync(root)
    except RuntimeError as e:  # no music library holds songs/
        raise PlexError(str(e)) from e
    except (PlexApiException, OSError) as e:
        log.exception("plex connect failed")
        url = os.getenv("PLEX_URL", "http://127.0.0.1:32400")
        if "401" in str(e) or "unauthorized" in str(e).lower():
            raise PlexError("Plex rejected the token (401). Check PLEX_TOKEN.") from e
        raise PlexError(f"Couldn't reach Plex at {url}: {log.explain(e)} Is Plex Media Server running?") from e


def sync_all(root: Path, dry_run: bool = False, only: list[Collection] | None = None,
             raise_errors: bool = False) -> dict | None:
    """Sync every cached playlist (or `only` these). Returns {library, dry_run, results} for the web UI;
    None if Plex couldn't be reached (the reason is logged), unless raise_errors."""
    try:
        ps = connect(root)
    except PlexError as e:
        if raise_errors:
            raise
        log.warn(str(e))
        return None
    colls = only if only is not None else playlists(root)
    log.say(f"[bold]plex[/]: syncing {len(colls)} playlist{'s' if len(colls) != 1 else ''} "
            f"into {ps.section.title!r}{' (dry run)' if dry_run else ''}")
    results = []
    for c in colls:
        try:
            r = ps.sync(c, dry_run)
            log.say(f"  {c.name}: {r['message']}")
        except PlexApiException as e:
            r = {"spotify_id": c.spotify_id, "name": c.name, "action": "error", "songs": 0, "added": 0,
                 "removed": 0, "missing": 0, "poster": False, "message": f"Plex refused: {e}"}
            log.say(f"  [red]{c.name}: Plex refused: {e}[/]", log.WARNING)
            log.exception(f"plex sync {c.name} failed")
        results.append(r)
    return {"library": ps.section.title, "dry_run": dry_run, "results": results}


def status(root: Path) -> tuple[str, str, str | None]:
    """(state, detail, fix) for the health check: ok | degraded | down | unknown."""
    if not configured():
        return ("unknown", "Not set up (optional). Playlists stay as .m3u8 files, which Plex doesn't read.",
                "Add PLEX_TOKEN under Connections to create the playlists in Plex.")
    try:
        ps = connect(root)
    except PlexError as e:
        return "down", str(e), None
    ours = sum(1 for p in ps.plex.playlists(playlistType="audio") if MARK in (p.summary or ""))
    return "ok", f"Library {ps.section.title!r}, {ours} synced playlist{'s' if ours != 1 else ''}", None


def refresh_poster(root: Path, coll: Collection) -> str:
    """After a cover was downloaded again: put it on the Plex playlist. Returns what happened."""
    if not configured():
        return "not set up"
    try:
        ps = connect(root)
    except PlexError as e:
        return f"couldn't reach Plex: {e}"
    ours = next((p for p in ps.plex.playlists(playlistType="audio")
                 if p.title == coll.name and not p.smart and MARK in (p.summary or "")), None)
    if not ours:
        return "not in Plex yet (it gets the cover on its first sync)"
    return "poster updated" if ps.set_poster(ours, coll, force=True) else "poster unchanged"
