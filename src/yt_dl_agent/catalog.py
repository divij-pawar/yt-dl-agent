"""Find Spotify artists, albums and tracks by name, without the Spotify API.

- Names -> IDs: Tavily Search restricted to open.spotify.com. Result titles have fixed shapes
  ("X - Album by A", "X - song and lyrics by A", "A | Spotify"), so matching is plain code.
- Artist releases: Tavily Extract (advanced) of the artist page's Discography section plus the
  /discography/album and /discography/single pages. Spotify renders these lazily, so each shows only
  part of the list; the union covers most artists. "Appears On" / "Featuring" are excluded.
"""

import os
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from tavily import TavilyClient

from . import log
from .match import norm
from .sources import embed_entity, largest_image

_ID = r"([A-Za-z0-9]{22})"
_ARTIST_ANY = re.compile(r"open\.spotify\.com/(?:intl-[a-z-]+/)?artist/" + _ID)
# The ID must end the path: skips /artist/<id>/concerts, /artist/<id>/discography, ...
_URL = re.compile(r"open\.spotify\.com/(?:intl-[a-z-]+/)?(artist|album|track)/" + _ID + r"/?(?:[?#]|$)")
_LINK = r"\[((?:[^\[\]]|\[[^\[\]]*\])+)\]\((?:https://open\.spotify\.com)?/album/" + _ID + r"\)"
# Artist page:      [Currents](…/album/…)\n\n2015 • Album     (or "Latest Release • Single")
_ARTIST_PAGE_RELEASE = re.compile(_LINK + r"\s*\n+(?:Latest Release|(\d{4})) • (Album|Single|EP|Compilation)")
# Discography page: [Deadbeat](…/album/…)\n\nAlbum•2025•12 songs
_DISCO_PAGE_RELEASE = re.compile(_LINK + r"\s*\n+(Album|Single|EP|Compilation)•(\d{4})")
_TITLE_ALBUM = re.compile(r"^(.*) - (Album|EP|Single|Compilation) by (.+?)(?: \| Spotify)?$")
EXTRACT_ROUNDS = 4


@dataclass
class Release:
    name: str
    id: str
    kind: str  # Album | Single | EP | Compilation
    year: int | None = None
    cover_url: str | None = None  # filled in by own_releases


def _client() -> TavilyClient:
    key = os.getenv("TAVILY_API_KEY")
    if not key:
        raise RuntimeError("TAVILY_API_KEY is not set in .env; it's needed to look things up by name")
    return TavilyClient(key)


def _search(query: str) -> list[tuple[str, str, str]]:
    """(kind, id, page title) for open.spotify.com results. Artist subpages (/artist/<id>/concerts)
    come back as "artist-sub": the ID is right, but the page title isn't the artist's name."""
    res = _client().search(query, max_results=8, include_domains=["open.spotify.com"])
    out = []
    for r in res.get("results", []):
        url, title = r.get("url", ""), (r.get("title") or "").replace("‎", "").strip()
        if m := _URL.search(url):
            out.append((m.group(1), m.group(2), title))
        elif m := _ARTIST_ANY.search(url):
            out.append(("artist-sub", m.group(1), title))
    log.detail(f"catalog search {query!r}: {[(k, t) for k, _, t in out]}")
    return out


def _same(a: str, b: str) -> bool:
    return norm(a) == norm(b)


def _artist_in(artist: str, credits: str) -> bool:
    want = norm(artist)
    return any(norm(c) == want for c in credits.split(",")) or want in norm(credits)


_artists: dict[str, tuple[str, str]] = {}  # the confirm step looks things up, then the run does it again
_releases: dict[str, list[Release]] = {}


def find_artist(name: str) -> tuple[str, str] | None:
    """(display name, artist id)"""
    if (key := norm(name)) not in _artists and (found := _find_artist(name)):
        _artists[key] = found
    return _artists.get(key)


def _find_artist(name: str) -> tuple[str, str] | None:
    for query in (f"{name} artist", f"{name} spotify artist"):
        results = _search(query)
        for kind, aid, title in results:
            title = title.removesuffix(" | Spotify").strip()
            if kind == "artist" and _same(title, name):
                return title, aid
        # No exact artist page: check candidate IDs (subpages included) against their real name,
        # starting with the ones whose page title mentions the name.
        cands = [(i, t) for k, i, t in results if k in ("artist", "artist-sub")]
        cands.sort(key=lambda c: norm(name) not in norm(c[1]))
        for aid in list(dict.fromkeys(i for i, _ in cands))[:3]:
            try:
                real = embed_entity("artist", aid)["name"]
            except Exception:  # noqa: BLE001 - just a candidate
                continue
            if _same(real, name) or norm(name) in norm(real) or norm(real) in norm(name):
                return real, aid
    return None


def artist_releases(artist_id: str) -> list[Release]:
    if artist_id not in _releases and (found := _artist_releases(artist_id)):
        _releases[artist_id] = found
    return _releases.get(artist_id, [])


def _artist_releases(artist_id: str) -> list[Release]:
    base = f"https://open.spotify.com/artist/{artist_id}"
    pages = {base: _ARTIST_PAGE_RELEASE, f"{base}/discography/album": _DISCO_PAGE_RELEASE,
             f"{base}/discography/single": _DISCO_PAGE_RELEASE}
    raw: dict[str, str] = {}
    client = _client()
    for _ in range(EXTRACT_ROUNDS):
        todo = [u for u in pages if u not in raw]
        if not todo:
            break
        r = client.extract(urls=todo, extract_depth="advanced")
        for x in r.get("results", []):
            if x.get("raw_content") and x.get("url") in pages:
                raw[x["url"]] = x["raw_content"]
    if missing := [u for u in pages if u not in raw]:
        log.detail(f"artist pages that never loaded: {missing}", log.WARNING)

    found: dict[str, Release] = {}
    if text := raw.get(base):
        # Only the Discography section: stop before "Featuring …" / "Appears On".
        start = text.find("## [Discography]")
        end = text.find("\n## ", start + 1)
        section = text[start:end] if start >= 0 else ""
        for name, rid, year, kind in _ARTIST_PAGE_RELEASE.findall(section):
            found[rid] = Release(name, rid, kind, int(year) if year else None)
    for url in (f"{base}/discography/album", f"{base}/discography/single"):
        for name, rid, kind, year in _DISCO_PAGE_RELEASE.findall(raw.get(url, "")):
            found.setdefault(rid, Release(name, rid, kind, int(year)))
    return sorted(found.values(), key=lambda r: (r.year or 9999, r.name))


def own_releases(artist: str, releases: list[Release]) -> list[Release]:
    """Drop releases where the artist is only featured: the discography pages list e.g. another
    artist's single that this artist sings on. Checked against each release's embed page (plain HTTP)."""
    def owner(rel: Release) -> str:
        try:
            ent = embed_entity("album", rel.id)
        except Exception:  # noqa: BLE001 - can't check: keep it
            return artist
        rel.cover_url = largest_image(ent)
        return ent.get("subtitle") or ""

    with ThreadPoolExecutor(8) as pool:
        owners = list(pool.map(owner, releases))
    keep = []
    for rel, credits in zip(releases, owners):
        main = credits.replace("\xa0", " ").split(",")[0]
        if _same(main, artist):
            keep.append(rel)
        else:
            log.detail(f"skipping {rel.name!r}: by {credits!r}, not {artist!r}")
    return keep


def find_album(title: str, artist: str) -> tuple[str, str] | None:
    """(album name, album id): search first, then the artist's discography."""
    for kind, aid, page in _search(f"{title} {artist} album"):
        if kind == "album" and (m := _TITLE_ALBUM.match(page)):
            if _same(m.group(1), title) and _artist_in(artist, m.group(3)):
                return m.group(1), aid
    if found := find_artist(artist):
        releases = artist_releases(found[1])
        for r in releases:
            if _same(r.name, title):
                return r.name, r.id
        for r in releases:  # "Currents" -> "Currents (Deluxe)"
            if norm(r.name).startswith(norm(title)):
                return r.name, r.id
    return None


_FEAT = re.compile(r"\s*[\(\[](?:feat|ft|with)\.?\s[^\)\]]*[\)\]]|\s+(?:feat|ft)\.?\s.*$", re.I)


def _core(title: str) -> str:
    """'Goodbye (feat. Lyse)' and 'Goodbye ft. Lyse' -> 'goodbye'"""
    return norm(_FEAT.sub("", title))


# Only notes that don't change the recording: '(From "Karwaan")', '[Taken from …]'. Never '(… Remix)'.
_FROM = re.compile(r"\s*[\(\[](?:from|taken from)\b[^\)\]]*[\)\]]", re.I)


def _bare(title: str) -> str:
    """'Saansein (From "Karwaan")' -> 'saansein'"""
    return _core(_FROM.sub("", title))


def _track_page(page: str) -> tuple[str, str] | None:
    """(song title, credits) from a track page title in any language:
    'X - song and lyrics by A', 'X - música y letra de A', 'X (From "Y") - A'."""
    page = page.removesuffix(" | Spotify").strip()
    if " - " not in page:
        return None
    song, rest = page.rsplit(" - ", 1)  # "X - Live - song and lyrics by A" -> "X - Live"
    return song, rest


def find_tracks(title: str, artist: str) -> list[str]:
    """Spotify track ids whose page title matches (all releases: album, single, compilation...).
    "- Live" / "- Remix" pages don't match a plain title."""
    out: list[str] = []
    for query in (f'"{title}" {artist}', f"{title} {artist} song"):
        for kind, tid, page in _search(query):
            if kind != "track" or tid in out or not (parsed := _track_page(page)):
                continue
            song, credits = parsed
            if (_core(song) == _core(title) or _bare(song) == _bare(title)) and norm(artist) in norm(credits):
                out.append(tid)
        if out:
            break
    return out


def find_tracks_any_artist(title: str) -> list[str]:
    """Track ids for a title alone (no artist known). Only good for suggestions."""
    out = []
    for kind, tid, page in _search(f'"{title}" song'):
        if kind == "track" and (parsed := _track_page(page)) and _core(parsed[0]) == _core(title) and tid not in out:
            out.append(tid)
    return out


def find_track(title: str, artist: str) -> str | None:
    found = find_tracks(title, artist)
    return found[0] if found else None
