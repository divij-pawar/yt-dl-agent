import { useMemo, useState } from "react"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleSlashIcon,
  ExternalLinkIcon,
  FileClockIcon,
  HistoryIcon,
  ListMusicIcon,
  RotateCcwIcon,
  SearchIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react"
import { NavLink, useSearchParams } from "react-router-dom"
import { Page } from "@/components/page"
import { KindBadge } from "@/components/status"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TrackSheet } from "@/components/track-sheet"
import { api } from "@/lib/api"
import { duration, plural } from "@/lib/format"
import { useLoad } from "@/lib/hooks"
import { useRequeue } from "@/lib/requeue"
import type { LibrarySong, RunOutcome, RunSummary, RunTrack } from "@/lib/types"
import { cn } from "@/lib/utils"

type Filter = "all" | "downloaded" | "failed" | "error"

const FILTERS: { id: Filter; label: string; test: (r: RunSummary) => boolean }[] = [
  { id: "all", label: "All runs", test: () => true },
  { id: "downloaded", label: "Downloaded something", test: (r) => r.counts.downloaded > 0 },
  { id: "failed", label: "Songs failed", test: (r) => r.counts.failed > 0 },
  { id: "error", label: "Run failed", test: (r) => r.status === "error" || r.status === "interrupted" },
]

function day(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 864e5)
  if (d.toDateString() === today.toDateString()) return "Today"
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday"
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })
}
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
const took = (r: RunSummary) => {
  if (!r.finished) return null
  const s = Math.round((new Date(r.finished).getTime() - new Date(r.started).getTime()) / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

export function HistoryPage() {
  const [params, setParams] = useSearchParams()
  const view = params.get("view") === "songs" ? "songs" : "runs"
  const failed = useLoad(() => api.failed())
  const { retry } = useRequeue()
  const nFailed = failed.data?.length ?? 0

  return (
    <Page
      title="History"
      help="history"
      description="Every run, song by song: what was downloaded, what was already in the library (so it was skipped), what failed and why."
      actions={
        nFailed > 0 && (
          <Button variant="outline" onClick={() => retry(failed.data!.flatMap((f) => f.in_collections), "Retrying failed songs")}>
            <RotateCcwIcon />
            Retry all {plural(nFailed, "failed song")}
          </Button>
        )
      }
    >
      <Tabs value={view} onValueChange={(v) => setParams(v === "songs" ? { view: "songs" } : {})}>
        <TabsList>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="songs">Downloaded songs</TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "songs" ? <DownloadedSongs /> : <RunsView />}
    </Page>
  )
}

function RunsView() {
  const [params, setParams] = useSearchParams()
  const job = params.get("job")
  const runs = useLoad(() => api.runs(job ? { job } : undefined), [job])
  const [filter, setFilter] = useState<Filter>("all")
  const [q, setQ] = useState("")
  const [openId, setOpenId] = useState<string | null>(null)

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, (runs.data ?? []).filter(f.test).length])) as Record<Filter, number>,
    [runs.data],
  )
  const shown = useMemo(() => {
    const test = FILTERS.find((f) => f.id === filter)!.test
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (runs.data ?? []).filter(
      (r) => test(r) && words.every((w) => `${r.name} ${r.owner ?? ""} ${r.kind}`.toLowerCase().includes(w)),
    )
  }, [runs.data, filter, q])
  const groups = useMemo(() => {
    const out: [string, RunSummary[]][] = []
    for (const r of shown) {
      const d = day(r.started)
      if (out.at(-1)?.[0] !== d) out.push([d, []])
      out.at(-1)![1].push(r)
    }
    return out
  }, [shown])
  const totals = shown.reduce(
    (t, r) => ({ downloaded: t.downloaded + r.counts.downloaded, reused: t.reused + r.counts.reused, failed: t.failed + r.counts.failed }),
    { downloaded: 0, reused: 0, failed: 0 },
  )

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="max-w-xs">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput placeholder="Filter by playlist or album" value={q} onChange={(e) => setQ(e.target.value)} />
        </InputGroup>
        <ToggleGroup variant="outline" size="sm" value={[filter]} onValueChange={(v) => v.length && setFilter(v[0] as Filter)} className="flex-wrap">
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f.id} value={f.id}>
              {f.label}
              <span className="text-xs text-muted-foreground tabular-nums">{counts[f.id] ?? 0}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {job && (
          <Badge variant="secondary" className="h-7 gap-1 pr-1">
            One queue job
            <button aria-label="Show all runs" className="rounded-sm p-0.5 hover:bg-background" onClick={() => setParams({})}>
              <XIcon className="size-3" />
            </button>
          </Badge>
        )}
      </div>

      {shown.length > 0 && (
        <div className="-mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{plural(shown.length, "run")}</span>
          <span className="text-success">{totals.downloaded} downloaded</span>
          <span>{totals.reused} already in library</span>
          {totals.failed > 0 && <span className="text-destructive">{totals.failed} failed</span>}
        </div>
      )}

      {runs.loading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : !runs.data?.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HistoryIcon />
            </EmptyMedia>
            <EmptyTitle>No runs recorded yet</EmptyTitle>
            <EmptyDescription>
              Every download from now on is recorded here, song by song. Runs from before this was added only have their{" "}
              <NavLink to="/logs" className="underline underline-offset-2">
                log
              </NavLink>
              .
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-5">
          {groups.map(([d, rs]) => (
            <section key={d} className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">{d}</h2>
              <Card className="gap-0 divide-y p-0">
                {rs.map((r) => (
                  <RunRow key={r.id} run={r} onOpen={() => setOpenId(r.id)} />
                ))}
              </Card>
            </section>
          ))}
          {!shown.length && <p className="text-sm text-muted-foreground">No runs match the filter.</p>}
        </div>
      )}

      <RunSheet id={openId} onClose={() => setOpenId(null)} />
    </>
  )
}

function StatusIcon({ r, className }: { r: RunSummary; className?: string }) {
  const c = cn("size-4 shrink-0", className)
  if (r.status === "error") return <XCircleIcon className={cn(c, "text-destructive")} />
  if (r.status === "interrupted") return <CircleSlashIcon className={cn(c, "text-muted-foreground")} />
  if (r.status === "failed") return <AlertTriangleIcon className={cn(c, "text-destructive")} />
  return <CheckCircle2Icon className={cn(c, r.counts.downloaded ? "text-success" : "text-muted-foreground")} />
}

/** One line per run: what came of it, in words. */
function Outcome({ r }: { r: RunSummary }) {
  if (r.status === "error") return <span className="truncate text-destructive">{r.error ?? "The run failed."}</span>
  if (r.status === "interrupted") return <span className="text-muted-foreground">Stopped before it finished</span>
  const c = r.counts
  if (r.options?.links_only) return <span className="text-muted-foreground">Search links only, {plural(c.total, "song")}</span>
  const upToDate = !c.downloaded && !c.failed
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {upToDate && <span className="text-muted-foreground">Up to date</span>}
      {c.downloaded > 0 && <span className="text-success">{c.downloaded} downloaded</span>}
      {c.reused > 0 && <span className="text-muted-foreground">{c.reused} already in library</span>}
      {c.failed > 0 && <span className="text-destructive">{c.failed} failed</span>}
      {c.removed > 0 && <span className="text-muted-foreground">{c.removed} removed on Spotify</span>}
    </span>
  )
}

function RunRow({ run: r, onOpen }: { run: RunSummary; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50">
      <StatusIcon r={r} />
      <span className="w-16 shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{time(r.started)}</span>
      <KindBadge kind={r.kind} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {r.name}
          {r.owner && <span className="font-normal text-muted-foreground"> · {r.owner}</span>}
        </span>
        <span className="block text-xs">
          <Outcome r={r} />
        </span>
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

const TABS: { id: RunOutcome | "removed"; label: string }[] = [
  { id: "downloaded", label: "Downloaded" },
  { id: "failed", label: "Failed" },
  { id: "reused", label: "Already in library" },
  { id: "removed", label: "Removed" },
  { id: "links", label: "Links only" },
]

function RunSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: r, loading } = useLoad(() => (id ? api.run(id) : Promise.resolve(null)), [id])
  const { retry } = useRequeue()
  const [tab, setTab] = useState<RunOutcome | "removed" | null>(null)

  const by = (o: RunOutcome) => (r?.tracks ?? []).filter((t) => t.outcome === o)
  const n = (k: RunOutcome | "removed") => (k === "removed" ? (r?.removed.length ?? 0) : by(k).length)
  const tabs = TABS.filter((t) => n(t.id) > 0)
  const current = tab && n(tab) ? tab : (tabs.find((t) => t.id === "failed") ?? tabs[0])?.id
  const canOpen = r && r.status !== "error" && !r.spotify_id.startsWith("search-")
  const flags = r
    ? Object.entries(r.options ?? {})
        .filter(([k, v]) => v && !(k === "workers" && v === 4) && !(k === "bitrate" && v === 320))
        .map(([k, v]) => (v === true ? `--${k.replace(/_/g, "-")}` : `--${k.replace(/_/g, "-")} ${v}`))
    : []

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        {loading || !r ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <>
            <SheetHeader className="border-b">
              <div className="flex items-center gap-2">
                <KindBadge kind={r.kind} />
                <StatusIcon r={r} />
              </div>
              <SheetTitle className="text-lg">{r.name}</SheetTitle>
              <SheetDescription>
                {[r.owner, `${day(r.started)} at ${time(r.started)}`, took(r) && `took ${took(r)}`, r.source && `from ${r.source === "embed" ? "the embed page" : r.source}`]
                  .filter(Boolean)
                  .join(" · ")}
              </SheetDescription>
              {(r.job || flags.length > 0 || r.from_log) && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {r.from_log && (
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      rebuilt from its log
                    </Badge>
                  )}
                  {r.job && (
                    <Badge variant="outline" className="max-w-full truncate font-normal">
                      queued as: {r.job.label.replace(/\s+/g, " ")}
                    </Badge>
                  )}
                  {flags.map((f) => (
                    <Badge key={f} variant="outline" className="font-mono text-[11px]">
                      {f}
                    </Badge>
                  ))}
                </div>
              )}
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
              {r.status === "error" ? (
                <Alert variant="destructive">
                  <XCircleIcon />
                  <AlertTitle>This run couldn't start</AlertTitle>
                  <AlertDescription>{r.error}</AlertDescription>
                </Alert>
              ) : r.status === "interrupted" ? (
                <Alert>
                  <CircleSlashIcon />
                  <AlertTitle>Stopped before it finished</AlertTitle>
                  <AlertDescription>Run it again: songs that did finish are already in the library and won't be fetched twice.</AlertDescription>
                </Alert>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {(
                    [
                      ["downloaded", "Downloaded", "text-success"],
                      ["reused", "Already in library", ""],
                      ["failed", "Failed", "text-destructive"],
                      ["removed", "Removed", ""],
                    ] as const
                  ).map(([k, label, color]) => (
                    <button
                      key={k}
                      disabled={!n(k)}
                      onClick={() => setTab(k)}
                      className={cn(
                        "rounded-lg border p-2 text-left disabled:opacity-50",
                        current === k ? "border-foreground/30 bg-muted" : "hover:bg-muted/50",
                      )}
                    >
                      <div className={cn("text-xl font-semibold tabular-nums", n(k) ? color : "")}>{n(k)}</div>
                      <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
                    </button>
                  ))}
                </div>
              )}

              {tabs.length > 0 && current && (
                <Tabs value={current} onValueChange={(v) => setTab(v as RunOutcome)} className="min-h-0 flex-1">
                  <TabsList className="w-full">
                    {tabs.map((t) => (
                      <TabsTrigger key={t.id} value={t.id}>
                        {t.label} <span className="text-xs text-muted-foreground tabular-nums">{n(t.id)}</span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <ScrollArea className="min-h-0 flex-1 rounded-lg border">
                    <ul className="divide-y">
                      {current === "removed"
                        ? r.removed.map((t, i) => (
                            <li key={i} className="px-3 py-2 text-sm">
                              <div className="font-medium">{t.title}</div>
                              <div className="text-xs text-muted-foreground">{t.artist} · no longer on the Spotify list; the MP3 is kept</div>
                            </li>
                          ))
                        : by(current as RunOutcome).map((t, i) => <TrackLine key={i} t={t} />)}
                    </ul>
                  </ScrollArea>
                  {current === "reused" && r.from_log && (
                    <p className="text-xs text-muted-foreground">
                      This run is from before History existed. Its log gives the count; the songs listed are the ones this list
                      has in the library today.
                    </p>
                  )}
                  {current === "reused" && !r.from_log && (
                    <p className="text-xs text-muted-foreground">
                      These were already downloaded (by this or another playlist or album), so they were skipped and the playlist
                      points at the existing file.
                    </p>
                  )}
                </Tabs>
              )}
            </div>

            <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
              <Button variant="ghost" size="sm" disabled={!r.log} render={<NavLink to={`/logs?name=${r.log ?? ""}`} />}>
                <FileClockIcon />
                Log
              </Button>
              {canOpen && (
                <Button variant="outline" size="sm" render={<NavLink to={`/playlists/${r.spotify_id}`} />}>
                  <ListMusicIcon />
                  Open {r.kind}
                </Button>
              )}
              {r.requeue && (r.counts.failed > 0 || r.status === "error" || r.status === "interrupted") && (
                <Button
                  size="sm"
                  onClick={async () => {
                    await retry([{ name: r.name, requeue: r.requeue }], r.counts.failed ? "Retrying failed songs" : "Running again")
                    onClose()
                  }}
                >
                  <RotateCcwIcon />
                  {r.counts.failed ? `Retry ${plural(r.counts.failed, "failed song")}` : "Run again"}
                </Button>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function TrackLine({ t }: { t: RunTrack }) {
  return (
    <li className="space-y-0.5 px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.title}</span>
        {t.outcome === "failed" && t.search_url && (
          <a href={t.search_url} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-muted-foreground hover:text-foreground">
            YT Music search <ExternalLinkIcon className="inline size-3" />
          </a>
        )}
      </div>
      <div className="truncate text-xs text-muted-foreground">
        {t.artist}
        {t.album && ` · ${t.album}`}
      </div>
      {t.outcome === "failed" ? (
        <div className="text-xs text-destructive">{t.error ?? "No reason recorded."}</div>
      ) : (
        t.file_path && <code className="block truncate text-[11px] text-muted-foreground">{t.file_path}</code>
      )}
    </li>
  )
}

/** Every song in the library, by when its file arrived (downloads and imports), newest first. */
function DownloadedSongs() {
  const { data, loading } = useLoad(() => api.library())
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<LibrarySong | null>(null)
  const [limit, setLimit] = useState(200)

  const sorted = useMemo(() => [...(data ?? [])].sort((a, b) => b.added.localeCompare(a.added)), [data])
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return sorted.filter((s) =>
      words.every((w) =>
        `${s.track.title} ${s.track.artist} ${s.track.album ?? ""} ${s.in_collections.map((c) => c.name).join(" ")}`.toLowerCase().includes(w),
      ),
    )
  }, [sorted, q])
  const perDay = useMemo(() => {
    const n = new Map<string, number>()
    for (const s of shown) n.set(day(s.added), (n.get(day(s.added)) ?? 0) + 1)
    return n
  }, [shown])
  const groups = useMemo(() => {
    const out: [string, LibrarySong[]][] = []
    for (const s of shown.slice(0, limit)) {
      const d = day(s.added)
      if (out.at(-1)?.[0] !== d) out.push([d, []])
      out.at(-1)![1].push(s)
    }
    return out
  }, [shown, limit])

  if (loading) return <Skeleton className="h-96 rounded-xl" />
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="max-w-xs">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput placeholder="Filter by song, artist or playlist" value={q} onChange={(e) => setQ(e.target.value)} />
        </InputGroup>
      </div>
      <p className="-mt-2 text-sm text-muted-foreground">
        {plural(shown.length, "song")}, newest first. Dated by when each file arrived, so this includes songs from before History
        existed.
      </p>
      <div className="space-y-5">
        {groups.map(([d, songs]) => (
          <section key={d} className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              {d} <span className="font-normal">· {plural(perDay.get(d) ?? songs.length, "song")}</span>
            </h2>
            <Card className="gap-0 divide-y p-0">
              {songs.map((s) => (
                <button key={s.path} onClick={() => setOpen(s)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50">
                  <CheckCircle2Icon className="size-4 shrink-0 text-success" />
                  <span className="w-16 shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{time(s.added)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.track.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.track.artist}
                      {s.track.album && ` · ${s.track.album}`}
                    </span>
                  </span>
                  <span className="hidden max-w-56 flex-wrap justify-end gap-1 md:flex">
                    {s.imported && <Badge variant="outline">imported</Badge>}
                    {s.in_collections.slice(0, 2).map((c) => (
                      <Badge key={c.spotify_id} variant="secondary" className="max-w-40 justify-start">
                        <span className="truncate">{c.name}</span>
                      </Badge>
                    ))}
                    {s.in_collections.length > 2 && <Badge variant="secondary">+{s.in_collections.length - 2}</Badge>}
                  </span>
                  <span className="w-12 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{duration(s.track.duration_s)}</span>
                </button>
              ))}
            </Card>
          </section>
        ))}
        {shown.length > limit && (
          <Button variant="outline" className="w-full" onClick={() => setLimit((l) => l + 300)}>
            Show more ({shown.length - limit} older)
          </Button>
        )}
        {!shown.length && <p className="text-sm text-muted-foreground">No songs match.</p>}
      </div>
      <TrackSheet track={open?.track ?? null} song={open} open={!!open} onOpenChange={(o) => !o && setOpen(null)} />
    </>
  )
}
