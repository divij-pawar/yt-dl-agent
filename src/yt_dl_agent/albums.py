"""Fill in missing album names.

1. Tavily Extract on each track's own Spotify page; the album is the first /album/ link under the
   song heading. Exact, cheap (20 URLs per call), no LLM. Pages fail to load often, so retry and
   escalate to advanced depth.
2. Anything still missing: Tavily Search, and the small model picks the album from the snippets.
"""

import json
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from itertools import batched
from pathlib import Path

from tavily import TavilyClient

from . import llm, log
from .models import Track

EXTRACT_ROUNDS = ("basic", "basic", "advanced", "advanced")
EXTRACT_BATCH = 20

# Album names can contain brackets: "Goodbye (feat. Lyse) [Remixes]"
_ALBUM_LINK = re.compile(r"\[((?:[^\[\]]|\[[^\[\]]*\])+)\]\((?:https://open\.spotify\.com)?/album/([A-Za-z0-9]{22})")
_SONG_HEADING = re.compile(r"^Song\s*\n+# .+$", re.M)

_lock = threading.Lock()


def album_from_track_page(raw: str) -> tuple[str, str] | None:
    """(album name, album id)"""
    head = _SONG_HEADING.search(raw)
    m = _ALBUM_LINK.search(raw, head.end() if head else 0)
    return (m.group(1).strip(), m.group(2)) if m else None


def _from_track_pages(client: TavilyClient, tracks: list[Track]) -> None:
    by_url = {f"https://open.spotify.com/track/{t.spotify_track_id}": t for t in tracks}
    pending = list(by_url)
    for depth in EXTRACT_ROUNDS:
        if not pending:
            break
        for batch in batched(pending, EXTRACT_BATCH):
            try:
                r = client.extract(urls=list(batch), extract_depth=depth)
            except Exception as e:  # noqa: BLE001 - next round retries what's left
                log.warn(f"  Tavily couldn't fetch track pages: {log.explain(e)} Retrying what's left.")
                log.exception("track page extract failed")
                continue
            for x in r.get("results", []):
                t = by_url.get(x.get("url"))
                if t and (found := album_from_track_page(x.get("raw_content") or "")):
                    t.album, t.album_id = found
        pending = [u for u in pending if not by_url[u].album]
    log.say(f"  from Spotify track pages: {len(by_url) - len(pending)}/{len(by_url)}")


def _search_title(title: str) -> str:
    return re.sub(r"\s*\((feat|with)\.? [^)]*\)", "", title, flags=re.I).strip()


def _from_search(client: TavilyClient, tracks: list[Track], workers: int) -> None:
    def one(t: Track) -> None:
        try:
            res = client.search(f'"{_search_title(t.title)}" {t.primary_artist} song album', max_results=4)
            snippets = [f"{r['title']}: {r['content'][:300]}" for r in res.get("results", [])]
            t.album = llm.pick_album(t.title, t.primary_artist, snippets) if snippets else None
        except Exception as e:  # noqa: BLE001 - a failed lookup just means "Singles"
            log.warn(f"  album lookup failed for {t.artist} - {t.title}: {log.explain(e)}")
            log.exception(f"album search failed for {t.artist} - {t.title}")

    with ThreadPoolExecutor(workers) as pool:
        list(pool.map(one, tracks))
    log.say(f"  from Tavily search + Ollama: {sum(1 for t in tracks if t.album)}/{len(tracks)}")
    for t in tracks:
        log.detail(f"album via search + LLM: {t.artist} - {t.title} -> {t.album}")


def _cache_key(t: Track) -> str:
    # By Spotify track ID: one song can exist on several releases (album, single, compilation).
    return t.spotify_track_id or t.key


def _cached(cache: dict, t: Track) -> tuple[str | None, str | None]:
    entry = cache.get(_cache_key(t))
    if entry is None and isinstance(cache.get(t.key), str):
        entry = cache[t.key]  # older caches: album name by artist|title
    if entry is None:
        return None, None
    return (entry, None) if isinstance(entry, str) else (entry.get("album"), entry.get("album_id"))


def fill_albums(tracks: list[Track], cache_path: Path, workers: int = 4, force: bool = False) -> None:
    """force: re-check every track that has a Spotify ID and no album ID yet (used by `fix`)."""
    cache: dict = json.loads(cache_path.read_text("utf-8")) if cache_path.exists() else {}
    todo = []
    for t in tracks:
        cached = _cached(cache, t)
        if force:
            if t.spotify_track_id and not t.album_id and not cached[1]:
                todo.append(t)
            elif not t.album_id and cached[1]:
                t.album, t.album_id = cached
        elif not t.album and cached[0]:
            t.album, t.album_id = cached
        elif not t.album:
            todo.append(t)
    if not todo:
        return
    key = os.getenv("TAVILY_API_KEY")
    if not key:
        log.warn("No TAVILY_API_KEY in .env, so albums can't be looked up; they go to 'Singles'.")
        return
    client = TavilyClient(key)
    log.say(f"looking up albums for {len(todo)} track{'' if len(todo) == 1 else 's'}")

    before = {id(t): t.album for t in todo}
    if with_id := [t for t in todo if t.spotify_track_id]:
        for t in with_id:
            t.album = None if force else t.album
        _from_track_pages(client, with_id)
        if force:  # a page that didn't load keeps the album it had
            for t in with_id:
                t.album = t.album or before[id(t)]
    if rest := [t for t in todo if not t.album]:
        _from_search(client, rest, workers)

    with _lock:  # misses aren't cached, so reruns retry
        cache.update({_cache_key(t): {"album": t.album, "album_id": t.album_id} for t in todo if t.album})
        cache_path.write_text(json.dumps(cache, indent=1, ensure_ascii=False), "utf-8")
    if missing := sum(1 for t in todo if not t.album):
        log.say(f"  no album found for {missing}; they go to 'Singles' (retried next run)")
