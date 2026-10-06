// Mirrors of the Python backend's data, field for field. Source of truth is noted on each type;
// when the backend changes, change these first and let the compiler show what else must follow.

// --- models.py ---------------------------------------------------------------

export type TrackStatus = "pending" | "done" | "failed"

/** models.Track */
export interface Track {
  title: string
  artist: string // all credited artists, comma-separated
  album: string | null
  album_artist: string | null
  track_no: number | null
  duration_s: number | null
  explicit: boolean
  spotify_track_id: string | null
  album_id: string | null
  year: number | null
  cover_url: string | null
  search_url: string | null
  video_id: string | null
  file_path: string | null // relative to the songs root
  status: TrackStatus
  error: string | null
}

export type CollectionKind = "playlist" | "album" | "track" | "artist"
/** Where the track list came from: sources.resolve() tries them in this order. */
export type CollectionSource = "spotify-api" | "embed" | "tavily" | "search" | "import"

/** models.Collection, as cached in songs/.cache/<spotify_id>.json */
export interface Collection {
  kind: CollectionKind
  spotify_id: string
  name: string
  owner_or_artist: string | null
  source: CollectionSource
  cover_url?: string | null // Spotify's image (covers.py saves a copy)
  tracks: Track[]
}

/** A Collection without its tracks, for lists. Added by the API layer. */
export interface CollectionSummary {
  kind: CollectionKind
  spotify_id: string
  name: string
  owner_or_artist: string | null
  source: CollectionSource
  total: number
  done: number
  failed: number
  m3u8: string | null // songs/<Playlist Name>.m3u8, playlists only
  cover?: string | null // /api/collections/:id/cover?v=…: the saved cover, null until it's downloaded
  updated: string // mtime of the cache file, ISO
  requeue: Requeue | null // how to run it again (null: imports and other special caches)
}

/** history.requeue_for: what to queue to run a collection again. A link usually; "top" re-runs an
 *  artist's top tracks (a plain artist link would mean the whole discography); a request for songs
 *  that were only found by searching. */
export interface Requeue {
  link?: [LinkKind, string]
  request?: ParsedRequest
}

// --- llm.py / chat.py ----------------------------------------------------------

/** llm.Request: what the small model (or the explicit "kind: …" syntax) understood */
export type RequestKind = "song" | "album" | "discography" | "albums" | "top"

export interface ParsedRequest {
  kind: RequestKind
  artist: string
  title: string | null
}

/** spotify_url.parse() kinds, plus "top" (an artist's top tracks), "tracks" (comma-separated track IDs picked
 *  in a preview) and the chat-only library tools */
export type LinkKind = "playlist" | "album" | "track" | "artist" | "user" | "top" | "tracks" | "albums" | "import" | "fix"

/** lookup.py: what a request points at, shown in "I understood" before anything is downloaded */
export interface Release {
  id: string
  name: string
  year: number | null
  kind: "Album" | "EP" | "Single" | "Compilation"
  cover_url: string | null
}

export interface Details {
  kind: "artist" | "album" | "song"
  id: string
  name: string
  subtitle: string | null // album/song: the artists
  image_url: string | null
  year: number | null
  bio: string | null // Wikipedia's summary, artists only
  bio_url: string | null
  track_count: number | null
  releases: Release[] // what a discography would download; empty otherwise
}

export type JobStatus = "queued" | "working" | "done" | "failed"

/** How a line became a job: chat.parse_line() checks links, then explicit syntax, then the model. */
export type ParsedVia = "link" | "explicit" | "model"

/** chat.Job */
export interface Job {
  id: string // API layer: stable id for the UI
  label: string
  request: ParsedRequest | null
  link: [LinkKind, string] | null
  status: JobStatus
  note: string
  units: Unit[]
  // API layer additions, reported by the queue worker while the job runs:
  via: ParsedVia
  unit_index: number // 1-based index of the unit running now
  progress: UnitProgress | null
  queued_at: string
}

/** A unit of work, as chat.expand() returns it. "bare" = a song Spotify search couldn't find. */
export type Unit =
  | { kind: "playlist" | "album" | "track" | "artist"; id: string; name?: string | null }
  | { kind: "bare"; track: Pick<Track, "title" | "artist"> }
  | { kind: "import"; paths: string[] }
  | { kind: "fix" }

/** cli.run_collection() for the unit running now. */
export interface UnitProgress {
  collection: string // "playlist 'Overnight' by Divij Pawar"
  source: CollectionSource | null // null until the track list is read
  total: number
  reused: number // already in the library (LibraryIndex hit)
  done: number
  failed: number
  phase: "resolving" | "albums" | "links" | "downloading" | "playlist" | "finished"
  recent: { label: string; ok: boolean; error?: string; retry?: string }[]
}

/** Spotify profile playlists, from sources.user_playlists(): for --list / --match */
export interface ProfilePlaylist {
  name: string
  id: string
}

/** CLI flags that shape one run (cli.main). */
export interface RunOptions {
  out: string
  workers: number
  bitrate: number
  links_only: boolean
  no_playlist: boolean
  no_album_lookup: boolean
  limit: number | null
  cookies_from_browser: string | null
  yes: boolean // chat: skip "Queue this?"
  no_plex?: boolean // don't sync playlists to Plex after downloading (YTDL_NO_PLEX)
}

// --- library_index.py ------------------------------------------------------------

/** One song file in the library, joined from library.json + every cached collection. */
export interface LibrarySong {
  path: string // Artist/Album/NN - Title.mp3
  track: Track
  in_collections: { spotify_id: string; name: string; kind: CollectionKind }[]
  format: string // .mp3 .m4a .flac .opus .ogg .wav (tags.AUDIO_EXTS)
  imported: boolean // from .cache/imported.json
  added: string // when the file appeared in the library (its creation time)
}

/** A song that failed in some playlist/album and still isn't in the library (GET /api/failed). */
export interface FailedSong {
  track: Track
  error: string | null // from the most recent attempt
  in_collections: { spotify_id: string; name: string; kind: CollectionKind; requeue: Requeue | null }[]
  last_tried: string
}

// --- history.py ------------------------------------------------------------------

/** downloaded: fetched this run · reused: already in the library, so skipped · failed · links: --links-only */
export type RunOutcome = "downloaded" | "reused" | "failed" | "links"

export interface RunTrack {
  outcome: RunOutcome
  title: string
  artist: string
  album: string | null
  spotify_track_id: string | null
  file_path: string | null
  duration_s: number | null
  error: string | null
  search_url: string | null
}

/** One playlist/album/track run: songs/.cache/runs/<id>.json. The list endpoint leaves out tracks/removed. */
export interface RunSummary {
  id: string
  started: string
  finished: string | null
  status: "ok" | "failed" | "error" | "interrupted" // failed: some songs failed · error: the run itself failed
  kind: CollectionKind
  spotify_id: string
  name: string
  owner: string | null
  source: CollectionSource | null
  options: Partial<RunOptions>
  log: string | null // logs/<name>
  job: { id: string; label: string } | null // the queue job it ran in
  counts: { total: number; downloaded: number; reused: number; failed: number; removed: number }
  playlist_file: string | null
  error: string | null
  requeue: Requeue | null
  from_log?: boolean // rebuilt from a log written before history existed
}

export interface RunRecord extends RunSummary {
  tracks: RunTrack[]
  removed: { title: string; artist: string }[]
}

// --- preview (GET /api/preview/:kind/:id) ----------------------------------------------

export interface PreviewTrack {
  title: string
  artist: string
  album: string | null // playlists: from the album cache, when known
  duration_s: number | null
  explicit: boolean
  spotify_track_id: string | null
  preview_url: string | null // Spotify's 30-second MP3 preview
  in_library: string | null // the file it would reuse
  failed_before: boolean
  error: string | null
}

/** A Spotify list as it is right now, before downloading it. */
export interface Preview {
  kind: "playlist" | "album" | "track" | "artist"
  spotify_id: string
  name: string
  owner: string | null
  cover_url: string | null
  colors: { background: string | null; tinted: string | null; subdued: string | null } // Spotify's own, per cover
  year: number | null
  duration_s: number
  capped: boolean // embed pages stop at 100 tracks
  downloaded_before: string | null // last run of this list, if any
  requeue: Requeue | null
  tracks: PreviewTrack[]
}

// --- importer.py -----------------------------------------------------------------

export type PlanStatus = "matched" | "unsorted" | "duplicate" | "better" | "still" | "error"

/** importer.Plan, as reported after a run or a dry run */
export interface ImportPlan {
  src: string
  status: PlanStatus
  dest: string | null
  replaced: string | null // _Replaced/<old path>, when status = better
  reason: string
  suggestion: string // "Artist - Title (Spotify 214s, file 230s): https://open.spotify.com/track/…"
  guesses: [string | null, string][]
  model_guess: [string, string] | null
  track: Track | null
}

export interface ImportResult {
  dry_run: boolean
  files: number
  skipped_unchanged: number
  plans: ImportPlan[]
  manifest: string | null // .cache/imports/<timestamp>.json, for undo
}

/** .cache/imports/<timestamp>.json (renamed *.undone.json once undone) */
export interface ImportManifest {
  name: string
  when: string
  mode: "copy" | "move"
  undone: boolean
  items: { src: string; dest: string; status: "matched" | "better" | "unsorted"; replaced: string | null }[]
}

/** .cache/unsorted.json, keyed by library-relative path under _Unsorted/ */
export interface UnsortedEntry {
  path: string
  src: string
  reason: string
  suggestion: string
  guesses: [string | null, string][]
  when: string
}

// --- fixer.py ----------------------------------------------------------------------

export interface FixChange {
  old: string
  new: string | null // set when the file moves/renames
  album: [string, string] | null // [before, after]
  cover: boolean
  error: string | null
}

export interface FixReport {
  dry_run: boolean
  songs: number
  albums_corrected: number
  covers_set: number
  moved: number
  errors: number
  changes: FixChange[]
  unsorted_retry: ImportResult | null
}

// --- log.py ------------------------------------------------------------------------

export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR"

export interface LogRun {
  name: string // run-YYYYmmdd-HHMMSS.log
  started: string
  args: string // cli args summary
  lines: number
  warnings: number
}

export interface LogLine {
  time: string
  level: LogLevel
  thread: string // MainThread | queue | ThreadPoolExecutor-0_1
  message: string
}

// --- environment (.env + README requirements) -------------------------------------

export type HealthState = "ok" | "degraded" | "down" | "unknown"

export interface ServiceHealth {
  id: "spotify" | "tavily" | "ollama" | "ffmpeg" | "js" | "ytdlp" | "plex"
  name: string
  state: HealthState
  detail: string
  fix?: string // plain-language fix, from log._EXPLANATIONS / README troubleshooting
}

export interface Settings {
  TAVILY_API_KEY: string
  OLLAMA_HOST: string
  OLLAMA_MODEL: string
  SPOTIFY_CLIENT_ID: string
  SPOTIFY_CLIENT_SECRET: string
  PLEX_URL?: string
  PLEX_TOKEN?: string // masked when read back, like the other secrets
  defaults: RunOptions & { log_dir: string }
}

// --- plex.py -------------------------------------------------------------------------

export type PlexAction = "created" | "updated" | "up_to_date" | "skipped" | "would_create" | "would_update" | "error"

/** One playlist's outcome from plex.PlexSync.sync */
export interface PlexResult {
  spotify_id: string
  name: string
  action: PlexAction
  songs: number // in the Plex playlist (or would be)
  added: number
  removed: number
  missing: number // songs Plex hasn't indexed yet
  message: string
}

/** POST /api/plex: plex.sync_all */
export interface PlexReport {
  library: string // the Plex music library
  dry_run: boolean
  results: PlexResult[]
}
