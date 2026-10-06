import argparse
import contextlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv
from rich.progress import BarColumn, MofNCompleteColumn, Progress, TextColumn, TimeElapsedColumn

from . import chat, config, covers, fixer, history, importer, log, plex, sources, spotify_url
from .albums import fill_albums
from .download import download
from .enrich import enrich
from .library import search_url
from .library_index import LibraryIndex
from .models import Collection
from .playlist import write_m3u8


def run(url: str, args) -> None:
    kind, sid = spotify_url.parse(url)
    if kind == "artist":  # an artist link means their discography
        job = chat.Job(label=f"discography of artist {sid}", link=(kind, sid))
        units = chat.expand(job)
        log.say(f"[cyan]{job.note}[/]")
        for i, (k, rid) in enumerate(units, 1):
            log.console.rule(f"[{i}/{len(units)}]")
            try:
                run_collection(k, rid, args)
            except Exception as e:  # noqa: BLE001 - one bad release shouldn't stop the rest
                log.say(f"[red]error[/] {log.explain(e)}", log.WARNING)
                log.exception(f"release {rid} failed")
        return
    if kind != "user":
        run_collection(kind, sid, args)
        return

    playlists = sources.user_playlists(sid)
    if args.match:
        wanted = [m.casefold() for m in args.match]
        playlists = [(n, p) for n, p in playlists if any(w in n.casefold() for w in wanted)]
    log.say(f"[bold]profile {sid}[/]: {len(playlists)} playlists")
    for i, (name, pid) in enumerate(playlists, 1):
        log.say(f"  {i:2}. {name}  https://open.spotify.com/playlist/{pid}")
    if args.list:
        return
    for i, (name, pid) in enumerate(playlists, 1):
        log.console.rule(f"[{i}/{len(playlists)}] {name}")
        log.detail(f"=== playlist {i}/{len(playlists)}: {name} ({pid})", log.INFO)
        try:
            run_collection("playlist", pid, args)
        except Exception as e:  # noqa: BLE001 - one bad playlist shouldn't stop the profile
            log.say(f"[red]error[/] {name}: {log.explain(e)}", log.WARNING)
            log.exception(f"playlist {name} failed")


class _NoProgress:
    def add_task(self, *a, **k):
        return None

    def advance(self, *a, **k):
        pass


def _n(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


def _previous(cache_file: Path) -> Collection | None:
    try:
        return Collection.model_validate_json(cache_file.read_text("utf-8"))
    except (OSError, ValueError):
        return None


def _plex_on(args) -> bool:
    return plex.configured() and not getattr(args, "no_plex", False)


def run_unit(args):
    """For chat mode: run one queued unit, ("album", id) / ("track", id) / ... or ("bare", Track)."""
    def _run(kind, x):
        if kind == "import":
            if args.undo:
                importer.undo(args.out, args.undo)
                if _plex_on(args):
                    plex.sync_all(args.out)
            elif not x:
                log.warn("Give one or more files or folders to import, e.g. import \"D:\\Music\\old\"")
            else:
                plans = importer.run_import([Path(p) for p in x], args.out, dry_run=args.dry_run)
                if _plex_on(args) and not args.dry_run and any(p.status == "better" for p in plans or []):
                    plex.sync_all(args.out)  # replaced files are new files to Plex
        elif kind == "fix":
            fixer.run_fix(args.out, dry_run=args.dry_run)
            if _plex_on(args) and not args.dry_run:
                plex.sync_all(args.out)  # files may have moved
        elif kind == "plex":
            plex.sync_all(args.out, dry_run=args.dry_run)
        elif kind == "bare":
            run_collection("track", None, args, coll=chat.bare_collection(x))
        else:
            run_collection(kind, x, args)
    return _run


def run_collection(kind: str, sid: str | None, args, coll: Collection | None = None) -> None:
    """Download one playlist/album/track, and record what happened in songs/.cache/runs/ (history.py)."""
    run = history.Run(args.out, kind, sid, args)
    try:
        _run_collection(kind, sid, args, coll, run)
    except Exception as e:
        run.fail(e)
        raise
    finally:
        run.save()


def _run_collection(kind: str, sid: str | None, args, coll: Collection | None, run: history.Run) -> None:
    root: Path = args.out
    cache_dir = root / ".cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    log.event("phase", phase="resolving", kind=kind, id=sid)
    coll = coll or sources.resolve(kind, sid)
    sid = coll.spotify_id
    cache_file = cache_dir / f"{sid}.json"
    prev = _previous(cache_file)

    if args.limit:
        coll.tracks = coll.tracks[: args.limit]
    log.say(f"[bold]{coll.kind} '{coll.name}'[/] by {coll.owner_or_artist}: "
            f"{_n(len(coll.tracks), 'track')} (from {coll.source})")
    log.event("collection", kind=coll.kind, id=sid, name=coll.name, owner=coll.owner_or_artist,
              source=coll.source, total=len(coll.tracks))
    if coll.kind in ("playlist", "album"):
        # Keep the cover only if Spotify's image changed; a fresh run notices a new playlist cover.
        old_url = prev.cover_url if prev else None
        covers.ensure(root, coll, refresh=bool(coll.cover_url and old_url and coll.cover_url != old_url))
    run.collection(coll)
    if prev and not args.limit:
        now = {t.key for t in coll.tracks}
        if removed := [t for t in prev.tracks if t.key not in now]:
            run.removed(removed)
            log.say(f"{_n(len(removed), 'track')} removed from this {kind} since the last run; "
                    "left out of the playlist file, MP3s kept")
            for t in removed:
                log.detail(f"removed since last run: {t.artist} - {t.title}")

    if not args.no_album_lookup:
        log.event("phase", phase="albums")
        fill_albums(coll.tracks, cache_dir / "albums.json")
    log.event("phase", phase="links")
    for t in coll.tracks:
        t.search_url = search_url(t)

    links = cache_dir / f"{sid}.links.txt"
    links.write_text("\n".join(f"{t.artist} - {t.title}\t{t.search_url}" for t in coll.tracks) + "\n", "utf-8")
    log.detail(f"search links -> {links}", log.INFO)

    if not args.links_only:
        # Same song twice in a playlist maps to one file; download each unique track once.
        unique = {t.key: t for t in reversed(coll.tracks)}
        # Songs already in the library (from any playlist/album, under any name) are reused.
        index = LibraryIndex(root)
        todo = []
        for t in unique.values():
            if hit := index.find(t):
                t.file_path, t.status, t.error = hit, "done", None
            else:
                todo.append(t)
        reused = len(unique) - len(todo)
        reused_keys = {t.key for t in unique.values()} - {t.key for t in todo}
        log.event("phase", phase="downloading", total=len(unique), reused=reused)
        if not todo:
            log.say(f"[green]Up to date:[/] all {_n(len(unique), 'song')} already in the library; nothing to download")
        elif reused:
            log.say(f"{_n(reused, 'song')} already in the library; downloading {len(todo)} new")

        if todo:
            enrich(todo)  # cover art, year, track number, album artist
            # No progress bar in chat mode: it would fight with the input prompt.
            bar = (Progress(TextColumn("{task.description}"), BarColumn(), MofNCompleteColumn(),
                            TimeElapsedColumn(), console=log.console)
                   if not args.chat_mode else contextlib.nullcontext(_NoProgress()))
            with bar as prog:
                task = prog.add_task("downloading", total=len(todo))
                with ThreadPoolExecutor(max(1, args.workers)) as pool:
                    futs = [pool.submit(download, t, root, args.bitrate, args.cookies_from_browser,
                                        getattr(args, "cookies_file", None))
                            for t in todo]
                    for f in as_completed(futs):
                        t = f.result()
                        if t.status == "done":
                            log.say(f"[green]ok[/] {t.artist} - {t.title}")
                            index.add(t)
                            index.save()
                        else:
                            log.say(f"[red]failed[/] {t.artist} - {t.title}: {t.error}", log.WARNING)
                        log.event("track", label=f"{t.artist} - {t.title}", ok=t.status == "done", error=t.error)
                        prog.advance(task)
        for t in coll.tracks:
            src = unique[t.key]
            t.status, t.error, t.file_path, t.video_id = src.status, src.error, src.file_path, src.video_id
        run.outcome(list(reversed(unique.values())), reused_keys, links_only=False)

        if coll.kind == "playlist" and not args.no_playlist:
            log.event("phase", phase="playlist")
            m3u8 = write_m3u8(root, coll)
            run.playlist_file(m3u8)
            log.say(f"playlist file -> {m3u8}")
            if _plex_on(args):
                log.event("phase", phase="plex")
                try:  # Plex never reads .m3u8 files from the library: create/update it through its API
                    plex.sync_all(root, only=[coll])
                except Exception as e:  # noqa: BLE001 - a Plex problem never fails the download
                    log.warn(f"Plex sync failed: {log.explain(e)}")
                    log.exception("plex sync failed")

    if prev and (args.links_only or args.limit):
        # A partial run mustn't forget what an earlier full run downloaded.
        done = {t.key: t for t in prev.tracks if t.status == "done" and t.file_path}
        for t in coll.tracks:
            if t.status == "pending" and (old := done.get(t.key)):
                t.status, t.file_path, t.video_id = old.status, old.file_path, old.video_id
        if args.limit:
            have = {t.key for t in coll.tracks}
            coll.tracks += [t for t in prev.tracks if t.key not in have]
    if args.links_only:
        run.outcome(list({t.key: t for t in coll.tracks}.values()), set(), links_only=True)
    cache_file.write_text(coll.model_dump_json(indent=1), "utf-8")
    if not args.links_only:
        failed = [t for t in coll.tracks if t.status == "failed"]
        done = sum(t.status == "done" for t in coll.tracks)
        log.event("phase", phase="finished", done=done, failed=len(failed))
        log.say(f"[bold]done {done}/{len(coll.tracks)}[/], failed {len(failed)}")
        for t in failed:
            log.say(f"  [red]x[/] {t.artist} - {t.title}: {t.error}", log.WARNING)
        if failed:
            log.say("  rerun the same link to retry just these")


def main() -> None:
    load_dotenv(Path.cwd() / ".env")
    d = config.defaults()  # YTDL_* in .env (the web UI's Settings page writes them)
    p = argparse.ArgumentParser(prog="yt-dl-agent",
                                description="Spotify playlist/album/profile -> MP3 library. "
                                            "Also: `import <files/folders>`, `fix`, `plex`, `serve` (web UI).")
    p.add_argument("urls", nargs="*", help="Spotify playlist/album/track/artist/profile links")
    p.add_argument("--chat", action="store_true",
                   help="type requests in plain words (artists, albums, songs, discographies); "
                        "the default when no links are given")
    p.add_argument("--ask", action="append", metavar="TEXT",
                   help="non-interactive chat: queue this request without confirming (repeatable)")
    p.add_argument("--yes", action="store_true", default=d["yes"], help="chat: queue requests without asking to confirm")
    p.add_argument("--out", type=Path, default=Path(d["out"]))
    p.add_argument("--workers", type=int, default=d["workers"], help="parallel downloads; 1 = sequential")
    p.add_argument("--bitrate", type=int, default=d["bitrate"], help="MP3 bitrate in kbps (max 320)")
    p.add_argument("--links-only", action="store_true", help="stop after building search links")
    p.add_argument("--no-playlist", action="store_true", default=d["no_playlist"], help="don't write the .m3u8")
    p.add_argument("--no-album-lookup", action="store_true", default=d["no_album_lookup"],
                   help="skip Tavily/Ollama album lookup")
    p.add_argument("--limit", type=int, help="only process the first N tracks (testing)")
    p.add_argument("--list", action="store_true", help="profile links: list the playlists and stop")
    p.add_argument("--match", action="append", metavar="TEXT",
                   help="profile links: only playlists whose name contains TEXT (repeatable)")
    p.add_argument("--cookies", dest="cookies_file", metavar="FILE", default=d["cookies_file"],
                   help="YouTube login from a cookies.txt file (most reliable; wins over --cookies-from-browser)")
    p.add_argument("--cookies-from-browser", default=d["cookies_from_browser"],
                   help="e.g. chrome; YT Music Premium gives better source audio")
    p.add_argument("--log-dir", type=Path, default=Path(d["log_dir"]), help="where run logs are kept")
    p.add_argument("--dry-run", action="store_true", help="import/fix: show what would change, change nothing")
    p.add_argument("--undo", nargs="?", const="last", metavar="RUN",
                   help="import: reverse the last import (or a named one from songs/.cache/imports)")
    p.add_argument("--port", type=int, default=8765, help="serve: port for the web UI (on 127.0.0.1)")
    p.add_argument("--no-plex", action="store_true", default=d["no_plex"],
                   help="don't sync playlists to Plex after downloading (when PLEX_TOKEN is set)")
    args = p.parse_args()

    log_file = log.setup(args.log_dir)
    log.detail(f"args: {vars(args)}", log.INFO)
    command = args.urls[0].lower() if args.urls else ""
    if command == "serve":  # yt-dl-agent serve: the web UI and its API
        from . import server  # local: FastAPI is only needed here
        server.serve(args.port, log_file)
        return
    if command in ("import", "fix", "plex"):  # yt-dl-agent import <files/folders...> | fix | plex
        args.chat_mode = False
        try:
            run_unit(args)(command, args.urls[1:])
        except Exception as e:  # noqa: BLE001
            log.say(f"[red]error[/] {command}: {log.explain(e)}", log.WARNING)
            log.exception(f"{command} failed")
        log.console.print(f"[dim]full log: {log_file}[/]")
        return
    args.chat_mode = bool(args.chat or args.ask or not args.urls)
    if args.ask:
        chat.ask(args.ask, run_unit(args))
    elif args.chat_mode:
        chat.chat(run_unit(args), auto_yes=args.yes)
    for url in args.urls if not args.chat_mode else []:
        try:
            run(url, args)
        except Exception as e:  # noqa: BLE001 - one bad URL shouldn't stop the rest
            log.say(f"[red]error[/] {url}: {log.explain(e)}", log.WARNING)
            log.exception(f"{url} failed")
    log.console.print(f"[dim]full log: {log_file}[/]")


if __name__ == "__main__":
    main()
