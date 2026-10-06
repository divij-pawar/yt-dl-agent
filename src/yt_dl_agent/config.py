"""Run defaults, from .env, shared by the CLI (argparse defaults) and the web UI (Settings page).

  YTDL_OUT=songs  YTDL_WORKERS=4  YTDL_BITRATE=320  YTDL_LOG_DIR=logs
  YTDL_NO_PLAYLIST=0  YTDL_NO_ALBUM_LOOKUP=0  YTDL_COOKIES_FROM_BROWSER=  YTDL_YES=0  YTDL_NO_PLEX=0
  YTDL_PREVIEW_LINKS=1   web UI only: a pasted Spotify link opens its preview instead of "I understood"

A flag on the command line still wins over these.
"""

import os
from pathlib import Path

from dotenv import dotenv_values, set_key

ENV_FILE = Path(".env")
# .env keys the Settings page edits. Secrets are masked when read back (see server.py).
CONNECTION_KEYS = ("TAVILY_API_KEY", "OLLAMA_HOST", "OLLAMA_MODEL", "SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET",
                   "PLEX_URL", "PLEX_TOKEN")
SECRET_KEYS = ("TAVILY_API_KEY", "SPOTIFY_CLIENT_SECRET", "PLEX_TOKEN")

# option -> (.env key, default)
DEFAULTS: dict[str, tuple[str, object]] = {
    "out": ("YTDL_OUT", "songs"),
    "workers": ("YTDL_WORKERS", 4),
    "bitrate": ("YTDL_BITRATE", 320),
    "no_playlist": ("YTDL_NO_PLAYLIST", False),
    "no_album_lookup": ("YTDL_NO_ALBUM_LOOKUP", False),
    "cookies_from_browser": ("YTDL_COOKIES_FROM_BROWSER", None),
    "yes": ("YTDL_YES", False),
    "log_dir": ("YTDL_LOG_DIR", "logs"),
    "no_plex": ("YTDL_NO_PLEX", False),
    "preview_links": ("YTDL_PREVIEW_LINKS", True),  # web UI only
}


def _parse(raw: str | None, default):
    if raw is None or raw.strip() == "":
        return default
    if isinstance(default, bool):
        return raw.strip().lower() in ("1", "true", "yes", "on")
    if isinstance(default, int):
        try:
            return int(raw)
        except ValueError:
            return default
    return raw.strip()


def defaults() -> dict:
    return {k: _parse(os.getenv(env), d) for k, (env, d) in DEFAULTS.items()}


def root() -> Path:
    """The library folder (songs/ unless YTDL_OUT says otherwise)."""
    return Path(defaults()["out"])


def read_env() -> dict[str, str]:
    file = dotenv_values(ENV_FILE) if ENV_FILE.exists() else {}
    return {k: (file.get(k) if file.get(k) is not None else os.getenv(k, "")) or "" for k in CONNECTION_KEYS}


def write_env(values: dict[str, object]) -> None:
    """Update keys in .env in place (other lines and comments are kept), and in this process."""
    ENV_FILE.touch(exist_ok=True)
    for key, value in values.items():
        text = "" if value is None else ("1" if value is True else "0" if value is False else str(value))
        set_key(ENV_FILE, key, text, quote_mode="never")
        os.environ[key] = text


def write_defaults(opts: dict) -> None:
    write_env({env: opts.get(k, d) for k, (env, d) in DEFAULTS.items()})
