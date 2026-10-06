export function duration(s: number | null | undefined): string {
  if (!s && s !== 0) return "–"
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`
}

export function when(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" }) +
        " " +
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

export const spotifyUrl = (kind: string, id: string) => `https://open.spotify.com/${kind}/${id}`
export const youtubeUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`

/** library.rel_path: folder is the album artist (or primary artist), album or "Singles". */
export function splitPath(p: string): { artist: string; album: string; file: string } {
  const [artist = "", album = "", ...rest] = p.split("/")
  return { artist, album, file: rest.join("/") }
}

/** "Artist - Title (Spotify 214s, file 230s): https://…" -> [text, url] */
export function splitSuggestion(s: string): [string, string | null] {
  const i = s.lastIndexOf(": https://")
  return i < 0 ? [s, null] : [s.slice(0, i), s.slice(i + 2)]
}
