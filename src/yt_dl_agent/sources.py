"""Resolve a Spotify playlist/album into a Collection.

Order: Spotify Web API (full list, albums, track numbers) -> embed page JSON (first 100 tracks,
durations) -> Tavily Extract of the embed page (first 100 tracks, parsed by regex, LLM fallback).
"""

import base64
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

from tavily import TavilyClient

from . import llm, log
from .models import Collection, Track

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
EMBED_LIMIT = 100


class SourceError(Exception):
    pass


class Unsupported(SourceError):
    """This source can't handle this kind of link; quietly try the next one."""


_SOURCE_NAMES = {"from_spotify_api": "Spotify API", "from_embed": "Spotify embed page", "from_tavily": "Tavily"}
# Set once the Spotify API refuses us (e.g. no Premium), so a profile run doesn't retry it per playlist.
_api_disabled: str | None = None


def _get_json(url: str, headers: dict) -> dict:
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as r:
        return json.load(r)


def _split_artists(s: str) -> str:
    return ", ".join(a.strip() for a in s.replace("\xa0", " ").split(",") if a.strip())


# --- Spotify Web API -------------------------------------------------------


def _spotify_token() -> str | None:
    cid, sec = os.getenv("SPOTIFY_CLIENT_ID"), os.getenv("SPOTIFY_CLIENT_SECRET")
    if not cid or not sec:
        return None
    req = urllib.request.Request(
        "https://accounts.spotify.com/api/token",
        data=b"grant_type=client_credentials",
        headers={"Authorization": "Basic " + base64.b64encode(f"{cid}:{sec}".encode()).decode()},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def _api_track(t: dict, album: dict | None = None) -> Track:
    album = album or t.get("album") or {}
    return Track(
        title=t["name"],
        artist=", ".join(a["name"] for a in t.get("artists", [])),
        album=album.get("name"),
        album_artist=", ".join(a["name"] for a in album.get("artists", [])) or None,
        track_no=t.get("track_number"),
        duration_s=round(t["duration_ms"] / 1000) if t.get("duration_ms") else None,
        explicit=bool(t.get("explicit")),
        spotify_track_id=t.get("id"),
        album_id=album.get("id"),
        year=int(album["release_date"][:4]) if (album.get("release_date") or "")[:4].isdigit() else None,
        cover_url=max(album.get("images") or [{}], key=lambda i: i.get("width") or 0).get("url"),
    )


def from_spotify_api(kind: str, sid: str) -> Collection:
    if kind not in ("playlist", "album"):
        raise Unsupported(kind)  # the embed page has everything for single tracks / artist top tracks
    if _api_disabled:
        raise SourceError(_api_disabled)
    token = _spotify_token()
    if not token:
        raise SourceError("no SPOTIFY_CLIENT_ID/SECRET")
    h = {"Authorization": f"Bearer {token}"}
    api = "https://api.spotify.com/v1"
    try:
        if kind == "album":
            meta = _get_json(f"{api}/albums/{sid}", h)
            tracks, page = [], meta["tracks"]
            while page:
                tracks += [_api_track(t, meta) for t in page["items"]]
                page = _get_json(page["next"], h) if page.get("next") else None
            return Collection(kind=kind, spotify_id=sid, name=meta["name"], source="spotify-api",
                              owner_or_artist=", ".join(a["name"] for a in meta["artists"]), tracks=tracks)

        meta = _get_json(f"{api}/playlists/{sid}?fields=name,owner(display_name)", h)
        tracks, url = [], f"{api}/playlists/{sid}/tracks?limit=100"
        while url:
            page = _get_json(url, h)
            for it in page["items"]:
                t = it.get("track") or it.get("item")
                if t and t.get("type", "track") == "track" and t.get("name"):
                    tracks.append(_api_track(t))
            url = page.get("next")
        return Collection(kind=kind, spotify_id=sid, name=meta["name"], source="spotify-api",
                          owner_or_artist=meta.get("owner", {}).get("display_name"), tracks=tracks)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:200]
        raise SourceError(f"Spotify API {e.code}: {body}") from e


# --- Embed page (direct) ---------------------------------------------------


def _embed_url(kind: str, sid: str) -> str:
    return f"https://open.spotify.com/embed/{kind}/{sid}"


def largest_image(ent: dict) -> str | None:
    imgs = (ent.get("visualIdentity") or {}).get("image") or []
    return max(imgs, key=lambda i: i.get("maxWidth") or 0)["url"] if imgs else None


def embed_entity(kind: str, sid: str) -> dict:
    """The JSON behind open.spotify.com/embed/<kind>/<id> (playlist, album, track or artist)."""
    req = urllib.request.Request(_embed_url(kind, sid), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        html = r.read().decode("utf-8")
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        raise SourceError("embed page has no __NEXT_DATA__")
    return json.loads(m.group(1))["props"]["pageProps"]["state"]["data"]["entity"]


def from_embed(kind: str, sid: str) -> Collection:
    ent = embed_entity(kind, sid)
    if kind == "track":
        artists = ", ".join(a["name"] for a in ent.get("artists", []))
        iso = ((ent.get("releaseDate") or {}).get("isoString") or "")[:4]
        track = Track(title=ent["title"], artist=artists, spotify_track_id=sid,
                      duration_s=round(ent["duration"] / 1000) if ent.get("duration") else None,
                      explicit=bool(ent.get("isExplicit")), year=int(iso) if iso.isdigit() else None,
                      cover_url=largest_image(ent))
        return Collection(kind=kind, spotify_id=sid, name=ent["title"], owner_or_artist=artists,
                          source="embed", tracks=[track])
    owner = _split_artists(ent.get("subtitle") or "") or None
    if kind == "artist":  # embed artist pages carry the top 10 tracks
        owner = ent["name"]
    tracks = []
    for i, t in enumerate(ent.get("trackList", []), 1):
        tracks.append(Track(
            title=t["title"],
            artist=_split_artists(t["subtitle"]),
            duration_s=round(t["duration"] / 1000) if t.get("duration") else None,
            explicit=bool(t.get("isExplicit")),
            spotify_track_id=(t.get("uri") or "").rsplit(":", 1)[-1] or None,
            **({"album": ent["name"], "album_artist": owner, "track_no": i, "album_id": sid,
                "cover_url": largest_image(ent)} if kind == "album" else {}),
        ))
    if not tracks:
        raise SourceError("embed page has no tracks")
    name = f"{ent['name']} - top tracks" if kind == "artist" else ent["name"]
    return Collection(kind=kind, spotify_id=sid, name=name, owner_or_artist=owner,
                      source="embed", tracks=tracks)


# --- Tavily Extract of the embed page -------------------------------------

_MD_TRACK = re.compile(r"^### (.+?)\s*\n+#### (.+?)\s*$", re.M)
_MD_COVER = re.compile(r"!\[(.+?) cover\]")


def _strip_explicit_badge(artist: str) -> tuple[str, bool]:
    # Tavily glues Spotify's "E" badge to the artist: "ELana Del Rey". Keep real names like "EELS", "Ed".
    if len(artist) > 2 and artist[0] == "E" and artist[1].isupper() and not artist[2].isupper():
        return artist[1:], True
    return artist, False


def from_tavily(kind: str, sid: str) -> Collection:
    if kind not in ("playlist", "album"):
        raise Unsupported(kind)
    key = os.getenv("TAVILY_API_KEY")
    if not key:
        raise SourceError("no TAVILY_API_KEY")
    r = TavilyClient(key).extract(urls=[_embed_url(kind, sid)], extract_depth="basic")
    if not r.get("results"):
        raise SourceError(f"Tavily extract failed: {r.get('failed_results')}")
    text = r["results"][0].get("raw_content") or ""
    name_m = _MD_COVER.search(text)
    name = name_m.group(1) if name_m else sid

    tracks = []
    for title, artist in _MD_TRACK.findall(text):
        artist, explicit = _strip_explicit_badge(artist)
        tracks.append(Track(title=title, artist=_split_artists(artist), explicit=explicit))
    if not tracks:  # layout changed: let the small model read it
        tracks = [Track(title=s.title, artist=s.artist, album=s.album) for s in llm.extract_tracks(text)]
    if not tracks:
        raise SourceError("no tracks found in Tavily text")
    if kind == "album":
        for i, t in enumerate(tracks, 1):
            t.album, t.track_no = name, i
    return Collection(kind=kind, spotify_id=sid, name=name, source="tavily", tracks=tracks)


# --- User profile -> playlists --------------------------------------------

_MD_PLAYLIST = re.compile(
    r"\[((?:[^\[\]]|\[[^\[\]]*\])+)\]\((?:https://open\.spotify\.com)?/playlist/([A-Za-z0-9]{22})"
)
PROFILE_ROUNDS = 4  # the profile pages fail to load about half the time


def _user_playlists_api(uid: str) -> list[tuple[str, str]]:
    if _api_disabled:
        raise SourceError(_api_disabled)
    token = _spotify_token()
    if not token:
        raise SourceError("no SPOTIFY_CLIENT_ID/SECRET")
    h, out = {"Authorization": f"Bearer {token}"}, []
    url = f"https://api.spotify.com/v1/users/{urllib.parse.quote(uid)}/playlists?limit=50"
    try:
        while url:
            page = _get_json(url, h)
            out += [(p["name"], p["id"]) for p in page["items"] if p]
            url = page.get("next")
    except urllib.error.HTTPError as e:
        raise SourceError(f"Spotify API {e.code}: {e.read().decode(errors='replace')[:200]}") from e
    return out


def _user_playlists_tavily(uid: str) -> list[tuple[str, str]]:
    key = os.getenv("TAVILY_API_KEY")
    if not key:
        raise SourceError("no TAVILY_API_KEY")
    client = TavilyClient(key)
    base = f"https://open.spotify.com/user/{urllib.parse.quote(uid)}"
    # /playlists is the full list; the profile page only shows the first ~10.
    for url in (f"{base}/playlists", base):
        for _ in range(PROFILE_ROUNDS):
            r = client.extract(urls=[url], extract_depth="advanced")
            raw = (r["results"][0].get("raw_content") or "") if r.get("results") else ""
            if found := _MD_PLAYLIST.findall(raw):
                if url == base:
                    log.warn("Only the profile page loaded; it shows ~10 playlists, not all of them.")
                seen, out = set(), []
                for name, pid in found:
                    if pid not in seen:
                        seen.add(pid)
                        out.append((name, pid))
                return out
    raise SourceError("Tavily couldn't load the profile's playlists")


def user_playlists(uid: str) -> list[tuple[str, str]]:
    """(name, playlist id) for every public playlist on a profile."""
    for name, fn in (("Spotify API", _user_playlists_api), ("Tavily", _user_playlists_tavily)):
        try:
            if found := fn(uid):
                return found
        except Exception as e:  # noqa: BLE001 - try the next source
            _source_failed(name, e)
    raise SourceError(f"no public playlists found for user {uid}")


def _source_failed(name: str, e: Exception) -> str:
    """Log a source failure once, in plain language. Returns the explanation."""
    global _api_disabled
    why = "no credentials in .env." if "no SPOTIFY_CLIENT_ID" in str(e) else log.explain(e)
    if name == "Spotify API":
        if _api_disabled:
            return why  # already explained earlier in this run
        _api_disabled = why
        log.warn(f"{name} not available: {why} Skipping it for the rest of this run.")
    else:
        log.warn(f"{name} failed: {why}")
    log.detail(f"{name} raw error: {e}")
    return why


def resolve(kind: str, sid: str) -> Collection:
    errors = []
    for fn in (from_spotify_api, from_embed, from_tavily):
        name = _SOURCE_NAMES[fn.__name__]
        try:
            coll = fn(kind, sid)
        except Unsupported:
            continue
        except Exception as e:  # noqa: BLE001 - every source failure means "try the next one"
            errors.append(f"{name}: {_source_failed(name, e)}")
            continue
        if coll.source != "spotify-api" and kind == "playlist" and len(coll.tracks) >= EMBED_LIMIT:
            log.warn(f"Only the first {EMBED_LIMIT} tracks are visible without the Spotify API; "
                     "this playlist may have more.")
        return coll
    raise SourceError("couldn't get the track list from any source. " + " | ".join(errors))
