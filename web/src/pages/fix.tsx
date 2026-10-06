import { useState } from "react"
import { ArrowRightIcon, EyeIcon, Loader2Icon, WandSparklesIcon } from "lucide-react"
import { toast } from "sonner"
import { Page } from "@/components/page"
import { DataTable } from "@/components/track-table"
import { ImportResults } from "@/pages/import"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/lib/api"
import type { FixReport } from "@/lib/types"

const STEPS = [
  ["Albums", "Re-read from each song's own Spotify page, replacing the model's guesses where the page loads."],
  ["Tags & covers", "Spotify's album cover (replacing YouTube thumbnails), year, track number and album artist."],
  ["Files", "Retagged, and renamed or moved if their correct place changed (Artist/Album/NN - Title)."],
  ["Playlists", "The index, cached playlists and every .m3u8 follow the moves."],
  ["Unsorted", "Everything in _Unsorted/ is retried; files that match now move into the library."],
]

export function FixPage() {
  const [busy, setBusy] = useState<"preview" | "run" | null>(null)
  const [report, setReport] = useState<FixReport | null>(null)

  const run = async (dry: boolean) => {
    setBusy(dry ? "preview" : "run")
    try {
      const r = await api.fix(dry)
      setReport(r)
      if (!dry) toast.success("Library fixed", { description: `${r.moved} files moved, ${r.covers_set} covers set` })
    } catch (e) {
      toast.error("Fix failed", { description: String(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Page
      title="Fix library"
      help="fix"
      description="Bring every song the app knows about up to the current standard. Safe to run any time; preview first to see what would change."
    >
      <Card>
        <CardHeader>
          <CardTitle>What it does</CardTitle>
          <CardDescription>Uses Tavily credits for the album lookups (cached afterwards).</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map(([name, text], i) => (
              <li key={name} className="space-y-1 rounded-lg border p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="flex size-5 items-center justify-center rounded-full bg-muted text-xs tabular-nums">{i + 1}</span>
                  {name}
                </div>
                <p className="text-xs text-muted-foreground">{text}</p>
              </li>
            ))}
          </ol>
        </CardContent>
        <CardFooter className="justify-end gap-2 border-t">
          <Button variant="outline" disabled={busy !== null} onClick={() => run(true)}>
            {busy === "preview" ? <Loader2Icon className="animate-spin" /> : <EyeIcon />}
            Preview changes
          </Button>
          <Button disabled={busy !== null} onClick={() => run(false)}>
            {busy === "run" ? <Loader2Icon className="animate-spin" /> : <WandSparklesIcon />}
            Fix library
          </Button>
        </CardFooter>
      </Card>

      {report && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-lg font-semibold">{report.dry_run ? "Would change" : "Changed"}</h2>
            {report.dry_run && (
              <Button disabled={busy !== null} onClick={() => run(false)}>
                Apply these changes
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ["Songs checked", report.songs],
              ["Albums corrected", report.albums_corrected],
              ["Covers from Spotify", report.covers_set],
              ["Files moved/renamed", report.moved],
              ["Errors", report.errors],
            ].map(([label, n]) => (
              <Card key={label} size="sm">
                <CardContent className="space-y-1">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className={`text-2xl font-semibold tabular-nums ${label === "Errors" && Number(n) > 0 ? "text-destructive" : ""}`}>{n}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <DataTable
            rows={report.changes}
            empty="Nothing to change: the library is up to date."
            columns={[
              {
                id: "change",
                header: "File",
                cell: (c) => (
                  <div className="min-w-0 space-y-1 whitespace-normal">
                    <code className="block truncate text-xs">{c.old}</code>
                    {c.new && (
                      <div className="flex items-center gap-1.5 text-xs text-success">
                        <ArrowRightIcon className="size-3 shrink-0" />
                        <code className="truncate">{c.new}</code>
                      </div>
                    )}
                    {c.error && <div className="text-xs text-destructive">{c.error}</div>}
                  </div>
                ),
                className: "max-w-xl",
              },
              {
                id: "what",
                header: "Changes",
                cell: (c) => (
                  <div className="flex flex-wrap gap-1">
                    {c.album && (
                      <Badge variant="outline" className="font-normal">
                        album: {c.album[0]} → {c.album[1]}
                      </Badge>
                    )}
                    {c.cover && <Badge variant="secondary">cover</Badge>}
                    {c.new && <Badge variant="secondary">moved</Badge>}
                  </div>
                ),
              },
            ]}
          />
          {report.unsorted_retry && <ImportResults result={report.unsorted_retry} />}
        </section>
      )}
    </Page>
  )
}
