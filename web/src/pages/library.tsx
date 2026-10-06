import { useMemo, useState } from "react"
import { RotateCcwIcon, SearchIcon } from "lucide-react"
import { useSearchParams } from "react-router-dom"
import { Page } from "@/components/page"
import { DataTable } from "@/components/track-table"
import { TrackSheet } from "@/components/track-sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/lib/api"
import { duration, splitPath, when } from "@/lib/format"
import { useLoad } from "@/lib/hooks"
import { useRequeue } from "@/lib/requeue"
import type { FailedSong, LibrarySong } from "@/lib/types"

type Facet = "all" | "singles" | "orphan" | "imported" | "lossless" | "failed"

const FACETS: { id: Exclude<Facet, "failed">; label: string; test: (s: LibrarySong) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "singles", label: "In Singles/", test: (s) => splitPath(s.path).album === "Singles" },
  { id: "orphan", label: "In no playlist", test: (s) => s.in_collections.every((c) => c.kind !== "playlist") },
  { id: "imported", label: "Imported", test: (s) => s.imported },
  { id: "lossless", label: "Lossless", test: (s) => s.format === ".flac" || s.format === ".wav" },
]

const matches = (q: string, hay: string) => q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.toLowerCase().includes(w))

export function LibraryPage() {
  const { data, loading } = useLoad(() => api.library())
  const failed = useLoad(() => api.failed())
  const { retry } = useRequeue()
  const [params, setParams] = useSearchParams()
  const facet = (params.get("show") as Facet) || "all"
  const setFacet = (f: Facet) => setParams(f === "all" ? {} : { show: f }, { replace: true })
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<LibrarySong | null>(null)
  const [openFailed, setOpenFailed] = useState<FailedSong | null>(null)

  const counts = useMemo(
    () => Object.fromEntries(FACETS.map((f) => [f.id, (data ?? []).filter(f.test).length])) as Record<Facet, number>,
    [data],
  )
  const rows = useMemo(() => {
    const test = FACETS.find((f) => f.id === facet)?.test ?? (() => true)
    return (data ?? []).filter((s) => test(s) && matches(q, `${s.track.title} ${s.track.artist} ${s.track.album ?? ""} ${s.path}`))
  }, [data, q, facet])
  const failedRows = useMemo(
    () => (failed.data ?? []).filter((f) => matches(q, `${f.track.title} ${f.track.artist} ${f.in_collections.map((c) => c.name).join(" ")}`)),
    [failed.data, q],
  )
  const artists = useMemo(() => new Set((data ?? []).map((s) => splitPath(s.path).artist)).size, [data])
  const nFailed = failed.data?.length ?? 0
  const failedTargets = (failed.data ?? []).flatMap((f) => f.in_collections)

  return (
    <Page
      title="Songs"
      help="files"
      description={
        data ? (
          <>
            {data.length} songs by {artists} artists, filed as <code className="text-xs">songs/Artist/Album/NN - Title</code>. Each
            song is stored once, however many playlists use it.
          </>
        ) : (
          "Loading the library index…"
        )
      }
      actions={
        facet === "failed" &&
        nFailed > 0 && (
          <Button onClick={() => retry(failedTargets, "Retrying failed songs")}>
            <RotateCcwIcon />
            Retry all {nFailed} failed
          </Button>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="max-w-sm">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput placeholder="Search title, artist, album or path" value={q} onChange={(e) => setQ(e.target.value)} />
        </InputGroup>
        <ToggleGroup variant="outline" size="sm" value={[facet]} onValueChange={(v) => v.length && setFacet(v[0] as Facet)} className="flex-wrap">
          {FACETS.map((f) => (
            <ToggleGroupItem key={f.id} value={f.id}>
              {f.label}
              <span className="text-xs text-muted-foreground tabular-nums">{counts[f.id] ?? 0}</span>
            </ToggleGroupItem>
          ))}
          <ToggleGroupItem value="failed" className={nFailed ? "text-destructive" : undefined}>
            Failed
            <span className="text-xs tabular-nums opacity-70">{nFailed}</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {facet === "failed" ? (
        failed.loading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : (
          <>
            {nFailed > 0 && (
              <p className="-mt-2 text-sm text-muted-foreground">
                Songs that couldn't be downloaded and aren't in the library yet. Open one to see why and try again; running a
                playlist again only fetches what's missing.
              </p>
            )}
            <DataTable
              rows={failedRows}
              onRowClick={setOpenFailed}
              rowClassName={() => "bg-destructive/5"}
              empty={nFailed ? "No failed songs match the search." : "Nothing has failed. Every song is in the library."}
              columns={[
                {
                  id: "title",
                  header: "Title",
                  cell: (f) => (
                    <div className="min-w-0">
                      <div className="truncate font-medium">{f.track.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{f.track.artist}</div>
                    </div>
                  ),
                  className: "max-w-64",
                },
                {
                  id: "why",
                  header: "Why",
                  cell: (f) => <span className="line-clamp-2 text-xs whitespace-normal text-destructive">{f.error ?? "–"}</span>,
                  className: "max-w-80",
                },
                {
                  id: "in",
                  header: "Failed in",
                  cell: (f) => (
                    <div className="flex flex-wrap gap-1">
                      {f.in_collections.map((c) => (
                        <Badge key={c.spotify_id} variant="secondary" className="max-w-40 justify-start">
                          <span className="truncate">{c.name}</span>
                        </Badge>
                      ))}
                    </div>
                  ),
                  className: "hidden max-w-56 lg:table-cell",
                },
                {
                  id: "when",
                  header: "Last tried",
                  cell: (f) => <span className="text-xs text-muted-foreground">{when(f.last_tried)}</span>,
                  className: "hidden w-32 md:table-cell",
                },
              ]}
            />
          </>
        )
      ) : loading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <DataTable
          rows={rows}
          onRowClick={setOpen}
          empty="No songs match. Clear the search or pick another filter."
          columns={[
            {
              id: "title",
              header: "Title",
              cell: (s) => (
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.track.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{s.track.artist}</div>
                </div>
              ),
              className: "max-w-72",
            },
            {
              id: "album",
              header: "Album",
              cell: (s) =>
                splitPath(s.path).album === "Singles" ? (
                  <span className="text-muted-foreground">Singles</span>
                ) : (
                  <span className="truncate">{s.track.album}</span>
                ),
              className: "hidden max-w-64 truncate md:table-cell",
            },
            {
              id: "used",
              header: "Playlists",
              cell: (s) => {
                const n = s.in_collections.filter((c) => c.kind === "playlist").length
                return n ? <Badge variant="secondary">{n}</Badge> : <span className="text-muted-foreground">–</span>
              },
              className: "hidden w-24 lg:table-cell",
            },
            {
              id: "fmt",
              header: "Format",
              cell: (s) => <span className="font-mono text-xs text-muted-foreground">{s.format.slice(1)}</span>,
              className: "hidden w-20 sm:table-cell",
            },
            {
              id: "len",
              header: <span className="block text-right">Length</span>,
              cell: (s) => <span className="block text-right tabular-nums text-muted-foreground">{duration(s.track.duration_s)}</span>,
              className: "w-20",
            },
          ]}
        />
      )}

      <TrackSheet track={open?.track ?? null} song={open} open={!!open} onOpenChange={(o) => !o && setOpen(null)} />
      <TrackSheet
        track={openFailed?.track ?? null}
        retry={openFailed?.in_collections ?? []}
        open={!!openFailed}
        onOpenChange={(o) => !o && setOpenFailed(null)}
      />
    </Page>
  )
}
