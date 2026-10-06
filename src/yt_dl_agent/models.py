from typing import Literal

from pydantic import BaseModel


class Track(BaseModel):
    title: str
    artist: str  # all credited artists, comma-separated
    album: str | None = None
    album_artist: str | None = None
    track_no: int | None = None
    duration_s: int | None = None
    explicit: bool = False
    spotify_track_id: str | None = None
    album_id: str | None = None
    year: int | None = None
    cover_url: str | None = None
    search_url: str | None = None
    video_id: str | None = None
    file_path: str | None = None  # relative to the songs root
    status: Literal["pending", "done", "failed"] = "pending"
    error: str | None = None

    @property
    def primary_artist(self) -> str:
        return self.artist.split(",")[0].strip()

    @property
    def key(self) -> str:
        return f"{self.primary_artist}|{self.title}".casefold()


class Collection(BaseModel):
    kind: Literal["playlist", "album", "track", "artist"]
    spotify_id: str
    name: str
    owner_or_artist: str | None = None
    source: str = ""
    tracks: list[Track]
