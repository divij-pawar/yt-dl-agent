# yt-dl-agent

A local agent that takes a **Spotify playlist or album link**, resolves its tracks, turns each one into a
**YouTube Music search link**, downloads the audio as **320 kbps MP3**, and files it into a `songs/`
library organised by artist and album. When the input is a playlist, it also writes a playlist file
(named after the original playlist) at the root of `songs/`.

It runs on the **Tavily API** for web access and a **local Ollama instance** for language understanding.
The Spotify Web API is used when it's available.

```
yt-dl-agent "https://open.spotify.com/playlist/48VKa8er36VggB0GUmQAFO"
```

---

## Goals

- Input: one or more Spotify URLs (`open.spotify.com/playlist/...`, `open.spotify.com/album/...`, or
  `open.spotify.com/user/...` for every public playlist on a profile, `/track/...`, `/artist/...` for a
  discography), **or plain-words requests in chat mode** ("Tame Impala discography", "Currents by Tame
  Impala", "Sweater Weather by The Neighbourhood", "top songs of Bon Iver"), queued and downloaded one
  by one.
- Output:
  - Audio files saved as `songs/<Artist>/<Album>/<NN> - <Title>.mp3`
  - For playlists only: `songs/<Playlist Name>.m3u8` pointing to those files with relative paths.
  - A list of YouTube Music search links, one per track (`songs/.cache/<id>.links.txt`), plus the
    full resolved collection (`songs/.cache/<id>.json`).
- Run locally, apart from the Tavily, Spotify and YouTube calls.

## Non-goals

- No user OAuth. The Spotify API is used only with app credentials (client credentials flow).
- No hosted service or accounts. The web UI (`yt-dl-agent serve`) is a local, single-user front end
  over the same code as the CLI; it listens on 127.0.0.1 only.

---

## Key constraint: the model is small

The Ollama model (`llama3.2` 3B by default) has a **small context window and weak reasoning**. The
design follows from that:

1. **Code does the work; the LLM only does fuzzy text-to-structure, and only as a fallback.**
   Fetching, parsing, matching, downloading, naming, deduplication and playlist writing are all
   deterministic code. The model never plans, never chooses tools, never sees the whole playlist.
2. **Tiny, single-purpose prompts** with a fixed output shape.
3. **Structured output only.** Ollama's `format` gets a JSON schema, and Pydantic validates the reply.
   A bad reply is retried once, then dropped.
4. **Chunked input** of about 1,500 characters (150 overlap), with `temperature: 0` and `num_ctx: 2048`.
5. **Grounding checks.** An extracted track is kept only if its title appears in the source chunk, and
   an album is kept only if its name appears in the snippets. Generic answers like "Singles" are
   rejected.

Testing showed why the model should only be a fallback. On album lookup from search snippets, both
`llama3.2` 3B and `qwen2.5` 7B got only about 5 of 9 right. Deterministic parsing of the right page
gets nearly all of them.

---

## Pipeline

```
Spotify URL
   │
   ▼
[1] Classify URL ───────── regex → (playlist|album|user, id)
   │
   ├─ user ─► [0] Profile playlists: Spotify API /users/<id>/playlists, else Tavily Extract
   │              (advanced, up to 4 tries) of /user/<id>/playlists; profile page as a last resort
   │              (~10 playlists). Filter with --match, then run [2]–[7] per playlist.
   │
   ▼
[2] Resolve tracks ─────── first source that works:
   │                         a. Spotify Web API     full list, albums, track numbers, durations
   │                         b. embed page JSON     open.spotify.com/embed/<kind>/<id> → __NEXT_DATA__
   │                                                first 100 tracks, durations, track IDs, no albums
   │                         c. Tavily Extract      same embed page → markdown → regex
   │                                                (Ollama chunked extraction if the regex finds nothing)
   ▼
[3] Fill albums ────────── only for tracks without one (sources b/c):
   │                         a. Tavily Extract on each open.spotify.com/track/<id>, 20 per call,
   │                            retried up to 4 rounds (basic → advanced); album = first /album/ link
   │                            under the song heading. No LLM.
   │                         b. leftovers: Tavily Search + Ollama picks the album from snippets
   │                         cached in songs/.cache/albums.json
   ▼
[4] Search links ───────── https://music.youtube.com/search?q=<artist>+<title>
   │
   ▼
[5] Match + download ───── worker pool (4), per track:
   │                         ytsearch8 → score candidates → best video → yt-dlp → 320k MP3
   ▼
[6] Tag ────────────────── mutagen writes the Spotify title/artist/album/track number;
   │                         yt-dlp embeds the cover art
   ▼
[7] Playlist file ──────── playlists only: songs/<Playlist Name>.m3u8
```

### Step 5: matching

The YouTube Music search link's first result isn't reliable. In testing, the `#songs` search for "The
Japanese House Clean" returned other songs by the same artist. So the code takes the top 8 YouTube
results and scores each one:

- **Title token coverage** (40) and **artist token coverage** (20). Filler words like "feat",
  "remastered" and "version" are ignored.
- **Official channel** (+10): `<Artist> - Topic`, the artist's own channel, or VEVO.
- **Duration vs Spotify**: ±3 s +30, ±10 s +20, ±30 s +5, otherwise −30. This is the strongest signal.
- **Unwanted variants** (−25 each) unless the Spotify title has them too: live, cover, remix,
  acoustic, slowed, sped up, 8D, 10 hours, and so on.
- **YT Music fallback:** if no YouTube result reaches 45 points (this happens with obscure tracks that
  regular search buries, like "Alicks - CRT"), the code runs the track's YT Music `#songs` search. Its
  results only carry a title and an ID, so the code fetches full details for up to 3 results whose
  title fits, then scores them the same way.
- Still below 45 points → the track is marked failed with "no confident match" rather than
  downloading the wrong thing.

The YT Music search links are still produced as the human-readable output in `.links.txt`.

### Step 5: download (parallel vs sequential)

Downloads are network-bound, so **a small parallel pool is faster**. Three tracks took 13 s in
parallel. The default is 4 workers; `--workers 1` makes it sequential. Higher values risk YouTube
throttling.

**MP3 at the highest quality possible:**

- `format: bestaudio/best`: the highest-bitrate audio-only stream (usually Opus at about 138–160 kbps;
  better with YT Music Premium cookies).
- `FFmpegExtractAudio` → MP3, `preferredquality: 320`, which gives 320 kbps CBR, the MP3 maximum. The
  sample rate is left at the source's 48 kHz, to avoid a resampling pass.
- The source is already lossy, so 320 kbps is the best MP3 possible but it can't exceed the source.
  `--cookies-from-browser` with a Premium account gives a better source.
- yt-dlp 2026.08.19 needs a JS runtime for YouTube. The code uses deno if present, otherwise node.
  `yt-dlp[default]` pulls in `yt-dlp-ejs`.
- Each track is retried twice with backoff, because YouTube sometimes returns a 403 that a retry fixes.
  An existing file is skipped, so reruns resume. One bad track never stops the run.
- If the same song appears twice in a playlist, it's downloaded once.

### Step 7: playlist file

- Format: **`.m3u8`** (UTF-8 M3U), which works in VLC, foobar2000, MusicBee, Poweramp and Jellyfin.
- `songs/<Playlist Name>.m3u8`, with **relative paths** so `songs/` can be moved, and
  `#EXTINF:<seconds>,<Artist> - <Title>` lines, in the original playlist order.
- Failed tracks are left out and listed in the run summary. Albums don't get a playlist file.

---

## Layout

### Project

```
yt-dl-agent/
├── project.md
├── pyproject.toml
├── .env / .env.example      # TAVILY_API_KEY, OLLAMA_*, SPOTIFY_CLIENT_ID/SECRET, YTDL_* run defaults
├── songs/                   # output library (gitignored)
├── web/                     # the web UI: React + shadcn/ui (see web/README.md), built into web/dist
└── src/yt_dl_agent/
    ├── cli.py               # entry point, orchestration, progress, summary; `serve` starts server.py
    ├── server.py            # FastAPI: the web UI's API (web/src/lib/api.ts), and serves web/dist
    ├── history.py           # run records, song by song: songs/.cache/runs/*.json
    ├── config.py            # run defaults from .env (YTDL_*), shared by CLI and web UI; .env writes
    ├── chat.py              # chat REPL / --ask: parse → confirm → queue → one job at a time
    ├── catalog.py           # find artists/albums/tracks by name (Tavily Search), artist discographies
    ├── importer.py          # import: identify (tags/name/folders + length check), tag, copy, undo
    ├── fixer.py             # fix: re-check albums, Spotify covers, rename/move, retry _Unsorted
    ├── tags.py              # read/write tags + covers for mp3/m4a/flac/opus/ogg/wav, junk cleanup
    ├── enrich.py            # cover, year, track number, album artist from Spotify embed pages
    ├── spotify_url.py       # [1] classify URL
    ├── sources.py           # [2] Spotify API → embed JSON → Tavily Extract
    ├── albums.py            # [3] track-page extract → search + LLM fallback
    ├── llm.py               # Ollama wrapper, schemas, chunked extraction, album pick
    ├── match.py             # [5] candidate scoring
    ├── download.py          # [5]+[6] yt-dlp, MP3, tags
    ├── library.py           # sanitising, paths, YT Music search URLs
    ├── library_index.py     # songs already downloaded (by track ID / artist+title+duration) → reuse
    ├── log.py               # console + logs/run-*.log, plain-language errors, log.event() progress
    ├── playlist.py          # [7] .m3u8 writer
    └── models.py            # Track, Collection
```

### Output

```
songs/
├── Night Music.m3u8
├── .cache/
│   ├── 48VKa8er36VggB0GUmQAFO.json        # resolved collection + per-track status
│   ├── 48VKa8er36VggB0GUmQAFO.links.txt   # "<artist> - <title>\t<YT Music search URL>"
│   └── albums.json                        # album lookup cache
├── The Neighbourhood/
│   └── I Love You./
│       └── Sweater Weather.mp3
└── Tame Impala/
    └── Currents/
        └── The Less I Know The Better.mp3
```

Track number prefixes (`01 - `) appear only when the source provides them: the Spotify API, or album
links. Playlist embeds don't.

---

## Naming rules

- Strip `< > : " / \ | ? *` and control characters, trim trailing dots and spaces, prefix reserved
  Windows names (`CON` → `_CON`), and cap each segment at 100 characters.
- The folder uses the **primary artist** (`"Artist A, Artist B"` → `Artist A`), or the album artist when
  it's known.
- Missing album → `songs/<Artist>/Singles/`.

---

## Configuration

`.env`:

```
TAVILY_API_KEY=tvly-...
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.2:latest
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
```

CLI:

```
yt-dl-agent <spotify-url> [<spotify-url> ...]
    --out songs                     # output root (default: ./songs)
    --workers 4                     # parallel downloads; 1 = sequential
    --bitrate 320                   # MP3 bitrate in kbps (default/max: 320)
    --links-only                    # stop after building search links
    --no-playlist                   # don't write the .m3u8
    --no-album-lookup               # skip [3]; everything goes to Artist/Singles
    --limit N                       # only the first N tracks (testing)
    --cookies-from-browser chrome   # YT Music Premium → better source audio
```

Run defaults (all optional; the CLI uses them as its defaults, the web UI's Settings page writes them):

```
YTDL_OUT=songs  YTDL_WORKERS=4  YTDL_BITRATE=320  YTDL_LOG_DIR=logs
YTDL_NO_PLAYLIST=0  YTDL_NO_ALBUM_LOOKUP=0  YTDL_COOKIES_FROM_BROWSER=  YTDL_YES=0  YTDL_PREVIEW_LINKS=1
```

Setup:

```
uv venv .venv -p 3.12
uv pip install -p .venv/Scripts/python.exe -e .
npm --prefix web install && npm --prefix web run build     # web UI (optional)
```

Requires Python 3.12+, ffmpeg on PATH, a JS runtime (deno or node), and Ollama running locally.

---

## Web UI

`yt-dl-agent serve` runs `server.py` (FastAPI + uvicorn) on 127.0.0.1:8765 and serves the built UI from
`web/dist`. The server is a thin layer: every endpoint calls the same functions the CLI does.

| Endpoint | Calls |
|---|---|
| `POST /api/parse` | `chat.parse_line`, plus which path read each item (link / exact form / model) and what it printed |
| `POST /api/queue`, `GET /api/queue` | `chat.DownloadQueue.add`, its jobs, and the live progress of the running one |
| `GET /api/profiles/{id}` | `sources.user_playlists` |
| `GET /api/collections[/{id}]` | `songs/.cache/<id>.json` |
| `GET /api/library` | every cached collection plus `imported.json` / `library-songs.json`, one row per file |
| `POST /api/import`, `GET /api/imports`, `POST /api/imports/{name}/undo` | `importer.run_import`, `.cache/imports/`, `importer.undo` |
| `GET /api/unsorted` | `.cache/unsorted.json` |
| `POST /api/fix` | `fixer.run_fix`, which returns its report |
| `GET /api/runs[/{id}]` | `songs/.cache/runs/*.json` (history.py), newest first; `?job=` for one queue job |
| `GET /api/preview/{kind}/{id}` | `sources.embed_entity` + `from_embed` (no Tavily, no downloads), each track checked against `LibraryIndex`; albums from `albums.json` |
| `GET /api/failed` | failed tracks across all collections that still aren't in the library, with where they failed |
| `GET /api/logs[/{name}]` | `logs/run-*.log`, parsed |
| `GET /api/health`, `GET`/`PUT /api/settings` | service checks; `.env` through `config.py` |

Design points:

- **One queue.** Downloads go through `chat.DownloadQueue`, so jobs run one at a time exactly as in chat.
  Each job carries its own run options (`Job.options`), turned into the argparse namespace
  `cli.run_collection` expects.
- **One writer.** A library lock is held for each download unit, import, fix and undo, so the import and
  fix endpoints never touch `songs/` while a download is writing to it.
- **Progress without parsing console output.** `cli.run_collection` and `download` emit
  `log.event("phase" | "collection" | "track" | "retry", ...)`, a no-op unless something listens. The
  server turns these into the running job's progress. `log.say` emits an event too, so `/api/parse` can
  return the messages the CLI would have printed (for example, that Ollama isn't reachable).
- **History is written by the CLI, not the server.** `cli.run_collection` saves a `history.Run` for every
  collection, including runs that fail before reading the track list, so CLI, chat and web runs all show
  up. Each track is `downloaded`, `reused` (already in the library, so skipped), `failed` (with the
  reason) or `links`, plus the songs removed since the last run. Records carry the queue job id when there
  is one, and a `requeue` hint: how to run the collection again. That's usually its link; an artist's
  top tracks become a `top` link (a plain artist link would mean the whole discography), and songs that
  were only found by search are re-queued as the original request.
  Logs from before history existed are turned into records once (`history.backfill`, on the first
  `GET /api/runs`), marked `from_log`: the log names what was downloaded and failed and how many were
  reused; which songs were reused comes from the collection's cache.
- **Picked songs** from a preview are queued as one job with a `tracks` link (comma-separated track IDs),
  which `chat.expand` turns into one `("track", id)` unit per song.
- **Local only.** Requests whose `Host` or `Origin` isn't localhost get 403, so other web pages can't
  drive the app (CSRF, DNS rebinding). Secrets come back masked, and a masked value sent back unchanged
  keeps the stored key.
- **The contract** lives in `web/src/lib/types.ts` (mirrors `models.py`, `chat.Job`, `importer.Plan`, ...)
  and `web/src/lib/api.ts` (one method per endpoint, naming the Python function behind it). The UI dev
  server runs on sample data (`npm --prefix web run dev`) or against `serve` (`dev:live`).

---

## Test results: "Night Music" (121 tracks)

- **Spotify API:** the token works, but the playlist call returns 403 *"Active premium subscription
  required for the owner of the app."* Spotify requires the app owner to have Premium, and it can take
  a few hours after subscribing before requests are allowed. Until then, sources b/c are used.
- **Main playlist page:** a JS shell with no track data. Tavily Extract fails on it ("Failed to fetch
  url").
- **Embed page:** 100/100 tracks with durations and track IDs, but **capped at 100**. Tracks 101–121
  need the Spotify API.
- **Tavily Extract on the embed page:** 100/100 tracks as clean `### Title` / `#### Artist` markdown,
  which the regex parses. Spotify's explicit badge gets glued to the artist ("ELana Del Rey") and is
  stripped by a heuristic.
- **Album lookup:** 87/100 from track pages (about half of the pages need a retry or advanced depth),
  and 13/13 from search + LLM. The LLM-picked ones are less trustworthy.
- **Download:** 3 tracks in 13 s at 4 workers. 320 kbps MP3, durations within 1 s of Spotify, tags and
  cover art embedded.

- **Profile `divijpawar`:** `/user/<id>` and `/user/<id>/playlists` are JS shells over plain HTTP.
  Tavily basic depth fails on both. At advanced depth, the profile page loads with 10 playlists, and
  `/playlists` loads all 29 on the 1st or 2nd try. Playlists that aren't shown on the profile
  ("Overnight") don't appear and need their own link.

- **Chat:** `llama3.2` parsed 11 of 12 test phrasings. The one miss ("beach house bloom and
  depression cherry", read as songs) is recovered by the song→album fallback. Tavily Search finds artists,
  tracks and most albums by name; *Currents* only came up through Tame Impala's discography. The artist
  page plus `/discography/album` and `/discography/single` gave all 13 Tame Impala releases. Ethel Cain's
  pages also listed 3 releases by other artists that she features on; those are filtered by checking each
  release's main artist on its embed page.

- **Import/fix test** (scratch library, 9 messy files in 5 formats):
  - Results: 5 imported correctly, 1 upgrade (FLAC over MP3, old copy to `_Replaced/`), 1 duplicate
    skipped, and 2 to `_Unsorted/` (a 60 s cut of Skinny Love, and a 440 Hz tone).
  - Lessons:
    - Spotify search often ranks compilation copies first ("Funky Basslines", "Viral Hits"). Ranking
      the candidates by album hint, own release, credited, not a compilation, and not a variant fixed
      every case.
    - The 3B model echoed its prompt example for a meaningless file name. Model guesses are now used
      only for searching, never for naming files.
  - `fix` replaced YouTube thumbnails on all 28 files, moved the deliberately misfiled Parcels song back
    into *Day/Night* as track 18, and updated the `.m3u8`.

## Known issues / next steps

- **Tracks past 100** need working Spotify API access (Premium on the app owner's account).
- **LLM album picks** (the search fallback) are roughly 50–60% reliable. Candidates for improvement:
  a multiple-choice prompt over album names extracted from Apple Music / Spotify result titles, or
  more extract retries so fewer tracks reach the fallback.
- **Matching:** a track fails only if neither YouTube's top 8 nor YT Music's top 3 songs score 45 points.
