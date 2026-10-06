import {
  AudioLinesIcon,
  CircleAlertIcon,
  CircleHelpIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileClockIcon,
  FolderInputIcon,
  FolderSearchIcon,
  HistoryIcon,
  LibraryIcon,
  ListMusicIcon,
  SettingsIcon,
  WandSparklesIcon,
} from "lucide-react"
import { NavLink, useLocation } from "react-router-dom"
import { HealthDot } from "@/components/status"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { API_MODE, api } from "@/lib/api"
import { useLoad } from "@/lib/hooks"
import { useQueue } from "@/lib/queue"

const PINNED_PLAYLISTS = 6

export function AppSidebar() {
  const { pathname, search } = useLocation()
  const showingFailed = pathname === "/library" && search.includes("show=failed")
  const { pending } = useQueue()
  const collections = useLoad(() => api.collections())
  const library = useLoad(() => api.library())
  const unsorted = useLoad(() => api.unsorted())
  const failed = useLoad(() => api.failed())
  const health = useLoad(() => api.health())

  const playlists = (collections.data ?? [])
    .filter((c) => c.kind === "playlist")
    .sort((a, b) => b.updated.localeCompare(a.updated))
  const is = (p: string) => (p === "/" ? pathname === "/" : pathname.startsWith(p))

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<NavLink to="/" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <AudioLinesIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">yt-dl-agent</span>
                <span className="truncate text-xs text-muted-foreground">
                  {API_MODE === "mock" ? "sample data" : `songs/ · ${library.data ? `${library.data.length} songs` : "…"}`}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Get music</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={is("/")} tooltip="Request & queue" render={<NavLink to="/" />}>
                  <DownloadIcon />
                  <span>Request & queue</span>
                </SidebarMenuButton>
                {pending > 0 && <SidebarMenuBadge>{pending}</SidebarMenuBadge>}
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={is("/history")} tooltip="History" render={<NavLink to="/history" />}>
                  <HistoryIcon />
                  <span>History</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Library</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={is("/library") && !showingFailed} tooltip="Songs" render={<NavLink to="/library" />}>
                  <LibraryIcon />
                  <span>Songs</span>
                </SidebarMenuButton>
                {library.data && <SidebarMenuBadge>{library.data.length}</SidebarMenuBadge>}
              </SidebarMenuItem>
              {!!failed.data?.length && (
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={showingFailed} tooltip="Failed songs" render={<NavLink to="/library?show=failed" />}>
                    <CircleAlertIcon />
                    <span>Failed songs</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge className="text-destructive">{failed.data.length}</SidebarMenuBadge>
                </SidebarMenuItem>
              )}

              <Collapsible defaultOpen render={<SidebarMenuItem />}>
                <SidebarMenuButton
                  isActive={pathname === "/playlists"}
                  tooltip="Playlists & albums"
                  render={<NavLink to="/playlists" />}
                >
                  <ListMusicIcon />
                  <span>Playlists & albums</span>
                </SidebarMenuButton>
                <CollapsibleTrigger
                  render={
                    <button
                      aria-label="Show recent playlists"
                      className="absolute top-1.5 right-1 flex size-5 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden [&[data-panel-open]>svg]:rotate-90"
                    />
                  }
                >
                  <ChevronRightIcon className="size-4 transition-transform" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {playlists.slice(0, PINNED_PLAYLISTS).map((p) => (
                      <SidebarMenuSubItem key={p.spotify_id}>
                        <SidebarMenuSubButton
                          isActive={pathname === `/playlists/${p.spotify_id}`}
                          render={<NavLink to={`/playlists/${p.spotify_id}`} />}
                        >
                          <span>{p.name}</span>
                          {p.failed > 0 && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-destructive" />}
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                    {playlists.length > PINNED_PLAYLISTS && (
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton render={<NavLink to="/playlists" />} className="text-muted-foreground">
                          <span>All {playlists.length} playlists…</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    )}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Library tools</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={pathname === "/import"} tooltip="Import files" render={<NavLink to="/import" />}>
                  <FolderInputIcon />
                  <span>Import files</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={is("/unsorted")} tooltip="Unsorted" render={<NavLink to="/unsorted" />}>
                  <FolderSearchIcon />
                  <span>Unsorted</span>
                </SidebarMenuButton>
                {!!unsorted.data?.length && (
                  <SidebarMenuBadge className="text-warning">{unsorted.data.length}</SidebarMenuBadge>
                )}
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={is("/fix")} tooltip="Fix library" render={<NavLink to="/fix" />}>
                  <WandSparklesIcon />
                  <span>Fix library</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={is("/logs")} tooltip="Run logs" render={<NavLink to="/logs" />}>
                  <FileClockIcon />
                  <span>Run logs</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2 px-2 py-1 group-data-[collapsible=icon]:hidden">
              <span className="text-xs text-muted-foreground">Services</span>
              <div className="ml-auto flex items-center gap-1.5">
                {health.data?.map((h) => (
                  <Tooltip key={h.id}>
                    <TooltipTrigger render={<NavLink to="/settings" className="p-0.5" aria-label={`${h.name}: ${h.state}`} />}>
                      <HealthDot state={h.state} />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64">
                      <span className="font-medium">{h.name}</span>: {h.detail}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={is("/help")} tooltip="Help & docs" render={<NavLink to="/help" />}>
              <CircleHelpIcon />
              <span>Help & docs</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={is("/settings")} tooltip="Settings" render={<NavLink to="/settings" />}>
              <SettingsIcon />
              <span>Settings</span>
              {health.data?.some((h) => h.state !== "ok") && (
                <HealthDot state={health.data.some((h) => h.state === "down") ? "down" : "degraded"} className="ml-auto" />
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
