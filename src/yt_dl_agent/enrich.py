"""Fill in what good tags need, from Spotify's embed pages (plain HTTP, no Tavily credits):

- each track's page: 640x640 album cover and release year
- the album's page:  track number (position in the album), album artist, album name
"""

from concurrent.futures import ThreadPoolExecutor

from . import log
from .models import Track
from .sources import largest_image
from .sources import embed_entity

WORKERS = 8


def year(ent: dict) -> int | None:
    iso = ((ent.get("releaseDate") or {}).get("isoString") or "")[:4]
    return int(iso) if iso.isdigit() else None


def _entity(kind: str, sid: str) -> dict | None:
    try:
        return embed_entity(kind, sid)
    except Exception as e:  # noqa: BLE001 - missing extras just mean fewer tags
        log.detail(f"embed {kind}/{sid} failed: {e}")
        return None


def enrich(tracks: list[Track]) -> None:
    with ThreadPoolExecutor(WORKERS) as pool:
        need = [t for t in tracks if t.spotify_track_id and (not t.cover_url or not t.year)]
        for t, ent in zip(need, pool.map(lambda t: _entity("track", t.spotify_track_id), need)):
            if ent:
                t.cover_url = t.cover_url or largest_image(ent)
                t.year = t.year or year(ent)

        by_album: dict[str, list[Track]] = {}
        for t in tracks:
            if t.album_id and (not t.track_no or not t.album_artist):
                by_album.setdefault(t.album_id, []).append(t)
        for aid, ent in zip(by_album, pool.map(lambda a: _entity("album", a), list(by_album))):
            if not ent:
                continue
            pos = {(x.get("uri") or "").rsplit(":", 1)[-1]: i for i, x in enumerate(ent.get("trackList", []), 1)}
            owner = (ent.get("subtitle") or "").replace("\xa0", " ")
            for t in by_album[aid]:
                if not t.track_no and t.spotify_track_id in pos:
                    t.track_no = pos[t.spotify_track_id]
                t.album_artist = t.album_artist or owner or None
                t.album = t.album or ent.get("name")
                t.cover_url = t.cover_url or largest_image(ent)
