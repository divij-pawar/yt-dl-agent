import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { SearchIcon } from "lucide-react"
import { Page } from "@/components/page"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/lib/api"
import { when } from "@/lib/format"
import { useLoad } from "@/lib/hooks"
import type { LogLevel } from "@/lib/types"
import { cn } from "@/lib/utils"

const RANK: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARNING: 2, ERROR: 3 }

/** logs/run-*.log: the console's plain lines plus matches, retries, yt-dlp output and tracebacks. */
export function LogsPage() {
  const runs = useLoad(() => api.logRuns())
  const [params] = useSearchParams()
  const [selected, setSelected] = useState<string | null>(params.get("name")) // History links to a run's log
  const name = selected ?? runs.data?.[0]?.name ?? null
  const lines = useLoad(() => (name ? api.logLines(name) : Promise.resolve([])), [name])
  const [min, setMin] = useState<LogLevel>("DEBUG")
  const [q, setQ] = useState("")

  const shown = useMemo(
    () => (lines.data ?? []).filter((l) => RANK[l.level] >= RANK[min] && l.message.toLowerCase().includes(q.toLowerCase())),
    [lines.data, min, q],
  )

  return (
    <Page
      title="Run logs"
      help="troubleshooting"
      description="Every run keeps a full log: which YouTube video each track matched and its score, every retry with the raw error, and yt-dlp's own messages."
    >
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card size="sm" className="h-fit">
          <CardHeader>
            <CardTitle className="text-sm">Runs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 px-2">
            {runs.loading && <Skeleton className="h-24" />}
            {runs.data?.map((r) => (
              <button
                key={r.name}
                onClick={() => setSelected(r.name)}
                className={cn("w-full rounded-md px-2 py-1.5 text-left hover:bg-muted", r.name === name && "bg-muted")}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  {when(r.started)}
                  {r.warnings > 0 && (
                    <Badge variant="outline" className="ml-auto h-4 border-warning/30 px-1.5 text-[10px] text-warning">
                      {r.warnings} warn
                    </Badge>
                  )}
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground">{r.args}</div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="min-w-0 gap-3">
          <CardHeader className="flex flex-wrap items-center gap-3">
            <CardTitle className="mr-auto font-mono text-sm">logs/{name}</CardTitle>
            <ToggleGroup variant="outline" size="sm" value={[min]} onValueChange={(v) => v.length && setMin(v[0] as LogLevel)}>
              <ToggleGroupItem value="DEBUG">All</ToggleGroupItem>
              <ToggleGroupItem value="INFO">Info+</ToggleGroupItem>
              <ToggleGroupItem value="WARNING">Problems</ToggleGroupItem>
            </ToggleGroup>
            <InputGroup className="w-56">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput placeholder="Filter lines" value={q} onChange={(e) => setQ(e.target.value)} />
            </InputGroup>
          </CardHeader>
          <CardContent className="px-0">
            <ScrollArea className="h-[60vh] border-t">
              <div className="min-w-max p-3 font-mono text-xs leading-relaxed">
                {shown.map((l, i) => (
                  <div key={i} className="flex gap-3 rounded px-1 hover:bg-muted/60">
                    <span className="text-muted-foreground tabular-nums">{l.time}</span>
                    <span
                      className={cn(
                        "w-14 shrink-0",
                        l.level === "DEBUG" && "text-muted-foreground",
                        l.level === "WARNING" && "text-warning",
                        l.level === "ERROR" && "text-destructive",
                      )}
                    >
                      {l.level}
                    </span>
                    <span className="w-40 shrink-0 truncate text-muted-foreground">{l.thread}</span>
                    <span className={cn(l.level === "ERROR" && "text-destructive")}>{l.message}</span>
                  </div>
                ))}
                {!shown.length && <div className="p-6 text-center text-muted-foreground">No lines match.</div>}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}
