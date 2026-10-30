"""SQLite-backed image library with tagging, vault storage and full-text search."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import shutil
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

from .parsers import ParsedMeta, parse_metadata
from .pngmeta import PNGError, make_blank_png, read_png_info
from .tokens import extract_tags, normalize_tag

SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    color TEXT DEFAULT '#8b5cf6',
    icon TEXT DEFAULT '🎨',
    created_at TEXT,
    updated_at TEXT
);
CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    vault_path TEXT,
    gdrive_id TEXT,
    gdrive_synced_at TEXT,
    sha1 TEXT, size INTEGER, mtime REAL,
    width INTEGER, height INTEGER,
    generator TEXT, prompt TEXT DEFAULT '', negative TEXT DEFAULT '',
    model TEXT, seed INTEGER,
    params TEXT DEFAULT '{}', raw TEXT DEFAULT '{}',
    rating INTEGER DEFAULT 0, favorite INTEGER DEFAULT 0, notes TEXT DEFAULT '',
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
    added_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_images_sha1 ON images(sha1);
CREATE INDEX IF NOT EXISTS ix_images_gen ON images(generator);
CREATE INDEX IF NOT EXISTS ix_images_model ON images(model);
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'prompt',
    UNIQUE(name, kind)
);
CREATE TABLE IF NOT EXISTS image_tags (
    image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    weight REAL DEFAULT 1.0,
    source TEXT NOT NULL DEFAULT 'auto',
    PRIMARY KEY (image_id, tag_id)
);
CREATE INDEX IF NOT EXISTS ix_image_tags_tag ON image_tags(tag_id);
CREATE TABLE IF NOT EXISTS matrices (
    id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, spec TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS wildcards (
    name TEXT PRIMARY KEY, items TEXT NOT NULL, updated_at TEXT
);
"""

FTS_SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS images_fts USING fts5(
    prompt, negative, notes, content='images', content_rowid='id', tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS images_ai AFTER INSERT ON images BEGIN
  INSERT INTO images_fts(rowid, prompt, negative, notes) VALUES (new.id, new.prompt, new.negative, new.notes);
END;
CREATE TRIGGER IF NOT EXISTS images_ad AFTER DELETE ON images BEGIN
  INSERT INTO images_fts(images_fts, rowid, prompt, negative, notes)
  VALUES ('delete', old.id, old.prompt, old.negative, old.notes);
END;
CREATE TRIGGER IF NOT EXISTS images_au AFTER UPDATE OF prompt, negative, notes ON images BEGIN
  INSERT INTO images_fts(images_fts, rowid, prompt, negative, notes)
  VALUES ('delete', old.id, old.prompt, old.negative, old.notes);
  INSERT INTO images_fts(rowid, prompt, negative, notes) VALUES (new.id, new.prompt, new.negative, new.notes);
END;
"""

SORTS = {
    "added": "i.added_at DESC, i.id DESC",
    "oldest": "i.added_at ASC, i.id ASC",
    "mtime": "i.mtime DESC",
    "rating": "i.rating DESC, i.id DESC",
    "path": "i.path ASC",
}
TAG_KINDS = ("prompt", "lora", "model", "user", "generator")


def default_db_path() -> Path:
    env = os.environ.get("PROMPTVAULT_DB")
    if env:
        return Path(env)
    return Path.home() / ".promptvault" / "library.db"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def file_sha1(path: str | Path) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def bytes_sha1(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()


def parse_query(q: str) -> dict[str, Any]:
    """Parse the mini search language.

    ``kedi "red hair" -blurry tag:landscape -tag:nsfw lora:detail model:sdxl
    gen:comfyui neg:watermark is:fav rating:>=3 seed:123 w:>=1024``
    """
    out: dict[str, Any] = {"text": [], "not_text": [], "tags": [], "not_tags": [], "neg": [],
                           "loras": [], "models": [], "generators": [], "workspaces": [], "favorite": None,
                           "rating": None, "seed": None, "size": []}
    try:
        tokens = shlex.split(q or "", posix=True)
    except ValueError:
        tokens = (q or "").split()
    for tok in tokens:
        neg = tok.startswith("-") and len(tok) > 1
        body = tok[1:] if neg else tok
        key, sep, val = body.partition(":")
        key = key.lower()
        if sep and val:
            if key in ("tag", "t"):
                out["not_tags" if neg else "tags"].append(normalize_tag(val))
            elif key == "lora":
                out["loras"].append(val)
            elif key == "model":
                out["models"].append(val)
            elif key in ("gen", "generator"):
                out["generators"].append(val.lower())
            elif key in ("ws", "workspace"):
                out["workspaces"].append(val)
            elif key == "neg":
                out["neg"].append(val)
            elif key == "is" and val.lower() in ("fav", "favorite", "favori"):
                out["favorite"] = not neg
            elif key == "rating":
                m = re.fullmatch(r"(>=|<=|>|<|=)?(\d)", val)
                if m:
                    out["rating"] = (m.group(1) or ">=", int(m.group(2)))
            elif key == "seed" and val.lstrip("-").isdigit():
                out["seed"] = int(val)
            elif key in ("w", "h", "width", "height"):
                m = re.fullmatch(r"(>=|<=|>|<|=)?(\d+)", val)
                if m:
                    out["size"].append(("width" if key.startswith("w") else "height", m.group(1) or "=", int(m.group(2))))
            else:
                out["not_text" if neg else "text"].append(tok[1:] if neg else tok)
        elif body.lower() in ("fav", "favori"):
            out["favorite"] = not neg
        else:
            out["not_text" if neg else "text"].append(body)
    return out


class Library:
    def __init__(self, db_path: str | Path | None = None, auto_vault: bool = True):
        self.db_path = Path(db_path) if db_path else default_db_path()
        self.auto_vault = auto_vault
        if str(self.db_path) != ":memory:":
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._write_lock = threading.RLock()
        self._memory_conn: sqlite3.Connection | None = None
        conn = self.conn
        conn.executescript(SCHEMA)
        # Migrate vault_path if opening an older database
        try:
            conn.execute("ALTER TABLE images ADD COLUMN vault_path TEXT")
            conn.commit()
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE images ADD COLUMN gdrive_id TEXT")
            conn.commit()
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE images ADD COLUMN gdrive_synced_at TEXT")
            conn.commit()
        except sqlite3.OperationalError:
            pass
        # Migrate workspace_id and seed default 'Genel' workspace
        try:
            conn.execute("ALTER TABLE images ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL")
            conn.commit()
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("CREATE INDEX IF NOT EXISTS ix_images_workspace ON images(workspace_id)")
            conn.commit()
        except sqlite3.OperationalError:
            pass
        now = _now()
        conn.execute(
            "INSERT OR IGNORE INTO workspaces (name, description, color, icon, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("Genel", "Varsayılan çalışma alanı", "#8b5cf6", "🎨", now, now)
        )
        conn.execute(
            "UPDATE images SET workspace_id = (SELECT id FROM workspaces WHERE name='Genel' LIMIT 1) "
            "WHERE workspace_id IS NULL"
        )
        conn.commit()
        try:
            conn.executescript(FTS_SCHEMA)
            self.fts = True
        except sqlite3.OperationalError:
            self.fts = False
        conn.commit()

    # ------------------------------------------------------------ plumbing
    @property
    def conn(self) -> sqlite3.Connection:
        if str(self.db_path) == ":memory:":
            if self._memory_conn is None:
                self._memory_conn = self._connect()
            return self._memory_conn
        c = getattr(self._local, "conn", None)
        if c is None:
            c = self._connect()
            self._local.conn = c
        return c

    def _connect(self) -> sqlite3.Connection:
        c = sqlite3.connect(str(self.db_path), check_same_thread=False, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys = ON")
        if str(self.db_path) != ":memory:":
            c.execute("PRAGMA journal_mode = WAL")
        return c

    @property
    def data_dir(self) -> Path:
        return self.db_path.parent if str(self.db_path) != ":memory:" else Path.home() / ".promptvault"

    @property
    def vault_dir(self) -> Path:
        p = self.data_dir / "vault"
        p.mkdir(parents=True, exist_ok=True)
        return p

    def close(self) -> None:
        c = getattr(self._local, "conn", None)
        if c is not None:
            c.close()
            self._local.conn = None
        if self._memory_conn is not None:
            self._memory_conn.close()
            self._memory_conn = None

    # ------------------------------------------------------------- vault storage
    def _store_in_vault(self, sha1: str, data: bytes | None = None, src_path: Path | None = None) -> Path:
        """Store image bytes or file in the vault storage directory."""
        dest_dir = self.vault_dir / sha1[:2]
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_file = dest_dir / f"{sha1}.png"
        if not dest_file.exists():
            if data is not None:
                dest_file.write_bytes(data)
            elif src_path is not None and src_path.exists():
                shutil.copy2(src_path, dest_file)
        return dest_file

    def resolve_image_path(self, image_id: int) -> Path | None:
        """Return a valid filesystem path for the image (original if present, else vault copy)."""
        row = self.conn.execute("SELECT path, vault_path FROM images WHERE id=?", (image_id,)).fetchone()
        if not row:
            return None
        orig = Path(row["path"]) if row["path"] else None
        if orig and orig.exists():
            return orig
        if row["vault_path"]:
            vp = Path(row["vault_path"])
            if vp.exists():
                return vp
        return None

    # ------------------------------------------------------------- tagging
    def _tag_id(self, name: str, kind: str) -> int:
        c = self.conn
        c.execute("INSERT OR IGNORE INTO tags(name, kind) VALUES (?, ?)", (name, kind))
        return c.execute("SELECT id FROM tags WHERE name=? AND kind=?", (name, kind)).fetchone()[0]

    def _set_auto_tags(self, image_id: int, meta: ParsedMeta) -> None:
        c = self.conn
        c.execute("DELETE FROM image_tags WHERE image_id=? AND source='auto'", (image_id,))
        entries: list[tuple[str, str, float]] = [(t, "prompt", w) for t, w in extract_tags(meta.prompt)]
        entries += [(normalize_tag(Path(n).stem) or n.lower(), "lora", w) for n, w in meta.loras]
        if meta.model:
            entries.append((Path(meta.model.replace("\\", "/")).stem.lower(), "model", 1.0))
        if meta.generator and meta.generator != "none":
            entries.append((meta.generator, "generator", 1.0))
        for name, kind, weight in entries:
            tid = self._tag_id(name, kind)
            c.execute("INSERT OR IGNORE INTO image_tags(image_id, tag_id, weight, source) VALUES (?,?,?, 'auto')",
                      (image_id, tid, weight))

    def add_tags(self, image_id: int, names: Iterable[str], kind: str = "user") -> list[str]:
        added = []
        with self._write_lock:
            for raw in names:
                name = normalize_tag(raw)
                if not name:
                    continue
                tid = self._tag_id(name, kind)
                self.conn.execute(
                    "INSERT INTO image_tags(image_id, tag_id, weight, source) VALUES (?,?,1.0,'user') "
                    "ON CONFLICT(image_id, tag_id) DO UPDATE SET source='user'", (image_id, tid))
                added.append(name)
            self.conn.commit()
        return added

    def remove_tags(self, image_id: int, names: Iterable[str], kind: str | None = "user") -> int:
        n = 0
        with self._write_lock:
            for raw in names:
                name = normalize_tag(raw)
                sql = "DELETE FROM image_tags WHERE image_id=? AND tag_id IN (SELECT id FROM tags WHERE name=?"
                args: list[Any] = [image_id, name]
                if kind:
                    sql += " AND kind=?"
                    args.append(kind)
                n += self.conn.execute(sql + ")", args).rowcount
            self.conn.commit()
        return n

    def bulk_add_tags(self, image_ids: Iterable[int], names: list[str]) -> int:
        ids = list(image_ids)
        for i in ids:
            self.add_tags(i, names)
        return len(ids)

    # -------------------------------------------------------------- import
    def add_file(self, path: str | Path, force: bool = False, copy_to_vault: bool | None = None) -> str:
        """Index one PNG. Returns 'added' | 'updated' | 'moved' | 'skipped' | 'error'."""
        p = Path(path).resolve()
        try:
            st = p.stat()
        except OSError:
            return "error"
        c = self.conn
        row = c.execute("SELECT id, size, mtime, vault_path FROM images WHERE path=?", (str(p),)).fetchone()
        if row and not force and row["size"] == st.st_size and abs((row["mtime"] or 0) - st.st_mtime) < 1e-3:
            return "skipped"
        try:
            info = read_png_info(p)
            sha1 = file_sha1(p)
        except (PNGError, OSError, ValueError):
            return "error"

        do_vault = self.auto_vault if copy_to_vault is None else copy_to_vault
        vault_path = str(self._store_in_vault(sha1, src_path=p)) if do_vault else (row["vault_path"] if row else None)

        meta = parse_metadata(info.text)
        seed = meta.params.get("seed")
        values = dict(vault_path=vault_path, sha1=sha1, size=st.st_size, mtime=st.st_mtime,
                      width=info.width, height=info.height,
                      generator=meta.generator, prompt=meta.prompt, negative=meta.negative, model=meta.model,
                      seed=seed if isinstance(seed, int) and abs(seed) < 2 ** 63 else None,
                      params=json.dumps(meta.params, ensure_ascii=False, default=str),
                      raw=json.dumps(meta.raw, ensure_ascii=False), updated_at=_now())
        status = "updated"
        with self._write_lock:
            if row is None:
                # same file moved/renamed? keep its user data
                moved = c.execute("SELECT id, path FROM images WHERE sha1=?", (sha1,)).fetchall()
                moved = next((m for m in moved if not Path(m["path"]).exists()), None)
                if moved:
                    image_id, status = moved["id"], "moved"
                    c.execute("UPDATE images SET path=? WHERE id=?", (str(p), image_id))
                else:
                    genel = c.execute("SELECT id FROM workspaces WHERE name='Genel' LIMIT 1").fetchone()
                    default_ws = genel[0] if genel else None
                    cur = c.execute("INSERT INTO images(path, added_at, workspace_id) VALUES (?, ?, ?)", (str(p), _now(), default_ws))
                    image_id, status = cur.lastrowid, "added"
            else:
                image_id = row["id"]
            c.execute(f"UPDATE images SET {', '.join(f'{k}=?' for k in values)} WHERE id=?",
                      (*values.values(), image_id))
            self._set_auto_tags(image_id, meta)
            c.commit()
        return status

    def add_bytes(self, data: bytes, filename: str = "upload.png",
                  prompt: str | None = None, negative: str | None = None,
                  params: dict[str, Any] | None = None, model: str | None = None,
                  generator: str | None = None, tags: list[str] | None = None,
                  rating: int = 0, notes: str = "", workspace_id: int | None = None) -> dict[str, Any]:
        """Add a single image from raw bytes directly into the vault with optional custom prompt."""
        sha1 = bytes_sha1(data)
        vault_file = self._store_in_vault(sha1, data=data)
        vault_path_str = str(vault_file)

        if workspace_id is None:
            genel = self.conn.execute("SELECT id FROM workspaces WHERE name='Genel' LIMIT 1").fetchone()
            workspace_id = genel[0] if genel else None

        # Read any embedded PNG info
        width, height = 0, 0
        raw_meta: dict[str, str] = {}
        try:
            import io
            info = read_png_info(io.BytesIO(data))
            width, height = info.width, info.height
            raw_meta = info.text
            parsed = parse_metadata(raw_meta)
        except Exception:
            parsed = ParsedMeta()
            try:
                from PIL import Image
                import io
                with Image.open(io.BytesIO(data)) as im:
                    width, height = im.size
            except Exception:
                pass

        # User overrides or explicit entries take precedence
        final_prompt = prompt.strip() if prompt is not None else parsed.prompt
        final_negative = negative.strip() if negative is not None else parsed.negative
        final_model = model.strip() if model is not None else parsed.model
        final_generator = generator.strip() if generator is not None else (parsed.generator if parsed.generator != "none" else "manual")

        merged_params = dict(parsed.params)
        if params:
            merged_params.update(params)

        seed = merged_params.get("seed")

        c = self.conn
        with self._write_lock:
            # Check if this SHA1 already exists
            row = c.execute("SELECT id, path FROM images WHERE sha1=?", (sha1,)).fetchone()
            if row:
                image_id = row["id"]
                c.execute("""UPDATE images SET vault_path=?, prompt=?, negative=?, model=?,
                             params=?, rating=COALESCE(NULLIF(?,0), rating), notes=COALESCE(NULLIF(?,''), notes),
                             workspace_id=COALESCE(?, workspace_id), updated_at=? WHERE id=?""",
                          (vault_path_str, final_prompt, final_negative, final_model,
                           json.dumps(merged_params, ensure_ascii=False, default=str),
                           rating, notes, workspace_id, _now(), image_id))
            else:
                unique_path = f"[vault]/{Path(filename).stem}_{sha1[:8]}.png"
                cur = c.execute("""
                    INSERT INTO images(path, vault_path, sha1, size, mtime, width, height, generator,
                                       prompt, negative, model, seed, params, raw, rating, notes, workspace_id, added_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (unique_path, vault_path_str, sha1, len(data), datetime.now().timestamp(),
                      width, height, final_generator, final_prompt, final_negative, final_model,
                      seed if isinstance(seed, int) and abs(seed) < 2 ** 63 else None,
                      json.dumps(merged_params, ensure_ascii=False, default=str),
                      json.dumps(raw_meta, ensure_ascii=False),
                      rating, notes, workspace_id, _now(), _now()))
                image_id = cur.lastrowid

            meta_for_tags = ParsedMeta(
                generator=final_generator,
                prompt=final_prompt,
                negative=final_negative,
                params=merged_params,
                loras=parsed.loras,
            )
            self._set_auto_tags(image_id, meta_for_tags)
            if tags:
                for t in tags:
                    name = normalize_tag(t)
                    if name:
                        tid = self._tag_id(name, "user")
                        c.execute("INSERT OR IGNORE INTO image_tags(image_id, tag_id, weight, source) VALUES (?,?,1.0,'user')",
                                  (image_id, tid))
            c.commit()

        return self.get(image_id) or {}

    def scan(self, folder: str | Path, recursive: bool = True, force: bool = False,
             progress: Callable[[dict[str, Any]], None] | None = None) -> dict[str, Any]:
        folder = Path(folder).expanduser()
        if not folder.exists():
            raise FileNotFoundError(f"Klasör bulunamadı: {folder}")
        files = [folder] if folder.is_file() else \
            sorted(p for p in (folder.rglob("*") if recursive else folder.glob("*"))
                   if p.is_file() and p.suffix.lower() == ".png")
        stats: dict[str, Any] = {"total": len(files), "done": 0, "added": 0, "updated": 0,
                                 "moved": 0, "skipped": 0, "error": 0}
        for f in files:
            stats[self.add_file(f, force=force)] += 1
            stats["done"] += 1
            if progress:
                progress(dict(stats, current=str(f)))
        return stats

    def prune(self, purge_vault: bool = False) -> int:
        """Remove records whose source files no longer exist.
        
        IMPORTANT: Records backed by a vault copy (vault_path) are ALWAYS PRESERVED
        unless purge_vault=True is explicitly specified.
        """
        to_delete = []
        for r in self.conn.execute("SELECT id, path, vault_path FROM images"):
            path_exists = Path(r["path"]).exists() if r["path"] and not r["path"].startswith("[vault]") else False
            vault_exists = Path(r["vault_path"]).exists() if r["vault_path"] else False
            if not path_exists:
                if vault_exists and not purge_vault:
                    continue  # Safe inside the vault!
                to_delete.append(r["id"])

        with self._write_lock:
            self.conn.executemany("DELETE FROM images WHERE id=?", [(i,) for i in to_delete])
            self.conn.execute("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM image_tags)")
            self.conn.commit()
        return len(to_delete)

    def delete_image(self, image_id: int, delete_vault_file: bool = True, delete_original: bool = False) -> bool:
        """Delete an image record from the vault.

        Args:
            image_id: ID of the image to delete.
            delete_vault_file: If True, delete the internal vault copy and its thumbnail.
            delete_original: If True and the image has an external disk path, also delete that file.
        """
        row = self.conn.execute("SELECT id, path, vault_path, sha1 FROM images WHERE id=?", (image_id,)).fetchone()
        if not row:
            return False

        orig_path = row["path"]
        vault_path = row["vault_path"]
        sha1 = row["sha1"]

        with self._write_lock:
            self.conn.execute("DELETE FROM images WHERE id=?", (image_id,))
            self.conn.execute("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM image_tags)")
            self.conn.commit()

        if delete_vault_file:
            if vault_path:
                try:
                    vp = Path(vault_path)
                    if vp.exists():
                        vp.unlink()
                except OSError:
                    pass
            if sha1:
                thumb = self.data_dir / "thumbs" / f"{sha1}.webp"
                if thumb.exists():
                    try:
                        thumb.unlink()
                    except OSError:
                        pass

        if delete_original and orig_path and not orig_path.startswith("[vault]"):
            try:
                op = Path(orig_path)
                if op.exists():
                    op.unlink()
            except OSError:
                pass

        return True

    def bulk_delete(self, image_ids: Iterable[int], delete_vault_file: bool = True, delete_original: bool = False) -> int:
        """Delete multiple images by their IDs."""
        count = 0
        for i in list(image_ids):
            if self.delete_image(i, delete_vault_file=delete_vault_file, delete_original=delete_original):
                count += 1
        return count

    # -------------------------------------------------------------- query
    def _fts_cond(self, term: str, columns: str) -> tuple[str, list[Any]]:
        if self.fts:
            phrase = '"' + term.replace('"', '""') + '"'
            if " " not in term:
                phrase += "*"
            return ("i.id IN (SELECT rowid FROM images_fts WHERE images_fts MATCH ?)",
                    [f"{{{columns}}} : {phrase}"])
        cols = columns.split()
        return ("(" + " OR ".join(f"i.{c} LIKE ?" for c in cols) + ")", [f"%{term}%"] * len(cols))

    def search(self, query: str = "", sort: str = "added", limit: int = 60, offset: int = 0,
               workspace_id: int | None = None) -> tuple[int, list[dict[str, Any]]]:
        q = parse_query(query)
        where: list[str] = []
        args: list[Any] = []
        if workspace_id is not None:
            where.append("i.workspace_id = ?")
            args.append(workspace_id)
        for ws in q.get("workspaces", []):
            where.append("i.workspace_id IN (SELECT id FROM workspaces WHERE name LIKE ?)")
            args.append(f"%{ws}%")
        for term in q["text"]:
            cond_fts, a_fts = self._fts_cond(term, "prompt notes")
            norm = normalize_tag(term)
            cond_tag = "i.id IN (SELECT it.image_id FROM image_tags it JOIN tags t ON t.id=it.tag_id WHERE t.name=? OR t.name LIKE ?)"
            where.append(f"({cond_fts} OR {cond_tag})")
            args += a_fts + [norm, f"%{norm}%"]
        for term in q["not_text"]:
            cond_fts, a_fts = self._fts_cond(term, "prompt notes")
            norm = normalize_tag(term)
            cond_tag = "i.id IN (SELECT it.image_id FROM image_tags it JOIN tags t ON t.id=it.tag_id WHERE t.name=? OR t.name LIKE ?)"
            where.append(f"NOT ({cond_fts} OR {cond_tag})")
            args += a_fts + [norm, f"%{norm}%"]
        for term in q["neg"]:
            cond, a = self._fts_cond(term, "negative")
            where.append(cond)
            args += a
        for tag in q["tags"]:
            norm = normalize_tag(tag)
            where.append("i.id IN (SELECT it.image_id FROM image_tags it JOIN tags t ON t.id=it.tag_id WHERE t.name=? OR t.name LIKE ?)")
            args += [norm, f"%{norm}%"]
        for tag in q["not_tags"]:
            norm = normalize_tag(tag)
            where.append("i.id NOT IN (SELECT it.image_id FROM image_tags it JOIN tags t ON t.id=it.tag_id WHERE t.name=? OR t.name LIKE ?)")
            args += [norm, f"%{norm}%"]
        for lora in q["loras"]:
            where.append("i.id IN (SELECT it.image_id FROM image_tags it JOIN tags t ON t.id=it.tag_id "
                         "WHERE t.kind='lora' AND t.name LIKE ?)")
            args.append(f"%{normalize_tag(lora)}%")
        for model in q["models"]:
            where.append("i.model LIKE ?")
            args.append(f"%{model}%")
        if q["generators"]:
            where.append(f"i.generator IN ({','.join('?' * len(q['generators']))})")
            args += q["generators"]
        if q["favorite"] is not None:
            where.append("i.favorite = ?")
            args.append(1 if q["favorite"] else 0)
        if q["rating"]:
            op, val = q["rating"]
            where.append(f"i.rating {op} ?")
            args.append(val)
        if q["seed"] is not None:
            where.append("i.seed = ?")
            args.append(q["seed"])
        for col, op, val in q["size"]:
            where.append(f"i.{col} {op} ?")
            args.append(val)
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        c = self.conn
        total = c.execute(f"SELECT COUNT(*) FROM images i {clause}", args).fetchone()[0]
        rows = c.execute(
            f"SELECT i.id, i.path, i.vault_path, i.sha1, i.width, i.height, i.generator, i.prompt, i.model, i.seed, "
            f"i.rating, i.favorite, i.workspace_id, w.name as workspace_name, w.color as workspace_color, w.icon as workspace_icon "
            f"FROM images i LEFT JOIN workspaces w ON i.workspace_id = w.id {clause} "
            f"ORDER BY {SORTS.get(sort, SORTS['added'])} "
            f"LIMIT ? OFFSET ?", (*args, limit, offset)).fetchall()
        return total, [dict(r) for r in rows]

    def get(self, image_id: int) -> dict[str, Any] | None:
        row = self.conn.execute("""
            SELECT i.*, w.name as workspace_name, w.color as workspace_color, w.icon as workspace_icon
            FROM images i LEFT JOIN workspaces w ON i.workspace_id = w.id
            WHERE i.id=?
        """, (image_id,)).fetchone()
        if row is None:
            return None
        d = dict(row)
        d["params"] = json.loads(d["params"] or "{}")
        d["raw"] = json.loads(d["raw"] or "{}")
        orig_path = Path(d["path"]) if d["path"] and not d["path"].startswith("[vault]") else None
        d["original_exists"] = bool(orig_path and orig_path.exists())
        d["vault_exists"] = bool(d["vault_path"] and Path(d["vault_path"]).exists())
        d["tags"] = [dict(r) for r in self.conn.execute(
            "SELECT t.name, t.kind, it.weight, it.source FROM image_tags it JOIN tags t ON t.id=it.tag_id "
            "WHERE it.image_id=? ORDER BY t.kind, it.rowid", (image_id,))]
        return d

    def update(self, image_id: int, **fields: Any) -> None:
        """Update image fields. Supports rating, favorite, notes, prompt, negative, model, generator, seed, params, workspace_id."""
        allowed_keys = ("rating", "favorite", "notes", "prompt", "negative", "model", "generator", "seed", "params", "workspace_id")
        allowed = {k: v for k, v in fields.items() if k in allowed_keys and v is not None}
        if "rating" in allowed:
            allowed["rating"] = max(0, min(5, int(allowed["rating"])))
        if "favorite" in allowed:
            allowed["favorite"] = 1 if allowed["favorite"] else 0
        if "params" in allowed and isinstance(allowed["params"], dict):
            allowed["params"] = json.dumps(allowed["params"], ensure_ascii=False)
        if not allowed:
            return

        allowed["updated_at"] = _now()
        with self._write_lock:
            self.conn.execute(f"UPDATE images SET {', '.join(f'{k}=?' for k in allowed)} WHERE id=?",
                              (*allowed.values(), image_id))

            # If prompt or model changed, refresh auto tags
            if "prompt" in allowed or "model" in allowed:
                cur = self.get(image_id)
                if cur:
                    loras = [(t["name"], t["weight"]) for t in cur["tags"] if t["kind"] == "lora"]
                    params = dict(cur.get("params") or {})
                    if cur.get("model"):
                        params["model"] = cur["model"]
                    meta = ParsedMeta(
                        generator=cur.get("generator") or "manual",
                        prompt=cur.get("prompt") or "",
                        negative=cur.get("negative") or "",
                        params=params,
                        loras=loras,
                    )
                    self._set_auto_tags(image_id, meta)

            self.conn.commit()

    def tag_stats(self, kind: str | None = None, prefix: str = "", limit: int = 200,
                  query: str = "") -> list[dict[str, Any]]:
        where, args = [], []
        if kind:
            where.append("t.kind=?")
            args.append(kind)
        if prefix:
            where.append("t.name LIKE ?")
            args.append(f"%{prefix.lower()}%")
        if query:
            _, ids = self.search(query, limit=1_000_000)
            if not ids:
                return []
            where.append(f"it.image_id IN ({','.join(str(int(r['id'])) for r in ids)})")
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        rows = self.conn.execute(
            f"SELECT t.name, t.kind, COUNT(*) AS count, ROUND(AVG(it.weight), 3) AS avg_weight "
            f"FROM image_tags it JOIN tags t ON t.id=it.tag_id {clause} "
            f"GROUP BY t.id ORDER BY count DESC, t.name LIMIT ?", (*args, limit)).fetchall()
        return [dict(r) for r in rows]

    def stats(self) -> dict[str, Any]:
        c = self.conn
        return {
            "images": c.execute("SELECT COUNT(*) FROM images").fetchone()[0],
            "with_prompt": c.execute("SELECT COUNT(*) FROM images WHERE prompt != ''").fetchone()[0],
            "favorites": c.execute("SELECT COUNT(*) FROM images WHERE favorite=1").fetchone()[0],
            "tags": c.execute("SELECT COUNT(*) FROM tags").fetchone()[0],
            "workspaces": c.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0],
            "generators": {r[0] or "none": r[1] for r in c.execute(
                "SELECT generator, COUNT(*) FROM images GROUP BY generator ORDER BY 2 DESC")},
            "models": {r[0]: r[1] for r in c.execute(
                "SELECT model, COUNT(*) FROM images WHERE model IS NOT NULL GROUP BY model ORDER BY 2 DESC LIMIT 20")},
            "fts": self.fts,
            "db_path": str(self.db_path),
            "vault_dir": str(self.vault_dir),
        }

    # ------------------------------------------------- matrices & wildcards
    def save_matrix(self, name: str, spec: dict[str, Any]) -> None:
        with self._write_lock:
            self.conn.execute(
                "INSERT INTO matrices(name, spec, updated_at) VALUES (?,?,?) "
                "ON CONFLICT(name) DO UPDATE SET spec=excluded.spec, updated_at=excluded.updated_at",
                (name, json.dumps(spec, ensure_ascii=False), _now()))
            self.conn.commit()

    def list_matrices(self) -> list[dict[str, Any]]:
        return [{"name": r["name"], "spec": json.loads(r["spec"]), "updated_at": r["updated_at"]}
                for r in self.conn.execute("SELECT * FROM matrices ORDER BY updated_at DESC")]

    def delete_matrix(self, name: str) -> bool:
        with self._write_lock:
            n = self.conn.execute("DELETE FROM matrices WHERE name=?", (name,)).rowcount
            self.conn.commit()
        return n > 0

    def set_wildcard(self, name: str, items: list[str]) -> None:
        clean = [i.strip() for i in items if i.strip()]
        with self._write_lock:
            self.conn.execute(
                "INSERT INTO wildcards(name, items, updated_at) VALUES (?,?,?) "
                "ON CONFLICT(name) DO UPDATE SET items=excluded.items, updated_at=excluded.updated_at",
                (name.strip(), json.dumps(clean, ensure_ascii=False), _now()))
            self.conn.commit()

    def delete_wildcard(self, name: str) -> bool:
        with self._write_lock:
            n = self.conn.execute("DELETE FROM wildcards WHERE name=?", (name,)).rowcount
            self.conn.commit()
        return n > 0

    def wildcards(self, extra_dir: str | Path | None = None) -> dict[str, list[str]]:
        """Wildcards from an optional folder of ``*.txt`` files, overridden by DB entries."""
        out: dict[str, list[str]] = {}
        if extra_dir and Path(extra_dir).is_dir():
            base = Path(extra_dir)
            for f in base.rglob("*.txt"):
                name = f.relative_to(base).with_suffix("").as_posix()
                out[name] = f.read_text(encoding="utf-8", errors="replace").splitlines()
        for r in self.conn.execute("SELECT name, items FROM wildcards"):
            out[r["name"]] = json.loads(r["items"])
        return out

    def wildcard_from_tags(self, name: str, kind: str = "prompt", query: str = "", limit: int = 50) -> list[str]:
        items = [t["name"] for t in self.tag_stats(kind=kind, query=query, limit=limit)]
        self.set_wildcard(name, items)
        return items

    # ------------------------------------------------------------- workspaces
    def set_images_workspace(self, image_ids: Iterable[int], workspace_id: int | None) -> int:
        ids = list(image_ids)
        if not ids:
            return 0
        with self._write_lock:
            placeholders = ",".join("?" * len(ids))
            cur = self.conn.execute(
                f"UPDATE images SET workspace_id = ?, updated_at = ? WHERE id IN ({placeholders})",
                (workspace_id, _now(), *ids)
            )
            self.conn.commit()
            return cur.rowcount

    def list_workspaces(self) -> list[dict[str, Any]]:
        c = self.conn
        query = """
            SELECT w.*,
                   (SELECT COUNT(*) FROM images WHERE workspace_id = w.id) as image_count
            FROM workspaces w
            ORDER BY w.name ASC
        """
        rows = c.execute(query).fetchall()
        return [dict(r) for r in rows]

    def get_workspace(self, ws_id: int) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM workspaces WHERE id=?", (ws_id,)).fetchone()
        return dict(row) if row else None

    def create_workspace(self, name: str, description: str = "", color: str = "#8b5cf6", icon: str = "🎨") -> dict[str, Any]:
        name = name.strip()
        if not name:
            raise ValueError("Çalışma alanı adı boş olamaz")
        now = _now()
        with self._write_lock:
            cur = self.conn.execute(
                "INSERT INTO workspaces (name, description, color, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (name, description, color, icon, now, now)
            )
            self.conn.commit()
            return self.get_workspace(cur.lastrowid)

    def update_workspace(self, ws_id: int, **fields: Any) -> dict[str, Any] | None:
        ws = self.get_workspace(ws_id)
        if not ws:
            return None
        updates = []
        vals = []
        for k in ("name", "description", "color", "icon"):
            if k in fields and fields[k] is not None:
                val = fields[k].strip() if isinstance(fields[k], str) else fields[k]
                if k == "name" and not val:
                    raise ValueError("Çalışma alanı adı boş olamaz")
                updates.append(f"{k} = ?")
                vals.append(val)
        if not updates:
            return ws
        updates.append("updated_at = ?")
        vals.append(_now())
        vals.append(ws_id)
        with self._write_lock:
            self.conn.execute(f"UPDATE workspaces SET {', '.join(updates)} WHERE id = ?", vals)
            self.conn.commit()
        return self.get_workspace(ws_id)

    def delete_workspace(self, ws_id: int) -> bool:
        ws = self.get_workspace(ws_id)
        if not ws:
            return False
        if ws["name"] == "Genel":
            raise ValueError("Varsayılan 'Genel' çalışma alanı silinemez")
        genel = self.conn.execute("SELECT id FROM workspaces WHERE name='Genel' LIMIT 1").fetchone()
        genel_id = genel[0] if genel else None
        with self._write_lock:
            self.conn.execute("UPDATE images SET workspace_id = ? WHERE workspace_id = ?", (genel_id, ws_id))
            cur = self.conn.execute("DELETE FROM workspaces WHERE id = ?", (ws_id,))
            self.conn.commit()
            return cur.rowcount > 0
