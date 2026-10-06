"""Console output + a log file per run.

The console gets short, plain-language lines. logs/run-YYYYmmdd-HHMMSS.log gets everything: the same
lines, every retry with the raw error, yt-dlp's own messages tagged with the track, and tracebacks.
"""

import logging
import re
from logging import INFO, WARNING  # noqa: F401 - re-exported for log.detail(..., log.INFO)
from datetime import datetime
from pathlib import Path

from rich.console import Console
from rich.text import Text

console = Console()
_log = logging.getLogger("yt_dl_agent")
log_path: Path | None = None


def setup(log_dir: Path) -> Path:
    global log_path
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"run-{datetime.now():%Y%m%d-%H%M%S}.log"
    handler = logging.FileHandler(log_path, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(threadName)-10s %(message)s"))
    _log.addHandler(handler)
    _log.setLevel(logging.DEBUG)
    return log_path


_listeners: list = []


def listen(fn) -> None:
    """fn(name, data) is called for every event(); the web server uses this for live progress."""
    _listeners.append(fn)


def unlisten(fn) -> None:
    if fn in _listeners:
        _listeners.remove(fn)


def event(name: str, /, **data) -> None:
    """Structured progress (phase changes, track results). A no-op unless something listens."""
    for fn in _listeners:
        try:
            fn(name, data)
        except Exception:  # noqa: BLE001 - a listener must never break a download
            _log.exception(f"event listener failed on {name}")


def say(msg: str, level: int = logging.INFO) -> None:
    """Print to the console (rich markup allowed) and write the plain text to the log."""
    console.print(msg)
    plain = Text.from_markup(msg).plain
    _log.log(level, plain)
    event("say", text=plain, level=level)


def warn(msg: str) -> None:
    say(f"[yellow]{msg}[/]", logging.WARNING)


def detail(msg: str, level: int = logging.DEBUG) -> None:
    """Log file only."""
    _log.log(level, msg)


def exception(msg: str) -> None:
    """Log file only, with traceback."""
    _log.exception(msg)


class YtdlpLogger:
    """Routes yt-dlp's messages to the log file (tagged with the track) instead of the console."""

    def __init__(self, label: str):
        self.label = label

    def debug(self, msg: str) -> None:
        if not msg.startswith("[debug] "):
            _log.debug(f"yt-dlp [{self.label}] {msg}")

    info = debug

    def warning(self, msg: str) -> None:
        _log.warning(f"yt-dlp [{self.label}] {msg}")

    def error(self, msg: str) -> None:
        _log.error(f"yt-dlp [{self.label}] {msg}")


# (substring in the raw error, lowercased) -> plain-language explanation
_EXPLANATIONS = [
    ("active premium subscription required",
     "the Spotify developer account that owns the app needs Premium (HTTP 403). "
     "After subscribing it can take a few hours to start working."),
    ("http error 403", "YouTube refused the download (HTTP 403 Forbidden). Usually temporary; "
                       "rerun later, lower --workers, or update yt-dlp."),
    ("http error 429", "YouTube is rate-limiting (HTTP 429). Wait a while, or lower --workers."),
    ("sign in to confirm", "YouTube wants a sign-in (bot check). Rerun with --cookies-from-browser chrome."),
    ("not a bot", "YouTube wants a sign-in (bot check). Rerun with --cookies-from-browser chrome."),
    ("not available in your country", "The matched video is region-blocked."),
    ("video unavailable", "The matched video is unavailable (removed or private)."),
    ("private video", "The matched video is private."),
    ("ffprobe", "ffmpeg/ffprobe failed or isn't on PATH."),
    ("ffmpeg", "ffmpeg failed or isn't on PATH."),
    ("js runtime", "yt-dlp needs a JS runtime for YouTube: install deno or node, or update yt-dlp."),
    ("challenge", "yt-dlp couldn't solve YouTube's JS challenge: install deno or node, or update yt-dlp."),
    ("usagelimitexceeded", "Tavily credits are used up for this billing period."),
    ("invalidapikey", "The Tavily API key is invalid. Check TAVILY_API_KEY in .env."),
    ("failed to connect to ollama", "Ollama isn't reachable. Start Ollama, or check OLLAMA_HOST in .env."),
    ("try pulling it", "The Ollama model isn't downloaded: run `ollama pull <OLLAMA_MODEL>` (see `ollama list`)."),
    ("timed out", "Network timeout."),
    ("connection", "Network connection error."),
]


_ANSI = re.compile(r"\[[0-9;]*m")


def explain(err: BaseException | str) -> str:
    """Turn a raw exception/message into one plain-language line."""
    raw = f"{type(err).__name__}: {err}" if isinstance(err, BaseException) else str(err)
    raw = _ANSI.sub("", raw)  # yt-dlp colours its errors: "[0;31mERROR:[0m ..."
    low = raw.lower()
    for needle, text in _EXPLANATIONS:
        if needle in low:
            return text
    msg = _ANSI.sub("", str(err)).strip()
    first = msg.splitlines()[0] if msg else type(err).__name__
    return f"Unexpected error: {first.removeprefix('ERROR: ')[:200]}"
