"""Import audio files into the library.

Each file is identified on Spotify from its tags, file name and folder names, cleaned up, given the
album cover, and copied to Artist/Album/NN - Title.<ext>. Originals are never touched (copy), and the
format is kept (a FLAC stays a FLAC).

  matched   a Spotify match whose length is within MATCH_TOLERANCE_S of the file -> the library
  unsorted  a possible match with the wrong length, or no match -> songs/_Unsorted/, with the reason
            and any suggestion in songs/_Unsorted/_report.txt (`fix` retries these later)
  duplicate already in the library at the same or better quality -> skipped
  better    already in the library, but this copy is better (lossless, or a higher bitrate): it takes
            the old one's place, and the old file is moved to songs/_Replaced/ (never deleted)

Every run writes .cache/imports/<timestamp>.json so `import --undo` can reverse it.
"""

import json
import re
import shutil
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from . import catalog, llm, log, sources, tags
from .albums import fill_albums
from .enrich import enrich
from .library import prune_empty_dirs, rel_path, sanitize
from .library_index import LibraryIndex, relink
from .match import norm
from .models import Collection, Track

MATCH_TOLERANCE_S = 4
BITRATE_MARGIN_KBPS = 32  # a lossy copy must beat the existing one by this much to replace it
UNSORTED, REPLACED = "_Unsorted", "_Replaced"
IMPORTED_CACHE = "imported.json"  # imported tracks, as a collection, so relink/fix see them
SOURCES_CACHE = "import_sources.json"  # source file -> where it went, to skip unchanged files on re-runs
MAX_GUESSES = 3
MODEL_SUGGESTION_MAX_DIFF_S = 30
WORKERS = 4

_JUNK = [
    r"[\(\[]\s*(?:official\s*)?(?:music\s*|lyrics?\s*|audio\s*|hd\s*|hq\s*|4k\s*)*"
    r"(?:video|audio|lyrics?|visuali[sz]er|clip)\s*[\)\]]",
    r"[\(\[]\s*(?:hd|hq|4k|explicit|clean|free download|out now|mv|m/v|remastered \d{4}|\d{4} remaster)\s*[\)\]]",
    r"[\(\[]?\b\d{2,3}\s?kbps\b[\)\]]?",
    r"\b(?:www\.)?[a-z0-9-]+\.(?:com|net|org|ru|io|me|to|cc|in|pk|info)\b",
    r"[\(\[]\s*\d\s*[\)\]]$",  # "song (1)"
    r"\b(?:final|copy|new)\s*$",
]


@dataclass
class Plan:
    src: Path
    clues: dict = field(default_factory=dict)
    guesses: list[tuple[str | None, str]] = field(default_factory=list)
    status: str = "unsorted"  # matched | unsorted | duplicate | better | error
    track: Track | None = None
    candidates: list[Track] = field(default_factory=list)  # Spotify versions within the length tolerance
    model_guess: tuple[str, str] | None = None  # from the LLM: used for searching, never for naming
    base: Path | None = None  # the folder the user asked to import (for Artist/Album folder hints)
    reason: str = ""
    suggestion: str = ""
    dest: str | None = None  # library-relative
    replaced: str | None = None  # where the worse copy went (library-relative)
    skipped: bool = False  # imported before and unchanged since: not looked at again


def clean(s: str) -> str:
    s = s.replace("_", " ")
    for pat in _JUNK:
        s = re.sub(pat, " ", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip(" -._")
    return s


def scan(paths: list[Path], root: Path, inside_ok: bool = False) -> list[tuple[Path, Path]]:
    """(file, the folder it was found under) for audio files. Files already in the library are skipped."""
    out, lib = [], root.resolve()
    for p in paths:
        files = [p] if p.is_file() else sorted(x for x in p.rglob("*") if x.is_file())
        for f in files:
            if f.suffix.lower() not in tags.AUDIO_EXTS:
                continue
            if not inside_ok and f.resolve().is_relative_to(lib):
                continue
            out.append((f, p if p.is_dir() else p.parent))
    return out


def _folders(path: Path, base: Path | None) -> list[str]:
    """Folder names between the import folder and the file: [] / ["Artist"] / ["Artist", "Album"]."""
    try:
        return list(path.relative_to(base).parts[:-1]) if base else []
    except ValueError:
        return []


def _guesses(path: Path, clues: dict, base: Path | None) -> list[tuple[str | None, str]]:
    """(artist, title) guesses, most trustworthy first: tags, "Artist - Title" names, folder names."""
    out: list[tuple[str | None, str]] = []
    stem = re.sub(r"^\d{1,3}\s*[-._)]?\s+", "", clean(path.stem))  # "03 - " / "03. " / "02 "
    folders = _folders(path, base)
    if clues.get("title"):
        artist = clues.get("artist") or clues.get("albumartist")
        out.append((None if (artist or "").casefold() in ("unknown artist", "unknown", "various artists") else artist,
                    clean(clues["title"])))
    for sep in (" - ", " – ", " — "):
        if sep in stem:
            artist, title = stem.split(sep, 1)
            out.append((artist.strip(), title.strip()))
            break
    else:
        if folders:  # Artist/Album/Title.ext or Artist/Title.ext
            out.append((clean(folders[-2] if len(folders) >= 2 else folders[-1]), stem))
        if re.search(r"\w-\w", stem):  # "tame impala-the less i know the better"
            artist, title = stem.split("-", 1)
            out.append((artist.strip(), title.strip()))
    seen, uniq = set(), []
    for a, t in out:
        k = (a or "").casefold(), t.casefold()
        if t and k not in seen:
            seen.add(k)
            uniq.append((a, t))
    return uniq


def _llm_guess(p: Plan) -> tuple[str, str] | None:
    folders = "/".join(_folders(p.src, p.base))
    try:
        r = llm.split_filename(p.src.stem, folders)
    except Exception as e:  # noqa: BLE001 - the model is optional here
        log.detail(f"split_filename failed for {p.src.name}: {e}")
        return None
    return (r.artist, clean(r.title)) if r and r.artist and r.title else None


def identify(p: Plan) -> Plan:
    p.clues = tags.read(p.src)
    p.guesses = _guesses(p.src, p.clues, p.base)
    file_s = p.clues.get("duration_s")
    closest: tuple[float, Track] | None = None

    def attempt(artist: str, title: str) -> bool:
        nonlocal closest
        for tid in catalog.find_tracks(title, artist)[:6]:
            try:
                t = sources.from_embed("track", tid).tracks[0]
            except Exception as e:  # noqa: BLE001 - try the next candidate
                log.detail(f"embed track {tid} failed: {e}")
                continue
            diff = abs(t.duration_s - file_s) if (t.duration_s and file_s) else 999
            if diff <= MATCH_TOLERANCE_S:
                p.candidates.append(t)  # kept in search order: Spotify's main release tends to come first
            if closest is None or diff < closest[0]:
                closest = (diff, t)
        return bool(p.candidates)

    for artist, title in [g for g in p.guesses if g[0]][:MAX_GUESSES]:
        if attempt(artist, title):
            break
    if not p.candidates and (g := _llm_guess(p)) and g not in p.guesses:  # messy names: ask the model
        p.model_guess = g
        attempt(*g)
        if not p.candidates and closest and closest[0] > MODEL_SUGGESTION_MAX_DIFF_S:
            closest = None  # a far-off length on a model guess is noise, not a suggestion
    if not p.candidates and not closest and (title := next((t for _, t in p.guesses), None)):
        # No artist anywhere: a title-only search, offered as a suggestion only.
        for tid in catalog.find_tracks_any_artist(title)[:6]:
            try:
                t = sources.from_embed("track", tid).tracks[0]
            except Exception:  # noqa: BLE001
                continue
            if t.duration_s and file_s and abs(t.duration_s - file_s) <= MATCH_TOLERANCE_S:
                closest = (abs(t.duration_s - file_s), t)
                p.reason = "no artist in the tags or file name; found a likely match by title and length"
                break
    if p.candidates:
        p.status, p.track = "matched", p.candidates[0]
    elif closest:
        t = closest[1]
        lengths = f"Spotify {t.duration_s}s, file {file_s}s" if file_s else "file length unknown"
        p.reason = p.reason or "length doesn't match"
        p.suggestion = f"{t.artist} - {t.title} ({lengths}): https://open.spotify.com/track/{t.spotify_track_id}"
    else:
        tried = "; ".join([f"{a} - {t}" for a, t in p.guesses if a]
                          + ([f"{p.model_guess[0]} - {p.model_guess[1]} (model's guess)"] if p.model_guess else []))
        p.reason = (f"not found on Spotify (tried: {tried})" if tried
                    else "no artist in the tags or file name, and the model couldn't tell")
    return p


# Album names that mark a variant release, unless the song title has the word too.
_ALBUM_VARIANTS = ("slowed", "sped up", "pitched", "nightcore", "reverb", "remix", "remixes", "live",
                   "acoustic", "karaoke", "instrumental", "8d", "tribute", "covers?", "lofi", "lo fi")


def _hints(p: Plan) -> set[str]:
    """Album names the file itself suggests: its album tag and its folder."""
    return {norm(x) for x in (p.clues.get("album"), *_folders(p.src, p.base)[-1:]) if x and norm(x) != "singles"}


def _album_hint_candidates(p: Plan) -> list[Track]:
    first = p.candidates[0]
    names = [x for x in (p.clues.get("album"), *_folders(p.src, p.base)[-1:]) if x]
    for name in dict.fromkeys(names):
        found = catalog.find_album(name, first.primary_artist)
        if not found:
            continue
        try:
            album = sources.from_embed("album", found[1])
        except Exception:  # noqa: BLE001
            continue
        file_s = p.clues.get("duration_s") or 0
        for t in album.tracks:
            if norm(t.title) == norm(first.title) and t.duration_s and abs(t.duration_s - file_s) <= MATCH_TOLERANCE_S:
                p.candidates.insert(0, t)
                log.detail(f"{p.src.name}: using {album.name!r} from its tags/folder")
                return [t]
    return []


def _rank(p: Plan, i: int, c: Track) -> tuple:
    """Higher is better. Search order breaks ties (Spotify's main release tends to come first)."""
    hints = _hints(p)
    album, owner, title = norm(c.album or ""), norm(c.album_artist or ""), norm(c.title)
    variant = any(re.search(rf"\b{v}\b", album) and not re.search(rf"\b{v}\b", title) for v in _ALBUM_VARIANTS)
    main_owner = norm((c.album_artist or "").split(",")[0])
    return (
        bool(album) and album in hints,         # the file's album tag / folder says this album
        main_owner == norm(c.primary_artist),   # the artist's own release
        norm(c.primary_artist) in owner,        # credited on it (e.g. a soundtrack)
        owner != "various artists",             # not a compilation
        not variant,                            # not a slowed / remix / live / tribute release
        -i,
    )


def _top_track_candidates(p: Plan) -> list[Track]:
    found = catalog.find_artist(p.candidates[0].primary_artist)
    if not found:
        return []
    try:
        top = sources.from_embed("artist", found[1]).tracks
    except Exception:  # noqa: BLE001
        return []
    file_s = p.clues.get("duration_s") or 0
    new = [t for t in top if norm(t.title) == norm(p.candidates[0].title)
           and t.duration_s and abs(t.duration_s - file_s) <= MATCH_TOLERANCE_S
           and t.spotify_track_id not in {c.spotify_track_id for c in p.candidates}]
    p.candidates = new + p.candidates
    return new


def _settle_albums(plans: list[Plan], root: Path) -> None:
    """Several Spotify versions can match a file's length (album, single, compilations, variants).
    Look up every candidate's album in one batch, then pick the best-ranked version."""
    cands = [c for p in plans if p.status == "matched" for c in p.candidates]
    if not cands:
        return
    fill_albums(cands, root / ".cache" / "albums.json")
    enrich(cands)
    extra = []
    for p in plans:
        if p.status != "matched":
            continue
        ranks = [_rank(p, i, c) for i, c in enumerate(p.candidates)]
        if _hints(p) and not any(r[0] for r in ranks):
            # The file's tags/folder name an album, but no candidate is on it: get that album's version.
            extra += _album_hint_candidates(p)
        elif not any(r[1] for r in ranks):
            # Only compilations matched: the artist's own top tracks often have the original.
            extra += _top_track_candidates(p)
    if extra:
        fill_albums(extra, root / ".cache" / "albums.json")
        enrich(extra)
    for p in plans:
        if p.status == "matched":
            p.track = max(enumerate(p.candidates), key=lambda ic: _rank(p, *ic))[1]
            log.detail(f"{p.src.name}: picked {p.track.album!r} by {p.track.album_artist!r} out of "
                       f"{[(c.album, c.album_artist) for c in p.candidates]}")


def _unique(root: Path, rel: str) -> str:
    stem, ext = rel.rsplit(".", 1)
    n, cand = 2, rel
    while (root / cand).exists():
        cand, n = f"{stem} ({n}).{ext}", n + 1
    return cand


def _place(src: Path, dest: Path, move: bool) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".importing")
    (shutil.move if move else shutil.copy2)(str(src), str(tmp))
    tmp.replace(dest)


def _load_sources(root: Path) -> dict:
    f = root / ".cache" / SOURCES_CACHE
    return json.loads(f.read_text("utf-8")) if f.exists() else {}


def _save_sources(root: Path, seen: dict) -> None:
    (root / ".cache" / SOURCES_CACHE).write_text(json.dumps(seen, indent=1, ensure_ascii=False), "utf-8")


def _unchanged(root: Path, seen: dict, f: Path) -> bool:
    e = seen.get(str(f))
    if not e or not (root / e["dest"]).exists():
        return False
    st = f.stat()
    return e["size"] == st.st_size and e["mtime"] == int(st.st_mtime)


def _load_imported(root: Path) -> Collection:
    f = root / ".cache" / IMPORTED_CACHE
    try:
        return Collection.model_validate_json(f.read_text("utf-8"))
    except (OSError, ValueError):
        return Collection(kind="track", spotify_id="imported", name="Imported", source="import", tracks=[])


def _save_imported(root: Path, coll: Collection) -> None:
    (root / ".cache" / IMPORTED_CACHE).write_text(coll.model_dump_json(indent=1), "utf-8")


def _unsorted_report(root: Path, plans: list[Plan]) -> None:
    """Add this run's unsorted files to .cache/unsorted.json, drop entries whose file has since moved
    into the library (or was deleted), and rewrite _Unsorted/_report.txt."""
    rows = [p for p in plans if p.status in ("unsorted", "still") and p.dest]
    data_f = root / ".cache" / "unsorted.json"
    data = json.loads(data_f.read_text("utf-8")) if data_f.exists() else {}
    if not rows and not data:
        return
    data = {k: v for k, v in data.items() if (root / k).exists()}
    for p in rows:
        if p.status == "still" and p.dest in data:
            data[p.dest].update(reason=p.reason, suggestion=p.suggestion)
            continue
        data[p.dest] = {"src": str(p.src), "reason": p.reason, "suggestion": p.suggestion,
                        "guesses": p.guesses, "when": datetime.now().isoformat(timespec="seconds")}
    data_f.write_text(json.dumps(data, indent=1, ensure_ascii=False), "utf-8")
    data_f.write_text(json.dumps(data, indent=1, ensure_ascii=False), "utf-8")
    if not data:
        (root / UNSORTED / "_report.txt").unlink(missing_ok=True)
        return
    lines = [f"{Path(k).name}\n    why: {v['reason']}\n" + (f"    maybe: {v['suggestion']}\n" if v["suggestion"] else "")
             + f"    from: {v['src']}\n" for k, v in sorted(data.items())]
    (root / UNSORTED).mkdir(parents=True, exist_ok=True)
    (root / UNSORTED / "_report.txt").write_text(
        "Files that couldn't be matched confidently. Fix the tags or file name and run "
        "`yt-dl-agent fix` to retry them.\n\n" + "\n".join(lines), "utf-8")


def run_import(paths: list[Path], root: Path, dry_run: bool = False, move: bool = False,
               inside_ok: bool = False) -> list[Plan]:
    files = scan(paths, root, inside_ok)
    log.say(f"[bold]import[/]: {len(files)} audio files in {', '.join(str(p) for p in paths)}")
    if not files:
        return []
    seen = _load_sources(root)
    known = [Plan(src=f, base=b, status="duplicate", dest=seen[str(f)]["dest"], skipped=True) for f, b in files
             if _unchanged(root, seen, f)]
    fresh = [(f, b) for f, b in files if not _unchanged(root, seen, f)]
    if known:
        log.say(f"{len(known)} already imported before and unchanged; skipping them")
    with ThreadPoolExecutor(WORKERS) as pool:
        plans = known + list(pool.map(lambda fb: identify(Plan(src=fb[0], base=fb[1])), fresh))
    _settle_albums(plans, root)

    index = LibraryIndex(root)
    moves: dict[str, str] = {}
    unsorted_f = root / ".cache" / "unsorted.json"
    already_unsorted = {v["src"]: k for k, v in json.loads(unsorted_f.read_text("utf-8")).items()
                        if (root / k).exists()} if unsorted_f.exists() else {}
    for p in plans:
        ext = p.src.suffix.lower()
        if p.status == "unsorted" and str(p.src) in already_unsorted:
            p.status, p.dest = "duplicate", already_unsorted[str(p.src)]
            continue
        if p.status == "unsorted" and p.src.resolve().is_relative_to((root / UNSORTED).resolve()):
            p.status, p.dest = "still", p.src.resolve().relative_to(root.resolve()).as_posix()
            continue  # `fix` retrying _Unsorted/: still no match, leave it where it is
        if p.status == "matched":
            t = p.track
            existing = index.find(t)
            if existing:
                new_q, old_q = tags.quality(p.src), tags.quality(root / existing)
                better = new_q[0] > old_q[0] or (new_q[0] == old_q[0] and new_q[1] > old_q[1] + BITRATE_MARGIN_KBPS)
                if not better:
                    p.status, p.dest = "duplicate", existing
                    continue
                p.status, p.replaced = "better", f"{REPLACED}/{existing}"
            p.dest = f"{rel_path(t)}{ext}"
            if p.status == "matched" and (root / p.dest).exists():
                p.status = "duplicate"
                continue
        else:
            a, title = next(((a, t) for a, t in p.guesses if a), (None, None)) or (None, None)
            name = sanitize(f"{a} - {title}") if a and title else sanitize(p.src.stem)
            p.dest = _unique(root, f"{UNSORTED}/{name}{ext}")

    if dry_run:
        _summary(plans, dry_run=True)
        return plans

    imported = _load_imported(root)
    covers = root / ".cache" / "covers"
    for p in plans:
        if p.status not in ("matched", "better", "unsorted"):
            continue
        try:
            if p.status == "better":
                old = index.find(p.track)
                _place(root / old, root / p.replaced, move=True)
                moves[old] = p.dest
            _place(p.src, root / p.dest, move)
            if p.status == "unsorted":
                a, title = next(((a, t) for a, t in p.guesses if a), (None, p.src.stem))
                tags.write(root / p.dest, Track(title=title, artist=a or "",
                                                album=p.clues.get("album")), minimal=True)
                continue
            p.track.file_path, p.track.status = p.dest, "done"
            tags.write(root / p.dest, p.track, tags.fetch_cover(p.track.cover_url, covers))
            index.add(p.track)
            imported.tracks.append(p.track)
        except Exception as e:  # noqa: BLE001 - one bad file shouldn't stop the import
            p.status, p.reason = "error", log.explain(e)
            log.exception(f"importing {p.src} failed")
    index.save()
    _save_imported(root, imported)
    relink(root, moves)
    for p in plans:
        if p.status in ("matched", "better", "unsorted") and not move:
            st = p.src.stat()
            seen[str(p.src)] = {"size": st.st_size, "mtime": int(st.st_mtime), "dest": p.dest}
    _save_sources(root, seen)
    _unsorted_report(root, plans)
    _manifest(root, plans, move)
    _summary(plans)
    return plans


def _manifest(root: Path, plans: list[Plan], move: bool) -> None:
    d = root / ".cache" / "imports"
    d.mkdir(parents=True, exist_ok=True)
    items = [{"src": str(p.src), "dest": p.dest, "status": p.status, "replaced": p.replaced}
             for p in plans if p.status in ("matched", "better", "unsorted")]
    if items:
        f = d / f"{datetime.now():%Y%m%d-%H%M%S}.json"
        f.write_text(json.dumps({"mode": "move" if move else "copy", "items": items}, indent=1,
                                ensure_ascii=False), "utf-8")
        log.say(f"[dim]undo with: yt-dl-agent import --undo  ({f.name})[/]")


def _summary(plans: list[Plan], dry_run: bool = False) -> None:
    icon = {"matched": "[green]+[/]", "better": "[green]^[/]", "duplicate": "[dim]=[/]",
            "unsorted": "[yellow]?[/]", "still": "[yellow]?[/]", "error": "[red]x[/]"}
    verb = "would be " if dry_run else ""
    for p in plans:
        if p.status == "matched":
            log.say(f" {icon['matched']} {p.src.name}\n     -> {p.dest}")
        elif p.status == "better":
            log.say(f" {icon['better']} {p.src.name}\n     -> {p.dest} (better quality; old copy {verb}moved to {REPLACED}/)")
        elif p.status == "duplicate":
            log.say(f" {icon['duplicate']} {p.src.name}: already in the library as {p.dest}")
        elif p.status == "still":
            log.say(f" {icon['still']} {p.dest}: still no confident match ({p.reason})"
                    + (f"\n     maybe: {p.suggestion}" if p.suggestion else ""))
        elif p.status == "unsorted":
            log.say(f" {icon['unsorted']} {p.src.name}\n     -> {p.dest}: {p.reason}"
                    + (f"\n     maybe: {p.suggestion}" if p.suggestion else ""))
        else:
            log.say(f" {icon['error']} {p.src.name}: {p.reason}", log.WARNING)
    counts = {s: sum(p.status == s for p in plans) for s in icon}
    log.say(f"[bold]{'dry run: ' if dry_run else ''}{counts['matched']} imported, {counts['better']} upgraded, "
            f"{counts['duplicate']} already in library, {counts['unsorted']} to {UNSORTED}/, "
            f"{counts['still']} still unsorted, "
            f"{counts['error']} errors[/]")


def undo(root: Path, which: str = "last") -> None:
    d = root / ".cache" / "imports"
    runs = sorted(d.glob("*.json")) if d.exists() else []
    runs = [r for r in runs if not r.name.endswith(".undone.json")]
    target = runs[-1] if which == "last" and runs else d / which if which != "last" else None
    if not target or not target.exists():
        log.warn("No import to undo.")
        return
    data = json.loads(target.read_text("utf-8"))
    index, imported = LibraryIndex(root), _load_imported(root)
    moves: dict[str, str] = {}
    undone = 0
    for it in reversed(data["items"]):
        dest = root / it["dest"]
        if data["mode"] == "move":
            if dest.exists():
                _place(dest, Path(it["src"]), move=True)
        else:
            dest.unlink(missing_ok=True)
        if it.get("replaced") and (root / it["replaced"]).exists():
            original = it["replaced"].removeprefix(f"{REPLACED}/")
            _place(root / it["replaced"], root / original, move=True)
            moves[it["dest"]] = original
        index.by_id = {k: v for k, v in index.by_id.items() if v != it["dest"]}
        index.by_key = {k: v for k, v in index.by_key.items() if v["path"] != it["dest"]}
        imported.tracks = [t for t in imported.tracks if t.file_path != it["dest"]]
        undone += 1
    index.save()
    _save_imported(root, imported)
    seen = _load_sources(root)
    for it in data["items"]:
        seen.pop(it["src"], None)
    _save_sources(root, seen)
    relink(root, moves)
    if moves:  # put the restored files back in the index
        index = LibraryIndex(root)
        for f in (root / ".cache").glob("*.json"):
            try:
                coll = Collection.model_validate_json(f.read_text("utf-8"))
            except ValueError:
                continue
            for t in coll.tracks:
                if t.file_path in moves.values():
                    index.add(t)
        index.save()
    _unsorted_report(root, [])  # drop report entries for files that are gone
    prune_empty_dirs(root)
    target.rename(target.with_name(target.stem + ".undone.json"))
    log.say(f"Undid {undone} files from the import of {target.stem}.")
