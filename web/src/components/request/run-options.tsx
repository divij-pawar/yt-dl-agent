import { SlidersHorizontalIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { RunOptions } from "@/lib/types"

const BROWSERS = ["chrome", "firefox", "edge", "brave", "opera", "safari"]
// Base UI's SelectValue shows the raw value unless the root knows each value's label.
const BROWSER_ITEMS = { none: "No login", ...Object.fromEntries(BROWSERS.map((b) => [b, b])) }
const BITRATE_ITEMS = { 320: "320 kbps (max)", 256: "256 kbps", 192: "192 kbps", 128: "128 kbps" }

/** The non-default flags, as the CLI would spell them. */
export function changedFlags(o: RunOptions, d: RunOptions): string[] {
  const out: string[] = []
  if (o.workers !== d.workers) out.push(`--workers ${o.workers}`)
  if (o.bitrate !== d.bitrate) out.push(`--bitrate ${o.bitrate}`)
  if (o.links_only) out.push("--links-only")
  if (o.no_playlist) out.push("--no-playlist")
  if (o.no_album_lookup) out.push("--no-album-lookup")
  if (o.limit) out.push(`--limit ${o.limit}`)
  if (o.cookies_from_browser) out.push(`--cookies-from-browser ${o.cookies_from_browser}`)
  return out
}

/** cli.main flags for downloads, phrased positively. */
export function RunOptionsPopover({
  value,
  defaults,
  onChange,
}: {
  value: RunOptions
  defaults: RunOptions
  onChange: (o: RunOptions) => void
}) {
  const set = <K extends keyof RunOptions>(k: K, v: RunOptions[K]) => onChange({ ...value, [k]: v })
  const changed = changedFlags(value, defaults)

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" />}>
        <SlidersHorizontalIcon />
        Options
        {changed.length > 0 && <Badge className="h-4 px-1.5 text-[10px]">{changed.length}</Badge>}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96">
        <FieldGroup className="gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>Parallel downloads</FieldLabel>
              <Select value={String(value.workers)} onValueChange={(v) => set("workers", Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 6, 8].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n === 1 ? "1 (sequential)" : n}
                      {n === 4 && " (default)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>MP3 bitrate</FieldLabel>
              <Select items={BITRATE_ITEMS} value={String(value.bitrate)} onValueChange={(v) => set("bitrate", Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[320, 256, 192, 128].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} kbps{n === 320 && " (max)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <FieldDescription className="-mt-2 text-xs">More than 4 at once risks YouTube throttling.</FieldDescription>

          <FieldSeparator />

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="opt-dl">Download audio</FieldLabel>
              <FieldDescription className="text-xs">Off = only build YouTube Music search links (--links-only).</FieldDescription>
            </FieldContent>
            <Switch id="opt-dl" checked={!value.links_only} onCheckedChange={(c) => set("links_only", !c)} />
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="opt-m3u">Write playlist files</FieldLabel>
              <FieldDescription className="text-xs">songs/&lt;Playlist&gt;.m3u8, for playlists only.</FieldDescription>
            </FieldContent>
            <Switch id="opt-m3u" checked={!value.no_playlist} onCheckedChange={(c) => set("no_playlist", !c)} />
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="opt-alb">Look up albums</FieldLabel>
              <FieldDescription className="text-xs">Off = everything goes to Artist/Singles/. Costs Tavily credits.</FieldDescription>
            </FieldContent>
            <Switch id="opt-alb" checked={!value.no_album_lookup} onCheckedChange={(c) => set("no_album_lookup", !c)} />
          </Field>

          <FieldSeparator />

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="opt-limit">Only first N tracks</FieldLabel>
              <Input
                id="opt-limit"
                type="number"
                min={1}
                placeholder="all"
                value={value.limit ?? ""}
                onChange={(e) => set("limit", e.target.value ? Number(e.target.value) : null)}
              />
            </Field>
            <Field>
              <FieldLabel>YouTube login from</FieldLabel>
              <Select
                items={BROWSER_ITEMS}
                value={value.cookies_from_browser ?? "none"}
                onValueChange={(v) => set("cookies_from_browser", v === "none" ? null : (v as string))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No login</SelectItem>
                  {BROWSERS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <FieldDescription className="-mt-2 text-xs">
            With YT Music Premium, a browser login gives better source audio and avoids bot checks.
          </FieldDescription>

          {changed.length > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5">
              <code className="truncate text-xs">{changed.join(" ")}</code>
              <Button variant="ghost" size="xs" onClick={() => onChange({ ...defaults, yes: value.yes })}>
                Reset
              </Button>
            </div>
          )}
        </FieldGroup>
      </PopoverContent>
    </Popover>
  )
}
