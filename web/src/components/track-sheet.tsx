import { CopyIcon, DiscIcon, ExternalLinkIcon, InfoIcon } from "lucide-react"
import { NavLink } from "react-router-dom"
import { toast } from "sonner"
import { TrackStatusBadge } from "@/components/status"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { duration, spotifyUrl, youtubeUrl } from "@/lib/format"
import type { LibrarySong, Track } from "@/lib/types"

export function TrackSheet({
  track,
  song,
  open,
  onOpenChange,
}: {
  track: Track | null
  song?: LibrarySong | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const t = track
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {t && (
          <>
            <SheetHeader className="border-b">
              <div className="flex gap-4">
                <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                  {t.cover_url ? <img src={t.cover_url} alt="" className="size-full object-cover" /> : <DiscIcon className="size-8 text-muted-foreground" />}
                </div>
                <div className="min-w-0 space-y-1">
                  <SheetTitle className="text-lg leading-tight">{t.title}</SheetTitle>
                  <SheetDescription>{t.artist}</SheetDescription>
                  <div className="flex flex-wrap gap-1 pt-1">
                    <TrackStatusBadge status={t.status} />
                    {t.explicit && <Badge variant="outline">E</Badge>}
                    {song && <Badge variant="outline">{song.format}</Badge>}
                    {song?.imported && <Badge variant="secondary">imported</Badge>}
                  </div>
                </div>
              </div>
            </SheetHeader>

            <div className="space-y-5 p-4">
              {t.status === "failed" && t.error && (
                <Alert variant="destructive">
                  <InfoIcon />
                  <AlertDescription>
                    {t.error}
                    <span className="mt-1 block text-xs">Run the playlist or album again to retry just the failed songs.</span>
                  </AlertDescription>
                </Alert>
              )}

              <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Album</dt>
                <dd>{t.album ?? <span className="text-muted-foreground">Singles (unknown)</span>}</dd>
                <dt className="text-muted-foreground">Album artist</dt>
                <dd>{t.album_artist ?? <span className="text-muted-foreground">{t.artist.split(",")[0]} (primary artist)</span>}</dd>
                <dt className="text-muted-foreground">Track no.</dt>
                <dd>{t.track_no ?? "–"}</dd>
                <dt className="text-muted-foreground">Year</dt>
                <dd>{t.year ?? "–"}</dd>
                <dt className="text-muted-foreground">Length</dt>
                <dd className="tabular-nums">{duration(t.duration_s)}</dd>
              </dl>

              {t.file_path && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">File (in songs/)</div>
                  <div className="flex items-center gap-1 rounded-md bg-muted px-2 py-1.5">
                    <code className="min-w-0 flex-1 truncate text-xs">{t.file_path}</code>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Copy path"
                      onClick={() => navigator.clipboard.writeText(`songs/${t.file_path}`).then(() => toast("Path copied"))}
                    >
                      <CopyIcon />
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {t.spotify_track_id && (
                  <Button variant="outline" size="sm" render={<a href={spotifyUrl("track", t.spotify_track_id)} target="_blank" rel="noreferrer" />}>
                    Spotify <ExternalLinkIcon />
                  </Button>
                )}
                {t.video_id && (
                  <Button variant="outline" size="sm" render={<a href={youtubeUrl(t.video_id)} target="_blank" rel="noreferrer" />}>
                    Matched video <ExternalLinkIcon />
                  </Button>
                )}
                {t.search_url && (
                  <Button variant="outline" size="sm" render={<a href={t.search_url} target="_blank" rel="noreferrer" />}>
                    YT Music search <ExternalLinkIcon />
                  </Button>
                )}
              </div>

              {song && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      Used by {song.in_collections.length || "no"} playlist{song.in_collections.length === 1 ? "" : "s"} / album
                      {song.in_collections.length === 1 ? "" : "s"}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {song.in_collections.map((c) => (
                        <Badge key={c.spotify_id} variant="secondary" render={<NavLink to={`/playlists/${c.spotify_id}`} />}>
                          {c.name}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Shared songs are stored once; every playlist's .m3u8 points at this file.
                    </p>
                  </div>
                </>
              )}

              <p className="text-xs text-muted-foreground">
                Wrong album or folder? Run <NavLink to="/fix" className="underline underline-offset-2">Fix library</NavLink>: it re-reads
                albums from Spotify and moves files to match.
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
