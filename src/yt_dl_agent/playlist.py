from pathlib import Path

from .library import sanitize
from .models import Collection


def write_m3u8(root: Path, coll: Collection) -> Path:
    lines = ["#EXTM3U", f"#PLAYLIST:{coll.name}"]
    for t in coll.tracks:
        if t.status == "done" and t.file_path:
            lines.append(f"#EXTINF:{t.duration_s or -1},{t.artist} - {t.title}")
            lines.append(t.file_path)
    path = root / f"{sanitize(coll.name)}.m3u8"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path
