"""Resolve each track to a YouTube video and download it as a 320 kbps MP3."""

import http.cookiejar
import shutil
import threading
import time
from pathlib import Path

from yt_dlp import YoutubeDL
from yt_dlp.cookies import CookieLoadError, extract_cookies_from_browser

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


# --- the YouTube login (cookies) -------------------------------------------------------
# From a cookies.txt file (most reliable), or read from a browser. On Windows, Chrome can't be read:
# it locks its cookie database while open, and newer versions encrypt cookies for Chrome alone.

_broken: dict[tuple, str] = {}  # login source -> why it couldn't be read; skipped for the rest of this process
_broken_lock = threading.Lock()
SIGN_IN_COOKIES = {"SID", "__Secure-1PSID", "__Secure-3PSID", "SAPISID", "LOGIN_INFO"}


def login_source(cookies_browser: str | None, cookies_file: str | None) -> tuple | None:
    """A file wins over a browser. A file's mtime is part of it, so re-exporting it gets a fresh try."""
    if cookies_file:
        p = Path(cookies_file)
        return ("file", str(p), p.stat().st_mtime if p.is_file() else None)
    return ("browser", cookies_browser) if cookies_browser else None


def _login_opts(src: tuple | None) -> dict:
    if not src or src in _broken:
        return {}
    if src[0] == "file":
        if src[2] is None:  # yt-dlp would silently use no cookies
            _give_up_on(src, f"the file {src[1]} doesn't exist")
            return {}
        return {"cookiefile": src[1]}
    return {"cookiesfrombrowser": (src[1],)}


def is_login_error(e: BaseException) -> bool:
    low = str(e).lower()
    return isinstance(e, CookieLoadError) or any(s in low for s in (
        "could not copy chrome cookie database", "failed to load cookies", "failed to decrypt",
        "netscape format", "cookies database"))


def _give_up_on(src: tuple, why: BaseException | str) -> None:
    with _broken_lock:
        if src in _broken:
            return
        _broken[src] = why if isinstance(why, str) else log.explain(why)
    where = f"the cookies file {src[1]}" if src[0] == "file" else f"{src[1]}"
    log.warn(f"Couldn't use your YouTube login from {where}: {_broken[src]} "
             "Downloading without a login instead (fine for most songs).")


def _base_opts(t: Track, login: dict) -> dict:
    return {"quiet": True, "no_warnings": True, "noprogress": True, "js_runtimes": _js_runtimes(),
            "logger": log.YtdlpLogger(_label(t))} | login


class _QuietLogger:
    def debug(self, msg, **_):
        log.detail(f"cookies: {msg}")

    info = debug

    def warning(self, msg, **_):
        log.detail(f"cookies: {msg}", log.WARNING)

    error = warning


def check_login(cookies_browser: str | None, cookies_file: str | None) -> tuple[str, str, str | None]:
    """(state, detail, fix) for Settings -> Services: does the login source load, and is it signed in?"""
    fix = ("Export a cookies.txt file from a browser signed in to YouTube and set it in Settings "
           "(see Help → YouTube sign-in), or use Firefox.")
    if not cookies_browser and not cookies_file:
        return ("unknown", "No login: fine for most songs. If YouTube asks for a sign-in (bot check), add one.", None)
    try:
        if cookies_file:
            if not Path(cookies_file).is_file():
                return "down", f"The cookies file {cookies_file} doesn't exist.", fix
            jar = http.cookiejar.MozillaCookieJar(cookies_file)
            jar.load(ignore_discard=True, ignore_expires=True)
            where = "cookies file"
        else:
            jar = extract_cookies_from_browser(cookies_browser, logger=_QuietLogger())
            where = cookies_browser
    except Exception as e:  # noqa: BLE001
        why = log.explain(e)
        if why.startswith("Unexpected error"):  # not one of the known, already-worded cases
            why = f"Couldn't read the {'cookies file' if cookies_file else cookies_browser + ' cookies'}: {why}"
        return "down", why, fix
    yt = [c for c in jar if "youtube.com" in c.domain]
    now = time.time()
    signed_in = [c for c in yt if c.name in SIGN_IN_COOKIES and (not c.expires or c.expires > now)]
    if not yt:
        return "degraded", f"The {where} has no youtube.com cookies.", fix
    if not signed_in:
        return "degraded", f"The {where} has YouTube cookies, but no (unexpired) sign-in.", fix
    return "ok", f"Signed in to YouTube via the {where} ({len(yt)} cookies).", None


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


def resolve(t: Track, login: dict | None = None) -> tuple[str, float]:
    opts = _base_opts(t, login or {})
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


def download(t: Track, root: Path, bitrate: int = 320, cookies_browser: str | None = None,
             cookies_file: str | None = None) -> Track:
    """Resolve + download one track. Never raises; sets t.status/t.error instead.
    If the YouTube login can't be read, it's dropped (with one warning) rather than failing the song."""
    src = login_source(cookies_browser, cookies_file)
    rel = rel_path(t)
    out = root / f"{rel}.mp3"
    t.file_path = f"{rel}.mp3"
    if out.exists():
        t.status = "done"
        return t
    out.parent.mkdir(parents=True, exist_ok=True)

    attempt = 0
    while attempt <= RETRIES:
        login = _login_opts(src)
        try:
            if not t.video_id:
                t.video_id, _ = resolve(t, login)
            # Spotify's square album cover when we have it; the YouTube thumbnail only as a fallback.
            cover = tags.fetch_cover(t.cover_url, root / ".cache" / "covers")
            post = [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": str(bitrate)}]
            opts = _base_opts(t, login) | {
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
            if login and is_login_error(e):  # not this song's fault: go on without the login
                log.exception(f"[{_label(t)}] YouTube login unusable")
                _give_up_on(src, e)
                continue
            t.status, t.error = "failed", log.explain(e)
            log.exception(f"[{_label(t)}] attempt {attempt + 1}/{RETRIES + 1} failed")
            if attempt < RETRIES:
                log.warn(f"  retry {attempt + 1}/{RETRIES} {_label(t)}: {t.error}")
                log.event("retry", label=f"{t.artist} - {t.title}", attempt=attempt + 1, of=RETRIES, error=t.error)
                time.sleep(2 * (attempt + 1))
            attempt += 1
    _cleanup_partials(out)
    return t


def _cleanup_partials(out: Path) -> None:
    """Remove leftovers (.webm, .part, thumbnails) of a download that failed for good."""
    if not out.parent.exists():
        return
    for f in out.parent.iterdir():
        if f.name.startswith(f"{out.stem}.") and f.suffix != ".mp3":
            f.unlink(missing_ok=True)
