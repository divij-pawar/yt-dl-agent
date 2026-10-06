import { useEffect, useState } from "react"
import {
  CircleHelpIcon,
  DownloadIcon,
  FileClockIcon,
  FolderInputIcon,
  FolderSearchIcon,
  HistoryIcon,
  LibraryIcon,
  ListMusicIcon,
  SearchIcon,
  SettingsIcon,
  WandSparklesIcon,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { api } from "@/lib/api"
import { useLoad } from "@/lib/hooks"

const PAGES = [
  { to: "/", label: "Request & queue", icon: DownloadIcon },
  { to: "/history", label: "History: what each run downloaded, skipped or failed", icon: HistoryIcon },
  { to: "/library?show=failed", label: "Failed songs", icon: LibraryIcon },
  { to: "/library", label: "Songs", icon: LibraryIcon },
  { to: "/playlists", label: "Playlists & albums", icon: ListMusicIcon },
  { to: "/import", label: "Import files", icon: FolderInputIcon },
  { to: "/unsorted", label: "Unsorted files", icon: FolderSearchIcon },
  { to: "/fix", label: "Fix library", icon: WandSparklesIcon },
  { to: "/logs", label: "Run logs", icon: FileClockIcon },
  { to: "/settings", label: "Settings & services", icon: SettingsIcon },
  { to: "/help", label: "Help & docs", icon: CircleHelpIcon },
]

/** Ctrl/⌘+K from anywhere: type a request (or paste a link) and send it to the composer. */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const navigate = useNavigate()
  const collections = useLoad(() => api.collections())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const go = (to: string, state?: unknown) => {
    setOpen(false)
    setText("")
    navigate(to, { state })
  }

  return (
    <>
      <Button
        variant="outline"
        className="h-8 w-full max-w-sm justify-start gap-2 text-muted-foreground sm:w-72"
        onClick={() => setOpen(true)}
      >
        <SearchIcon />
        <span className="truncate">Request, paste a link, or jump to…</span>
        <KbdGroup className="ml-auto hidden sm:inline-flex">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Request or jump to">
        <CommandInput
          placeholder="Tame Impala discography · Currents by Tame Impala · https://open.spotify.com/…"
          value={text}
          onValueChange={setText}
        />
        <CommandList>
          <CommandEmpty>Nothing matches. Press Enter on “Request” to send it to the queue composer.</CommandEmpty>
          {text.trim() && (
            <CommandGroup heading="Request">
              <CommandItem value={`request ${text}`} onSelect={() => go("/", { draft: text.trim() })}>
                <DownloadIcon />
                <span className="truncate">
                  Request “<span className="font-medium">{text.trim()}</span>”
                </span>
                <CommandShortcut>↵</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          )}
          <CommandGroup heading="Go to">
            {PAGES.map((p) => (
              <CommandItem key={p.to} value={p.label} onSelect={() => go(p.to)}>
                <p.icon />
                {p.label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Playlists & albums">
            {collections.data?.map((c) => (
              <CommandItem key={c.spotify_id} value={`${c.kind} ${c.name} ${c.owner_or_artist}`} onSelect={() => go(`/playlists/${c.spotify_id}`)}>
                <ListMusicIcon />
                <span className="truncate">{c.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{c.kind}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}
