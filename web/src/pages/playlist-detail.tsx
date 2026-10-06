import { useMemo, useState } from "react"
import { ExternalLinkIcon, FileMusicIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { Page } from "@/components/page"
import { SourceBadge, TrackStatusBadge } from "@/components/status"
import { DataTable } from "@/components/track-table"
import { TrackSheet } from "@/components/track-sheet"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, requeueJob } from "@/lib/api"
import { duration, plural, spotifyUrl } from "@/lib/format"
import { useLoad } from "@/lib/hooks"
import { useQueue } from "@/lib/queue"
import type { Track } from "@/lib/types"

export function PlaylistDetailPage() {
  const { id = "" } = useParams()
  const { data: c, loading } = useLoad(() => api.collection(id), [id])
  const { enqueue } = useQueue()
  const navigate = useNavigate()
  const [show, setShow] = useState<"all" | "failed">("all")
  const [open, setOpen] = useState<Track | null>(null)

  const stats = useMemo(() => {
    const ts = c?.tracks ?? []
    const secs = ts.reduce((s, t) => s + (t.duration_s ?? 0), 0)
    return {
      done: ts.filter((t) => t.status === "done").length,
      failed: ts.filter((t) => t.status === "failed"),
      singles: ts.filter((t) => t.status === "done" && !t.album).length,
      hours: `${Math.floor(secs / 3600)} h ${Math.round((secs % 3600) / 60)} min`,
    }
  }, [c])

  if (loading) return <Page title={<Skeleton className="h-8 w-64" />}><Skeleton className="h-96 rounded-xl" /></Page>
  if (!c)
    return (
      <Page title="Not found">
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No cached playlist or album with this ID</EmptyTitle>
            <EmptyDescription>It may not have been downloaded yet. Paste its Spotify link on the Request page.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Page>
    )

  const sync = async () => {
    if (!c.requeue) return
    await enqueue([requeueJob(c.requeue, c.name)])
    toast.success(`Syncing ${c.name}`, { action: { label: "View queue", onClick: () => navigate("/") } })
  }
  const capped = c.source === "embed" && c.tracks.length === 100
  const rows = show === "failed" ? stats.failed : c.tracks

  return (
    <Page
      crumb={c.name}
      title={c.name}
      help="queue"
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="capitalize">{c.kind}</span> by {c.owner_or_artist} · {plural(c.tracks.length, "track")} · {stats.hours}
          <SourceBadge source={c.source} capped={capped} />
        </span>
      }
      actions={
        <>
          <Button variant="outline" render={<a href={spotifyUrl(c.kind, c.spotify_id)} target="_blank" rel="noreferrer" />}>
            Spotify <ExternalLinkIcon />
          </Button>
          {c.kind === "playlist" && (
            <Button
              variant="outline"
              onClick={() => navigator.clipboard.writeText(`songs/${c.name}.m3u8`).then(() => toast("Path copied"))}
            >
              <FileMusicIcon />
              Copy .m3u8 path
            </Button>
          )}
          <Button onClick={sync}>
            <RefreshCwIcon />
            {stats.failed.length ? `Sync & retry ${stats.failed.length} failed` : "Sync"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="In library" value={`${stats.done}/${c.tracks.length}`} />
        <Stat label="Failed" value={stats.failed.length} tone={stats.failed.length ? "danger" : undefined} />
        <Stat label="No album (in Singles/)" value={stats.singles} />
        <Stat label="Playlist file" value={c.kind === "playlist" ? `${c.name}.m3u8` : "albums don't get one"} small />
      </div>

      {capped && (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>Only the first 100 tracks</AlertTitle>
          <AlertDescription>
            Spotify's embed page stops at 100. The rest need working Spotify API credentials (the app owner needs Premium). See
            Settings.
          </AlertDescription>
        </Alert>
      )}

      {stats.failed.length > 0 && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{plural(stats.failed.length, "song")} couldn't be downloaded</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-1">
              {stats.failed.slice(0, 4).map((t) => (
                <li key={t.spotify_track_id}>
                  <span className="font-medium">
                    {t.artist} - {t.title}
                  </span>
                  : {t.error?.split(" Search: ")[0]}
                </li>
              ))}
            </ul>
            <span className="mt-2 block">Sync again to retry just these. Each failed row links to its YouTube Music search.</span>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <ToggleGroup variant="outline" size="sm" value={[show]} onValueChange={(v) => v.length && setShow(v[0] as typeof show)}>
          <ToggleGroupItem value="all">All {c.tracks.length}</ToggleGroupItem>
          <ToggleGroupItem value="failed" disabled={!stats.failed.length}>
            Failed {stats.failed.length}
          </ToggleGroupItem>
        </ToggleGroup>
        <span className="text-xs text-muted-foreground">Original playlist order</span>
      </div>

      <DataTable
        rows={rows}
        pageSize={100}
        onRowClick={setOpen}
        rowClassName={(t) => (t.status === "failed" ? "bg-destructive/5" : undefined)}
        columns={[
          {
            id: "n",
            header: "#",
            cell: (t, i) => (
              <span className="text-xs text-muted-foreground tabular-nums">{c.kind === "album" ? t.track_no : i + 1}</span>
            ),
            className: "w-10",
          },
          {
            id: "title",
            header: "Title",
            cell: (t) => (
              <div className="min-w-0">
                <div className="truncate font-medium">{t.title}</div>
                <div className="truncate text-xs text-muted-foreground">{t.artist}</div>
              </div>
            ),
            className: "max-w-72",
          },
          {
            id: "album",
            header: "Album",
            cell: (t) => <span className="truncate">{t.album ?? <span className="text-muted-foreground">Singles</span>}</span>,
            className: "hidden max-w-56 truncate md:table-cell",
          },
          {
            id: "status",
            header: "Status",
            cell: (t) =>
              t.status === "failed" && t.search_url ? (
                <a href={t.search_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  <TrackStatusBadge status={t.status} />
                </a>
              ) : (
                <TrackStatusBadge status={t.status} />
              ),
            className: "w-28",
          },
          {
            id: "len",
            header: <span className="block text-right">Length</span>,
            cell: (t) => <span className="block text-right tabular-nums text-muted-foreground">{duration(t.duration_s)}</span>,
            className: "w-20",
          },
        ]}
      />

      <TrackSheet
        track={open}
        retry={[{ name: c.name, requeue: c.requeue }]}
        open={!!open}
        onOpenChange={(o) => !o && setOpen(null)}
      />
    </Page>
  )
}

function Stat({ label, value, tone, small }: { label: string; value: React.ReactNode; tone?: "danger"; small?: boolean }) {
  return (
    <Card size="sm">
      <CardContent className="space-y-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={small ? "truncate text-sm font-medium" : `text-2xl font-semibold tabular-nums ${tone === "danger" ? "text-destructive" : ""}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  )
}
