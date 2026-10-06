"""`fix`: bring the existing library up to the current standard.

For every song the app knows about (all cached playlists/albums/tracks, plus imports):
  1. album: re-read from the track's own Spotify page, which replaces Ollama's guesses where the page
     loads; the album ID is remembered
  2. Spotify album cover (replacing YouTube thumbnails), year, track number, album artist
  3. retag the file, and rename/move it if its correct place changed (Artist/Album/NN - Title)
  4. the index, cached playlists and .m3u8 files follow the moves
Then everything in songs/_Unsorted/ is retried; files that match now move into the library.
"""

import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import covers, log, tags
from .albums import fill_albums
from .enrich import enrich
from .importer import REPLACED, UNSORTED, Plan, _settle_albums, identify, run_import
from .library import prune_empty_dirs, rel_path
from .match import norm
from .library_index import _NOT_COLLECTIONS, LibraryIndex, relink
from .models import Collection, Track

ORPHANS_CACHE = "library-songs.json"  # songs fix found that no playlist/album cache describes
_COPY_FIELDS = ("album", "album_id", "album_artist", "track_no", "year", "cover_url")


def _collections(root: Path) -> list[tuple[Path, Collection]]:
    out = []
    for f in sorted((root / ".cache").glob("*.json")):
        if f.name in _NOT_COLLECTIONS:
            continue
        try:
            out.append((f, Collection.model_validate_json(f.read_text("utf-8"))))
        except ValueError:
            continue
    return out


def _orphans(root: Path, known: dict[str, Track]) -> dict[str, Track]:
    index = LibraryIndex(root)
    ids = {path: tid for tid, path in index.by_id.items()}
    out = {}
    for e in index.by_key.values():
        path = e["path"]
        if path in known or path in out or not (root / path).exists() or path.startswith((UNSORTED, REPLACED)):
            continue
        clues = tags.read(root / path)
        if not clues.get("title") or not clues.get("artist"):
            continue
        no = (clues.get("tracknumber") or "").split("/")[0]
        out[path] = Track(title=clues["title"], artist=clues["artist"], album=clues.get("album"),
                          album_artist=clues.get("albumartist"), track_no=int(no) if no.isdigit() else None,
                          duration_s=clues.get("duration_s") or e.get("duration_s"),
                          spotify_track_id=ids.get(path), file_path=path, status="done")
    return out


def _untracked(root: Path, known: set[str]) -> dict[str, Track]:
    """Audio files on disk that nothing tracks: identify them like an import, but fix them in place.
    Ones that can't be identified are left alone (they're not moved to _Unsorted)."""
    files = [f for f in root.rglob("*") if f.is_file() and f.suffix.lower() in tags.AUDIO_EXTS
             and not f.relative_to(root).parts[0] in (UNSORTED, REPLACED, ".cache")
             and f.relative_to(root).as_posix() not in known]
    if not files:
        return {}
    log.say(f"identifying {len(files)} files that aren't in the library index")
    plans = [identify(Plan(src=f, base=root)) for f in files]
    _settle_albums(plans, root)
    out = {}
    for p in plans:
        rel = p.src.relative_to(root).as_posix()
        if p.status == "matched":
            t = p.track
            t.file_path, t.status = rel, "done"
            no = (p.clues.get("tracknumber") or "").split("/")[0]
            if not t.track_no and no.isdigit() and norm(p.clues.get("album") or "") == norm(t.album or ""):
                t.track_no = int(no)
            out[rel] = t
        else:
            log.say(f"  [yellow]left as is[/] {rel}: couldn't identify it ({p.reason})")
    return out


def _move(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dest))


def run_fix(root: Path, dry_run: bool = False) -> dict:
    """Returns a report: counts, the songs whose album or place changed, and the _Unsorted/ retry."""
    colls = _collections(root)
    songs: dict[str, Track] = {}
    for _, coll in colls:
        for t in coll.tracks:
            if t.status == "done" and t.file_path and (root / t.file_path).exists():
                songs.setdefault(t.file_path, t)
    # Files the index knows but no cached collection describes: rebuild them from their own tags.
    orphans = _orphans(root, songs)
    orphans.update(_untracked(root, set(songs) | set(orphans)))
    if orphans:
        log.detail(f"fix: {len(orphans)} songs weren't in any cached collection", log.INFO)
        songs.update(orphans)
        # Keep them in a collection of their own so relink and later fixes know them.
        f = root / ".cache" / ORPHANS_CACHE
        found = next((c for p, c in colls if p == f), None)
        if found:
            found.tracks += list(orphans.values())
        else:
            colls.append((f, Collection(kind="track", spotify_id="library-songs", name="Library songs",
                                        source="fix", tracks=list(orphans.values()))))
    log.say(f"[bold]fix[/]: {len(songs)} songs in the library{' (dry run)' if dry_run else ''}")
    tracks = list(songs.values())
    before = {p: (t.album, t.track_no) for p, t in songs.items()}

    fill_albums(tracks, root / ".cache" / "albums.json", force=True)
    enrich(tracks)
    for old, t in songs.items():  # never lose a track number the file already had on the same album
        if not t.track_no and before[old][1] and norm(t.album or "") == norm(before[old][0] or ""):
            t.track_no = before[old][1]

    covers_dir = root / ".cache" / "covers"
    targets = {old: f"{rel_path(t)}{Path(old).suffix.lower()}" for old, t in songs.items()}
    moves: dict[str, str] = {}
    n_cover = n_album = errors = 0
    report: dict[str, dict] = {}  # old path -> what changed, for songs whose album or place changes
    for old, t in songs.items():
        new = targets[old]
        cover = tags.fetch_cover(t.cover_url, covers_dir)
        changes = []
        if before[old][0] != t.album:
            changes.append(f"album: {before[old][0] or 'Singles'} -> {t.album}")
            n_album += 1
        if cover:
            n_cover += 1
        if new != old:
            changes.append(f"-> {new}")
        if changes:
            log.say(f"  {old}\n      " + "\n      ".join(changes))
            report[old] = {"old": old, "new": new if new != old else None, "cover": bool(cover), "error": None,
                           "album": [before[old][0] or "Singles", t.album] if before[old][0] != t.album else None}
        if dry_run:
            continue
        try:
            tags.write(root / old, t, cover)
            if new != old:
                if (root / new).exists():  # the right place is taken by another copy: keep that one
                    _move(root / old, root / REPLACED / old)
                else:
                    _move(root / old, root / new)
                moves[old] = new
        except Exception as e:  # noqa: BLE001 - e.g. the file is open in a player
            errors += 1
            report.setdefault(old, {"old": old, "new": None, "album": None, "cover": False})["error"] = log.explain(e)
            log.say(f"[red]couldn't fix[/] {old}: {log.explain(e)}", log.WARNING)
            log.exception(f"fix {old} failed")

    if not dry_run:
        # Playlist/album covers that were never saved (downloaded before covers were kept).
        if missing := [c for _, c in colls if c.kind in ("playlist", "album") and not covers.path(root, c.spotify_id).exists()]:
            log.say(f"saving {len(missing)} playlist/album cover{'s' if len(missing) != 1 else ''} from Spotify")
            with ThreadPoolExecutor(8) as pool:
                list(pool.map(lambda c: covers.ensure(root, c), missing))
        # Write the improved metadata into every cached collection that has the song, then move paths.
        for f, coll in colls:
            for t in coll.tracks:
                if (src := songs.get(t.file_path)) is not None and src is not t:
                    for k in _COPY_FIELDS:
                        setattr(t, k, getattr(src, k))
            f.write_text(coll.model_dump_json(indent=1), "utf-8")
        relink(root, moves)
        index = LibraryIndex(root)  # make sure every song is findable, at its new path
        for old, t in songs.items():
            t.file_path = moves.get(old, old)
            index.add(t)
        index.save()
        prune_empty_dirs(root)
    verb = "would be " if dry_run else ""
    n_moved = sum(o != n for o, n in targets.items()) if dry_run else len(moves)
    log.say(f"[bold]{len(songs)} songs: {n_album} albums corrected, {n_cover} covers {verb}set from Spotify, "
            f"{n_moved} files {verb}moved/renamed{f', {errors} errors' if errors else ''}[/]")

    unsorted, retried = root / UNSORTED, None
    if unsorted.exists() and any(f.suffix.lower() in tags.AUDIO_EXTS for f in unsorted.iterdir()):
        log.say(f"[bold]retrying {UNSORTED}/[/]")
        retried = run_import([unsorted], root, dry_run=dry_run, move=True, inside_ok=True)
    return {"dry_run": dry_run, "songs": len(songs), "albums_corrected": n_album, "covers_set": n_cover,
            "moved": n_moved, "errors": errors, "changes": list(report.values()), "unsorted_retry": retried}
