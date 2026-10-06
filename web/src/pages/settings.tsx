import { useEffect, useState } from "react"
import { EyeIcon, EyeOffIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"
import { Page } from "@/components/page"
import { HealthDot } from "@/components/status"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api"
import { useLoad } from "@/lib/hooks"
import type { Settings } from "@/lib/types"

const BITRATE_ITEMS = { 320: "320 kbps", 256: "256 kbps", 192: "192 kbps", 128: "128 kbps" }
const BROWSER_ITEMS = { none: "No login", chrome: "chrome", firefox: "firefox", edge: "edge", brave: "brave" }

export function SettingsPage() {
  const [checks, setChecks] = useState(0)
  const health = useLoad(() => api.health(checks > 0), [checks])
  const loaded = useLoad(() => api.settings())
  const [s, setS] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => setS(loaded.data), [loaded.data])

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => s && setS({ ...s, [k]: v })
  const setD = <K extends keyof Settings["defaults"]>(k: K, v: Settings["defaults"][K]) =>
    s && setS({ ...s, defaults: { ...s.defaults, [k]: v } })
  const dirty = JSON.stringify(s) !== JSON.stringify(loaded.data)

  return (
    <Page title="Settings" help="options" description="Services the app depends on, the keys in .env, and the defaults every run starts from.">
      <Card>
        <CardHeader>
          <CardTitle>Services</CardTitle>
          <CardDescription>Nothing crashes when one is missing: the app falls back and says what it skipped.</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setChecks((n) => n + 1)} disabled={health.loading}>
              {health.loading ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
              Check again
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="divide-y rounded-lg border p-0">
          {health.data?.map((h) => (
            <div key={h.id} className="flex items-start gap-3 px-4 py-3">
              <HealthDot state={h.state} className="mt-1.5" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{h.name}</div>
                <div className="text-sm text-muted-foreground">{h.detail}</div>
                {h.fix && <div className="mt-1 text-xs text-warning">{h.fix}</div>}
              </div>
              <span className="text-xs capitalize text-muted-foreground">{h.state}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {!s ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Connections</CardTitle>
              <CardDescription>Stored in .env next to the app. Never committed.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="tavily">Tavily API key</FieldLabel>
                  <Secret id="tavily" value={s.TAVILY_API_KEY} onChange={(v) => set("TAVILY_API_KEY", v)} />
                  <FieldDescription>Reads Spotify pages and looks up albums. About 55 credits per 100-track playlist.</FieldDescription>
                </Field>
                <FieldSeparator />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="ohost">Ollama host</FieldLabel>
                    <Input id="ohost" value={s.OLLAMA_HOST} onChange={(e) => set("OLLAMA_HOST", e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="omodel">Ollama model</FieldLabel>
                    <Input id="omodel" value={s.OLLAMA_MODEL} onChange={(e) => set("OLLAMA_MODEL", e.target.value)} />
                  </Field>
                </div>
                <FieldDescription className="-mt-3">
                  Understands plain-words requests and covers two fallbacks. A small model (llama3.2, 3B) is enough.
                </FieldDescription>
                <FieldSeparator />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="sid">Spotify client ID</FieldLabel>
                    <Input id="sid" placeholder="optional" value={s.SPOTIFY_CLIENT_ID} onChange={(e) => set("SPOTIFY_CLIENT_ID", e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ssec">Spotify client secret</FieldLabel>
                    <Secret id="ssec" value={s.SPOTIFY_CLIENT_SECRET} onChange={(v) => set("SPOTIFY_CLIENT_SECRET", v)} placeholder="optional" />
                  </Field>
                </div>
                <FieldDescription className="-mt-3">
                  Optional: full track lists past 100, exact albums and track numbers. The developer account that owns the app needs
                  Premium.
                </FieldDescription>
                <FieldSeparator />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="purl">Plex server</FieldLabel>
                    <Input
                      id="purl"
                      placeholder="http://127.0.0.1:32400"
                      value={s.PLEX_URL ?? ""}
                      onChange={(e) => set("PLEX_URL", e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ptok">Plex token</FieldLabel>
                    <Secret id="ptok" value={s.PLEX_TOKEN ?? ""} onChange={(v) => set("PLEX_TOKEN", v)} placeholder="optional" />
                  </Field>
                </div>
                <FieldDescription className="-mt-3">
                  Optional: creates your playlists in Plex, which doesn't read .m3u8 files. Token: in Plex Web, a song's ⋯ › Get
                  Info › View XML, then the X-Plex-Token value in the address.
                </FieldDescription>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Defaults for every run</CardTitle>
              <CardDescription>Each request can still override these from its Options menu.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="out">Library folder</FieldLabel>
                    <Input id="out" value={s.defaults.out} onChange={(e) => setD("out", e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="logdir">Log folder</FieldLabel>
                    <Input id="logdir" value={s.defaults.log_dir} onChange={(e) => setD("log_dir", e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel>Parallel downloads</FieldLabel>
                    <Select value={String(s.defaults.workers)} onValueChange={(v) => setD("workers", Number(v))}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 6, 8].map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>MP3 bitrate</FieldLabel>
                    <Select items={BITRATE_ITEMS} value={String(s.defaults.bitrate)} onValueChange={(v) => setD("bitrate", Number(v))}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[320, 256, 192, 128].map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n} kbps
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <FieldSeparator />
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="d-m3u">Write playlist files (.m3u8)</FieldLabel>
                  </FieldContent>
                  <Switch id="d-m3u" checked={!s.defaults.no_playlist} onCheckedChange={(c) => setD("no_playlist", !c)} />
                </Field>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="d-alb">Look up albums</FieldLabel>
                  </FieldContent>
                  <Switch id="d-alb" checked={!s.defaults.no_album_lookup} onCheckedChange={(c) => setD("no_album_lookup", !c)} />
                </Field>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="d-plex">Sync playlists to Plex after downloading</FieldLabel>
                    <FieldDescription>Only when a Plex token is set.</FieldDescription>
                  </FieldContent>
                  <Switch id="d-plex" checked={!s.defaults.no_plex} onCheckedChange={(c) => setD("no_plex", !c)} />
                </Field>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="d-preview">Preview Spotify links first</FieldLabel>
                    <FieldDescription>
                      Pasting a playlist, album, song or artist link opens its preview: what's on it and what's already in your
                      library. Download from there. Off = it goes straight to “I understood”.
                    </FieldDescription>
                  </FieldContent>
                  <Switch id="d-preview" checked={s.defaults.preview_links ?? true} onCheckedChange={(c) => setD("preview_links", c)} />
                </Field>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="d-yes">Confirm requests before queueing</FieldLabel>
                    <FieldDescription>Recommended: the small model sometimes misreads a request.</FieldDescription>
                  </FieldContent>
                  <Switch id="d-yes" checked={!s.defaults.yes} onCheckedChange={(c) => setD("yes", !c)} />
                </Field>
                <FieldSeparator />
                <Field>
                  <FieldLabel>Use YouTube login from</FieldLabel>
                  <Select
                    items={BROWSER_ITEMS}
                    value={s.defaults.cookies_from_browser ?? "none"}
                    onValueChange={(v) => setD("cookies_from_browser", v === "none" ? null : (v as string))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No login</SelectItem>
                      {["chrome", "firefox", "edge", "brave"].map((b) => (
                        <SelectItem key={b} value={b}>
                          {b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>Helps with “sign in to confirm you're not a bot”; with YT Music Premium, better source audio.</FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>
        </div>
      )}

      {s && (
        <div className="sticky bottom-4 flex justify-end">
          <Card size="sm" className="flex-row items-center gap-3 px-3 shadow-lg">
            <span className="text-sm text-muted-foreground">{dirty ? "Unsaved changes" : "All saved"}</span>
            <CardFooter className="gap-2 p-0">
              <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => setS(loaded.data)}>
                Discard
              </Button>
              <Button
                size="sm"
                disabled={!dirty || saving}
                onClick={async () => {
                  setSaving(true)
                  await api.saveSettings(s)
                  loaded.setData(s)
                  setSaving(false)
                  toast.success("Saved to .env")
                }}
              >
                {saving && <Loader2Icon className="animate-spin" />}
                Save
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </Page>
  )
}

function Secret({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <InputGroup>
      <InputGroupInput id={id} type={show ? "text" : "password"} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label={show ? "Hide" : "Show"} onClick={() => setShow(!show)}>
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
