"""Resolve each track to a YouTube video and download it as a 320 kbps MP3."""

import shutil
import time
from pathlib import Path

from yt_dlp import YoutubeDL

from . import log, match, tags
from .library import rel_path, search_url
from .models import Track

SEARCH_RESULTS = 8
YTMUSIC_RESULTS = 3
RETRIES = 2


def _js_runtimes() -> dict:
    # yt-dlp defaults to deno; fall back to node when that's what is installed.
    if shutil.which("deno"):
        return {"deno": {}}
    if shutil.which("node"):
        return {"node": {}}
    return {}


class NoMatch(Exception):
    pass


def _label(t: Track) -> str:
    return f"{t.primary_artist} - {t.title}"


def _base_opts(t: Track, cookies_browser: str | None) -> dict:
    opts = {"quiet": True, "no_warnings": True, "noprogress": True, "js_runtimes": _js_runtimes(),
            "logger": log.YtdlpLogger(_label(t))}
    if cookies_browser:
        opts["cookiesfrombrowser"] = (cookies_browser,)
    return opts


def _ytmusic_candidates(t: Track, opts: dict) -> list[dict]:
    """YT Music song results only carry title + id, so fetch details for the ones whose title fits."""
    with YoutubeDL(opts | {"extract_flat": True, "playlistend": YTMUSIC_RESULTS}) as y:
        info = y.extract_info(f"{search_url(t)}#songs", download=False)
    want = match.norm(t.title)
    out = []
    with YoutubeDL(opts) as y:
        for e in (info.get("entries") or [])[:YTMUSIC_RESULTS]:
            have = match.norm(e.get("title") or "")
            if e.get("id") and have and (have in want or want in have):
                full = y.extract_info(f"https://music.youtube.com/watch?v={e['id']}", download=False, process=False)
                out.append({"id": e["id"], "title": full.get("title"),
                            "channel": full.get("channel") or full.get("uploader") or "",
                            "duration": full.get("duration")})
    return out


def resolve(t: Track, cookies_browser: str | None = None) -> tuple[str, float]:
    opts = _base_opts(t, cookies_browser)
    with YoutubeDL(opts | {"extract_flat": True}) as y:
        info = y.extract_info(f"ytsearch{SEARCH_RESULTS}:{t.primary_artist} {t.title}", download=False)
    cand, s = match.best(t, info.get("entries") or [])
    if not cand or s < match.MIN_SCORE:  # obscure tracks: YouTube search misses, YT Music has them
        log.detail(f"[{_label(t)}] YouTube search best score {s:.0f} < {match.MIN_SCORE}; trying YT Music")
        cand2, s2 = match.best(t, _ytmusic_candidates(t, opts))
        if cand2 and s2 > s:
            cand, s = cand2, s2
    if not cand or s < match.MIN_SCORE:
        raise NoMatch(f"No YouTube/YT Music result was close enough in title and duration "
                      f"(best score {s:.0f}, need {match.MIN_SCORE}). Search: {search_url(t)}")
    log.detail(f"[{_label(t)}] matched {cand['id']} '{cand.get('title')}' / {cand.get('channel')} "
               f"/ {cand.get('duration')}s (spotify {t.duration_s}s), score {s:.0f}", log.INFO)
    return cand["id"], s


def download(t: Track, root: Path, bitrate: int = 320, cookies_browser: str | None = None) -> Track:
    """Resolve + download one track. Never raises; sets t.status/t.error instead."""
    rel = rel_path(t)
    out = root / f"{rel}.mp3"
    t.file_path = f"{rel}.mp3"
    if out.exists():
        t.status = "done"
        return t
    out.parent.mkdir(parents=True, exist_ok=True)

    for attempt in range(RETRIES + 1):
        try:
            if not t.video_id:
                t.video_id, _ = resolve(t, cookies_browser)
            # Spotify's square album cover when we have it; the YouTube thumbnail only as a fallback.
            cover = tags.fetch_cover(t.cover_url, root / ".cache" / "covers")
            post = [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": str(bitrate)}]
            opts = _base_opts(t, cookies_browser) | {
                "format": "bestaudio/best",
                "outtmpl": str(root / f"{rel}.%(ext)s"),
                "writethumbnail": not cover,
                "postprocessors": post + ([] if cover else [{"key": "EmbedThumbnail"}]),
            }
            with YoutubeDL(opts) as y:
                y.download([f"https://www.youtube.com/watch?v={t.video_id}"])
            tags.write(out, t, cover)
            t.status, t.error = "done", None
            return t
        except NoMatch as e:
            t.status, t.error = "failed", str(e)
            log.detail(f"[{_label(t)}] {e}", log.WARNING)
            return t
        except Exception as e:  # noqa: BLE001 - recorded on the track, reported in the summary
            t.status, t.error = "failed", log.explain(e)
            log.exception(f"[{_label(t)}] attempt {attempt + 1}/{RETRIES + 1} failed")
            if attempt < RETRIES:
                log.warn(f"  retry {attempt + 1}/{RETRIES} {_label(t)}: {t.error}")
                log.event("retry", label=f"{t.artist} - {t.title}", attempt=attempt + 1, of=RETRIES, error=t.error)
                time.sleep(2 * (attempt + 1))
    _cleanup_partials(out)
    return t


def _cleanup_partials(out: Path) -> None:
    """Remove leftovers (.webm, .part, thumbnails) of a download that failed for good."""
    if not out.parent.exists():
        return
    for f in out.parent.iterdir():
        if f.name.startswith(f"{out.stem}.") and f.suffix != ".mp3":
            f.unlink(missing_ok=True)
