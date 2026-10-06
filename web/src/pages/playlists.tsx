import { useMemo, useState } from "react"
import { MoreHorizontalIcon, PlusIcon, RefreshCwIcon, SearchIcon } from "lucide-react"
import { NavLink, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Page } from "@/components/page"
import { SourceBadge } from "@/components/status"
import { DataTable } from "@/components/track-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { api, linkJob } from "@/lib/api"
import { spotifyUrl, when } from "@/lib/format"
import { useLoad } from "@/lib/hooks"
import { useQueue } from "@/lib/queue"
import type { CollectionSummary } from "@/lib/types"

export function PlaylistsPage() {
  const { data, loading } = useLoad(() => api.collections())
  const { enqueue } = useQueue()
  const navigate = useNavigate()
  const [tab, setTab] = useState<"playlist" | "release">("playlist")
  const [q, setQ] = useState("")

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
    await enqueue(cs.map((c) => linkJob(c.kind, c.spotify_id, c.name)))
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
                <div className="min-w-0">
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {c.kind !== "playlist" && `${c.kind} · `}
                    {c.owner_or_artist}
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
              cell: (c) => <RowActions c={c} onSync={() => sync([c])} />,
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

function RowActions({ c, onSync }: { c: CollectionSummary; onSync: () => void }) {
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
