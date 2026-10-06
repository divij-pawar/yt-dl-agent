import { useMemo, useState } from "react"
import { InfoIcon, Loader2Icon, UserIcon, XIcon } from "lucide-react"
import { KindBadge, ViaBadge } from "@/components/status"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { api, describe } from "@/lib/api"
import { useLoad } from "@/lib/hooks"
import type { Job } from "@/lib/types"

/** chat.py's "I understood: … Queue these? [Y/n]", as a reviewable list. */
export function Understood({
  jobs,
  warnings = [],
  onChange,
  onQueue,
  onCancel,
}: {
  jobs: Job[]
  warnings?: string[]
  onChange: (jobs: Job[]) => void
  onQueue: (jobs: Job[]) => void
  onCancel: () => void
}) {
  const [picked, setPicked] = useState<Record<string, Job[]>>({})
  const anyModel = jobs.some((j) => j.via === "model")

  const final = jobs.flatMap((j) => (j.link?.[0] === "user" ? (picked[j.id] ?? []) : [j]))

  return (
    <Card className="border-primary/30 ring-1 ring-primary/10">
      <CardHeader>
        <CardTitle>I understood</CardTitle>
        <CardDescription>
          {anyModel
            ? "Parts of this were read by the local model. Check them; if something is off, rephrase or use the exact form."
            : "Nothing here needed the model."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {(jobs.length === 0 || warnings.length > 0) && (
          <Alert>
            <InfoIcon />
            <AlertTitle>{jobs.length === 0 ? "Nothing to queue from that" : "Some of it couldn't be read"}</AlertTitle>
            <AlertDescription>
              {warnings.map((w) => (
                <span key={w} className="block">
                  {w}
                </span>
              ))}
              <span className="mt-1 block">
                Try e.g. <code>Currents by Tame Impala</code>, or the exact form <code>album: Bloom - Beach House</code>. Spotify
                links always work, even with Ollama off.
              </span>
            </AlertDescription>
          </Alert>
        )}
        {jobs.map((j) => (
          <div key={j.id} className="rounded-lg border bg-card">
            <div className="flex items-center gap-3 px-3 py-2">
              <KindBadge kind={j.request?.kind ?? j.link![0]} />
              <span className="min-w-0 flex-1 truncate text-sm">
                {j.request ? describe(j.request) : <code className="text-xs">{j.link![1]}</code>}
              </span>
              <ViaBadge via={j.via} />
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Remove"
                onClick={() => onChange(jobs.filter((x) => x.id !== j.id))}
              >
                <XIcon />
              </Button>
            </div>
            {j.request?.kind === "song" && (
              <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
                If this turns out to be an album, the album is downloaded instead. Not on Spotify → searched on YouTube by
                title and artist.
              </p>
            )}
            {j.request?.kind === "discography" && (
              <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
                Albums, EPs and singles from the artist's Spotify pages. Releases where they're only featured are skipped.
              </p>
            )}
            {j.link?.[0] === "user" && (
              <ProfilePicker userId={j.link[1]} onPick={(sel) => setPicked((p) => ({ ...p, [j.id]: sel }))} />
            )}
          </div>
        ))}
      </CardContent>
      <CardFooter className="justify-between gap-2 border-t">
        <span className="text-xs text-muted-foreground">Jobs run one at a time, in order. You can keep adding while it works.</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Rephrase
          </Button>
          <Button disabled={final.length === 0} onClick={() => onQueue(final)}>
            Queue {final.length > 1 ? `these ${final.length}` : "this"}
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}

/** Profile links: sources.user_playlists → --list, then pick with --match-style filtering. */
function ProfilePicker({ userId, onPick }: { userId: string; onPick: (jobs: Job[]) => void }) {
  const { data, loading } = useLoad(() => api.profilePlaylists(userId), [userId])
  const [match, setMatch] = useState("")
  const [sel, setSel] = useState<Set<string>>(new Set())

  const shown = useMemo(() => {
    const terms = match.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    return (data ?? []).filter((p) => !terms.length || terms.some((t) => p.name.toLowerCase().includes(t)))
  }, [data, match])

  const update = (next: Set<string>) => {
    setSel(next)
    onPick(
      (data ?? [])
        .filter((p) => next.has(p.id))
        .map((p) => ({
          id: `pl-${p.id}`,
          label: `link         playlist ${p.id}`,
          request: null,
          link: ["playlist", p.id],
          status: "queued",
          note: "",
          units: [{ kind: "playlist", id: p.id, name: p.name }],
          via: "link",
          unit_index: 0,
          progress: null,
          queued_at: new Date().toISOString(),
        })),
    )
  }

  return (
    <div className="space-y-2 border-t p-3">
      <div className="flex items-center gap-2 text-sm">
        <UserIcon className="size-4 text-muted-foreground" />
        <span className="font-medium">{loading ? "Reading the profile…" : `${data?.length ?? 0} public playlists`}</span>
        {loading && <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />}
        <span className="ml-auto text-xs text-muted-foreground">{sel.size} selected</span>
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="Filter by name; commas for several (night, jim '24)"
          value={match}
          onChange={(e) => setMatch(e.target.value)}
          className="h-8"
        />
        <Button variant="outline" size="sm" onClick={() => update(new Set([...sel, ...shown.map((p) => p.id)]))}>
          Select shown
        </Button>
        <Button variant="ghost" size="sm" onClick={() => update(new Set())}>
          Clear
        </Button>
      </div>
      <ScrollArea className="h-48 rounded-md border">
        <div className="grid gap-px p-1 sm:grid-cols-2">
          {shown.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
              <Checkbox
                checked={sel.has(p.id)}
                onCheckedChange={(c) => {
                  const next = new Set(sel)
                  if (c) next.add(p.id)
                  else next.delete(p.id)
                  update(next)
                }}
              />
              <span className="truncate">{p.name}</span>
            </label>
          ))}
        </div>
      </ScrollArea>
      <p className="text-xs text-muted-foreground">
        Only playlists shown on the profile are listed. Private or hidden ones need their own link. Songs shared between
        playlists download once.
      </p>
    </div>
  )
}
