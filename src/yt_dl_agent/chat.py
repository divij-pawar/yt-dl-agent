"""Chat mode: say what you want in plain words; it's parsed, confirmed, queued and downloaded one by one.

  > Tame Impala discography
  > Currents by Tame Impala
  > Sweater Weather by The Neighbourhood, and the top songs of Bon Iver

Each line goes to the small model (llm.parse_request) unless it's a Spotify link or uses the explicit
"kind: title - artist" syntax. Requests are resolved to Spotify albums/tracks by catalog.py and run
by a background worker, one at a time, so you can keep typing while it downloads.
"""

import queue
import re
import textwrap
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime

from rich.markup import escape

from . import catalog, llm, log, lookup, sources, spotify_url
from .match import norm
from .models import Collection, Track

HELP = """Type what you want, one request per line, for example:
  Tame Impala discography          (albums, EPs and singles)
  all Lana Del Rey albums          (albums and EPs only)
  Currents by Tame Impala          (one album)
  Sweater Weather by The Neighbourhood
  top songs of Bon Iver
  https://open.spotify.com/...     (playlist, album, track, artist or profile links)
Without the model, use:  song: <title> - <artist>   album: <title> - <artist>
                         discography: <artist>       albums: <artist>      top: <artist>
Library:   import <file or folder>   (identify, tag and file your own songs)
           fix                       (album art, albums, track numbers for the whole library)
           plex                      (create/update your playlists in Plex)
Commands:  queue  (what's queued / running / done)   help   quit"""

_EXPLICIT = re.compile(r"^\s*(song|track|album|discography|albums|top)\s*:\s*(.+?)\s*$", re.I)
_LINK = re.compile(r"https?://open\.spotify\.com/\S+|spotify:[a-z]+:\S+")
_DISCOGRAPHY_KINDS = {"discography": ("Album", "EP", "Single"), "albums": ("Album", "EP")}


@dataclass
class Job:
    label: str
    request: llm.Request | None = None
    link: tuple[str, str] | None = None  # (kind, id) for pasted links
    status: str = "queued"  # queued | working | done | failed
    note: str = ""
    units: list = field(default_factory=list)
    # For the web UI (server.py); the CLI ignores these.
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:10])
    via: str = ""  # link | explicit | model
    options: dict | None = None  # run flags for this job
    unit_index: int = 0  # 1-based, the unit running now
    names: dict = field(default_factory=dict)  # unit id -> release/playlist name
    queued_at: str = field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))


def describe(r: llm.Request) -> str:
    return {
        "song": f'song         "{r.title}" by {r.artist}',
        "album": f'album        "{r.title}" by {r.artist}',
        "discography": f"discography  {r.artist} (albums, EPs, singles)",
        "albums": f"albums       {r.artist} (albums and EPs)",
        "top": f"top songs    {r.artist}",
    }[r.kind]


def _explicit(line: str) -> llm.Request | None:
    if not (m := _EXPLICIT.match(line)):
        return None
    kind, rest = m.group(1).lower(), m.group(2)
    kind = "song" if kind == "track" else kind
    if kind in ("song", "album"):
        title, sep, artist = rest.rpartition(" - ")
        return llm.Request(kind=kind, title=title.strip(), artist=artist.strip()) if sep else None
    return llm.Request(kind=kind, artist=rest)


def parse_line(line: str) -> list[Job]:
    """One line of input -> jobs. Links and explicit syntax skip the model."""
    jobs = []
    for url in _LINK.findall(line):
        try:
            kind, sid = spotify_url.parse(url)
            jobs.append(Job(label=f"link         {kind} {sid}", link=(kind, sid)))
        except ValueError as e:
            log.warn(str(e))
    rest = _LINK.sub("", line).strip(" ,;")
    if not rest:
        return jobs
    if req := _explicit(rest):
        return jobs + [Job(label=describe(req), request=req)]
    try:
        reqs = llm.parse_request(rest)
    except Exception as e:  # noqa: BLE001 - tell the user how to proceed without the model
        log.warn(f"Couldn't understand that: {log.explain(e)}")
        log.say("You can still paste Spotify links or use 'album: <title> - <artist>' style requests.")
        log.exception("parse_request failed")
        return jobs
    if not reqs:
        log.warn("Couldn't find any artist, album or song in that. Try e.g. 'Currents by Tame Impala'.")
    unique = {(r.kind, norm(r.artist), norm(r.title or "")): r for r in reqs}  # the model repeats itself
    return jobs + [Job(label=describe(r), request=r) for r in unique.values()]


# --- resolving a job into units of work -------------------------------------
# A unit is ("playlist"|"album"|"track"|"artist", spotify id) or ("bare", Track) for songs Spotify
# search couldn't find; those are matched on YouTube by title and artist only.


def _song(r: llm.Request, job: Job) -> list:
    if tid := catalog.find_track(r.title, r.artist):
        return [("track", tid)]
    if found := catalog.find_album(r.title, r.artist):
        job.note = f'no song called "{r.title}", but found the album "{found[0]}"'
        job.names[found[1]] = found[0]
        return [("album", found[1])]
    job.note = "not found on Spotify; searching YouTube by title and artist only"
    return [("bare", Track(title=r.title, artist=r.artist))]


def _album(r: llm.Request, job: Job) -> list:
    if found := catalog.find_album(r.title, r.artist):
        if norm(found[0]) != norm(r.title):
            job.note = f'using "{found[0]}"'
        job.names[found[1]] = found[0]
        return [("album", found[1])]
    if tid := catalog.find_track(r.title, r.artist):
        job.note = f'no album called "{r.title}", but found the song'
        return [("track", tid)]
    raise LookupError(f'couldn\'t find "{r.title}" by {r.artist} on Spotify')


def _artist(r: llm.Request, job: Job) -> list:
    found = catalog.find_artist(r.artist)
    if not found:
        raise LookupError(f"couldn't find the artist {r.artist!r} on Spotify")
    name, aid = found
    if r.kind == "top":
        return [("artist", aid)]
    wanted = _DISCOGRAPHY_KINDS[r.kind]
    releases = catalog.own_releases(name, [rel for rel in catalog.artist_releases(aid) if rel.kind in wanted])
    if not releases:
        raise LookupError(f"couldn't load {name}'s releases from Spotify (try again in a bit)")
    counts = ", ".join(f"{sum(rel.kind == k for rel in releases)} {k.lower()}s" for k in wanted
                       if any(rel.kind == k for rel in releases))
    job.note = f"{name}: {len(releases)} releases ({counts})"
    for rel in releases:
        log.detail(f"  {name} release: {rel.year} {rel.kind} {rel.name} ({rel.id})", log.INFO)
        job.names[rel.id] = rel.name
    return [("album", rel.id) for rel in releases]


def expand(job: Job) -> list:
    if job.link:
        kind, sid = job.link
        if kind in ("import", "fix", "plex"):
            return [(kind, sid)]
        if kind == "user":
            playlists = sources.user_playlists(sid)
            job.names.update({pid: name for name, pid in playlists})
            return [("playlist", pid) for _, pid in playlists]
        if kind == "top":  # an artist's top tracks (the web UI re-runs "artist" collections this way)
            return [("artist", sid)]
        if kind == "tracks":  # comma-separated track IDs: songs picked from a playlist preview in the web UI
            return [("track", tid) for tid in sid.split(",") if tid]
        if kind == "albums":  # comma-separated album IDs: releases ticked in the "I understood" step
            return [("album", aid) for aid in sid.split(",") if aid]
        if kind == "artist":  # an artist link means their discography
            name = sources.embed_entity("artist", sid)["name"]
            return _artist(llm.Request(kind="discography", artist=name), job)
        return [(kind, sid)]
    r = job.request
    return {"song": _song, "album": _album}.get(r.kind, _artist)(r, job)


# --- the queue ---------------------------------------------------------------


class DownloadQueue:
    def __init__(self, run_unit):
        self.run_unit = run_unit  # (kind, id_or_track) -> None
        self.jobs: list[Job] = []
        self.current: Job | None = None  # the job being worked on
        self._q: queue.Queue[Job] = queue.Queue()
        threading.Thread(target=self._work, name="queue", daemon=True).start()

    def add(self, job: Job) -> None:
        self.jobs.append(job)
        self._q.put(job)

    def busy(self) -> bool:
        return any(j.status in ("queued", "working") for j in self.jobs)

    def wait(self) -> None:
        self._q.join()

    def show(self) -> None:
        if not self.jobs:
            log.say("The queue is empty.")
        for i, j in enumerate(self.jobs, 1):
            colour = {"queued": "dim", "working": "cyan", "done": "green", "failed": "red"}[j.status]
            note = f" - {j.note}" if j.note else ""
            log.say(f"  {i:2}. [{colour}]{j.status:7}[/] {j.label.strip()}{note}")

    def _work(self) -> None:
        while True:
            job = self._q.get()
            job.status, self.current = "working", job
            n = self.jobs.index(job) + 1
            log.console.rule(f"[{n}/{len(self.jobs)}] {job.label.strip()}")
            log.detail(f"=== job {n}: {job.label.strip()}", log.INFO)
            try:
                job.units = expand(job)
                if job.note:
                    log.say(f"[cyan]{job.note}[/]")
                failed, last_error = 0, ""
                for i, unit in enumerate(job.units, 1):
                    job.unit_index = i
                    if len(job.units) > 1:
                        log.say(f"[bold]({i}/{len(job.units)})[/]")
                    try:
                        self.run_unit(*unit)
                    except Exception as e:  # noqa: BLE001 - one bad album shouldn't stop the rest
                        failed += 1
                        last_error = log.explain(e)
                        log.say(f"[red]error[/] {last_error}", log.WARNING)
                        log.exception(f"unit {unit} failed")
                job.status = "failed" if failed == len(job.units) else "done"
                if failed and failed == len(job.units):  # say why, not just "failed"
                    job.note = (job.note + "; " if job.note else "") + last_error
                elif failed:
                    job.note = (job.note + "; " if job.note else "") + f"{failed} of {len(job.units)} failed"
            except Exception as e:  # noqa: BLE001 - report and move on to the next job
                job.status, job.note = "failed", log.explain(e) if not isinstance(e, LookupError) else str(e)
                log.say(f"[red]couldn't do[/] {job.label.strip()}: {job.note}", log.WARNING)
                log.exception(f"job {job.label} failed")
            finally:
                self.current = None
                self._q.task_done()
                if not self.busy():
                    log.say("[green]Queue finished.[/] Type more, or 'quit'.")


# --- "I understood": what each request points at ------------------------------


def _show_details(d: dict) -> None:
    head = f"{d['name']}" + (f" by {d['subtitle']}" if d.get("subtitle") else "") + (f" ({d['year']})" if d.get("year") else "")
    log.say(f"  [bold]{escape(head)}[/]" + (f" [dim]{d['track_count']} songs[/]" if d.get("track_count") else ""))
    if d.get("bio"):
        for line in textwrap.wrap(d["bio"], 96)[:3]:
            log.say(f"    [dim]{escape(line)}[/]")
        if len(d["bio"]) > 290:
            log.say("    [dim]...[/]")
    if d.get("image_url"):
        log.say(f"    [dim]photo: {escape(d['image_url'])}[/]")
    for i, r in enumerate(d["releases"], 1):
        log.say(f"    {i:3}. {r['year'] or '----'}  {r['kind']:<6} {escape(r['name'])}")


def _numbers(text: str, n: int) -> set[int] | None:
    """'2,5,7-9' -> {2, 5, 7, 8, 9} (1-based); None if it isn't that."""
    out = set()
    for part in text.replace(" ", "").split(","):
        lo, _, hi = part.partition("-")
        if not (lo.isdigit() and (not hi or hi.isdigit())):
            return None
        out.update(range(int(lo), int(hi or lo) + 1))
    return out if out and max(out) <= n and min(out) >= 1 else None


def pick_releases(answer: str, n: int) -> list[int] | None:
    """The answer to "which releases?" -> 0-based indexes to keep. Enter/all = everything,
    'skip 2,5' drops those, 'only 1-4' keeps those. None if it wasn't understood."""
    a = answer.strip().lower()
    if a in ("", "all", "y", "yes"):
        return list(range(n))
    word, _, rest = a.partition(" ")
    if word in ("none", "no", "n"):
        return []
    if word in ("skip", "not", "except", "only") and (nums := _numbers(rest, n)):
        return [i for i in range(n) if (i + 1 in nums) == (word == "only")]
    return None


def review(job: Job, ask_which: bool) -> Job | None:
    """Show what the job points at; for discographies let the user drop releases. Returns the job to queue
    (narrowed when some were dropped), or None when nothing is left. Lookup failures leave the job as it was."""
    try:
        d = lookup.details(job.request, job.link)
    except Exception as e:  # noqa: BLE001 - the details are a nicety; the job still runs without them
        log.say(f"  [dim]{escape(job.label.strip())}: no details ({escape(log.explain(e))})[/]")
        log.exception("lookup failed")
        return job
    if not d:
        return job
    _show_details(d)
    rels = d["releases"]
    if not rels or not ask_which:
        return job
    while True:
        try:
            keep = pick_releases(input(f"  Which of these {len(rels)}? [Enter = all, 'skip 2,5', 'only 1-4', 'none'] "), len(rels))
        except EOFError:
            keep = list(range(len(rels)))
        if keep is not None:
            break
        log.say("  Say e.g. 'skip 2,5' or 'only 1-4'.")
    if len(keep) == len(rels):
        return job
    if not keep:
        return None
    picked = [rels[i] for i in keep]
    narrowed = Job(label=f"albums       {d['name']} ({len(picked)} of {len(rels)} releases)",
                   link=("albums", ",".join(r["id"] for r in picked)), via=job.via)
    narrowed.names = {r["id"]: r["name"] for r in picked}
    narrowed.note = f"{d['name']}: {len(picked)} releases"
    return narrowed


def _confirm(prompt: str) -> bool:
    try:
        return input(f"{prompt} [Y/n] ").strip().lower() in ("", "y", "yes")
    except EOFError:
        return True


def chat(run_unit, auto_yes: bool = False) -> None:
    q = DownloadQueue(run_unit)
    log.say("[bold]yt-dl-agent chat[/]")
    log.say(HELP)
    while True:
        try:
            line = input("\n> ").strip()
        except (EOFError, KeyboardInterrupt):
            line = "quit"
        if not line:
            continue
        log.detail(f"user: {line}", log.INFO)
        cmd = line.lower()
        if cmd in ("quit", "exit", "q"):
            if q.busy() and _confirm("Downloads are still queued. Wait for them to finish?"):
                log.say("Waiting for the queue to finish (Ctrl+C to stop now)...")
                try:
                    q.wait()
                except KeyboardInterrupt:
                    log.warn("Stopped. Rerun the same requests later to finish them.")
            return
        if cmd in ("help", "?"):
            log.say(HELP)
            continue
        if cmd in ("queue", "status", "q?"):
            q.show()
            continue

        if cmd.startswith("import "):  # library tools go through the same queue
            path = line[len("import "):].strip().strip('"')
            q.add(Job(label=f"import       {path}", link=("import", [path])))
            log.say("Queued the import.")
            continue
        if cmd == "plex":
            q.add(Job(label="plex         sync playlists", link=("plex", None)))
            log.say("Queued a Plex playlist sync.")
            continue
        if cmd == "fix":
            q.add(Job(label="fix          the library", link=("fix", None)))
            log.say("Queued a library fix.")
            continue

        jobs = parse_line(line)
        if not jobs:
            continue
        log.say("I understood:")
        for j in jobs:
            log.say(f"  - {escape(j.label)}")
        jobs = [r for j in jobs if (r := review(j, not auto_yes))]
        if not jobs:
            log.say("Nothing left to queue.")
            continue
        if auto_yes or _confirm(f"Queue {'these' if len(jobs) > 1 else 'this'}?"):
            for j in jobs:
                q.add(j)
            log.say(f"Queued. ({sum(j.status in ('queued', 'working') for j in q.jobs)} in the queue)")
        else:
            log.say("Skipped. Try rephrasing, e.g. 'album: Bloom - Beach House'.")


def ask(lines: list[str], run_unit) -> None:
    """Non-interactive: queue each request (no confirmation) and wait until everything is done."""
    jobs = [j for line in lines for j in parse_line(line)]  # parse everything before starting
    for j in jobs:
        log.say(f"queued: {j.label}")
    q = DownloadQueue(run_unit)
    for j in jobs:
        q.add(j)
    q.wait()
    q.show()


def bare_collection(t: Track) -> Collection:
    """A one-song collection for a song Spotify search couldn't find."""
    slug = re.sub(r"[^a-z0-9]+", "-", f"{t.primary_artist} {t.title}".lower()).strip("-")[:60]
    return Collection(kind="track", spotify_id=f"search-{slug}", name=t.title,
                      owner_or_artist=t.artist, source="search", tracks=[t])
