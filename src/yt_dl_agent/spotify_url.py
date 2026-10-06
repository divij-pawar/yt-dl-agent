import re

_URL_RE = re.compile(
    r"(?:open\.spotify\.com/(?:intl-[a-z-]+/)?(?:embed/)?|spotify:)(playlist|album|track|artist)[/:]([A-Za-z0-9]{22})"
)


# User IDs aren't base62: they can be legacy usernames ("divijpawar") or numeric.
_USER_RE = re.compile(r"(?:open\.spotify\.com/(?:intl-[a-z-]+/)?|spotify:)user[/:]([^/?#:]+)")


def parse(url: str) -> tuple[str, str]:
    """Return (kind, id) for a Spotify playlist/album/track/artist/user URL or URI."""
    if m := _URL_RE.search(url):
        return m.group(1), m.group(2)
    if m := _USER_RE.search(url):
        return "user", m.group(1)
    raise ValueError(f"Not a Spotify playlist/album/track/artist/profile link: {url}")
