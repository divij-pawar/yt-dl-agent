// Sample data shaped exactly like the backend's caches (songs/.cache/*.json, unsorted.json,
// imports/*.json, logs/run-*.log). Used until the HTTP API in api.ts is running.

import type {
  PlexReport,
  PlexResult,
  Collection,
  CollectionSummary,
  FailedSong,
  FixReport,
  ImportManifest,
  ImportResult,
  Job,
  LibrarySong,
  LogLine,
  LogRun,
  Preview,
  ProfilePlaylist,
  RunRecord,
  ServiceHealth,
  Settings,
  Track,
} from "./types"

const ytm = (artist: string, title: string) =>
  "https://music.youtube.com/search?q=" + encodeURIComponent(`${artist} ${title}`).replace(/%20/g, "+")

let seq = 0
function t(
  title: string,
  artist: string,
  album: string | null,
  duration_s: number,
  extra: Partial<Track> = {},
): Track {
  seq += 1
  const primary = artist.split(",")[0].trim()
  const folder = (extra.album_artist ?? primary).split(",")[0].trim()
  const name = extra.track_no ? `${String(extra.track_no).padStart(2, "0")} - ${title}` : title
  const status = extra.status ?? "done"
  return {
    title,
    artist,
    album,
    album_artist: null,
    track_no: null,
    duration_s,
    explicit: false,
    spotify_track_id: `trk${String(seq).padStart(19, "0")}`,
    album_id: null,
    year: null,
    cover_url: null,
    search_url: ytm(primary, title),
    video_id: status === "done" ? `vid${String(seq).padStart(8, "0")}` : null,
    file_path: status === "done" ? `${folder}/${album ?? "Singles"}/${name}.mp3` : null,
    status,
    error: null,
    ...extra,
  }
}

const NO_MATCH = (a: string, s: string) =>
  `No YouTube/YT Music result was close enough in title and duration (best score 31, need 45). Search: ${ytm(a, s)}`
const HTTP403 =
  "YouTube refused the download (HTTP 403 Forbidden). Usually temporary; rerun later, lower --workers, or update yt-dlp."

export const collections: Collection[] = [
  {
    kind: "playlist",
    spotify_id: "40R99ocNHdnFIcGTPT4ZB7",
    name: "Overnight",
    owner_or_artist: "Divij Pawar",
    source: "embed",
    tracks: [
      t("Clean", "The Japanese House", "Clean", 299, { year: 2015 }),
      t("Sweater Weather", "The Neighbourhood", "I Love You.", 240, { year: 2013 }),
      t("Space Song", "Beach House", "Depression Cherry", 320, { year: 2015 }),
      t("Myth", "Beach House", "Bloom", 258, { year: 2012 }),
      t("Only Love", "Ben Howard", "Every Kingdom", 251, { year: 2011 }),
      t("Dark Star", "Poliça", "Give You The Ghost", 291, { year: 2012 }),
      t("Pharmacist", "Alvvays", "Blue Rev", 158, { year: 2022 }),
      t("Tile By Tile", "Alvvays", "Blue Rev", 202, { year: 2022 }),
      t("I Wanna Be Yours", "Arctic Monkeys", "AM", 184, { year: 2013 }),
      t("Iron Lung", "Black Marble", "It's Immaterial", 236, { year: 2016 }),
      t("Playground Love", "Babyteeth", "Playground Love", 214),
      t("Once", "Parcels", "DayNight", 267, { year: 2021 }),
      t("Baarishein", "Anuv Jain", "Baarishein", 199, { year: 2019 }),
      t("CRT", "Alicks", "1997", 172),
      t("morning light", "Aaron Hibell", "morning light", 186),
      t("Lemon Glow", "Beach House", "7", 280, { year: 2018 }),
      t("Beyond Love", "Beach House", "Depression Cherry", 268, { year: 2015 }),
      t("Silver Soul", "Beach House", "Teen Dream", 299, { year: 2010 }),
      t("PPP", "Beach House", "Depression Cherry", 361, { year: 2015 }),
      t("Linger - Remastered", "Ben Malkinson", "Linger", 191),
      t("veil", "akiaura", "veil", 150),
    ],
  },
  {
    kind: "playlist",
    spotify_id: "48VKa8er36VggB0GUmQAFO",
    name: "Night Music",
    owner_or_artist: "Divij Pawar",
    source: "embed",
    tracks: [
      t("Clean", "The Japanese House", "Clean", 299),
      t("Sweater Weather", "The Neighbourhood", "I Love You.", 240),
      t(
        "Goodbye (feat. Lyse) - Vijay and Sofia Zlatko Remix",
        "Feder, Lyse, Sofia Zlatko, Vijay",
        "Goodbye (feat. Lyse) [The Complete Collection]",
        351,
      ),
      t("This Town", "Niall Horan", "This Town", 232),
      t("Magnetised - Acoustic", "Tom Odell", "Magnetised (Acoustic)", 236),
      t("Fade", "Alex Lustig", "Fade", 201),
      t("drown", "AVAION", "drown", 175),
      t("Other Side", "AVAION", "Selfreflection", 191),
      t("Late Night Drive", "Alx Beats", "Late Night Drive", 148),
      t("Nowhere", "Alx Beats", "Late Night Drive", 156),
      t("Fatal Flaw", "Anchor & Braille", "Songs for the Late Night Drive Home", 213),
      t("Keep Dancin'", "Anchor & Braille", "Songs for the Late Night Drive Home", 228),
      t("Lower East Side", "Anchor & Braille", "Songs for the Late Night Drive Home", 241),
      t("Midsummer Madness", "88rising", "Head In The Clouds", 263),
      t("Quiet Water", "92914", "The Calm Water", 183),
      t("Wanderlust", "AK", "Discovery", 201),
      t("Ozon", "AK", "Ozon", 222),
      t("Maya", "Alboe", "Maya", 199),
      t("Malx", "Alboe", "Enroute 24", 188, { status: "failed", error: NO_MATCH("Alboe", "Malx") }),
      t("SOLANA", "Alex LeMirage", "SOLANA", 147, { status: "failed", error: HTTP403 }),
      ...Array.from({ length: 80 }, (_, i) =>
        t(`Night track ${i + 21}`, ["Beach House", "Black Marble", "AVAION", "Aaron Hibell"][i % 4], null, 180 + i),
      ),
    ],
  },
  {
    kind: "album",
    spotify_id: "3WmujGwOS0ANHkJRnMH6n8",
    name: "Preacher's Daughter",
    owner_or_artist: "Ethel Cain",
    source: "embed",
    tracks: [
      "Family Tree (Intro)",
      "American Teenager",
      "A House in Nebraska",
      "Western Nights",
      "Family Tree",
      "Hard Times",
      "Thoroughfare",
      "Gibson Girl",
      "Ptolemaea",
      "August Underground",
      "Televangelism",
      "Sun Bleached Flies",
      "Strangers",
    ].map((title, i) =>
      t(title, "Ethel Cain", "Preacher's Daughter", 200 + i * 17, {
        track_no: i + 1,
        album_artist: "Ethel Cain",
        year: 2022,
      }),
    ),
  },
  {
    kind: "playlist",
    spotify_id: "2bZzJIJKDug8H0598aAq5a",
    name: "Jim '24 pt1",
    owner_or_artist: "Divij Pawar",
    source: "embed",
    tracks: [
      t("In Da Club", "50 Cent", "00s House Party", 193),
      t("Candy Shop", "50 Cent", "The Massacre", 209),
      t("Plain Jane", "A$AP Ferg", "Still Striving", 173),
      t("Babushka Boi", "A$AP Rocky", "Babushka Boi", 167),
      t("6IXSPEED", "7oh2", "6IXSPEED", 129),
      t("TAKA", "Ahadadream", "TAKA", 186),
      t("RAJA", "ARB4", "RAJA", 157),
      t("Levels - Radio Edit", "Avicii", "Levels", 199),
      t("Pump It", "Black Eyed Peas", "Monkey Business", 213),
    ],
  },
  {
    kind: "playlist",
    spotify_id: "1CTyXBTIyt9yCgfbxRHUcP",
    name: "Old School Party",
    owner_or_artist: "Divij Pawar",
    source: "embed",
    tracks: [
      t("Dancing Queen", "ABBA", "Arrival", 230),
      t("All That She Wants", "Ace of Base", "The Sign", 211),
      t("The Sign", "Ace of Base", "The Sign", 191),
      t("Barbie Girl", "Aqua", "Aquarium (Special Edition)", 197),
      t("Who Let The Dogs Out", "Baha Men", "Who Let The Dogs Out", 198),
      t("I Want It That Way", "Backstreet Boys", "Millennium", 213),
      t("Stayin' Alive - From Saturday Night Fever Soundtrack", "Bee Gees", "Tales From The Brothers Gibb", 285),
      t("Mr. Saxobeat - Radio Edit", "Alexandra Stan", "Saxobeats", 195),
    ],
  },
  {
    kind: "playlist",
    spotify_id: "0dJ3ahRDM8sL4DGZVIcSC5",
    name: "Desi tech",
    owner_or_artist: "Divij Pawar",
    source: "embed",
    tracks: [
      t("Jhanak Jhanak", "Blu Attic", "Resurface", 241),
      t("Aao Huzoor", "Aatma", "Aao Huzoor", 222),
      t("Saathi Re", "Aatma", "Indian Roadtrip", 238),
      t("Kaise", "Anyasa", "Athena EP", 245),
      t("Naina Tarse", "AFTERAll", "Naina Tarse", 201),
      t("Rukawat", "AFKAP", "Parat", 188, { status: "failed", error: NO_MATCH("AFKAP", "Rukawat") }),
    ],
  },
  {
    kind: "playlist",
    spotify_id: "6pVvi1wlzxuw6RQ8wJcibh",
    name: "Grunge Shoegaze",
    owner_or_artist: "Divij Pawar",
    source: "tavily",
    tracks: [
      t("Nutshell", "Alice In Chains", "Jar Of Flies", 259),
      t("I Miss You", "blink-182", "blink-182", 227),
      t("Dream On", "Aerosmith", "Aerosmith", 268),
    ],
  },
]

const playlistNames = [
  "2000s wave",
  "825bpm Gym",
  "Drive Music",
  "Jim '20",
  "Jim '22",
  "Jim '23 pt1",
  "Nostalgia",
  "Road trippp",
  "This was Cigarettes After Sex",
  "Vlog music",
  "deko neko",
  "desi low tech",
  "drain my veins",
  "evening cooking",
  "hard",
  "her dream",
  "meow",
  "night drive",
  "singing",
  "southern dream vibes",
  "stutter me now",
  "summer'23",
  "tech te",
]

function summarize(c: Collection, updated: string): CollectionSummary {
  return {
    kind: c.kind,
    spotify_id: c.spotify_id,
    name: c.name,
    owner_or_artist: c.owner_or_artist,
    source: c.source,
    total: c.tracks.length,
    done: c.tracks.filter((x) => x.status === "done").length,
    failed: c.tracks.filter((x) => x.status === "failed").length,
    m3u8: c.kind === "playlist" ? `${c.name}.m3u8` : null,
    updated,
    requeue: { link: [c.kind, c.spotify_id] },
  }
}

export const collectionSummaries: CollectionSummary[] = [
  ...collections.map((c, i) => summarize(c, `2026-10-0${6 - (i % 5)}T15:${10 + i}:00`)),
  ...playlistNames.map((name, i) => {
    const total = 12 + ((i * 7) % 60)
    const failed = i % 6 === 0 ? 1 : 0
    return {
      kind: "playlist" as const,
      spotify_id: `pl${String(i).padStart(20, "0")}`,
      name,
      owner_or_artist: "Divij Pawar",
      source: "embed" as const,
      total,
      done: total - failed,
      failed,
      m3u8: `${name}.m3u8`,
      updated: `2026-10-0${1 + (i % 5)}T1${i % 10}:20:00`,
      requeue: { link: ["playlist", `pl${String(i).padStart(20, "0")}`] as [ "playlist", string ] },
    }
  }),
]

export const librarySongs: LibrarySong[] = (() => {
  const byPath = new Map<string, LibrarySong>()
  for (const c of collections) {
    for (const tr of c.tracks) {
      if (tr.status !== "done" || !tr.file_path) continue
      const hit = byPath.get(tr.file_path)
      const ref = { spotify_id: c.spotify_id, name: c.name, kind: c.kind }
      if (hit) hit.in_collections.push(ref)
      else
        byPath.set(tr.file_path, {
          path: tr.file_path,
          track: tr,
          in_collections: [ref],
          format: ".mp3",
          imported: false,
          added: `2026-10-0${1 + (byPath.size % 6)}T1${byPath.size % 10}:${String(byPath.size % 60).padStart(2, "0")}:00`,
        })
    }
  }
  const imported = t("Kitida Navyane", "Aarya Ambekar", "Ti Saddhya Kay Karte (Original Motion Picture Soundtrack)", 274, {
    file_path: "Aarya Ambekar/Ti Saddhya Kay Karte (Original Motion Picture Soundtrack)/03 - Kitida Navyane.flac",
    track_no: 3,
    year: 2017,
  })
  byPath.set(imported.file_path!, { path: imported.file_path!, track: imported, in_collections: [], format: ".flac", imported: true, added: "2026-10-05T21:14:02" })
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
})()

export const profilePlaylists: ProfilePlaylist[] = [
  ...collectionSummaries.filter((c) => c.kind === "playlist").map((c) => ({ name: c.name, id: c.spotify_id })),
]

const now = "2026-10-06T16:02:00"

export const jobs: Job[] = [
  {
    id: "j1",
    label: "link         playlist 40R99ocNHdnFIcGTPT4ZB7",
    request: null,
    link: ["playlist", "40R99ocNHdnFIcGTPT4ZB7"],
    status: "done",
    note: "Up to date: all 21 songs already in the library",
    units: [{ kind: "playlist", id: "40R99ocNHdnFIcGTPT4ZB7", name: "Overnight" }],
    via: "link",
    unit_index: 1,
    progress: null,
    queued_at: "2026-10-06T15:59:37",
  },
  {
    id: "j2",
    label: "album        \"Bloom\" by Beach House",
    request: { kind: "album", artist: "Beach House", title: "Bloom" },
    link: null,
    status: "done",
    note: "",
    units: [{ kind: "album", id: "6YGBnmgnBTbwMqN6kD2Ghq", name: "Bloom" }],
    via: "model",
    unit_index: 1,
    progress: null,
    queued_at: "2026-10-06T16:00:10",
  },
  {
    id: "j3",
    label: "discography  Tame Impala (albums, EPs, singles)",
    request: { kind: "discography", artist: "Tame Impala", title: null },
    link: null,
    status: "working",
    note: "Tame Impala: 13 releases (4 albums, 2 eps, 7 singles)",
    units: [
      "Tame Impala",
      "Innerspeaker",
      "Lonerism",
      "Currents",
      "Currents B-Sides & Remixes",
      "The Slow Rush",
      "Borderline",
      "Lost in Yesterday",
      "Is It True",
      "Patience",
      "Breathe Deeper",
      "Wings of Time",
      "Deadbeat",
    ].map((name, i) => ({ kind: "album" as const, id: `alb${i}`, name })),
    via: "model",
    unit_index: 4,
    progress: {
      collection: "album 'Currents' by Tame Impala",
      source: "embed",
      total: 13,
      reused: 2,
      done: 6,
      failed: 0,
      phase: "downloading",
      recent: [
        { label: "Tame Impala - Let It Happen", ok: true },
        { label: "Tame Impala - Nangs", ok: true },
        { label: "Tame Impala - The Moment", ok: true, retry: "retry 1/2: YouTube refused the download (HTTP 403 Forbidden)" },
        { label: "Tame Impala - Yes I'm Changing", ok: true },
      ],
    },
    queued_at: "2026-10-06T16:01:02",
  },
  {
    id: "j4",
    label: "song         \"Sweater Weather\" by The Neighbourhood",
    request: { kind: "song", artist: "The Neighbourhood", title: "Sweater Weather" },
    link: null,
    status: "queued",
    note: "",
    units: [],
    via: "model",
    unit_index: 0,
    progress: null,
    queued_at: now,
  },
  {
    id: "j5",
    label: "top songs    Bon Iver",
    request: { kind: "top", artist: "Bon Iver", title: null },
    link: null,
    status: "queued",
    note: "",
    units: [],
    via: "model",
    unit_index: 0,
    progress: null,
    queued_at: now,
  },
  {
    id: "j6",
    label: "album        \"Depression Cherry Deluxe\" by Beach House",
    request: { kind: "album", artist: "Beach House", title: "Depression Cherry Deluxe" },
    link: null,
    status: "failed",
    note: "couldn't find \"Depression Cherry Deluxe\" by Beach House on Spotify",
    units: [],
    via: "explicit",
    unit_index: 0,
    progress: null,
    queued_at: "2026-10-06T15:40:31",
  },
]

export const importResult: ImportResult = {
  dry_run: true,
  files: 7,
  skipped_unchanged: 1,
  manifest: null,
  plans: [
    {
      src: "D:\\Music\\old\\Marathi\\03 Kitida Navyane.flac",
      status: "matched",
      dest: "Aarya Ambekar/Ti Saddhya Kay Karte (Original Motion Picture Soundtrack)/03 - Kitida Navyane.flac",
      replaced: null,
      reason: "",
      suggestion: "",
      guesses: [["Aarya Ambekar", "Kitida Navyane"]],
      model_guess: null,
      track: null,
    },
    {
      src: "D:\\Music\\old\\Arctic Monkeys - I Wanna Be Yours (Official Audio) [320kbps].flac",
      status: "better",
      dest: "Arctic Monkeys/AM/12 - I Wanna Be Yours.flac",
      replaced: "_Replaced/Arctic Monkeys/AM/I Wanna Be Yours.mp3",
      reason: "",
      suggestion: "",
      guesses: [["Arctic Monkeys", "I Wanna Be Yours"]],
      model_guess: null,
      track: null,
    },
    {
      src: "D:\\Music\\old\\Beach House - Space Song.mp3",
      status: "duplicate",
      dest: "Beach House/Depression Cherry/Space Song.mp3",
      replaced: null,
      reason: "",
      suggestion: "",
      guesses: [["Beach House", "Space Song"]],
      model_guess: null,
      track: null,
    },
    {
      src: "D:\\Music\\old\\tame impala-the less i know the better (live).mp3",
      status: "unsorted",
      dest: "_Unsorted/tame impala - the less i know the better (live).mp3",
      replaced: null,
      reason: "length doesn't match",
      suggestion:
        "Tame Impala - The Less I Know The Better (Spotify 216s, file 262s): https://open.spotify.com/track/6K4t31amVTZDgR3sKmwUJJ",
      guesses: [["tame impala", "the less i know the better (live)"]],
      model_guess: null,
      track: null,
    },
    {
      src: "D:\\Music\\old\\track01.wav",
      status: "unsorted",
      dest: "_Unsorted/track01.wav",
      replaced: null,
      reason: "no artist in the tags or file name, and the model couldn't tell",
      suggestion: "",
      guesses: [[null, "track01"]],
      model_guess: null,
      track: null,
    },
    {
      src: "D:\\Music\\old\\mithoon_darkhaast_www.songs.pk.mp3",
      status: "matched",
      dest: "Mithoon/Shivaay/Darkhaast.mp3",
      replaced: null,
      reason: "",
      suggestion: "",
      guesses: [],
      model_guess: ["Mithoon", "Darkhaast"],
      track: null,
    },
    {
      src: "D:\\Music\\old\\corrupt.m4a",
      status: "error",
      dest: null,
      replaced: null,
      reason: "Unexpected error: MP4StreamInfoError: no audio tracks",
      suggestion: "",
      guesses: [],
      model_guess: null,
      track: null,
    },
  ],
}

export const importManifests: ImportManifest[] = [
  {
    name: "20261005-211402",
    when: "2026-10-05T21:14:02",
    mode: "copy",
    undone: false,
    items: [
      { src: "D:\\Music\\phone\\Raabta.mp3", dest: "Pritam/Agent Vinod/Raabta.mp3", status: "matched", replaced: null },
      { src: "D:\\Music\\phone\\Ishq.m4a", dest: "Faheem Abdullah/Lost;Found/Ishq.m4a", status: "matched", replaced: null },
      { src: "D:\\Music\\phone\\voice memo 3.m4a", dest: "_Unsorted/voice memo 3.m4a", status: "unsorted", replaced: null },
    ],
  },
  {
    name: "20261002-180944",
    when: "2026-10-02T18:09:44",
    mode: "copy",
    undone: true,
    items: [{ src: "D:\\Downloads\\Kabira.mp3", dest: "Pritam/Yeh Jawaani Hai Deewani/Kabira (Encore).mp3", status: "matched", replaced: null }],
  },
]

export const unsorted = [
  {
    path: "_Unsorted/voice memo 3.m4a",
    src: "D:\\Music\\phone\\voice memo 3.m4a",
    reason: "no artist in the tags or file name, and the model couldn't tell",
    suggestion: "",
    guesses: [[null, "voice memo 3"]] as [string | null, string][],
    when: "2026-10-05T21:14:02",
  },
  {
    path: "_Unsorted/Hoobastank - The Reason.mp3",
    src: "D:\\Music\\phone\\Hoobastank - The Reason.mp3",
    reason: "length doesn't match",
    suggestion:
      "Hoobastank - The Reason (Spotify 232s, file 251s): https://open.spotify.com/track/5B5eTk7DF8KVp1zpQoY1XY",
    guesses: [["Hoobastank", "The Reason"]] as [string | null, string][],
    when: "2026-10-05T21:14:02",
  },
]

export const fixReport: FixReport = {
  dry_run: true,
  songs: 947,
  albums_corrected: 3,
  covers_set: 912,
  moved: 4,
  errors: 0,
  changes: [
    {
      old: "The Neighbourhood/Singles/Sweater Weather.mp3",
      new: "The Neighbourhood/I Love You/Sweater Weather.mp3",
      album: ["Singles", "I Love You."],
      cover: true,
      error: null,
    },
    {
      old: "Ethel Cain/Preacher's Daughter/Family Tree (Intro).mp3",
      new: "Ethel Cain/Preacher's Daughter/01 - Family Tree (Intro).mp3",
      album: null,
      cover: true,
      error: null,
    },
    {
      old: "Poliça/Shulamith/Dark Star.mp3",
      new: "Poliça/Give You The Ghost/Dark Star.mp3",
      album: ["Shulamith", "Give You The Ghost"],
      cover: true,
      error: null,
    },
    {
      old: "Tom Odell/Singles/Magnetised - Acoustic.mp3",
      new: "Tom Odell/Magnetised (Acoustic)/Magnetised - Acoustic.mp3",
      album: ["Singles", "Magnetised (Acoustic)"],
      cover: true,
      error: null,
    },
  ],
  unsorted_retry: null,
}

export const logRuns: LogRun[] = [
  { name: "run-20261006-160102.log", started: "2026-10-06T16:01:02", args: "chat", lines: 412, warnings: 3 },
  { name: "run-20261006-155937.log", started: "2026-10-06T15:59:37", args: "playlist 40R99ocNHdnFIcGTPT4ZB7", lines: 8, warnings: 1 },
  { name: "run-20261006-154031.log", started: "2026-10-06T15:40:31", args: "--ask \"album: Depression Cherry Deluxe - Beach House\"", lines: 37, warnings: 2 },
]

export const logLines: LogLine[] = [
  { time: "15:59:37,186", level: "INFO", thread: "MainThread", message: "args: {'urls': ['https://open.spotify.com/playlist/40R99ocNHdnFIcGTPT4ZB7'], 'workers': 4, 'bitrate': 320}" },
  { time: "15:59:37,600", level: "WARNING", thread: "MainThread", message: "Spotify API not available: the Spotify developer account that owns the app needs Premium (HTTP 403). After subscribing it can take a few hours to start working. Skipping it for the rest of this run." },
  { time: "15:59:37,600", level: "DEBUG", thread: "MainThread", message: "Spotify API raw error: Spotify API 403: Active premium subscription required for the owner of the app." },
  { time: "15:59:38,007", level: "INFO", thread: "MainThread", message: "playlist 'Overnight' by Divij Pawar: 21 tracks (from embed)" },
  { time: "15:59:38,017", level: "INFO", thread: "MainThread", message: "search links -> songs\\.cache\\40R99ocNHdnFIcGTPT4ZB7.links.txt" },
  { time: "15:59:38,019", level: "INFO", thread: "MainThread", message: "Up to date: all 21 songs already in the library; nothing to download" },
  { time: "15:59:38,020", level: "INFO", thread: "MainThread", message: "playlist file -> songs\\Overnight.m3u8" },
  { time: "15:59:38,021", level: "INFO", thread: "MainThread", message: "done 21/21, failed 0" },
  { time: "16:01:02,114", level: "INFO", thread: "queue", message: "=== job 3: discography  Tame Impala (albums, EPs, singles)" },
  { time: "16:01:19,402", level: "INFO", thread: "queue", message: "  Tame Impala release: 2015 Album Currents (79dL7FLiJFOO0EoehUHQBv)" },
  { time: "16:02:11,903", level: "INFO", thread: "ThreadPoolExecutor-3_0", message: "[Tame Impala - Let It Happen] matched pFptt7Cargc 'Let It Happen' / Tame Impala - Topic / 467s (spotify 467s), score 100" },
  { time: "16:02:14,551", level: "ERROR", thread: "ThreadPoolExecutor-3_2", message: "yt-dlp [Tame Impala - The Moment] ERROR: unable to download video data: HTTP Error 403: Forbidden" },
  { time: "16:02:14,552", level: "WARNING", thread: "ThreadPoolExecutor-3_2", message: "  retry 1/2 Tame Impala - The Moment: YouTube refused the download (HTTP 403 Forbidden). Usually temporary; rerun later, lower --workers, or update yt-dlp." },
  { time: "16:02:19,880", level: "INFO", thread: "queue", message: "ok Tame Impala - The Moment" },
]

export const health: ServiceHealth[] = [
  {
    id: "spotify",
    name: "Spotify API",
    state: "degraded",
    detail: "403: the app owner needs Premium. Using embed pages (playlists capped at 100 tracks).",
    fix: "Optional. Subscribe the developer account that owns the app to Premium; it can take a few hours to start working.",
  },
  { id: "tavily", name: "Tavily", state: "ok", detail: "API key valid" },
  { id: "ollama", name: "Ollama", state: "ok", detail: "llama3.2:latest at http://localhost:11434" },
  { id: "ffmpeg", name: "ffmpeg", state: "ok", detail: "on PATH" },
  { id: "js", name: "JS runtime", state: "ok", detail: "node v22.12.0 (deno not found)" },
  { id: "ytdlp", name: "yt-dlp", state: "ok", detail: "2026.08.19" },
  { id: "plex", name: "Plex", state: "ok", detail: "Library 'Music', 32 synced playlists" },
]

export const settings: Settings = {
  TAVILY_API_KEY: "tvly-••••••••••••3f9a",
  OLLAMA_HOST: "http://localhost:11434",
  OLLAMA_MODEL: "llama3.2:latest",
  SPOTIFY_CLIENT_ID: "",
  SPOTIFY_CLIENT_SECRET: "",
  PLEX_URL: "http://127.0.0.1:32400",
  PLEX_TOKEN: "yU8x2…9QkA",
  defaults: {
    out: "songs",
    workers: 4,
    bitrate: 320,
    links_only: false,
    no_playlist: false,
    no_album_lookup: false,
    limit: null,
    cookies_from_browser: null,
    yes: false,
    no_plex: false,
    log_dir: "logs",
  },
}

// --- run history (history.py) ------------------------------------------------------

function runFrom(
  c: Collection,
  started: string,
  { downloaded = 0, removed = [] as { title: string; artist: string }[], job = null as RunRecord["job"] } = {},
): RunRecord {
  let fresh = 0
  const tracks = c.tracks.map((tr) => {
    const outcome = tr.status === "failed" ? "failed" : fresh++ < downloaded ? "downloaded" : "reused"
    return {
      outcome: outcome as RunRecord["tracks"][number]["outcome"],
      title: tr.title,
      artist: tr.artist,
      album: tr.album,
      spotify_track_id: tr.spotify_track_id,
      file_path: tr.file_path,
      duration_s: tr.duration_s,
      error: tr.error,
      search_url: tr.search_url,
    }
  })
  const n = (o: string) => tracks.filter((x) => x.outcome === o).length
  return {
    id: `${started.replace(/[-:T]/g, "").slice(0, 8)}-${started.slice(11).replace(/:/g, "")}-000000-${c.spotify_id}`,
    started,
    finished: started.replace(/:(\d\d)$/, (_, s) => `:${String(Math.min(59, Number(s) + 40)).padStart(2, "0")}`),
    status: n("failed") ? "failed" : "ok",
    kind: c.kind,
    spotify_id: c.spotify_id,
    name: c.name,
    owner: c.owner_or_artist,
    source: c.source,
    options: { workers: 4, bitrate: 320 },
    log: "run-20261006-160102.log",
    job,
    counts: { total: tracks.length, downloaded: n("downloaded"), reused: n("reused"), failed: n("failed"), removed: removed.length },
    playlist_file: c.kind === "playlist" ? `${c.name}.m3u8` : null,
    error: null,
    requeue: { link: [c.kind, c.spotify_id] },
    tracks,
    removed,
  }
}

const [overnight, night, preachers, jim, oldSchool, desi] = collections

export const runs: RunRecord[] = [
  runFrom(desi, "2026-10-06T16:05:12", { downloaded: 2, job: { id: "j9", label: "link         playlist 0dJ3ahRDM8sL4DGZVIcSC5" } }),
  {
    ...runFrom(overnight, "2026-10-06T16:04:40"),
    id: "20261006-160440-000000-0000000000000000000000",
    status: "error",
    spotify_id: "0000000000000000000000",
    name: "0000000000000000000000",
    owner: null,
    source: null,
    playlist_file: null,
    error: "Unexpected error: couldn't get the track list from any source.",
    counts: { total: 0, downloaded: 0, reused: 0, failed: 0, removed: 0 },
    tracks: [],
    requeue: { link: ["playlist", "0000000000000000000000"] },
  },
  runFrom(preachers, "2026-10-06T16:02:30", { downloaded: 13, job: { id: "j2", label: "album        \"Preacher's Daughter\" by Ethel Cain" } }),
  runFrom(overnight, "2026-10-06T15:59:37", { job: { id: "j1", label: "link         playlist 40R99ocNHdnFIcGTPT4ZB7" } }),
  runFrom(night, "2026-10-05T22:14:03", {
    downloaded: 3,
    removed: [
      { title: "Somewhere Only We Know", artist: "Keane" },
      { title: "Electric Feel", artist: "MGMT" },
    ],
  }),
  runFrom(jim, "2026-10-05T19:40:51", { downloaded: 9 }),
  runFrom(oldSchool, "2026-10-04T21:02:10"),
]

export const failedSongs: FailedSong[] = collections.flatMap((c) =>
  c.tracks
    .filter((tr) => tr.status === "failed")
    .map((tr) => ({
      track: tr,
      error: tr.error,
      in_collections: [{ spotify_id: c.spotify_id, name: c.name, kind: c.kind, requeue: { link: [c.kind, c.spotify_id] as [typeof c.kind, string] } }],
      last_tried: "2026-10-06T16:05:12",
    })),
)

export function preview(kind: string, id: string): Preview {
  const c = collections.find((x) => x.spotify_id === id) ?? collections[0]
  return {
    kind: (["playlist", "album", "track", "artist"].includes(kind) ? kind : "playlist") as Preview["kind"],
    spotify_id: id,
    name: c.name,
    owner: c.owner_or_artist,
    cover_url: null,
    colors: { background: "rgb(15, 85, 139)", tinted: "rgb(0, 49, 100)", subdued: "rgb(153, 212, 255)" },
    year: kind === "album" ? 2022 : null,
    duration_s: c.tracks.reduce((s, t) => s + (t.duration_s ?? 0), 0),
    capped: c.tracks.length >= 100,
    downloaded_before: "2026-10-06T16:05:12",
    requeue: { link: [c.kind, c.spotify_id] },
    tracks: c.tracks.map((t, i) => ({
      title: t.title,
      artist: t.artist,
      album: t.album,
      duration_s: t.duration_s,
      explicit: t.explicit || i % 7 === 3,
      spotify_track_id: t.spotify_track_id,
      preview_url: null,
      in_library: i % 4 === 1 ? null : t.file_path,
      failed_before: t.status === "failed",
      error: t.error,
    })),
  }
}

/** plex.sync_all: most playlists already in Plex, a couple changed since the last sync. */
export function plexReport(dryRun: boolean, ids?: string[]): PlexReport {
  const base = collectionSummaries.filter((c) => c.kind === "playlist" && (!ids || ids.includes(c.spotify_id)))
  const results: PlexResult[] = base.map((c, i) => {
    const r = { spotify_id: c.spotify_id, name: c.name, songs: c.done, added: 0, removed: 0, missing: 0 }
    if (i === 0) return { ...r, action: dryRun ? "would_update" : "updated", added: 2, removed: 1,
      message: dryRun ? "would update: 2 to add, 1 to remove" : `updated: 2 added, 1 removed, ${c.done} songs` }
    if (i === 1) return { ...r, action: dryRun ? "would_create" : "created", added: c.done, missing: 1,
      message: `${dryRun ? "would create" : "created"} with ${c.done} songs (1 not in Plex yet)` }
    return { ...r, action: "up_to_date", message: `up to date (${c.done} songs)` }
  })
  return { library: "Music", dry_run: dryRun, results }
}

