"""Playlist and album covers: Spotify's own image, saved as songs/.cache/covers/collections/<id>.jpg.

The web UI shows it, and plex.py uses it as the playlist's poster in Plex. Saved on every download run
when missing; `refresh` fetches it again from Spotify (a playlist's cover can change, and old image
URLs can stop working).
"""

import os
import re
import urllib.request
from pathlib import Path

from . import log
from .models import Collection
from .sources import UA, embed_entity, largest_image

_SPOTIFY_ID = re.compile(r"[A-Za-z0-9]{22}")
_KINDS = {"playlist", "album", "artist", "track"}


def path(root: Path, sid: str) -> Path:
    return root / ".cache" / "covers" / "collections" / f"{sid}.jpg"


def _fetch(url: str) -> bytes | None:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
            data = r.read()
    except OSError as e:
        log.detail(f"cover download failed {url}: {e}")
        return None
    return data if data[:3] == b"\xff\xd8\xff" or data[:8] == b"\x89PNG\r\n\x1a\n" else None


def ensure(root: Path, coll: Collection, refresh: bool = False) -> Path | None:
    """The saved cover for a collection, downloading it if needed. Sets coll.cover_url. Never raises."""
    f = path(root, coll.spotify_id)
    if f.exists() and not refresh:
        return f
    url = coll.cover_url
    if (refresh or not url) and coll.kind in _KINDS and _SPOTIFY_ID.fullmatch(coll.spotify_id):
        try:  # ask Spotify for the current image
            url = largest_image(embed_entity(coll.kind, coll.spotify_id)) or url
        except Exception as e:  # noqa: BLE001 - keep the old URL / file
            log.detail(f"embed {coll.kind}/{coll.spotify_id} for its cover failed: {e}")
    if not url or not (data := _fetch(url)):
        return f if f.exists() else None
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, f)
    coll.cover_url = url
    log.detail(f"cover for {coll.kind} {coll.name!r} saved ({len(data) // 1024} KB)", log.INFO)
    return f
