import { useMemo, useState } from "react"
import { ArrowRightIcon, EyeIcon, FolderInputIcon, FolderOpenIcon, Loader2Icon, PlusIcon, Undo2Icon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { Page } from "@/components/page"
import { PLAN, PlanStatusBadge } from "@/components/status"
import { DataTable } from "@/components/track-table"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/lib/api"
import { splitSuggestion, when } from "@/lib/format"
import { useLoad } from "@/lib/hooks"
import type { ImportManifest, ImportPlan, ImportResult, PlanStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

const ORDER: PlanStatus[] = ["matched", "better", "unsorted", "still", "duplicate", "error"]

export function ImportPage() {
  const [paths, setPaths] = useState<string[]>([])
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState<"preview" | "import" | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const history = useLoad(() => api.importHistory())

  const add = () => {
    const p = draft.trim().replace(/^"|"$/g, "")
    if (p && !paths.includes(p)) setPaths([...paths, p])
    setDraft("")
  }
  const run = async (dry: boolean) => {
    const all = draft.trim() ? [...paths, draft.trim().replace(/^"|"$/g, "")] : paths
    if (!all.length) return
    setPaths(all)
    setDraft("")
    setBusy(dry ? "preview" : "import")
    try {
      const r = await api.importFiles(all, dry)
      setResult(r)
      if (!dry) {
        history.reload()
        toast.success("Import finished", { description: r.manifest ? "You can undo it from the history below." : undefined })
      }
    } catch (e) {
      toast.error("Import failed", { description: String(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Page
      title="Import files"
      help="import"
      description="Bring in your own songs. Each file is identified on Spotify from its tags, name and folders, given proper tags and the album cover, and copied to Artist/Album/NN - Title. Originals are never touched, and formats are kept (a FLAC stays a FLAC)."
    >
      <Card>
        <CardHeader>
          <CardTitle>Files or folders</CardTitle>
          <CardDescription>Paths on this computer. Folders are scanned recursively for mp3, m4a, flac, opus, ogg and wav.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <InputGroup>
            <InputGroupAddon>
              <FolderOpenIcon />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="D:\Music\old"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="xs" disabled={!draft.trim()} onClick={add}>
                <PlusIcon /> Add
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {paths.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {paths.map((p) => (
                <Badge key={p} variant="secondary" className="h-6 gap-1 pr-1 font-mono text-xs">
                  {p}
                  <button aria-label={`Remove ${p}`} className="rounded-sm p-0.5 hover:bg-background" onClick={() => setPaths(paths.filter((x) => x !== p))}>
                    <XIcon className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
        <CardFooter className="justify-between gap-2 border-t">
          <span className="text-xs text-muted-foreground">Preview first: nothing is copied or changed until you import.</span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy !== null || (!paths.length && !draft.trim())} onClick={() => run(true)}>
              {busy === "preview" ? <Loader2Icon className="animate-spin" /> : <EyeIcon />}
              Preview
            </Button>
            <Button disabled={busy !== null || (!paths.length && !draft.trim())} onClick={() => run(false)}>
              {busy === "import" ? <Loader2Icon className="animate-spin" /> : <FolderInputIcon />}
              Import
            </Button>
          </div>
        </CardFooter>
      </Card>

      {result && <ImportResults result={result} onImport={() => run(false)} busy={busy !== null} />}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Past imports</h2>
        <ImportHistory runs={history.data ?? []} onUndone={history.reload} />
      </section>
    </Page>
  )
}

export function ImportResults({ result, onImport, busy }: { result: ImportResult; onImport?: () => void; busy?: boolean }) {
  const [filter, setFilter] = useState<PlanStatus | "all">("all")
  const counts = useMemo(
    () => Object.fromEntries(ORDER.map((s) => [s, result.plans.filter((p) => p.status === s).length])) as Record<PlanStatus, number>,
    [result],
  )
  const rows = result.plans
    .filter((p) => filter === "all" || p.status === filter)
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{result.dry_run ? "Preview" : "Imported"}</h2>
          <p className="text-sm text-muted-foreground">
            {result.files} audio files{result.skipped_unchanged > 0 && `, ${result.skipped_unchanged} skipped (imported before, unchanged)`}
          </p>
        </div>
        {result.dry_run && onImport && (
          <Button disabled={busy} onClick={onImport}>
            Looks right, import
          </Button>
        )}
      </div>

      <ToggleGroup variant="outline" size="sm" value={[filter]} onValueChange={(v) => v.length && setFilter(v[0] as PlanStatus | "all")} className="flex-wrap">
        <ToggleGroupItem value="all">All {result.plans.length}</ToggleGroupItem>
        {ORDER.filter((s) => counts[s]).map((s) => (
          <ToggleGroupItem key={s} value={s}>
            {PLAN[s].label} <span className="tabular-nums text-muted-foreground">{counts[s]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {counts.unsorted > 0 && (
        <Alert>
          <AlertDescription>
            Files without a confident match go to <code>songs/_Unsorted/</code> with the reason. Fix their tags or file names, then
            run Fix library to retry them.
          </AlertDescription>
        </Alert>
      )}

      <DataTable
        rows={rows}
        columns={[
          { id: "status", header: "Result", cell: (p) => <PlanStatusBadge status={p.status} />, className: "w-40" },
          { id: "file", header: "File → where it goes", cell: (p) => <PlanCell p={p} />, className: "max-w-xl" },
        ]}
      />
    </section>
  )
}

function basename(p: string) {
  return p.split(/[\\/]/).pop() ?? p
}

function PlanCell({ p }: { p: ImportPlan }) {
  const [text, url] = splitSuggestion(p.suggestion)
  return (
    <div className="min-w-0 space-y-1 whitespace-normal">
      <div className="truncate font-medium" title={p.src}>
        {basename(p.src)}
      </div>
      {p.dest && (
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowRightIcon className="size-3 shrink-0" />
          <code className={cn("truncate", p.status === "duplicate" && "line-through decoration-muted-foreground/50")}>{p.dest}</code>
          {p.status === "duplicate" && <span className="shrink-0">(exists)</span>}
        </div>
      )}
      {p.replaced && <div className="text-xs text-info">old copy → {p.replaced}</div>}
      {p.model_guess && p.status === "matched" && (
        <div className="text-xs text-muted-foreground">
          Found via the model's reading of the file name: {p.model_guess[0]} - {p.model_guess[1]}
        </div>
      )}
      {p.reason && <div className={cn("text-xs", p.status === "error" ? "text-destructive" : "text-warning")}>{p.reason}</div>}
      {p.suggestion && (
        <div className="text-xs">
          Maybe:{" "}
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {text}
            </a>
          ) : (
            text
          )}
        </div>
      )}
    </div>
  )
}

function ImportHistory({ runs, onUndone }: { runs: ImportManifest[]; onUndone: () => void }) {
  const [confirm, setConfirm] = useState<ImportManifest | null>(null)
  const [undoing, setUndoing] = useState(false)

  if (!runs.length) return <p className="text-sm text-muted-foreground">No imports yet.</p>
  return (
    <>
      <Card size="sm">
        <CardContent className="divide-y p-0">
          {runs.map((r) => {
            const by = (s: string) => r.items.filter((i) => i.status === s).length
            return (
              <div key={r.name} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{when(r.when)}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.items.length} files ({r.mode}) · {by("matched")} imported · {by("better")} upgraded · {by("unsorted")} unsorted
                  </div>
                </div>
                {r.undone ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    undone
                  </Badge>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setConfirm(r)}>
                    <Undo2Icon />
                    Undo
                  </Button>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Undo the import of {confirm && when(confirm.when)}?</DialogTitle>
            <DialogDescription>
              The {confirm?.items.length} copied files are removed from songs/. Any older copies this import replaced are moved back
              from _Replaced/, and playlists pointing at them are relinked. Your original files aren't affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              disabled={undoing}
              onClick={async () => {
                setUndoing(true)
                await api.undoImport(confirm!.name)
                setUndoing(false)
                setConfirm(null)
                toast.success("Import undone")
                onUndone()
              }}
            >
              {undoing && <Loader2Icon className="animate-spin" />}
              Undo import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
