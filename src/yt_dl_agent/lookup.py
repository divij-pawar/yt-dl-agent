"""What a request points at, before anything is downloaded: the artist's photo and bio, an album's cover and
year, and the releases a discography would fetch. Used by the chat's "I understood" step and the web UI.

Names are resolved with catalog.py (Tavily); photos, years and track counts come from Spotify's embed pages
(plain HTTP). The bio is Wikipedia's page summary, when there's a page that is plainly about a musician.
"""

import json
import re
import urllib.parse
import urllib.request
from functools import lru_cache

from . import catalog, llm
from .sources import UA, embed_entity, largest_image

KINDS = {"discography": ("Album", "EP", "Single"), "albums": ("Album", "EP")}
_MUSIC = re.compile(r"\b(band|singer|musician|rapper|duo|group|songwriter|producer|composer|dj|vocalist|"
                    r"guitarist|recording artist)\b", re.I)
_WIKI = "https://en.wikipedia.org/api/rest_v1/page/summary/"


@lru_cache(maxsize=256)
def wiki_bio(name: str) -> dict | None:
    """{"bio", "url", "image_url"} from Wikipedia, or None. "Beach House" is a page about a house, so
    "(band)" etc. are tried too, and a page only counts if it reads like a musician's."""
    for title in (name, f"{name} (band)", f"{name} (musician)", f"{name} (singer)", f"{name} (rapper)"):
        req = urllib.request.Request(_WIKI + urllib.parse.quote(title.replace(" ", "_"), safe=""),
                                     headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.load(r)
        except Exception:  # noqa: BLE001 - 404 means no such page; anything else, no bio
            continue
        text = data.get("extract") or ""
        if data.get("type") == "standard" and _MUSIC.search(f"{data.get('description') or ''} {text[:300]}"):
            return {"bio": text, "url": ((data.get("content_urls") or {}).get("desktop") or {}).get("page"),
                    "image_url": (data.get("thumbnail") or {}).get("source")}
    return None


def _year(ent: dict) -> int | None:
    y = ((ent.get("releaseDate") or {}).get("isoString") or "")[:4]
    return int(y) if y.isdigit() else None


def artist(name: str | None = None, aid: str | None = None, kinds: tuple[str, ...] = ()) -> dict:
    """kinds: which release types to list (empty: none, for "top songs")."""
    if aid is None:
        found = catalog.find_artist(name)
        if not found:
            raise LookupError(f"couldn't find the artist {name!r} on Spotify")
        name, aid = found
    ent = embed_entity("artist", aid)
    name = ent.get("name") or name
    wiki = wiki_bio(name)
    releases = []
    if kinds:
        wanted = [r for r in catalog.artist_releases(aid) if r.kind in kinds]
        releases = [{"id": r.id, "name": r.name, "year": r.year, "kind": r.kind, "cover_url": r.cover_url}
                    for r in catalog.own_releases(name, wanted)]
    return {"kind": "artist", "id": aid, "name": name, "subtitle": None,
            "image_url": largest_image(ent) or (wiki or {}).get("image_url"), "year": None,
            "bio": (wiki or {}).get("bio"), "bio_url": (wiki or {}).get("url"),
            "track_count": None if kinds else len(ent.get("trackList", [])), "releases": releases}


def album(aid: str) -> dict:
    ent = embed_entity("album", aid)
    return {"kind": "album", "id": aid, "name": ent["name"], "subtitle": (ent.get("subtitle") or "").replace("\xa0", " "),
            "image_url": largest_image(ent), "year": _year(ent), "bio": None, "bio_url": None,
            "track_count": len(ent.get("trackList", [])), "releases": []}


def track(tid: str) -> dict:
    ent = embed_entity("track", tid)
    return {"kind": "song", "id": tid, "name": ent["title"],
            "subtitle": ", ".join(a["name"] for a in ent.get("artists", [])),
            "image_url": largest_image(ent), "year": _year(ent), "bio": None, "bio_url": None,
            "track_count": 1, "releases": []}


def details(request: llm.Request | None, link: tuple[str, str] | None) -> dict | None:
    """None when there's nothing to show (playlists, profiles, library tools). LookupError when Spotify
    has no such artist/album/song."""
    if link:
        kind, sid = link
        if kind == "artist":
            return artist(aid=sid, kinds=KINDS["discography"])
        if kind == "top":
            return artist(aid=sid)
        return album(sid) if kind == "album" else track(sid) if kind == "track" else None
    r = request
    if r.kind in KINDS or r.kind == "top":
        return artist(name=r.artist, kinds=KINDS.get(r.kind, ()))
    if r.kind == "album":
        if found := catalog.find_album(r.title, r.artist):
            return album(found[1])
        raise LookupError(f'couldn\'t find "{r.title}" by {r.artist} on Spotify')
    if tid := catalog.find_track(r.title, r.artist):
        return track(tid)
    if found := catalog.find_album(r.title, r.artist):  # the same fallback chat._song takes
        return album(found[1])
    return None
