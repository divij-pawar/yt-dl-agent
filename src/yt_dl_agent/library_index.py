"""Index of songs already in the library, so a song is reused instead of downloaded again under a
different name. Album downloads number their files and playlists don't, and the same song can be filed
under different releases (album vs deluxe vs single).

Lookup order: Spotify track ID (exact), then artist|title with durations within a few seconds.
Stored in songs/.cache/library.json; built from the per-collection caches the first time.
"""

import json
from pathlib import Path

from .models import Collection, Track

DURATION_TOLERANCE_S = 5
_NOT_COLLECTIONS = {"albums.json", "library.json", "unsorted.json"}


class LibraryIndex:
    def __init__(self, root: Path):
        self.root = root
        self.path = root / ".cache" / "library.json"
        data = json.loads(self.path.read_text("utf-8")) if self.path.exists() else {}
        self.by_id: dict[str, str] = data.get("by_id", {})
        self.by_key: dict[str, dict] = data.get("by_key", {})
        if not data:
            self._bootstrap()

    def _bootstrap(self) -> None:
        for f in sorted((self.root / ".cache").glob("*.json")):
            if f.name in _NOT_COLLECTIONS:
                continue
            try:
                coll = Collection.model_validate_json(f.read_text("utf-8"))
            except ValueError:
                continue
            for t in coll.tracks:
                if t.status == "done" and t.file_path:
                    self.add(t)
        self.save()

    def _exists(self, rel: str | None) -> bool:
        return bool(rel) and (self.root / rel).exists()

    def find(self, t: Track) -> str | None:
        if t.spotify_track_id and self._exists(p := self.by_id.get(t.spotify_track_id)):
            return p
        e = self.by_key.get(t.key)
        if e and self._exists(e["path"]):
            known = e.get("duration_s")
            if not t.duration_s or not known or abs(t.duration_s - known) <= DURATION_TOLERANCE_S:
                return e["path"]
        return None

    def add(self, t: Track) -> None:
        if not t.file_path:
            return
        if t.spotify_track_id and not self._exists(self.by_id.get(t.spotify_track_id)):
            self.by_id[t.spotify_track_id] = t.file_path
        if not self._exists((self.by_key.get(t.key) or {}).get("path")):
            self.by_key[t.key] = {"path": t.file_path, "duration_s": t.duration_s}

    def save(self) -> None:
        self.path.write_text(json.dumps({"by_id": self.by_id, "by_key": self.by_key}, indent=1,
                                        ensure_ascii=False), "utf-8")


def relink(root: Path, moves: dict[str, str]) -> None:
    """Files moved inside the library (old rel path -> new rel path): update the index, every cached
    collection, and rewrite the .m3u8 of every playlist that uses one of them."""
    if not moves:
        return
    from .playlist import write_m3u8  # local: playlist -> library -> models; avoids a cycle at import

    index = LibraryIndex(root)
    for k, p in index.by_id.items():
        index.by_id[k] = moves.get(p, p)
    for e in index.by_key.values():
        e["path"] = moves.get(e["path"], e["path"])
    index.save()

    for f in (root / ".cache").glob("*.json"):
        if f.name in _NOT_COLLECTIONS:
            continue
        try:
            coll = Collection.model_validate_json(f.read_text("utf-8"))
        except ValueError:
            continue
        hit = False
        for t in coll.tracks:
            if t.file_path in moves:
                t.file_path, hit = moves[t.file_path], True
        if hit:
            f.write_text(coll.model_dump_json(indent=1), "utf-8")
            if coll.kind == "playlist":
                write_m3u8(root, coll)
