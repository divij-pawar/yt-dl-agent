"""Small-model helpers. Each call does one narrow job with a JSON-schema-constrained reply."""

import os
from typing import Literal

import ollama
from pydantic import BaseModel, ValidationError

CHUNK_SIZE = 1500
CHUNK_OVERLAP = 150


class Song(BaseModel):
    title: str
    artist: str
    album: str | None = None


class _Songs(BaseModel):
    tracks: list[Song]


class _Album(BaseModel):
    album: str | None


def _client() -> ollama.Client:
    return ollama.Client(host=os.getenv("OLLAMA_HOST", "http://localhost:11434"))


def _ask[T: BaseModel](prompt: str, schema: type[T], num_ctx: int = 2048) -> T | None:
    model = os.getenv("OLLAMA_MODEL", "llama3.2:latest")
    for _ in range(2):  # one retry on malformed output, then give up
        resp = _client().chat(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            format=schema.model_json_schema(),
            options={"temperature": 0, "num_ctx": num_ctx},
        )
        try:
            return schema.model_validate_json(resp.message.content)
        except ValidationError:
            continue
    return None


def chunks(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    out, i = [], 0
    while i < len(text):
        out.append(text[i : i + size])
        i += size - overlap
    return out


def extract_tracks(text: str) -> list[Song]:
    """Pull songs out of messy page text, chunk by chunk. Drops anything not literally in the text."""
    seen, songs = set(), []
    for chunk in chunks(text):
        res = _ask(
            "Extract songs from the text. Return JSON only.\n"
            "Each song: title, artist, album (or null).\n"
            "Ignore menus, ads, buttons, and anything that is not a song.\n\n"
            f"TEXT:\n{chunk}",
            _Songs,
        )
        if not res:
            continue
        low = chunk.casefold()
        for s in res.tracks:
            key = (s.artist.casefold(), s.title.casefold())
            if s.title.casefold() in low and key not in seen:  # hallucination filter
                seen.add(key)
                songs.append(s)
    return songs


class Request(BaseModel):
    kind: Literal["song", "album", "discography", "albums", "top"]
    artist: str
    title: str | None = None


class _Requests(BaseModel):
    items: list[Request]


_REQUEST_PROMPT = """Turn the music request into a list of items. Return JSON only.
Each item has:
- kind: "song" (one song), "album" (one album or EP), "discography" (everything an artist released),
  "albums" (only an artist's albums), "top" (an artist's most popular songs)
- artist: the artist name, as written
- title: the song or album name, or null for discography/albums/top

Examples:
"Currents by Tame Impala" -> {"items":[{"kind":"album","artist":"Tame Impala","title":"Currents"}]}
"sweater weather - the neighbourhood" -> {"items":[{"kind":"song","artist":"the neighbourhood","title":"sweater weather"}]}
"all of Bon Iver" -> {"items":[{"kind":"discography","artist":"Bon Iver","title":null}]}
"every Lana Del Rey album" -> {"items":[{"kind":"albums","artist":"Lana Del Rey","title":null}]}
"Frank Ocean's best songs" -> {"items":[{"kind":"top","artist":"Frank Ocean","title":null}]}
"Skinny Love and Holocene by Bon Iver" -> {"items":[{"kind":"song","artist":"Bon Iver","title":"Skinny Love"},{"kind":"song","artist":"Bon Iver","title":"Holocene"}]}

REQUEST: """


def parse_request(text: str) -> list[Request]:
    """One line of free text from the chat -> structured download requests."""
    res = _ask(_REQUEST_PROMPT + text.strip(), _Requests)
    return [r for r in res.items if r.artist.strip()] if res else []


class _SongName(BaseModel):
    artist: str | None
    title: str


def split_filename(name: str, folder: str = "") -> _SongName | None:
    """A messy file name the regexes couldn't split -> artist + title."""
    return _ask(
        "This is a music file name. Give the artist and song title. Return JSON only.\n"
        "Drop junk like track numbers, (Official Video), [Lyrics], 320kbps, site names, 'final', '(1)'.\n"
        "If the name has no artist but it's a well-known song, give its artist. If unsure, use null.\n"
        'Example: "07_some_band-some song name (official video)" -> '
        '{"artist":"Some Band","title":"Some Song Name"}\n'
        'If the name is not a song name at all (like "track01" or "audio_0042"), return '
        '{"artist":null,"title":"<the name>"}.\n\n'
        f"FOLDER: {folder}\nFILE NAME: {name}",
        _SongName,
    )


def pick_album(title: str, artist: str, snippets: list[str]) -> str | None:
    """Read search snippets and name the album the song is on. Must be quoted from the snippets."""
    joined = "\n".join(f"- {s}" for s in snippets)
    res = _ask(
        f'Which album is the song "{title}" by "{artist}" from? Use only these snippets.\n'
        "If a single, the album name is often the song name. If unsure, return null.\n"
        'Return JSON: {"album": string or null}\n\n'
        f"SNIPPETS:\n{joined}",
        _Album,
    )
    if not res or not res.album:
        return None
    album = res.album.strip().strip('"')
    if album.casefold() in {"single", "singles", "ep", "album", "unknown", "null", "none"}:
        return None
    return album if album and album.casefold() in joined.casefold() else None
