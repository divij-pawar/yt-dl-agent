// The chat queue (chat.DownloadQueue) as React state: one job at a time, in order.
// Against the real server this polls GET /api/queue; with the mock API it simulates the worker.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { API_MODE, api } from "./api"
import * as mock from "./mock"
import type { Job, RunOptions, Unit } from "./types"

interface QueueState {
  jobs: Job[]
  options: RunOptions
  defaults: RunOptions // from GET /api/settings
  setOptions: (o: RunOptions) => void
  enqueue: (jobs: Job[]) => Promise<void>
  active: Job | undefined
  pending: number
}

const Ctx = createContext<QueueState | null>(null)
const SIMULATE = API_MODE === "mock"

/** What chat.expand() would turn a job into, for the simulation. */
function fakeUnits(j: Job): Unit[] {
  if (j.link) {
    const [kind, id] = j.link
    if (kind === "user") return mock.profilePlaylists.slice(0, 3).map((p) => ({ kind: "playlist", id: p.id, name: p.name }))
    if (kind === "import" || kind === "fix") return [{ kind: "fix" }]
    if (kind === "tracks") return id.split(",").map((t) => ({ kind: "track", id: t, name: `track ${t.slice(0, 6)}…` }))
    if (kind === "albums") return id.split(",").map((a) => ({ kind: "album", id: a, name: `album ${a.slice(0, 6)}…` }))
    return [{ kind: kind === "top" ? "artist" : kind, id, name: `${kind} ${id.slice(0, 6)}…` }]
  }
  const r = j.request!
  if (r.kind === "song") return [{ kind: "track", id: "t", name: r.title ?? "" }]
  if (r.kind === "album") return [{ kind: "album", id: "a", name: r.title ?? "" }]
  if (r.kind === "top") return [{ kind: "artist", id: "ar", name: `top songs of ${r.artist}` }]
  return ["Debut", "Second", "Third"].map((n, i) => ({ kind: "album", id: `a${i}`, name: `${r.artist}: ${n}` }))
}

function tick(jobs: Job[]): Job[] {
  const i = jobs.findIndex((j) => j.status === "working")
  if (i < 0) {
    const next = jobs.findIndex((j) => j.status === "queued")
    if (next < 0) return jobs
    const j = { ...jobs[next] }
    j.status = "working"
    j.units = j.units.length ? j.units : fakeUnits(j)
    j.unit_index = 1
    j.progress = start(j)
    return jobs.map((x, k) => (k === next ? j : x))
  }
  const j = structuredClone(jobs[i])
  const p = j.progress!
  if (p.phase !== "downloading") p.phase = "downloading"
  else if (p.reused + p.done + p.failed < p.total) {
    p.done += 1
    p.recent = [{ label: `${j.request?.artist ?? "Track"} - track ${p.done}`, ok: true }, ...p.recent].slice(0, 5)
  } else if (j.unit_index < j.units.length) {
    j.unit_index += 1
    j.progress = start(j)
  } else {
    j.status = "done"
    j.progress = null
  }
  return jobs.map((x, k) => (k === i ? j : x))
}

function start(j: Job) {
  const u = j.units[j.unit_index - 1]
  const name = "name" in u && u.name ? u.name : u.kind
  const total = u.kind === "track" ? 1 : u.kind === "artist" ? 10 : 8
  return {
    collection: `${u.kind} '${name}'`,
    source: "embed" as const,
    total,
    reused: Math.min(1, total - 1),
    done: 0,
    failed: 0,
    phase: "resolving" as const,
    recent: [],
  }
}

export function QueueProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [defaults, setDefaults] = useState<RunOptions>(mock.settings.defaults)
  const [options, setOptions] = useState<RunOptions>(mock.settings.defaults)
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  useEffect(() => {
    api.queue().then(setJobs)
    api.settings().then((s) => {
      // Settings added later are missing from an older server's reply: use their defaults.
      const d = { ...s.defaults, preview_links: s.defaults.preview_links ?? true }
      setDefaults(d)
      setOptions(d)
    })
  }, [])

  useEffect(() => {
    const id = setInterval(
      () => (SIMULATE ? setJobs(tick) : api.queue().then(setJobs)),
      SIMULATE ? 1500 : 2000,
    )
    return () => clearInterval(id)
  }, [])

  const enqueue = useCallback(async (add: Job[]) => {
    const accepted = await api.enqueue(add, optionsRef.current)
    setJobs((js) => [...js, ...accepted.map((j) => ({ ...j, queued_at: new Date().toISOString() }))])
  }, [])

  const active = jobs.find((j) => j.status === "working")
  const pending = jobs.filter((j) => j.status === "queued" || j.status === "working").length
  return <Ctx.Provider value={{ jobs, options, defaults, setOptions, enqueue, active, pending }}>{children}</Ctx.Provider>
}

export function useQueue() {
  const v = useContext(Ctx)
  if (!v) throw new Error("useQueue outside QueueProvider")
  return v
}
