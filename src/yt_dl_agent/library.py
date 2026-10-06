import re
from pathlib import PurePosixPath
from urllib.parse import quote_plus

from .models import Track

_BAD_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
MAX_SEGMENT = 100


def sanitize(name: str) -> str:
    s = _BAD_CHARS.sub("", name)
    # Leading dots make a hidden file/folder, which Plex (and macOS/Linux) skip: "...Baby One More Time".
    s = re.sub(r"\s+", " ", s).strip().strip(". ")
    s = s[:MAX_SEGMENT].rstrip(". ")
    if s.upper().split(".")[0] in _RESERVED:
        s = f"_{s}"
    return s or "_"


def search_url(t: Track) -> str:
    return "https://music.youtube.com/search?q=" + quote_plus(f"{t.primary_artist} {t.title}")


def rel_path(t: Track) -> str:
    """songs-relative path without extension: Artist/Album/NN - Title"""
    artist = (t.album_artist or t.artist).split(",")[0].strip()
    album = t.album or "Singles"
    name = f"{t.track_no:02d} - {t.title}" if t.track_no else t.title
    return str(PurePosixPath(sanitize(artist), sanitize(album), sanitize(name)))


def prune_empty_dirs(root) -> None:
    """Remove folders left empty after files were moved out (never .cache)."""
    for d in sorted((p for p in root.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
        if ".cache" not in d.relative_to(root).parts and not any(d.iterdir()):
            d.rmdir()
