import { useEffect, useRef, useState } from "react"
import { ArrowUpIcon, HelpCircleIcon, Loader2Icon } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Page } from "@/components/page"
import { QueueList } from "@/components/request/queue-list"
import { changedFlags, RunOptionsPopover } from "@/components/request/run-options"
import { Understood } from "@/components/request/understood"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api"
import { useQueue } from "@/lib/queue"
import type { Job } from "@/lib/types"

const EXAMPLES = [
  "Tame Impala discography",
  "all Lana Del Rey albums",
  "Currents by Tame Impala",
  "Sweater Weather by The Neighbourhood",
  "top songs of Frank Ocean",
]

export function RequestPage() {
  const { jobs, enqueue, options, defaults, setOptions } = useQueue()
  const [text, setText] = useState("")
  const [parsing, setParsing] = useState(false)
  const [preview, setPreview] = useState<Job[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const ref = useRef<HTMLTextAreaElement>(null)
  const location = useLocation()
  const navigate = useNavigate()

  async function understand(input = text) {
    const lines = input.split("\n").map((l) => l.trim()).filter(Boolean)
    if (!lines.length) return
    setParsing(true)
    try {
      const results = await Promise.all(lines.map((l) => api.parse(l)))
      const parsed = results.flatMap((r) => r.jobs)
      setWarnings(results.flatMap((r) => r.warnings))
      if (options.yes && parsed.length && !parsed.some((j) => j.link?.[0] === "user")) {
        await queue(parsed)
      } else {
        setPreview(parsed)
      }
    } catch (e) {
      toast.error("Couldn't understand that", { description: String(e) })
    } finally {
      setParsing(false)
    }
  }

  async function queue(js: Job[]) {
    await enqueue(js)
    toast.success(`Queued ${js.length === 1 ? "1 request" : `${js.length} requests`}`)
    setPreview(null)
    setText("")
    ref.current?.focus()
  }

  // Requests sent from the command palette land here.
  useEffect(() => {
    const draft = (location.state as { draft?: string } | null)?.draft
    if (draft) {
      setText(draft)
      understand(draft)
      navigate(".", { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  const flags = changedFlags(options, defaults)

  return (
    <Page
      title="Request & queue"
      help="requests"
      description="Ask for artists, albums, songs or discographies in plain words, or paste Spotify links. Everything lands in songs/, and nothing already there is downloaded again."
    >
      <Card className="gap-0 p-0">
        <InputGroup className="rounded-xl border-0 shadow-none ring-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0">
          <InputGroupTextarea
            ref={ref}
            autoFocus
            rows={3}
            className="min-h-24 text-base"
            placeholder={"Tame Impala discography\nhttps://open.spotify.com/playlist/…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                understand()
              }
            }}
          />
          <InputGroupAddon align="block-end" className="flex-wrap gap-2 border-t">
            <RunOptionsPopover value={options} defaults={defaults} onChange={setOptions} />
            <SyntaxHelp />
            <div className="flex items-center gap-2 pl-1">
              <Switch id="confirm" checked={!options.yes} onCheckedChange={(c) => setOptions({ ...options, yes: !c })} />
              <Label htmlFor="confirm" className="text-xs font-normal text-muted-foreground">
                Confirm before queueing
              </Label>
            </div>
            <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
              One request per line · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> for a new line
            </span>
            <Button size="icon" className="rounded-full" aria-label="Understand" disabled={!text.trim() || parsing} onClick={() => understand()}>
              {parsing ? <Loader2Icon className="animate-spin" /> : <ArrowUpIcon />}
            </Button>
          </InputGroupAddon>
        </InputGroup>
      </Card>

      {flags.length > 0 && (
        <div className="-mt-3 flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <Badge key={f} variant="outline" className="font-mono text-[11px]">
              {f}
            </Badge>
          ))}
        </div>
      )}

      {!preview && !text && (
        <div className="-mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <Button key={ex} variant="outline" size="sm" className="rounded-full font-normal text-muted-foreground" onClick={() => setText(ex)}>
              {ex}
            </Button>
          ))}
        </div>
      )}

      {preview && (
        <Understood jobs={preview} warnings={warnings} onChange={setPreview} onQueue={queue} onCancel={() => setPreview(null)} />
      )}

      <QueueList
        jobs={jobs}
        onRequeue={(j) =>
          queue([{ ...j, id: `${j.id}-r${Date.now()}`, status: "queued", note: "", progress: null, unit_index: 0 }])
        }
      />
    </Page>
  )
}

/** chat.HELP: the exact forms that skip the model. */
function SyntaxHelp() {
  const rows: [string, string][] = [
    ["song: <title> - <artist>", "one song"],
    ["album: <title> - <artist>", "one album"],
    ["discography: <artist>", "albums, EPs, singles"],
    ["albums: <artist>", "albums and EPs only"],
    ["top: <artist>", "10 most popular tracks"],
  ]
  return (
    <HoverCard>
      <HoverCardTrigger render={<Button variant="ghost" size="sm" />}>
        <HelpCircleIcon />
        Exact form
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-96 space-y-3">
        <p className="text-sm">
          These skip the model, so they work even when Ollama is off. Links work for playlists, albums, tracks, artists
          (whole discography) and profiles.
        </p>
        <table className="w-full text-xs">
          <tbody>
            {rows.map(([syntax, what]) => (
              <tr key={syntax}>
                <td className="py-0.5 pr-3 font-mono">{syntax}</td>
                <td className="text-muted-foreground">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </HoverCardContent>
    </HoverCard>
  )
}
