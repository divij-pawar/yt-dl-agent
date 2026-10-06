import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { SearchIcon } from "lucide-react"
import { NavLink, useLocation } from "react-router-dom"
import { Page } from "@/components/page"
import { PLAN, PlanStatusBadge } from "@/components/status"
import { Card, CardContent } from "@/components/ui/card"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import type { PlanStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

function Table({ head, rows, mono = 0 }: { head: string[]; rows: ReactNode[][]; mono?: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={cn("px-3 py-2 align-top", j < mono && "font-mono text-xs whitespace-nowrap")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const P = ({ children }: { children: ReactNode }) => <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
const Code = ({ children }: { children: ReactNode }) => <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
const Go = ({ to, children }: { to: string; children: ReactNode }) => (
  <NavLink to={to} className="font-medium text-foreground underline underline-offset-2">
    {children}
  </NavLink>
)

interface Section {
  id: string
  title: string
  keywords: string
  body: ReactNode
}

const SECTIONS: Section[] = [
  {
    id: "how-it-works",
    title: "How it works",
    keywords: "start overview pipeline spotify youtube mp3 match score",
    body: (
      <>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Ask", "Type an artist, album or song, or paste any Spotify link."],
            ["Confirm", "Check what it understood. The local model reads plain words; links and the exact form skip it."],
            ["Queue", "Jobs run one at a time in the background. Keep adding while it works."],
            ["Library", "320 kbps MP3s, tagged with cover art, in songs/Artist/Album/. Playlists get a .m3u8."],
          ].map(([t, d], i) => (
            <li key={t} className="space-y-1 rounded-lg border p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">{i + 1}</span>
                {t}
              </div>
              <p className="text-xs text-muted-foreground">{d}</p>
            </li>
          ))}
        </ol>
        <P>For every song:</P>
        <Table
          head={["Step", "What happens"]}
          rows={[
            ["Track list", "The Spotify API if it works, otherwise Spotify's embed page (first 100 tracks), otherwise Tavily."],
            ["Albums", "Read from each track's Spotify page; if that page won't load, a web search and the local model pick it. Cached."],
            ["Match", "The top 8 YouTube results are scored on title, artist, official channel and length (the strongest signal). Live, cover, remix and sped-up versions lose points. Below 45 points, YouTube Music is tried; still below, the song is skipped rather than downloading the wrong thing."],
            ["Download", "Best audio stream → 320 kbps MP3, tagged with Spotify's title, artist, album, track number, year and cover."],
          ]}
        />
      </>
    ),
  },
  {
    id: "requests",
    title: "Asking for music",
    keywords: "request chat discography album song top links profile exact form syntax",
    body: (
      <>
        <Table
          head={["You type", "It downloads"]}
          rows={[
            [<Code>Tame Impala discography</Code>, "All of the artist's albums, EPs and singles"],
            [<Code>all Lana Del Rey albums</Code>, "Albums and EPs, no singles"],
            [<Code>Currents by Tame Impala</Code>, "One album"],
            [<Code>Sweater Weather by The Neighbourhood</Code>, "One song (or the album, if that's what it turns out to be)"],
            [<Code>top songs of Frank Ocean</Code>, "The artist's 10 most popular tracks"],
            ["A Spotify link", "Playlist, album, track, artist (whole discography) or profile"],
          ]}
        />
        <P>
          One request per line; a line can hold several (<Code>Skinny Love and Holocene by Bon Iver</Code>). The <b>exact form</b> skips
          the model, so it works with Ollama off:
        </P>
        <Table
          head={["Exact form", "Means"]}
          mono={1}
          rows={[
            ["song: <title> - <artist>", "one song"],
            ["album: <title> - <artist>", "one album"],
            ["discography: <artist>", "albums, EPs and singles"],
            ["albums: <artist>", "albums and EPs"],
            ["top: <artist>", "the 10 most popular tracks"],
          ]}
        />
        <P>
          <b>Profile links</b> (<Code>open.spotify.com/user/…</Code>) list the public playlists shown on the profile; tick the ones you
          want, or filter by name. Private playlists, and ones hidden from the profile, need their own link.
        </P>
        <P>
          <b>Discographies</b> come from the artist's Spotify pages, which load lazily, so a very prolific artist can come back
          incomplete; the job's note says how many releases it found. Releases where the artist is only featured are skipped.
        </P>
      </>
    ),
  },
  {
    id: "queue",
    title: "The queue, syncing and retries",
    keywords: "queue sync rerun retry failed removed duplicates 100 cap up to date",
    body: (
      <>
        <P>
          Jobs run <b>one at a time, in order</b>. Inside a job, up to 4 songs download in parallel (change it under Options). A
          discography is one job with a unit per release.
        </P>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            <b>Nothing is downloaded twice.</b> Songs already in the library, from any playlist or album and under any file name, are
            reused (matched by Spotify ID, or artist + title with a length check so an extended mix isn't mistaken for the original).
          </li>
          <li>
            <b>Sync = run it again.</b> On <Go to="/playlists">Playlists & albums</Go>, Sync re-reads the list from Spotify (one quick
            request) and downloads only what's new. Songs removed on Spotify drop out of the .m3u8; their MP3s stay, since other
            playlists may use them.
          </li>
          <li>
            <b>Failed songs are retried</b> on the next sync. A YouTube 403 is common and usually temporary; each song is already
            retried twice. See <a href="#history" className="font-medium text-foreground underline underline-offset-2">History and retrying failed songs</a>.
          </li>
          <li>
            <b>100-track cap.</b> Without working Spotify API access, only a playlist's first 100 tracks are visible. See{" "}
            <Go to="/settings">Settings</Go>.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "history",
    title: "History and retrying failed songs",
    keywords: "history runs previous downloaded skipped reused already failed retry requeue again log",
    body: (
      <>
        <P>
          <Go to="/history">History</Go> records every run of a playlist, album or song (from this page, chat or the command line),
          song by song:
        </P>
        <Table
          head={["In a run", "Means"]}
          rows={[
            [<span className="font-medium text-success">Downloaded</span>, "Fetched from YouTube in this run."],
            [<span className="font-medium">Already in library</span>, "Downloaded before (by this or another playlist or album), so it was skipped. The playlist file points at the existing MP3."],
            [<span className="font-medium text-destructive">Failed</span>, "Couldn't be downloaded; the reason is shown. It's tried again next time the playlist runs."],
            [<span className="font-medium">Removed</span>, "No longer on the Spotify list since the previous run. The MP3 is kept."],
            [<span className="font-medium text-destructive">Run failed</span>, "The run couldn't start, e.g. the track list couldn't be read. The reason is shown, with Run again."],
          ]}
        />
        <P>
          Open a run for the full lists, its log, and <b>Retry failed songs</b>. On the queue, <b>Details</b> on a finished job shows the
          runs it made. Runs from before History existed are rebuilt from their <Go to="/logs">logs</Go> the first time History opens
          (marked “rebuilt from its log”).
        </P>
        <P>
          <b>Downloaded songs</b> (the second tab) lists every song in the library by the day its file arrived, newest first, including
          songs downloaded before there were any logs.
        </P>
        <P>
          <b>Failed songs</b> (in the sidebar, or the Failed filter on <Go to="/library?show=failed">Songs</Go>) lists every song that
          failed somewhere and still isn't in the library. Open one to see why, then <b>Run “playlist” again</b> (only missing and
          failed songs are fetched, and its playlist file is updated) or <b>Download just this song</b>. <b>Retry all failed</b> re-runs
          every playlist and album that has a failure. If YouTube asked for a sign-in, set “YouTube login from” in Settings first.
        </P>
      </>
    ),
  },
  {
    id: "preview",
    title: "Preview a Spotify list before downloading",
    keywords: "preview spotify playlist album artist songs before download select new library listen",
    body: (
      <>
        <P>
          Paste a playlist, album, song or artist link and its preview opens straight away (setting <b>Preview Spotify links
          first</b>, on by default; turn it off in <Go to="/settings">Settings</Go> or under the request box). With it off, press{" "}
          <b>Preview</b> in “I understood”, or choose “Preview it first” in{" "}
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
          . Profile playlists have a preview link in the picker, and downloaded playlists have <b>What's new on Spotify</b>.
        </P>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>It shows the list as it is on Spotify now, with every song marked <b>In library</b>, <b>New</b> or <b>Failed before</b>.</li>
          <li>
            The round button downloads the list: only the new songs are fetched. Or tick songs and use <b>Download selected</b>; those
            are filed under their own albums.
          </li>
          <li>Hover a number to play Spotify's 30-second preview. “Only songs not in my library” hides what you already have.</li>
          <li>For an artist it shows their top songs, with a button for the whole discography.</li>
          <li>Previewing reads Spotify's public embed page only: no Tavily credits, nothing downloaded.</li>
        </ul>
      </>
    ),
  },
  {
    id: "files",
    title: "Where files go",
    keywords: "folders naming output songs m3u8 singles track numbers cache",
    body: (
      <>
        <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">{`songs/
├── Overnight.m3u8                 playlists only: relative paths, original order
├── Ethel Cain/
│   └── Preacher's Daughter/
│       └── 01 - Family Tree (Intro).mp3
├── Parcels/DayNight/Once.mp3      no track number when the source has none
├── Tame Impala/Singles/…          songs with no known album
├── _Unsorted/                     imports without a confident match
├── _Replaced/                     older copies an import or fix replaced (never deleted)
└── .cache/                        track lists, search links, album lookups, the library index`}</pre>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>Folders use the album artist, or the primary artist (“Artist A, Artist B” → Artist A).</li>
          <li>
            Characters Windows doesn't allow are removed (<Code>Day/Night</Code> → <Code>DayNight</Code>); names are capped at 100
            characters.
          </li>
          <li>Tags come from Spotify, not YouTube. Deleted an MP3 by hand? The next sync downloads it again.</li>
        </ul>
      </>
    ),
  },
  {
    id: "options",
    title: "Run options",
    keywords: "options flags workers bitrate links only playlist album lookup limit cookies browser login defaults",
    body: (
      <>
        <P>
          Set per request from <b>Options</b> under the request box. Defaults for every run (web and command line) live in{" "}
          <Go to="/settings">Settings</Go>.
        </P>
        <Table
          head={["Option", "Command line", "Meaning"]}
          mono={0}
          rows={[
            ["Parallel downloads", <Code>--workers 4</Code>, "1 = one at a time. Much higher risks YouTube throttling."],
            ["MP3 bitrate", <Code>--bitrate 320</Code>, "320 is the MP3 maximum. YouTube audio is ~130–160 kbps Opus, so the MP3 can't beat the source."],
            ["Download audio", <Code>--links-only</Code>, "Off = only write the YouTube Music search links (.cache/<id>.links.txt)."],
            ["Write playlist files", <Code>--no-playlist</Code>, "The .m3u8 for playlists."],
            ["Look up albums", <Code>--no-album-lookup</Code>, "Off = songs without an album go to Artist/Singles/. Saves Tavily credits."],
            ["Only first N tracks", <Code>--limit N</Code>, "For trying a playlist out."],
            ["YouTube login from", <Code>--cookies-from-browser chrome</Code>, "Uses your browser's YouTube login: gets past bot checks, and better audio with YT Music Premium."],
          ].map(([a, b, c]) => [<span className="font-medium">{a}</span>, b, c])}
        />
      </>
    ),
  },
  {
    id: "import",
    title: "Import, Unsorted and Undo",
    keywords: "import files folders flac unsorted undo replaced duplicate better quality",
    body: (
      <>
        <P>
          <Go to="/import">Import files</Go> identifies your own files on Spotify from their tags, file name and folder names, gives them
          proper tags and cover art, and <b>copies</b> them into the library. Originals are never changed, and formats are kept.{" "}
          <b>Preview</b> first: nothing changes until you import.
        </P>
        <Table
          head={["Result", "Means"]}
          rows={(Object.keys(PLAN) as PlanStatus[]).map((s) => [<PlanStatusBadge status={s} />, PLAN[s].help])}
        />
        <P>
          Fix an <Go to="/unsorted">unsorted</Go> file by correcting its tags or renaming it to <Code>Artist - Title</Code>, then run{" "}
          <Go to="/fix">Fix library</Go>, which retries them all. Every import can be undone from its history: copied files are removed
          and replaced copies come back from _Replaced/.
        </P>
      </>
    ),
  },
  {
    id: "fix",
    title: "Fix library",
    keywords: "fix albums covers retag rename move unsorted",
    body: (
      <P>
        <Go to="/fix">Fix library</Go> brings every known song up to the current standard: re-reads albums from Spotify (replacing the
        model's guesses), sets Spotify's cover, year, track number and album artist, renames or moves files whose correct place changed,
        and updates the index and every playlist file to match. Then it retries <Code>_Unsorted/</Code>. Preview shows exactly what
        would change. It uses Tavily credits for album lookups, which are cached afterwards.
      </P>
    ),
  },
  {
    id: "model",
    title: "Where the local model is used",
    keywords: "ollama llama model ai llm fallback",
    body: (
      <>
        <P>
          A small model in Ollama (llama3.2 by default) does only fuzzy text jobs: understanding plain-words requests, reading messy
          file names on import, and two fallbacks (reading a track list when the page layout changed, and picking an album from search
          snippets). Everything else (finding, matching, naming, de-duplicating) is plain code.
        </P>
        <P>
          Because a small model sometimes misreads a request, requests are shown for confirmation before they're queued. Without Ollama
          nothing breaks: use links or the exact form, and songs that needed the album fallback go to Singles/.
        </P>
      </>
    ),
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    keywords: "error problem 403 forbidden 429 premium no confident match ollama ffmpeg node deno bot sign in throttling",
    body: (
      <Table
        head={["You see", "What to do"]}
        rows={[
          ["Spotify API … needs Premium (HTTP 403)", "The developer account that owns the Spotify app needs Premium. Everything still works without it; playlists are capped at 100 tracks."],
          ["Only the first 100 tracks", "Same cause: needs working Spotify API access."],
          ["no confident match", "Neither YouTube nor YouTube Music had a result close enough in title and length: usually a very obscure or region-locked track. Each failed song links to its YouTube Music search."],
          ["YouTube refused the download (HTTP 403)", "Usually temporary and retried automatically. If it keeps failing, sync again later or lower Parallel downloads."],
          ["Lots of failures at once / HTTP 429", "YouTube throttling: lower Parallel downloads to 2, wait a while, or update yt-dlp."],
          ["YouTube wants a sign-in (bot check)", "Set “YouTube login from” to your browser in Options or Settings."],
          ["JS runtime / challenge errors", "Install Node.js or Deno and make sure it's on PATH (see Services in Settings)."],
          ["Ollama isn't reachable", "Start Ollama, and check the host and that the model is pulled (Settings → Services)."],
          ["Wrong album folder", "That album came from the search fallback. Run Fix library, which re-reads albums from Spotify."],
        ].map(([a, b]) => [<span className="font-medium">{a}</span>, b])}
      />
    ),
  },
  {
    id: "command-line",
    title: "Command line",
    keywords: "cli command line terminal serve chat ask import fix undo dry run",
    body: (
      <>
        <P>Everything here is also available from a terminal in the project folder (with the venv active):</P>
        <Table
          head={["Command", "Does"]}
          mono={1}
          rows={[
            ["yt-dl-agent serve", "this web UI on http://127.0.0.1:8765 (--port to change)"],
            ["yt-dl-agent <spotify link> …", "download playlists, albums, tracks, artists or profiles"],
            ["yt-dl-agent", "chat mode: type requests in plain words"],
            ['yt-dl-agent --ask "Tame Impala discography"', "queue requests without confirming; exits when done"],
            ["yt-dl-agent <profile link> --list", "list a profile's playlists (--match TEXT to pick some)"],
            ['yt-dl-agent import "D:\\Music\\old" --dry-run', "preview an import (drop --dry-run to import)"],
            ["yt-dl-agent import --undo", "reverse the last import"],
            ["yt-dl-agent fix --dry-run", "preview Fix library"],
          ]}
        />
      </>
    ),
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    keywords: "keyboard shortcuts keys ctrl k enter",
    body: (
      <Table
        head={["Keys", "Does"]}
        rows={[
          [<KbdGroup><Kbd>Ctrl</Kbd><Kbd>K</Kbd></KbdGroup>, "Request something or jump anywhere, from any page"],
          [<Kbd>Enter</Kbd>, "In the request box: read the request"],
          [<KbdGroup><Kbd>Shift</Kbd><Kbd>Enter</Kbd></KbdGroup>, "In the request box: new line (one request per line)"],
          [<KbdGroup><Kbd>Ctrl</Kbd><Kbd>B</Kbd></KbdGroup>, "Collapse or expand the sidebar"],
        ]}
      />
    ),
  },
]

export function HelpPage() {
  const [q, setQ] = useState("")
  const { hash } = useLocation()
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return SECTIONS.filter((s) => words.every((w) => `${s.title} ${s.keywords}`.toLowerCase().includes(w)))
  }, [q])

  const first = useRef(true)
  useEffect(() => {
    // Opening /help#topic jumps straight there (after layout); clicks inside the page scroll smoothly.
    const behavior = first.current ? "instant" : "smooth"
    first.current = false
    if (!hash) return
    const id = requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior, block: "start" }))
    return () => cancelAnimationFrame(id)
  }, [hash])

  return (
    <Page title="Help & docs" description="How requests, the queue, the library and the tools work, and what to do when something goes wrong.">
      <div className="grid gap-6 lg:grid-cols-[13rem_1fr]">
        <nav className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput placeholder="Search help" value={q} onChange={(e) => setQ(e.target.value)} />
          </InputGroup>
          <ul className="flex flex-wrap gap-1 lg:flex-col">
            {shown.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className={cn(
                    "block rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                    hash === `#${s.id}` && "bg-muted text-foreground",
                  )}
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-6">
          {shown.length === 0 && <P>No help topics match “{q}”.</P>}
          {shown.map((s) => (
            <Card key={s.id} id={s.id} className="scroll-mt-20">
              <CardContent className="space-y-3">
                <h2 className="text-lg font-semibold">{s.title}</h2>
                {s.body}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Page>
  )
}
