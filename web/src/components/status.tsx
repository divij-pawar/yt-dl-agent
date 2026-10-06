import {
  AlertTriangleIcon,
  ArrowUpCircleIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CopyIcon,
  HelpCircleIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type {
  CollectionSource,
  HealthState,
  JobStatus,
  ParsedVia,
  PlanStatus,
  RequestKind,
  LinkKind,
  TrackStatus,
} from "@/lib/types"

const tone = {
  success: "bg-success/12 text-success border-success/25",
  warning: "bg-warning/12 text-warning border-warning/25",
  info: "bg-info/12 text-info border-info/25",
  danger: "bg-destructive/10 text-destructive border-destructive/25",
  muted: "bg-muted text-muted-foreground border-transparent",
}

type Tone = keyof typeof tone

function Pill({ t, icon, children, className }: { t: Tone; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn(tone[t], "gap-1 font-medium", className)}>
      {icon}
      {children}
    </Badge>
  )
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  if (status === "working") return <Pill t="info" icon={<Loader2Icon className="animate-spin" />}>working</Pill>
  if (status === "done") return <Pill t="success" icon={<CheckCircle2Icon />}>done</Pill>
  if (status === "failed") return <Pill t="danger" icon={<XCircleIcon />}>failed</Pill>
  return <Pill t="muted" icon={<CircleDashedIcon />}>queued</Pill>
}

export function TrackStatusBadge({ status }: { status: TrackStatus }) {
  if (status === "done") return <Pill t="success" icon={<CheckCircle2Icon />}>in library</Pill>
  if (status === "failed") return <Pill t="danger" icon={<XCircleIcon />}>failed</Pill>
  return <Pill t="muted" icon={<CircleDashedIcon />}>pending</Pill>
}

/** importer.Plan statuses, with the words the CLI summary uses. */
export const PLAN: Record<PlanStatus, { t: Tone; icon: React.ReactNode; label: string; help: string }> = {
  matched: { t: "success", icon: <CheckCircle2Icon />, label: "imported", help: "Matched on Spotify within 4 s of the file's length; filed into the library." },
  better: { t: "info", icon: <ArrowUpCircleIcon />, label: "upgraded", help: "Already in the library, but this copy is better (lossless, or 32+ kbps higher). The old file moves to _Replaced/." },
  duplicate: { t: "muted", icon: <CopyIcon />, label: "already in library", help: "Same song at the same or better quality already exists; skipped." },
  unsorted: { t: "warning", icon: <HelpCircleIcon />, label: "to _Unsorted", help: "No confident match. Copied to _Unsorted/ with the reason; `fix` retries it later." },
  still: { t: "warning", icon: <HelpCircleIcon />, label: "still unsorted", help: "Retried from _Unsorted/; still no confident match." },
  error: { t: "danger", icon: <XCircleIcon />, label: "error", help: "The file couldn't be read or written." },
}

export function PlanStatusBadge({ status }: { status: PlanStatus }) {
  const p = PLAN[status]
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>
        <Pill t={p.t} icon={p.icon}>
          {p.label}
        </Pill>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{p.help}</TooltipContent>
    </Tooltip>
  )
}

const SOURCE: Record<CollectionSource, [string, string]> = {
  "spotify-api": ["Spotify API", "Full track list, albums and track numbers."],
  embed: ["embed page", "Spotify's embed page: first 100 tracks, with durations and IDs. Albums come from a lookup."],
  tavily: ["Tavily", "Read from the embed page text via Tavily; albums come from a lookup."],
  search: ["search", "Not found on Spotify; matched on YouTube by title and artist only."],
  import: ["import", "Your own files, identified and filed by `import`."],
}

export function SourceBadge({ source, capped }: { source: CollectionSource; capped?: boolean }) {
  const [name, help] = SOURCE[source] ?? [source, ""]
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex items-center gap-1" />}>
        <Badge variant="outline" className="font-normal text-muted-foreground">
          {name}
        </Badge>
        {capped && (
          <Pill t="warning" icon={<AlertTriangleIcon />}>
            100-track cap
          </Pill>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {help}
        {capped && " This playlist may have more tracks; the rest need working Spotify API access."}
      </TooltipContent>
    </Tooltip>
  )
}

const KIND_LABEL: Record<RequestKind | LinkKind, string> = {
  song: "song",
  album: "album",
  discography: "discography",
  albums: "albums",
  top: "top songs",
  playlist: "playlist",
  track: "track",
  artist: "artist",
  user: "profile",
  tracks: "songs",
  import: "import",
  fix: "fix",
}

export function KindBadge({ kind }: { kind: RequestKind | LinkKind }) {
  return (
    <Badge variant="secondary" className="w-24 justify-center font-mono text-[11px] uppercase tracking-wide">
      {KIND_LABEL[kind]}
    </Badge>
  )
}

export function ViaBadge({ via }: { via: ParsedVia }) {
  const help = {
    link: "Spotify link: no model involved.",
    explicit: "Exact form (kind: title - artist): no model involved.",
    model: "Understood by the local Ollama model. Check it before queueing.",
  }[via]
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>
        <span className="text-xs text-muted-foreground">{via === "model" ? "via model" : via === "link" ? "link" : "exact form"}</span>
      </TooltipTrigger>
      <TooltipContent>{help}</TooltipContent>
    </Tooltip>
  )
}

export function HealthDot({ state, className }: { state: HealthState; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        state === "ok" && "bg-success",
        state === "degraded" && "bg-warning",
        state === "down" && "bg-destructive",
        state === "unknown" && "bg-muted-foreground/40",
        className,
      )}
    />
  )
}
