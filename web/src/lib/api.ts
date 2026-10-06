// The HTTP contract between the UI and the Python side (src/yt_dl_agent/server.py, `yt-dl-agent serve`).
// Each method names the backend function it wraps. `mockApi` serves the sample data in mock.ts instead:
// the default for `npm run dev`; `npm run dev:live` and the built UI talk to the real server.

import * as mock from "./mock"
import type {
  Collection,
  CollectionSummary,
  FailedSong,
  FixReport,
  ImportManifest,
  ImportResult,
  Job,
  LibrarySong,
  LinkKind,
  LogLine,
  LogRun,
  ParsedRequest,
  ProfilePlaylist,
  Requeue,
  RunOptions,
  RunRecord,
  RunSummary,
  ServiceHealth,
  Settings,
  UnsortedEntry,
} from "./types"

export interface Api {
  /** POST /api/parse            chat.parse_line(line): links, then "kind: …" syntax, then Ollama.
   *  warnings: what the CLI would have printed, e.g. "Couldn't understand that: Ollama isn't reachable…" */
  parse(line: string): Promise<{ jobs: Job[]; warnings: string[] }>
  /** POST /api/queue            DownloadQueue.add(job) for each; options = the CLI flags for the run */
  enqueue(jobs: Job[], options: RunOptions): Promise<Job[]>
  /** GET  /api/queue            DownloadQueue.jobs, with live progress of the running one */
  queue(): Promise<Job[]>
  /** GET  /api/profiles/:id     sources.user_playlists(id): for --list, then pick (--match) */
  profilePlaylists(userId: string): Promise<ProfilePlaylist[]>

  /** GET  /api/collections      every songs/.cache/<id>.json, summarized */
  collections(): Promise<CollectionSummary[]>
  /** GET  /api/collections/:id  one cached Collection with its tracks, plus how to run it again */
  collection(id: string): Promise<(Collection & { requeue: Requeue | null }) | null>
  /** GET  /api/failed           songs that failed somewhere and still aren't in the library */
  failed(): Promise<FailedSong[]>
  /** GET  /api/runs             history.Run records, newest first (no per-song lists); filter by queue job */
  runs(filter?: { job?: string; spotify_id?: string }): Promise<RunSummary[]>
  /** GET  /api/runs/:id         one run, song by song */
  run(id: string): Promise<RunRecord | null>
  /** GET  /api/library          library.json joined with the collections that use each file */
  library(): Promise<LibrarySong[]>

  /** POST /api/import           importer.run_import(paths, dry_run) */
  importFiles(paths: string[], dryRun: boolean): Promise<ImportResult>
  /** GET  /api/imports          .cache/imports/*.json */
  importHistory(): Promise<ImportManifest[]>
  /** POST /api/imports/:name/undo  importer.undo(root, name) */
  undoImport(name: string): Promise<void>
  /** GET  /api/unsorted         .cache/unsorted.json */
  unsorted(): Promise<UnsortedEntry[]>
  /** POST /api/fix              fixer.run_fix(root, dry_run) */
  fix(dryRun: boolean): Promise<FixReport>

  /** GET  /api/logs, /api/logs/:name   logs/run-*.log */
  logRuns(): Promise<LogRun[]>
  logLines(name: string): Promise<LogLine[]>

  /** GET  /api/health           checks behind log.explain(): Spotify, Tavily, Ollama, ffmpeg, JS, yt-dlp.
   *  Cached for 30 s unless refresh. */
  health(refresh?: boolean): Promise<ServiceHealth[]>
  /** GET/PUT /api/settings      .env + default CLI flags */
  settings(): Promise<Settings>
  saveSettings(s: Settings): Promise<void>
}

// --- mock parsing: a client-side stand-in for chat.parse_line ----------------------

const LINK = /https?:\/\/open\.spotify\.com\/\S+|spotify:[a-z]+:\S+/g
const URL_RE = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?|spotify:)(playlist|album|track|artist)[/:]([A-Za-z0-9]{22})/
const USER_RE = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?|spotify:)user[/:]([^/?#:]+)/
const EXPLICIT = /^\s*(song|track|album|discography|albums|top)\s*:\s*(.+?)\s*$/i

export function describe(r: ParsedRequest): string {
  return {
    song: `"${r.title}" by ${r.artist}`,
    album: `"${r.title}" by ${r.artist}`,
    discography: `${r.artist} (albums, EPs, singles)`,
    albums: `${r.artist} (albums and EPs)`,
    top: r.artist,
  }[r.kind]
}

let nextId = 100
function job(partial: Pick<Job, "label" | "request" | "link" | "via">): Job {
  return {
    id: `j${nextId++}`,
    status: "queued",
    note: "",
    units: [],
    unit_index: 0,
    progress: null,
    queued_at: new Date().toISOString(),
    ...partial,
  }
}

/** A job for a known Spotify link, as chat.parse_line makes for pasted links. Rerunning one syncs it. */
export function linkJob(kind: LinkKind, id: string, name?: string): Job {
  const j = job({ label: `link         ${kind} ${id}`, request: null, link: [kind, id], via: "link" })
  if (name && kind !== "user" && kind !== "import" && kind !== "fix")
    j.units = [{ kind: kind === "top" ? "artist" : kind, id, name }] // top: the artist's top tracks
  return j
}

/** A queue job that runs a collection (or a failed run) again. Only missing and failed songs are fetched. */
export function requeueJob(r: Requeue, name?: string): Job {
  if (r.link) return linkJob(r.link[0], r.link[1], name)
  const req = r.request!
  return job({ label: label(req), request: req, link: null, via: "explicit" })
}

function explicit(line: string): ParsedRequest | null {
  const m = EXPLICIT.exec(line)
  if (!m) return null
  let kind = m[1].toLowerCase()
  if (kind === "track") kind = "song"
  const rest = m[2]
  if (kind === "song" || kind === "album") {
    const i = rest.lastIndexOf(" - ")
    return i < 0 ? null : { kind, title: rest.slice(0, i).trim(), artist: rest.slice(i + 3).trim() }
  }
  return { kind: kind as ParsedRequest["kind"], artist: rest, title: null }
}

/** Rough imitation of what llm.parse_request returns, good enough to exercise the UI. */
function fakeModel(text: string): ParsedRequest[] {
  return text
    .split(/,\s*(?:and\s+)?|\s+and\s+the\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s): ParsedRequest | null => {
      let m: RegExpMatchArray | null
      if ((m = s.match(/^(?:the\s+)?(.+?)\s+discography$/i)) || (m = s.match(/^everything by (.+)$/i)))
        return { kind: "discography", artist: m[1], title: null }
      if ((m = s.match(/^all (.+?) albums$/i))) return { kind: "albums", artist: m[1], title: null }
      if ((m = s.match(/^(?:the\s+)?top songs (?:of|by) (.+)$/i))) return { kind: "top", artist: m[1], title: null }
      if ((m = s.match(/^(.+?) by (.+)$/i)))
        return { kind: /^(currents|bloom|am|lonerism|preacher'?s daughter)$/i.test(m[1]) ? "album" : "song", title: m[1], artist: m[2] }
      return null
    })
    .filter((r): r is ParsedRequest => r !== null)
}

const KIND_WORD: Record<ParsedRequest["kind"], string> = {
  song: "song",
  album: "album",
  discography: "discography",
  albums: "albums",
  top: "top songs",
}

function label(r: ParsedRequest) {
  return `${KIND_WORD[r.kind].padEnd(12)} ${describe(r)}`
}

export function parseLineLocally(line: string): Job[] {
  const out: Job[] = []
  for (const url of line.match(LINK) ?? []) {
    const m = URL_RE.exec(url)
    const u = USER_RE.exec(url)
    const link: [LinkKind, string] | null = m ? [m[1] as LinkKind, m[2]] : u ? ["user", u[1]] : null
    if (link) out.push(job({ label: `link         ${link[0]} ${link[1]}`, request: null, link, via: "link" }))
  }
  const rest = line.replace(LINK, "").replace(/^[\s,;]+|[\s,;]+$/g, "")
  if (!rest) return out
  const ex = explicit(rest)
  if (ex) return [...out, job({ label: label(ex), request: ex, link: null, via: "explicit" })]
  return [...out, ...fakeModel(rest).map((r) => job({ label: label(r), request: r, link: null, via: "model" }))]
}

const wait = <T,>(v: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), ms))

export const mockApi: Api = {
  parse: (line) => {
    const jobs = parseLineLocally(line)
    const warnings = jobs.length ? [] : ["Couldn't find any artist, album or song in that. Try e.g. 'Currents by Tame Impala'."]
    return wait({ jobs, warnings }, 600)
  },
  enqueue: (jobs) => wait(jobs),
  queue: () => wait(mock.jobs),
  profilePlaylists: () => wait(mock.profilePlaylists, 700),
  collections: () => wait(mock.collectionSummaries),
  collection: (id) => {
    const c = mock.collections.find((c) => c.spotify_id === id)
    return wait(c ? { ...c, requeue: { link: [c.kind, c.spotify_id] as [LinkKind, string] } } : null)
  },
  failed: () => wait(mock.failedSongs),
  runs: (f) =>
    wait(
      mock.runs
        .filter((r) => (!f?.job || r.job?.id === f.job) && (!f?.spotify_id || r.spotify_id === f.spotify_id))
        .map(({ tracks: _t, removed: _r, ...summary }) => summary),
    ),
  run: (id) => wait(mock.runs.find((r) => r.id === id) ?? null),
  library: () => wait(mock.librarySongs),
  importFiles: (_paths, dryRun) =>
    wait({ ...mock.importResult, dry_run: dryRun, manifest: dryRun ? null : "20261006-161500.json" }, 1200),
  importHistory: () => wait(mock.importManifests),
  undoImport: () => wait(undefined, 600),
  unsorted: () => wait(mock.unsorted),
  fix: (dryRun) => wait({ ...mock.fixReport, dry_run: dryRun }, 1400),
  logRuns: () => wait(mock.logRuns),
  logLines: () => wait(mock.logLines),
  health: () => wait(mock.health, 400),
  settings: () => wait(mock.settings),
  saveSettings: () => wait(undefined, 400),
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    const text = await r.text()
    let detail = text
    try {
      detail = JSON.parse(text).detail ?? text // FastAPI: {"detail": "..."}
    } catch {
      // not JSON: keep the text
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail))
  }
  return r.status === 204 ? (undefined as T) : r.json()
}

export const httpApi: Api = {
  parse: (line) => call("POST", "/parse", { line }),
  enqueue: (jobs, options) => call("POST", "/queue", { jobs, options }),
  queue: () => call("GET", "/queue"),
  profilePlaylists: (id) => call("GET", `/profiles/${encodeURIComponent(id)}`),
  collections: () => call("GET", "/collections"),
  collection: (id) => call("GET", `/collections/${id}`),
  failed: () => call("GET", "/failed"),
  runs: (f) => call("GET", `/runs?${new URLSearchParams(Object.entries(f ?? {}).filter(([, v]) => v) as [string, string][])}`),
  run: (id) => call("GET", `/runs/${encodeURIComponent(id)}`),
  library: () => call("GET", "/library"),
  importFiles: (paths, dry_run) => call("POST", "/import", { paths, dry_run }),
  importHistory: () => call("GET", "/imports"),
  undoImport: (name) => call("POST", `/imports/${encodeURIComponent(name)}/undo`),
  unsorted: () => call("GET", "/unsorted"),
  fix: (dry_run) => call("POST", "/fix", { dry_run }),
  logRuns: () => call("GET", "/logs"),
  logLines: (name) => call("GET", `/logs/${encodeURIComponent(name)}`),
  health: (refresh) => call("GET", `/health${refresh ? "?refresh=true" : ""}`),
  settings: () => call("GET", "/settings"),
  saveSettings: (s) => call("PUT", "/settings", s),
}

/** "http" (the real server) or "mock" (sample data). */
export const API_MODE: "http" | "mock" =
  import.meta.env.VITE_API === "http" || import.meta.env.VITE_API === "mock"
    ? import.meta.env.VITE_API
    : import.meta.env.PROD
      ? "http"
      : "mock"

export const api: Api = API_MODE === "http" ? httpApi : mockApi
