import { useMemo, useState } from "react"
import { SearchIcon } from "lucide-react"
import { Page } from "@/components/page"
import { DataTable } from "@/components/track-table"
import { TrackSheet } from "@/components/track-sheet"
import { Badge } from "@/components/ui/badge"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/lib/api"
import { duration, splitPath } from "@/lib/format"
import { useLoad } from "@/lib/hooks"
import type { LibrarySong } from "@/lib/types"

type Facet = "all" | "singles" | "orphan" | "imported" | "lossless"

const FACETS: { id: Facet; label: string; test: (s: LibrarySong) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "singles", label: "In Singles/", test: (s) => splitPath(s.path).album === "Singles" },
  { id: "orphan", label: "In no playlist", test: (s) => s.in_collections.every((c) => c.kind !== "playlist") },
  { id: "imported", label: "Imported", test: (s) => s.imported },
  { id: "lossless", label: "Lossless", test: (s) => s.format === ".flac" || s.format === ".wav" },
]

export function LibraryPage() {
  const { data, loading } = useLoad(() => api.library())
  const [q, setQ] = useState("")
  const [facet, setFacet] = useState<Facet>("all")
  const [open, setOpen] = useState<LibrarySong | null>(null)

  const counts = useMemo(
    () => Object.fromEntries(FACETS.map((f) => [f.id, (data ?? []).filter(f.test).length])) as Record<Facet, number>,
    [data],
  )
  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const test = FACETS.find((f) => f.id === facet)!.test
    return (data ?? []).filter((s) => {
      if (!test(s)) return false
      const hay = `${s.track.title} ${s.track.artist} ${s.track.album ?? ""} ${s.path}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [data, q, facet])
  const artists = useMemo(() => new Set((data ?? []).map((s) => splitPath(s.path).artist)).size, [data])

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
    >
      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="max-w-sm">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput placeholder="Search title, artist, album or path" value={q} onChange={(e) => setQ(e.target.value)} />
        </InputGroup>
        <ToggleGroup
          variant="outline"
          size="sm"
          value={[facet]}
          onValueChange={(v) => v.length && setFacet(v[0] as Facet)}
        >
          {FACETS.map((f) => (
            <ToggleGroupItem key={f.id} value={f.id}>
              {f.label}
              <span className="text-xs text-muted-foreground tabular-nums">{counts[f.id] ?? 0}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {loading ? (
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
    </Page>
  )
}
