import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Clock3Icon,
  DiscIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  XCircleIcon,
} from "lucide-react"
import { NavLink, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { SiteHeader } from "@/components/site-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, linkJob, requeueJob, tracksJob } from "@/lib/api"
import { duration, plural, spotifyUrl, when } from "@/lib/format"
import { useLoad } from "@/lib/hooks"
import { useQueue } from "@/lib/queue"
import type { Preview, PreviewTrack } from "@/lib/types"
import { cn } from "@/lib/utils"

const KIND_LABEL: Record<Preview["kind"], string> = { playlist: "Playlist", album: "Album", track: "Song", artist: "Artist · top songs" }

function totalLength(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return h ? `${h} hr ${m} min` : `${m} min`
}

/** A Spotify playlist/album/song/artist as Spotify shows it, with what's already in the library. */
export function PreviewPage() {
  const { kind = "", id = "" } = useParams()
  const { data: p, error, loading } = useLoad(() => api.preview(kind, id), [kind, id])
  const { enqueue } = useQueue()
  const navigate = useNavigate()
  const [onlyNew, setOnlyNew] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const player = usePreviewPlayer()

  useEffect(() => setSelected(new Set()), [kind, id])
  const tracks = p?.tracks ?? []
  const fresh = tracks.filter((t) => !t.in_library)
  const shown = onlyNew ? fresh : tracks
  const selectable = shown.filter((t) => t.spotify_track_id)
  const title = p?.kind === "artist" ? (p.owner ?? p.name) : p?.name

  const queue = async (what: "all" | "selected" | "discography") => {
    if (!p) return
    setBusy(true)
    try {
      if (what === "selected") {
        const picked = tracks.filter((t) => t.spotify_track_id && selected.has(t.spotify_track_id))
        await enqueue([tracksJob(picked.map((t) => t.spotify_track_id!), title ?? p.name, picked.map((t) => t.title))])
      } else if (what === "discography") {
        await enqueue([linkJob("artist", p.spotify_id, `${title} discography`)])
      } else if (p.requeue) {
        await enqueue([requeueJob(p.requeue, title ?? p.name)])
      }
      toast.success("Queued", {
        description:
          what === "selected"
            ? `${plural(selected.size, "song")} from ${title}`
            : what === "discography"
              ? `Everything by ${title}`
              : fresh.length
                ? `${plural(fresh.length, "new song")} will download; ${tracks.length - fresh.length} already in your library are skipped.`
                : "Everything is already in your library; this just refreshes the playlist file.",
        action: { label: "View queue", onClick: () => navigate("/") },
      })
      setSelected(new Set())
    } finally {
      setBusy(false)
    }
  }

  if (loading)
    return (
      <>
        <SiteHeader crumb="Preview" />
        <div className="flex items-end gap-6 bg-muted/40 p-6 pt-16">
          <Skeleton className="size-48 shrink-0 rounded-md" />
          <div className="w-full space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-14 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
      </>
    )
  if (error || !p)
    return (
      <>
        <SiteHeader crumb="Preview" />
        <div className="p-6">
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>Couldn't load this from Spotify</EmptyTitle>
              <EmptyDescription>{error?.message ?? "Check the link and try again."}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </>
    )

  const bg = p.colors.background ?? "rgb(64, 64, 64)"
  const tinted = p.colors.tinted ?? bg

  return (
    <>
      <SiteHeader crumb={title} />
      <div className="relative flex-1">
        {/* Header in the cover's own colours, the way Spotify does it */}
        <header className="text-white" style={{ background: `linear-gradient(180deg, ${bg} 0%, ${tinted} 100%)` }}>
          <div className="flex flex-col gap-6 px-4 pt-10 pb-6 sm:flex-row sm:items-end md:px-8 md:pt-16">
            <div
              className={cn(
                "flex size-40 shrink-0 items-center justify-center overflow-hidden bg-black/20 shadow-[0_8px_40px_rgba(0,0,0,0.5)] md:size-56",
                p.kind === "artist" ? "rounded-full" : "rounded-md",
              )}
            >
              {p.cover_url ? <img src={p.cover_url} alt="" className="size-full object-cover" /> : <DiscIcon className="size-16 opacity-50" />}
            </div>
            <div className="min-w-0 space-y-2">
              <div className="text-sm font-medium">{KIND_LABEL[p.kind]}</div>
              <h1 className="line-clamp-2 text-4xl font-black tracking-tight break-words md:text-6xl lg:text-7xl">{title}</h1>
              <div className="flex flex-wrap items-center gap-x-1.5 text-sm" style={{ color: p.colors.subdued ?? undefined }}>
                {[
                  p.kind !== "artist" && p.owner && (
                    <span key="o" className="font-semibold text-white">
                      {p.owner}
                    </span>
                  ),
                  p.year && <span key="y">{p.year}</span>,
                  <span key="n">
                    {plural(tracks.length, "song")}
                    {p.duration_s > 0 && `, ${totalLength(p.duration_s)}`}
                  </span>,
                ]
                  .filter(Boolean)
                  .flatMap((part, i) => (i ? [<span key={`d${i}`}>•</span>, part] : [part]))}
              </div>
            </div>
          </div>
        </header>

        <div style={{ background: `linear-gradient(180deg, color-mix(in oklab, ${tinted} 45%, transparent) 0, transparent 240px)` }}>
          {/* Actions */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-5 md:px-8">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    aria-label="Download"
                    disabled={busy || !p.requeue}
                    onClick={() => queue("all")}
                    className="flex size-14 items-center justify-center rounded-full bg-[#1ed760] text-black shadow-lg transition hover:scale-105 hover:bg-[#3be477] active:scale-95 disabled:opacity-50"
                  />
                }
              >
                {busy ? <Loader2Icon className="size-6 animate-spin" /> : <DownloadIcon className="size-6" />}
              </TooltipTrigger>
              <TooltipContent>
                {p.kind === "artist" ? "Download these top songs" : "Download"} · only songs not in your library
              </TooltipContent>
            </Tooltip>
            <div className="text-sm">
              {fresh.length ? (
                <>
                  <span className="font-semibold">{plural(fresh.length, "song")} to download</span>
                  <span className="text-muted-foreground"> · {tracks.length - fresh.length} already in your library</span>
                </>
              ) : (
                <span className="font-semibold">Everything is already in your library</span>
              )}
            </div>
            {p.kind === "artist" && (
              <Button variant="outline" className="rounded-full" disabled={busy} onClick={() => queue("discography")}>
                Download whole discography
              </Button>
            )}
            {selected.size > 0 && (
              <Button variant="secondary" className="rounded-full" disabled={busy} onClick={() => queue("selected")}>
                <DownloadIcon />
                Download {plural(selected.size, "selected song")}
              </Button>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch id="only-new" checked={onlyNew} onCheckedChange={setOnlyNew} />
                <Label htmlFor="only-new" className="text-sm font-normal text-muted-foreground">
                  Only songs not in my library
                </Label>
              </div>
              <Button variant="ghost" size="icon" aria-label="Open in Spotify" render={<a href={spotifyUrl(p.kind, p.spotify_id)} target="_blank" rel="noreferrer" />}>
                <ExternalLinkIcon />
              </Button>
            </div>
          </div>

          {(p.capped || p.downloaded_before) && (
            <div className="flex flex-wrap gap-2 px-4 pb-4 md:px-8">
              {p.capped && (
                <Badge variant="outline" className="h-6 gap-1 border-warning/30 text-warning">
                  <AlertTriangleIcon />
                  Only the first 100 songs are visible without the Spotify API
                </Badge>
              )}
              {p.downloaded_before && (
                <Badge variant="secondary" className="h-6" render={<NavLink to={`/playlists/${p.spotify_id}`} />}>
                  Downloaded before · last run {when(p.downloaded_before)} · open in library
                </Badge>
              )}
            </div>
          )}

          {/* Track list */}
          <div className="px-2 pb-10 md:px-6">
            <div className="grid grid-cols-[2rem_2.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 border-b px-2 pb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase md:grid-cols-[2rem_2.5rem_minmax(0,4fr)_minmax(0,3fr)_8rem_3.5rem]">
              <Checkbox
                aria-label="Select all"
                checked={selectable.length > 0 && selectable.every((t) => selected.has(t.spotify_track_id!))}
                onCheckedChange={(c) => setSelected(c ? new Set(selectable.map((t) => t.spotify_track_id!)) : new Set())}
              />
              <span className="text-right">#</span>
              <span>Title</span>
              <span className="hidden md:block">Album</span>
              <span className="hidden md:block">In library</span>
              <Clock3Icon className="ml-auto size-4" />
            </div>
            {shown.length === 0 && (
              <p className="px-2 py-10 text-center text-sm text-muted-foreground">Nothing new: every song is already in your library.</p>
            )}
            <ol className="pt-2">
              {shown.map((t) => (
                <TrackRow
                  key={`${t.spotify_track_id}-${t.title}`}
                  n={tracks.indexOf(t) + 1}
                  t={t}
                  selected={!!t.spotify_track_id && selected.has(t.spotify_track_id)}
                  onSelect={(on) =>
                    setSelected((s) => {
                      const next = new Set(s)
                      if (on) next.add(t.spotify_track_id!)
                      else next.delete(t.spotify_track_id!)
                      return next
                    })
                  }
                  playing={player.playing === t.preview_url && !!t.preview_url}
                  onPlay={() => player.toggle(t.preview_url)}
                />
              ))}
            </ol>
          </div>
        </div>
      </div>
    </>
  )
}

function TrackRow({
  n,
  t,
  selected,
  onSelect,
  playing,
  onPlay,
}: {
  n: number
  t: PreviewTrack
  selected: boolean
  onSelect: (on: boolean) => void
  playing: boolean
  onPlay: () => void
}) {
  return (
    <li
      className={cn(
        "group grid grid-cols-[2rem_2.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/60 md:grid-cols-[2rem_2.5rem_minmax(0,4fr)_minmax(0,3fr)_8rem_3.5rem]",
        selected && "bg-muted",
      )}
    >
      <Checkbox aria-label={`Select ${t.title}`} disabled={!t.spotify_track_id} checked={selected} onCheckedChange={(c) => onSelect(!!c)} />
      <div className="flex justify-end text-sm text-muted-foreground tabular-nums">
        {t.preview_url ? (
          <button aria-label={playing ? "Pause preview" : "Play 30-second preview"} onClick={onPlay} className="flex size-6 items-center justify-center">
            <span className={cn("group-hover:hidden", playing && "hidden")}>{n}</span>
            {playing ? (
              <PauseIcon className="size-4 fill-current text-[#1ed760]" />
            ) : (
              <PlayIcon className="hidden size-4 fill-current text-foreground group-hover:block" />
            )}
          </button>
        ) : (
          <span>{n}</span>
        )}
      </div>
      <div className="min-w-0">
        <div className={cn("truncate font-medium", playing && "text-[#1ed760]")}>{t.title}</div>
        <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          {t.explicit && (
            <span className="flex h-4 shrink-0 items-center rounded-[3px] bg-muted-foreground/50 px-1 text-[9px] font-bold text-background">
              E
            </span>
          )}
          <span className="truncate">{t.artist}</span>
        </div>
      </div>
      <div className="hidden truncate text-sm text-muted-foreground md:block">{t.album ?? "–"}</div>
      <div className="hidden text-sm md:block">
        {t.in_library ? (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex items-center gap-1.5 text-[#1db954] dark:text-[#1ed760]" />}>
              <CheckCircle2Icon className="size-4" />
              In library
            </TooltipTrigger>
            <TooltipContent className="max-w-80">songs/{t.in_library}</TooltipContent>
          </Tooltip>
        ) : t.failed_before ? (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex items-center gap-1.5 text-destructive" />}>
              <XCircleIcon className="size-4" />
              Failed before
            </TooltipTrigger>
            <TooltipContent className="max-w-80">{t.error ?? "It couldn't be downloaded last time; it's retried."}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <DownloadIcon className="size-4" />
            New
          </span>
        )}
      </div>
      <div className="flex items-center justify-end gap-1.5 text-sm text-muted-foreground tabular-nums">
        {t.in_library && <CheckCircle2Icon className="size-3.5 text-[#1db954] md:hidden dark:text-[#1ed760]" />}
        {duration(t.duration_s)}
      </div>
    </li>
  )
}

/** One <audio> for the whole page: Spotify's 30-second previews. */
function usePreviewPlayer() {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  useEffect(() => {
    const a = new Audio()
    a.volume = 0.8
    a.onended = () => setPlaying(null)
    audio.current = a
    return () => {
      a.pause()
      audio.current = null
    }
  }, [])
  return useMemo(
    () => ({
      playing,
      toggle(url: string | null) {
        const a = audio.current
        if (!a || !url) return
        if (playing === url) {
          a.pause()
          setPlaying(null)
          return
        }
        a.src = url
        a.play().then(
          () => setPlaying(url),
          () => setPlaying(null),
        )
      },
    }),
    [playing],
  )
}
