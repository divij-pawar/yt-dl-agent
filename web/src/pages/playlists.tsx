import { useMemo, useState } from "react"
import { Loader2Icon, MonitorPlayIcon, MoreHorizontalIcon, PlusIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react"
import { NavLink, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Cover } from "@/components/cover"
import { Page } from "@/components/page"
import { SourceBadge } from "@/components/status"
import { DataTable } from "@/components/track-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, requeueJob } from "@/lib/api"
import { spotifyUrl, when } from "@/lib/format"
import { useLoad } from "@/lib/hooks"
import { useQueue } from "@/lib/queue"
import type { CollectionSummary, PlexReport, PlexResult } from "@/lib/types"

export function PlaylistsPage() {
  const { data, loading } = useLoad(() => api.collections())
  const { enqueue } = useQueue()
  const navigate = useNavigate()
  const [tab, setTab] = useState<"playlist" | "release">("playlist")
  const [q, setQ] = useState("")
  const plex = usePlexSync()

  const all = data ?? []
  const playlists = all.filter((c) => c.kind === "playlist")
  const releases = all.filter((c) => c.kind !== "playlist")
  const rows = useMemo(
    () =>
      (tab === "playlist" ? playlists : releases)
        .filter((c) => `${c.name} ${c.owner_or_artist}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.failed - a.failed || b.updated.localeCompare(a.updated)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, tab, q],
  )

  const sync = async (cs: CollectionSummary[]) => {
    const runnable = cs.filter((c) => c.requeue)
    if (!runnable.length) return
    await enqueue(runnable.map((c) => requeueJob(c.requeue!, c.name)))
    toast.success(cs.length === 1 ? `Syncing ${cs[0].name}` : `Queued ${cs.length} syncs`, {
      description: "Only songs that aren't in the library yet are downloaded.",
      action: { label: "View queue", onClick: () => navigate("/") },
    })
  }

  return (
    <Page
      title="Playlists & albums"
      help="queue"
      description="Everything you've downloaded from Spotify. Run one again whenever it changes on Spotify: only new songs are fetched, and removed songs drop out of the .m3u8 (the MP3s stay)."
      actions={
        <>
          <Button variant="outline" disabled={!playlists.length} onClick={() => sync(playlists)}>
            <RefreshCwIcon />
            Sync all playlists
          </Button>
          <Button variant="outline" disabled={!playlists.length || plex.busy !== null} onClick={() => plex.run()}>
            {plex.busy === "all" ? <Loader2Icon className="animate-spin" /> : <MonitorPlayIcon />}
            Sync to Plex
          </Button>
          <Button render={<NavLink to="/" />}>
            <PlusIcon />
            Add
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="playlist">
              Playlists <span className="text-xs text-muted-foreground">{playlists.length}</span>
            </TabsTrigger>
            <TabsTrigger value="release">
              Albums & singles <span className="text-xs text-muted-foreground">{releases.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <InputGroup className="max-w-xs">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput placeholder="Filter by name" value={q} onChange={(e) => setQ(e.target.value)} />
        </InputGroup>
      </div>

      {plex.report && <PlexResults report={plex.report} onClose={() => plex.setReport(null)} />}

      {loading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <DataTable
          rows={rows}
          onRowClick={(c) => navigate(`/playlists/${c.spotify_id}`)}
          empty={tab === "playlist" ? "No playlists yet. Paste a playlist or profile link on the Request page." : "No albums yet."}
          columns={[
            {
              id: "name",
              header: "Name",
              cell: (c) => (
                <div className="flex min-w-0 items-center gap-3">
                  <Cover src={c.cover} className="size-9" />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {c.kind !== "playlist" && `${c.kind} · `}
                      {c.owner_or_artist}
                    </div>
                  </div>
                </div>
              ),
              className: "max-w-72",
            },
            {
              id: "songs",
              header: "Songs",
              cell: (c) => <SongsCell c={c} />,
              className: "w-48",
            },
            {
              id: "source",
              header: "Source",
              cell: (c) => <SourceBadge source={c.source} capped={c.source === "embed" && c.total === 100} />,
              className: "hidden lg:table-cell",
            },
            {
              id: "updated",
              header: "Last run",
              cell: (c) => <span className="text-xs text-muted-foreground">{when(c.updated)}</span>,
              className: "hidden w-32 md:table-cell",
            },
            {
              id: "actions",
              header: <span className="sr-only">Actions</span>,
              cell: (c) => (
                <RowActions
                  c={c}
                  onSync={() => sync([c])}
                  onPlex={c.kind === "playlist" ? () => plex.run([c]) : undefined}
                  plexBusy={plex.busy === c.spotify_id}
                />
              ),
              className: "w-24 text-right",
            },
          ]}
        />
      )}
    </Page>
  )
}

function SongsCell({ c }: { c: CollectionSummary }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-success" style={{ width: `${(c.done / Math.max(1, c.total)) * 100}%` }} />
      </div>
      <span className="text-xs tabular-nums">
        {c.done}/{c.total}
      </span>
      {c.failed > 0 && (
        <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
          {c.failed} failed
        </Badge>
      )}
    </div>
  )
}

function RowActions({
  c,
  onSync,
  onPlex,
  plexBusy,
}: {
  c: CollectionSummary
  onSync: () => void
  onPlex?: () => void
  plexBusy?: boolean
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  return (
    <div className="flex justify-end gap-1" onClick={stop}>
      <Button variant="ghost" size="icon-sm" aria-label={`Sync ${c.name}`} onClick={onSync}>
        <RefreshCwIcon />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More" />}>
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onSync}>{c.failed ? `Retry ${c.failed} failed` : "Sync now"}</DropdownMenuItem>
          {onPlex && (
            <DropdownMenuItem onClick={onPlex} disabled={plexBusy}>
              {plexBusy ? "Syncing to Plex…" : "Sync to Plex"}
            </DropdownMenuItem>
          )}
          {c.m3u8 && (
            <DropdownMenuItem onClick={() => navigator.clipboard.writeText(`songs/${c.m3u8}`).then(() => toast("Path copied"))}>
              Copy .m3u8 path
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => navigator.clipboard.writeText(`songs/.cache/${c.spotify_id}.links.txt`).then(() => toast("Path copied"))}
          >
            Copy search-links file path
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<a href={spotifyUrl(c.kind, c.spotify_id)} target="_blank" rel="noreferrer" />}>
            Open in Spotify
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// --- Plex ---------------------------------------------------------------------------------
// Plex never reads the .m3u8 files: POST /api/plex creates/updates the playlists through its API.

const PLEX_LABEL: Record<PlexResult["action"], string> = {
  created: "created",
  updated: "updated",
  up_to_date: "up to date",
  skipped: "skipped",
  would_create: "would create",
  would_update: "would update",
  error: "error",
}

function usePlexSync() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState<string | null>(null) // "all" or a playlist's spotify_id
  const [report, setReport] = useState<PlexReport | null>(null)

  const run = async (only?: CollectionSummary[]) => {
    setBusy(only?.length === 1 ? only[0].spotify_id : "all")
    try {
      const r = await api.plexSync({ ids: only?.map((c) => c.spotify_id) })
      setReport(r)
      const n = (a: PlexResult["action"]) => r.results.filter((x) => x.action === a).length
      const changed = n("created") + n("updated")
      const problems = n("skipped") + n("error")
      const parts = [n("created") && `${n("created")} created`, n("updated") && `${n("updated")} updated`,
        n("up_to_date") && `${n("up_to_date")} up to date`, problems && `${problems} need attention`].filter(Boolean)
      const title = only?.length === 1 ? `${only[0].name}: ${r.results[0]?.message ?? "synced"}` : `Plex: ${parts.join(", ")}`
      ;(problems ? toast.warning : toast.success)(title, {
        description: only?.length === 1 ? `In the '${r.library}' library` : changed ? `Library '${r.library}'` : "Nothing needed changing.",
      })
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e)
      toast.error("Couldn't sync to Plex", {
        description: msg,
        ...(/PLEX_TOKEN|isn't set up|token/i.test(msg) ? { action: { label: "Settings", onClick: () => navigate("/settings") } } : {}),
      })
    } finally {
      setBusy(null)
    }
  }
  return { busy, report, setReport, run }
}

function PlexResults({ report, onClose }: { report: PlexReport; onClose: () => void }) {
  const notable = report.results.filter((r) => r.action !== "up_to_date" || r.missing > 0)
  const upToDate = report.results.length - notable.length
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorPlayIcon className="size-4" />
          Plex sync{report.dry_run && " (preview)"}
        </CardTitle>
        <CardDescription>
          {report.results.length} playlist{report.results.length === 1 ? "" : "s"} in the '{report.library}' library
          {upToDate > 0 && notable.length > 0 && ` · ${upToDate} already up to date`}
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <XIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {notable.length === 0 ? (
          <p className="text-sm text-muted-foreground">Everything was already up to date in Plex.</p>
        ) : (
          <ul className="divide-y text-sm">
            {notable.map((r) => (
              <li key={r.spotify_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                <Badge
                  variant={r.action === "error" || r.action === "skipped" ? "destructive" : r.action === "up_to_date" ? "outline" : "secondary"}
                >
                  {PLEX_LABEL[r.action]}
                </Badge>
                <span className="w-full text-xs text-muted-foreground sm:w-auto">
                  {r.action === "skipped" || r.action === "error" ? r.message : `${r.songs} songs`}
                  {r.added > 0 && r.action !== "created" && r.action !== "would_create" && ` · +${r.added}`}
                  {r.removed > 0 && ` · −${r.removed}`}
                  {r.missing > 0 && ` · ${r.missing} not in Plex yet (added on the next sync)`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
