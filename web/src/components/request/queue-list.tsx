import { useState } from "react"
import { AlertTriangleIcon, CheckIcon, ExternalLinkIcon, HistoryIcon, InboxIcon, RotateCcwIcon, XIcon } from "lucide-react"
import { NavLink } from "react-router-dom"
import { JobStatusBadge, KindBadge, SourceBadge } from "@/components/status"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { describe } from "@/lib/api"
import { when } from "@/lib/format"
import type { Job, UnitProgress } from "@/lib/types"
import { cn } from "@/lib/utils"

type Filter = "all" | "active" | "done" | "failed"

function title(j: Job) {
  if (j.link?.[0] === "tracks") return j.label.replace(/^songs\s+/, "") // "3 songs from “Overnight”"
  if (j.link?.[0] === "albums") return j.label.replace(/^albums\s+/, "") // "Tame Impala (5 of 7 releases)"
  return j.request ? describe(j.request) : j.units[0] && "name" in j.units[0] && j.units[0].name ? j.units[0].name : `${j.link![0]} ${j.link![1]}`
}

export function QueueList({ jobs, onRequeue }: { jobs: Job[]; onRequeue: (j: Job) => void }) {
  const [filter, setFilter] = useState<Filter>("all")
  const count = {
    all: jobs.length,
    active: jobs.filter((j) => j.status === "queued" || j.status === "working").length,
    done: jobs.filter((j) => j.status === "done").length,
    failed: jobs.filter((j) => j.status === "failed").length,
  }
  const working = jobs.find((j) => j.status === "working")
  const queued = jobs.filter((j) => j.status === "queued")
  const finished = jobs
    .filter((j) => (j.status === "done" || j.status === "failed") && (filter === "all" || filter === j.status))
    .reverse()

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Queue</h2>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            {(["all", "active", "done", "failed"] as const).map((f) => (
              <TabsTrigger key={f} value={f} className="capitalize">
                {f}
                <span className="text-xs text-muted-foreground tabular-nums">{count[f]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {jobs.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing queued</EmptyTitle>
            <EmptyDescription>Type a request above. Each one is downloaded in order, in the background.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {(filter === "all" || filter === "active") && working && <ActiveJob job={working} />}

      {(filter === "all" || filter === "active") && queued.length > 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Up next</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {queued.map((j, i) => (
              <div key={j.id} className="flex items-center gap-3 px-4 py-2">
                <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <KindBadge kind={j.request?.kind ?? j.link![0]} />
                <span className="min-w-0 flex-1 truncate text-sm">{title(j)}</span>
                <span className="text-xs text-muted-foreground">{when(j.queued_at)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {filter !== "active" && finished.length > 0 && (
        <Card size="sm">
          <CardContent className="divide-y p-0">
            {finished.map((j) => (
              <FinishedRow key={j.id} job={j} onRequeue={() => onRequeue(j)} />
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  )
}

const PHASES: { id: UnitProgress["phase"]; label: string }[] = [
  { id: "resolving", label: "Track list" },
  { id: "albums", label: "Albums" },
  { id: "links", label: "Search links" },
  { id: "downloading", label: "Download" },
  { id: "playlist", label: "Playlist file" },
]

function ActiveJob({ job }: { job: Job }) {
  const p = job.progress
  const multi = job.units.length > 1
  const phaseIdx = p ? PHASES.findIndex((x) => x.id === p.phase) : 0

  return (
    <Card className="border-info/40">
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2">
          <KindBadge kind={job.request?.kind ?? job.link![0]} />
          <span className="truncate">{title(job)}</span>
        </CardTitle>
        <CardDescription>{job.note || "Working out what to download…"}</CardDescription>
        <CardAction>
          <JobStatusBadge status="working" />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {multi && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                Release {job.unit_index} of {job.units.length}
              </span>
              <span>one at a time</span>
            </div>
            <div className="flex gap-0.5">
              {job.units.map((u, i) => (
                <Tooltip key={i}>
                  <TooltipTrigger
                    render={
                      <div
                        className={cn(
                          "h-1.5 flex-1 rounded-full",
                          i + 1 < job.unit_index && "bg-success",
                          i + 1 === job.unit_index && "animate-pulse bg-info",
                          i + 1 > job.unit_index && "bg-muted",
                        )}
                      />
                    }
                  />
                  <TooltipContent>{"name" in u ? u.name : u.kind}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        )}

        {p && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{p.collection}</span>
              {p.source && <SourceBadge source={p.source} capped={p.source === "embed" && p.total === 100} />}
            </div>
            <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {PHASES.map((ph, i) => (
                <li
                  key={ph.id}
                  className={cn(
                    "flex items-center gap-1",
                    i < phaseIdx && "text-success",
                    i === phaseIdx && "font-medium text-foreground",
                    i > phaseIdx && "text-muted-foreground",
                  )}
                >
                  {i < phaseIdx ? <CheckIcon className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />}
                  {ph.label}
                </li>
              ))}
            </ol>
            <StackedProgress p={p} />
            {p.recent.length > 0 && (
              <ul className="space-y-1 font-mono text-xs">
                {p.recent.map((r, i) => (
                  <li key={i} className="flex items-start gap-2">
                    {r.ok ? <CheckIcon className="mt-0.5 size-3 text-success" /> : <XIcon className="mt-0.5 size-3 text-destructive" />}
                    <span className="min-w-0">
                      <span className={cn(!r.ok && "text-destructive")}>{r.label}</span>
                      {r.retry && (
                        <span className="block text-warning">
                          <AlertTriangleIcon className="mr-1 inline size-3" />
                          {r.retry}
                        </span>
                      )}
                      {r.error && <span className="block text-muted-foreground">{r.error}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** reused (already in library) · downloaded · failed, out of the collection's unique tracks. */
function StackedProgress({ p }: { p: UnitProgress }) {
  const pct = (n: number) => `${(n / Math.max(1, p.total)) * 100}%`
  const left = p.total - p.reused - p.done - p.failed
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        <div className="bg-muted-foreground/40" style={{ width: pct(p.reused) }} />
        <div className="bg-success transition-all" style={{ width: pct(p.done) }} />
        <div className="bg-destructive" style={{ width: pct(p.failed) }} />
      </div>
      <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground tabular-nums">
        <span>
          <span className="mr-1 inline-block size-2 rounded-full bg-muted-foreground/40" />
          {p.reused} already in library
        </span>
        <span>
          <span className="mr-1 inline-block size-2 rounded-full bg-success" />
          {p.done} downloaded
        </span>
        {p.failed > 0 && (
          <span>
            <span className="mr-1 inline-block size-2 rounded-full bg-destructive" />
            {p.failed} failed
          </span>
        )}
        <span className="ml-auto">{left} left</span>
      </div>
    </div>
  )
}

function FinishedRow({ job, onRequeue }: { job: Job; onRequeue: () => void }) {
  const target = job.units.find((u) => u.kind === "playlist" || u.kind === "album")
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <JobStatusBadge status={job.status} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{title(job)}</div>
        {job.note && (
          <div className={cn("truncate text-xs", job.status === "failed" ? "text-destructive" : "text-muted-foreground")}>{job.note}</div>
        )}
      </div>
      <span className="hidden text-xs text-muted-foreground sm:block">{when(job.queued_at)}</span>
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" size="sm" aria-label="What happened" render={<NavLink to={`/history?job=${job.id}`} />} />}
        >
          <HistoryIcon />
          <span className="hidden md:inline">Details</span>
        </TooltipTrigger>
        <TooltipContent>Song by song: downloaded, already in the library, failed</TooltipContent>
      </Tooltip>
      {target && "id" in target && job.units.length === 1 && (
        <Button variant="ghost" size="icon-sm" aria-label="Open" render={<NavLink to={`/playlists/${target.id}`} />}>
          <ExternalLinkIcon />
        </Button>
      )}
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Run again" onClick={onRequeue} />}>
          <RotateCcwIcon />
        </TooltipTrigger>
        <TooltipContent>Run again: re-reads the list and fetches only what's missing or failed</TooltipContent>
      </Tooltip>
    </div>
  )
}
