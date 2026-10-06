"""Pick the right YouTube result for a track. YT Music's first hit is often wrong, so score candidates."""

import re
import unicodedata

from .models import Track

# Variants we don't want unless the Spotify title asks for them.
_VARIANTS = ("live", "cover", "karaoke", "instrumental", "8d", "slowed", "reverb", "sped up",
             "nightcore", "hours", "hour version", "reaction", "remix", "acoustic", "loop", "mashup")
# Words that say nothing about which recording it is.
_FILLER = {"feat", "ft", "with", "the", "a", "and", "remastered", "remaster", "version", "single",
           "edit", "radio", "mono", "stereo", "original", "mix"}
MIN_SCORE = 45


def norm(s: str) -> str:
    s = re.sub(r"['’`]", "", s)  # "Preacher's" == "Preacher’s" == "Preachers"
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower().replace("&", " and ")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def _tokens(s: str) -> set[str]:
    return {w for w in norm(s).split() if w not in _FILLER and not re.fullmatch(r"(19|20)\d\d", w)}


def _coverage(want: set[str], have: set[str]) -> float:
    return len(want & have) / len(want) if want else 1.0


def score(track: Track, title: str, channel: str, duration: float | None) -> float:
    have = _tokens(f"{title} {channel}")
    s = 40 * _coverage(_tokens(track.title), have)
    s += 20 * _coverage(_tokens(track.primary_artist), have)

    ch = norm(channel)
    if channel.endswith(" - Topic") or ch == norm(track.primary_artist) or ch.endswith(" vevo"):
        s += 10

    if track.duration_s and duration:
        diff = abs(track.duration_s - duration)
        s += 30 if diff <= 3 else 20 if diff <= 10 else 5 if diff <= 30 else -30

    want_title, cand_title = norm(track.title), norm(title)
    for v in _VARIANTS:
        if re.search(rf"\b{v}\b", cand_title) and not re.search(rf"\b{v}\b", want_title):
            s -= 25
    return s


def best(track: Track, candidates: list[dict]) -> tuple[dict | None, float]:
    scored = [(c, score(track, c.get("title") or "", c.get("channel") or c.get("uploader") or "",
                        c.get("duration"))) for c in candidates if c.get("id")]
    if not scored:
        return None, 0.0
    return max(scored, key=lambda x: x[1])
