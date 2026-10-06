import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"

/** Where the YouTube login (cookies) comes from: nothing, a cookies.txt file, or a browser. */
export interface LoginSource {
  cookies_from_browser: string | null
  cookies_file: string | null
}

const BROWSERS = ["firefox", "chrome", "edge", "brave", "opera"]
/** Chromium browsers lock their cookie database while open; Chrome on Windows also encrypts it for itself. */
export const UNRELIABLE = new Set(["chrome", "edge", "brave", "opera"])

export function LoginSelect({
  value,
  onChange,
  filePath,
  className,
}: {
  value: LoginSource
  onChange: (v: LoginSource) => void
  /** The cookies.txt path to use when "file" is picked (Settings knows it; the Options menu borrows it). */
  filePath: string | null
  className?: string
}) {
  // "" = file picked, path not typed yet: still the file option
  const current = value.cookies_file != null ? "file" : (value.cookies_from_browser ?? "none")
  const items = {
    none: "No login",
    file: "cookies.txt file",
    ...Object.fromEntries(BROWSERS.map((b) => [b, UNRELIABLE.has(b) ? `${b} (often fails on Windows)` : b])),
  }
  return (
    <Select
      items={items}
      value={current}
      onValueChange={(v) =>
        onChange(
          v === "none"
            ? { cookies_from_browser: null, cookies_file: null }
            : v === "file"
              ? { cookies_from_browser: null, cookies_file: filePath ?? "" }
              : { cookies_from_browser: v as string, cookies_file: null },
        )
      }
    >
      <SelectTrigger className={className ?? "w-full"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No login</SelectItem>
        <SelectItem value="file" disabled={filePath === null}>
          cookies.txt file {filePath === null ? "(set it up in Settings)" : "(recommended)"}
        </SelectItem>
        <SelectSeparator />
        {BROWSERS.map((b) => (
          <SelectItem key={b} value={b}>
            {items[b as keyof typeof items]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function UnreliableBrowserNote({ browser }: { browser: string | null }) {
  if (!browser || !UNRELIABLE.has(browser)) return null
  return (
    <p className="flex gap-1.5 text-xs text-warning">
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {browser} usually can't be read on Windows: it locks its cookies while it's open, and Chrome encrypts them so only
        Chrome can read them. Use a cookies.txt file or Firefox. If it fails, downloads carry on without a login.
      </span>
    </p>
  )
}

/** How to make the cookies.txt file. */
export function ExportSteps() {
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-foreground hover:underline [&[data-panel-open]>svg]:rotate-90">
        <ChevronRightIcon className="size-3.5 transition-transform" />
        How to make a cookies.txt file
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
          <li>
            Install a cookies.txt exporter in your browser, for example “Get cookies.txt LOCALLY” (Chrome, Edge) or “cookies.txt”
            (Firefox). Allow it in private windows.
          </li>
          <li>
            Open a <b>private/incognito</b> window and sign in to youtube.com there. (YouTube changes the cookies of normal tabs as
            you browse, which can make an export stop working.)
          </li>
          <li>On youtube.com, export the cookies in Netscape/cookies.txt format, then close the private window.</li>
          <li>
            Save the file somewhere private, e.g. <code>D:\Code\yt-dl-agent\cookies.txt</code> (it's kept out of git), and put
            its path here.
          </li>
          <li>Treat it like a password: it signs in as you. Export it again if the check below says it's expired.</li>
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}
