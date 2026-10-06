import { Loader2Icon, MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "@/lib/theme"
import { NavLink, useLocation } from "react-router-dom"
import { CommandPalette } from "@/components/command-palette"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useQueue } from "@/lib/queue"

const TITLES: Record<string, string> = {
  "": "Request & queue",
  library: "Songs",
  playlists: "Playlists & albums",
  import: "Import files",
  unsorted: "Unsorted",
  fix: "Fix library",
  logs: "Run logs",
  settings: "Settings",
  help: "Help & docs",
  history: "History",
  preview: "Preview",
}

export function SiteHeader({ crumb }: { crumb?: string }) {
  const { pathname } = useLocation()
  const [section, sub] = pathname.split("/").filter(Boolean)
  const title = TITLES[section ?? ""] ?? section

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <Breadcrumb className="hidden min-w-0 md:block">
        <BreadcrumbList>
          <BreadcrumbItem>
            {sub && section !== "preview" ? <BreadcrumbLink render={<NavLink to={`/${section}`} />}>{title}</BreadcrumbLink> : <BreadcrumbPage>{title}</BreadcrumbPage>}
          </BreadcrumbItem>
          {sub && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="truncate">{crumb ?? sub}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-2">
        <CommandPalette />
        <QueuePill />
        <ThemeToggle />
      </div>
    </header>
  )
}

/** Always-visible pointer to whatever the queue worker is doing. */
function QueuePill() {
  const { active, pending } = useQueue()
  const { pathname } = useLocation()
  if (!active || pathname === "/") return null
  const p = active.progress
  return (
    <Button variant="secondary" size="sm" className="hidden max-w-64 lg:inline-flex" render={<NavLink to="/" />}>
      <Loader2Icon className="animate-spin" />
      <span className="truncate">
        {active.units.length > 1 && `${active.unit_index}/${active.units.length} · `}
        {p ? `${p.reused + p.done + p.failed}/${p.total}` : "starting"}
      </span>
      {pending > 1 && <span className="text-muted-foreground">+{pending - 1}</span>}
    </Button>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      <SunIcon className="dark:hidden" />
      <MoonIcon className="hidden dark:block" />
    </Button>
  )
}
