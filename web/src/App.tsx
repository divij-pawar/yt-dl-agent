import { BrowserRouter, Route, Routes } from "react-router-dom"
import { ThemeProvider } from "@/lib/theme"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { QueueProvider } from "@/lib/queue"
import { FixPage } from "@/pages/fix"
import { HelpPage } from "@/pages/help"
import { ImportPage } from "@/pages/import"
import { LibraryPage } from "@/pages/library"
import { LogsPage } from "@/pages/logs"
import { PlaylistDetailPage } from "@/pages/playlist-detail"
import { PlaylistsPage } from "@/pages/playlists"
import { RequestPage } from "@/pages/request"
import { SettingsPage } from "@/pages/settings"
import { UnsortedPage } from "@/pages/unsorted"

export default function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <BrowserRouter>
          <QueueProvider>
            <SidebarProvider>
              <AppSidebar />
              <SidebarInset>
                <Routes>
                  <Route path="/" element={<RequestPage />} />
                  <Route path="/library" element={<LibraryPage />} />
                  <Route path="/playlists" element={<PlaylistsPage />} />
                  <Route path="/playlists/:id" element={<PlaylistDetailPage />} />
                  <Route path="/import" element={<ImportPage />} />
                  <Route path="/unsorted" element={<UnsortedPage />} />
                  <Route path="/fix" element={<FixPage />} />
                  <Route path="/logs" element={<LogsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/help" element={<HelpPage />} />
                </Routes>
              </SidebarInset>
            </SidebarProvider>
          </QueueProvider>
        </BrowserRouter>
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  )
}
