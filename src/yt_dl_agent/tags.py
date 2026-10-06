"""Read and write tags + cover art for every format the library keeps (files are never converted).

  .mp3 .wav  ID3v2.3 (what Windows Explorer and most players read best)
  .m4a       MP4 atoms
  .flac      Vorbis comments + FLAC picture block
  .opus .ogg Vorbis comments + METADATA_BLOCK_PICTURE

Writing also cleans junk left by rippers and download sites: comments, URL frames, "encoded by",
private frames. Lyrics and ReplayGain values are kept.
"""

import base64
import hashlib
import urllib.request
from pathlib import Path

import mutagen
from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, ID3, TALB, TDRC, TIT2, TPE1, TPE2, TRCK, ID3NoHeaderError
from mutagen.mp4 import MP4, MP4Cover
from mutagen.wave import WAVE

from .models import Track

AUDIO_EXTS = {".mp3", ".m4a", ".flac", ".opus", ".ogg", ".wav"}
LOSSLESS_EXTS = {".flac", ".wav"}
_ID3_JUNK = ("COMM", "WXXX", "WOAF", "WOAR", "WOAS", "WORS", "WPAY", "WPUB", "WCOM", "WCOP", "TENC", "PRIV")
_VORBIS_JUNK = ("comment", "description", "encoder", "encoded_by", "encodedby", "url", "website", "purl")
_MP4_JUNK = ("\xa9cmt", "desc", "\xa9too", "purl", "ldes")


def fetch_cover(url: str | None, cache_dir: Path) -> bytes | None:
    if not url:
        return None
    cache_dir.mkdir(parents=True, exist_ok=True)
    f = cache_dir / f"{hashlib.sha1(url.encode()).hexdigest()[:16]}.jpg"
    if f.exists():
        return f.read_bytes()
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = r.read()
    except OSError:
        return None
    if not data.startswith(b"\xff\xd8"):  # not a JPEG
        return None
    f.write_bytes(data)
    return data


def read(path: Path) -> dict:
    """What a file says about itself: title, artist, album, tracknumber, duration_s, bitrate_kbps."""
    out: dict = {}
    try:
        f = mutagen.File(path, easy=True)
    except Exception:  # noqa: BLE001 - unreadable/corrupt files just give no clues
        return out
    if f is None:
        return out
    if f.tags:
        id3 = hasattr(f.tags, "getall")  # WAV: raw ID3 frames, no "easy" names
        names = {"title": "TIT2", "artist": "TPE1", "album": "TALB", "albumartist": "TPE2", "tracknumber": "TRCK"}
        for k, frame in names.items():
            if v := f.tags.get(frame if id3 else k):
                out[k] = str(v.text[0] if id3 else v[0]).strip()
    if f.info:
        out["duration_s"] = round(getattr(f.info, "length", 0) or 0) or None
        out["bitrate_kbps"] = round((getattr(f.info, "bitrate", 0) or 0) / 1000) or None
    return out


def quality(path: Path) -> tuple[int, int]:
    """Sortable quality: (lossless?, bitrate kbps)."""
    return (1 if path.suffix.lower() in LOSSLESS_EXTS else 0, read(path).get("bitrate_kbps") or 0)


def _id3_frames(tags: ID3, t: Track, cover: bytes | None, minimal: bool) -> None:
    for frame in _ID3_JUNK:
        tags.delall(frame)
    tags.setall("TIT2", [TIT2(encoding=3, text=t.title)])
    if t.artist:  # unknown artists stay blank rather than "Unknown Artist"
        tags.setall("TPE1", [TPE1(encoding=3, text=t.artist)])
    if t.album or not minimal:
        tags.setall("TALB", [TALB(encoding=3, text=t.album or "Singles")])
    if not minimal:
        tags.setall("TPE2", [TPE2(encoding=3, text=_album_artist(t))])
    if t.track_no:
        tags.setall("TRCK", [TRCK(encoding=3, text=str(t.track_no))])
    if t.year:
        tags.setall("TDRC", [TDRC(encoding=3, text=str(t.year))])
    if cover:
        tags.delall("APIC")
        tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=cover))


def _album_artist(t: Track) -> str:
    return (t.album_artist or t.artist).split(",")[0].strip()


def _vorbis(f, t: Track, minimal: bool) -> None:
    for k in _VORBIS_JUNK:
        if k in f:
            del f[k]
    f["title"] = t.title
    if t.artist:
        f["artist"] = t.artist
    if t.album or not minimal:
        f["album"] = t.album or "Singles"
    if not minimal:
        f["albumartist"] = _album_artist(t)
    if t.track_no:
        f["tracknumber"] = str(t.track_no)
    if t.year:
        f["date"] = str(t.year)


def _picture(cover: bytes) -> Picture:
    pic = Picture()
    pic.type, pic.mime, pic.desc, pic.data = 3, "image/jpeg", "Cover", cover
    return pic


def write(path: Path, t: Track, cover: bytes | None = None, minimal: bool = False) -> None:
    """minimal: only clean junk and set title/artist (and album if known); for unidentified files,
    where anything more would be made up."""
    ext = path.suffix.lower()
    if ext == ".mp3":
        try:
            tags = ID3(path)
        except ID3NoHeaderError:
            tags = ID3()
        _id3_frames(tags, t, cover, minimal)
        tags.save(path, v2_version=3)
    elif ext == ".wav":
        f = WAVE(path)
        if f.tags is None:
            f.add_tags()
        _id3_frames(f.tags, t, cover, minimal)
        f.save(v2_version=3)
    elif ext == ".m4a":
        f = MP4(path)
        for k in _MP4_JUNK:
            f.pop(k, None)
        f["\xa9nam"] = [t.title]
        if t.artist:
            f["\xa9ART"] = [t.artist]
        if t.album or not minimal:
            f["\xa9alb"] = [t.album or "Singles"]
        if not minimal:
            f["aART"] = [_album_artist(t)]
        if t.track_no:
            f["trkn"] = [(t.track_no, 0)]
        if t.year:
            f["\xa9day"] = [str(t.year)]
        if cover:
            f["covr"] = [MP4Cover(cover, imageformat=MP4Cover.FORMAT_JPEG)]
        f.save()
    elif ext == ".flac":
        f = FLAC(path)
        _vorbis(f, t, minimal)
        if cover:
            f.clear_pictures()
            f.add_picture(_picture(cover))
        f.save()
    elif ext in (".opus", ".ogg"):
        f = mutagen.File(path)
        _vorbis(f, t, minimal)
        if cover:
            f["metadata_block_picture"] = [base64.b64encode(_picture(cover).write()).decode()]
        f.save()
    else:
        raise ValueError(f"can't tag {ext} files")


def has_cover(path: Path) -> bool:
    try:
        f = mutagen.File(path)
    except Exception:  # noqa: BLE001
        return False
    if f is None:
        return False
    if isinstance(f, FLAC):
        return bool(f.pictures)
    if isinstance(f, MP4):
        return bool(f.get("covr"))
    if f.tags is None:
        return False
    if hasattr(f.tags, "getall"):
        return bool(f.tags.getall("APIC"))
    return "metadata_block_picture" in f.tags
