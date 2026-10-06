import { useMemo, useState } from "react"
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  EyeIcon,
  FileMusicIcon,
  ImageDownIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  SearchCheckIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { NavLink, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { Cover } from "@/components/cover"
import { Page } from "@/components/page"
import { SourceBadge, TrackStatusBadge } from "@/components/status"
import { DataTable } from "@/components/track-table"
import { TrackSheet } from "@/components/track-sheet"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, requeueJob } from "@/lib/api"
import { duration, plural, spotifyUrl } from "@/lib/format"
import { useLoad } from "@/lib/hooks"
import { useQueue } from "@/lib/queue"
import type { PreviewTrack, Track } from "@/lib/types"

export function PlaylistDetailPage() {
  const { id = "" } = useParams()
  const { data: c, loading, setData } = useLoad(() => api.collection(id), [id])
  const { enqueue } = useQueue()
  const navigate = useNavigate()
  const [show, setShow] = useState<"all" | "failed">("all")
  const [open, setOpen] = useState<Track | null>(null)
  const [check, setCheck] = useState<MissingCheck | null>(null)
  const [busy, setBusy] = useState<"check" | "cover" | null>(null)

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
  const onSpotify = /^[A-Za-z0-9]{22}$/.test(c.spotify_id) && (c.kind === "playlist" || c.kind === "album")

  const runCheck = async () => {
    setBusy("check")
    try {
      setCheck(missingCheck(c.tracks, await api.preview(c.kind, c.spotify_id)))
    } catch (e) {
      toast.error("Couldn't check Spotify", { description: String(e instanceof Error ? e.message : e) })
    } finally {
      setBusy(null)
    }
  }
  const refreshCover = async () => {
    setBusy("cover")
    try {
      const r = await api.refreshCover(c.spotify_id)
      setData({ ...c, cover: r.cover })
      toast.success("Cover downloaded again", { description: r.plex ? `Plex: ${r.plex}` : undefined })
    } catch (e) {
      toast.error("Couldn't download the cover", { description: String(e instanceof Error ? e.message : e) })
    } finally {
      setBusy(null)
    }
  }
  const capped = c.source === "embed" && c.tracks.length === 100
  const rows = show === "failed" ? stats.failed : c.tracks

  return (
    <Page
      crumb={c.name}
      title={
        <span className="flex items-center gap-3">
          <Cover src={c.cover} alt={`${c.name} cover`} className="size-14 shadow-sm" />
          <span className="min-w-0">{c.name}</span>
        </span>
      }
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
          {/^[A-Za-z0-9]{22}$/.test(c.spotify_id) && (
            <Button variant="outline" render={<NavLink to={`/preview/${c.kind}/${c.spotify_id}`} />}>
              <EyeIcon />
              What's new on Spotify
            </Button>
          )}
          {onSpotify && (
            <Button variant="outline" disabled={busy !== null} onClick={runCheck}>
              {busy === "check" ? <Loader2Icon className="animate-spin" /> : <SearchCheckIcon />}
              Check for missing songs
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More actions" />}>
              {busy === "cover" ? <Loader2Icon className="animate-spin" /> : <MoreHorizontalIcon />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onSpotify && (
                <DropdownMenuItem onClick={refreshCover} disabled={busy !== null}>
                  <ImageDownIcon />
                  {c.cover ? "Re-download cover" : "Download cover"}
                </DropdownMenuItem>
              )}
              {c.kind === "playlist" && (
                <DropdownMenuItem onClick={() => navigator.clipboard.writeText(`songs/${c.name}.m3u8`).then(() => toast("Path copied"))}>
                  <FileMusicIcon />
                  Copy .m3u8 path
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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

      {check && <MissingCard check={check} kind={c.kind} onDownload={sync} onClose={() => setCheck(null)} />}

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

// --- "Check for missing songs": Spotify's list right now (embed page, no credits) vs. the library --------

interface MissingCheck {
  total: number // songs on Spotify right now
  capped: boolean
  newOnSpotify: PreviewTrack[] // added on Spotify since the last run
  failed: PreviewTrack[] // tried before, couldn't be downloaded
  deleted: PreviewTrack[] // downloaded before, but the file is gone
  other: PreviewTrack[] // known but never downloaded (e.g. a links-only run)
  removedOnSpotify: Track[] // in the last run, not on Spotify any more
}

const songKey = (t: { spotify_track_id: string | null; artist: string; title: string }) =>
  t.spotify_track_id ?? `${t.artist}|${t.title}`.toLowerCase()

function missingCheck(cached: Track[], p: { tracks: PreviewTrack[]; capped: boolean }): MissingCheck {
  const before = new Map(cached.map((t) => [songKey(t), t]))
  const now = new Set(p.tracks.map(songKey))
  const missing = p.tracks.filter((t) => !t.in_library)
  const was = (t: PreviewTrack) => before.get(songKey(t))
  return {
    total: p.tracks.length,
    capped: p.capped,
    newOnSpotify: missing.filter((t) => !was(t)),
    failed: missing.filter((t) => was(t) && (t.failed_before || was(t)!.status === "failed")),
    deleted: missing.filter((t) => was(t)?.status === "done"),
    other: missing.filter((t) => was(t)?.status === "pending" && !t.failed_before),
    removedOnSpotify: cached.filter((t) => !now.has(songKey(t))),
  }
}

function MissingCard({
  check,
  kind,
  onDownload,
  onClose,
}: {
  check: MissingCheck
  kind: string
  onDownload: () => void
  onClose: () => void
}) {
  const groups: [string, string, PreviewTrack[]][] = [
    ["New on Spotify", "Added since the last run.", check.newOnSpotify],
    ["Failed before", "Couldn't be downloaded last time.", check.failed],
    ["File missing", "Downloaded before, but the file is gone from the library.", check.deleted],
    ["Never downloaded", "Known from an earlier run that didn't download.", check.other],
  ]
  const missing = groups.reduce((n, [, , ts]) => n + ts.length, 0)
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {missing ? <SearchCheckIcon className="size-4" /> : <CheckCircle2Icon className="size-4 text-success" />}
          {missing ? `${plural(missing, "song")} missing from your library` : "Nothing missing"}
        </CardTitle>
        <CardDescription>
          Checked against Spotify just now: {plural(check.total, "song")} on the {kind}
          {check.capped && " (the first 100: Spotify's embed page stops there)"}.
          {!missing && " Every one of them is in your library."}
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <XIcon />
          </Button>
        </CardAction>
      </CardHeader>
      {(missing > 0 || check.removedOnSpotify.length > 0) && (
        <CardContent className="space-y-4">
          {groups
            .filter(([, , ts]) => ts.length)
            .map(([name, help, ts]) => (
              <div key={name} className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {name}
                  <Badge variant="secondary">{ts.length}</Badge>
                  <span className="text-xs font-normal text-muted-foreground">{help}</span>
                </div>
                <ul className="grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2">
                  {ts.slice(0, 12).map((t) => (
                    <li key={songKey(t)} className="truncate">
                      {t.artist} - {t.title}
                    </li>
                  ))}
                  {ts.length > 12 && <li className="text-muted-foreground">and {ts.length - 12} more</li>}
                </ul>
              </div>
            ))}
          {check.removedOnSpotify.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {plural(check.removedOnSpotify.length, "song")} from the last run {check.removedOnSpotify.length === 1 ? "is" : "are"} no
              longer on Spotify; the next sync leaves {check.removedOnSpotify.length === 1 ? "it" : "them"} out of the playlist file
              (the MP3s stay).
            </p>
          )}
        </CardContent>
      )}
      {missing > 0 && (
        <CardFooter className="justify-end border-t">
          <Button onClick={onDownload}>
            <RefreshCwIcon />
            Download {plural(missing, "missing song")}
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
