"""SQLite-backed music and Suno AI song library with workspace segmentation and FTS5 search."""
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
from typing import Any, Callable

from .models import ParsedSong, Song, Workspace
from .parser import extract_lyric_sections, extract_style_tags, parse_suno_txt

MUSIC_SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS music_workspaces (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    color TEXT DEFAULT '#8b5cf6',
    icon TEXT DEFAULT '🎵',
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY,
    suno_id TEXT,
    title TEXT NOT NULL,
    style TEXT DEFAULT '',
    lyrics TEXT DEFAULT '',
    model TEXT DEFAULT 'Suno AI',
    created_at TEXT DEFAULT '',
    suno_url TEXT DEFAULT '',
    workspace_id INTEGER REFERENCES music_workspaces(id) ON DELETE SET NULL,
    artist TEXT DEFAULT '',
    persona TEXT DEFAULT '',
    audio_path TEXT DEFAULT '',
    vault_audio_path TEXT DEFAULT '',
    txt_path TEXT DEFAULT '',
    vault_txt_path TEXT DEFAULT '',
    synced_lyrics TEXT DEFAULT '',
    lrc_content TEXT DEFAULT '',
    srt_content TEXT DEFAULT '',
    has_synced_lyrics INTEGER DEFAULT 0,
    vault_lrc_path TEXT DEFAULT '',
    vault_srt_path TEXT DEFAULT '',
    rating INTEGER DEFAULT 0,
    favorite INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    duration REAL,
    sha1 TEXT DEFAULT '',
    added_at TEXT,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS ix_songs_suno_id ON songs(suno_id);
CREATE INDEX IF NOT EXISTS ix_songs_ws ON songs(workspace_id);
CREATE INDEX IF NOT EXISTS ix_songs_artist ON songs(artist);
CREATE INDEX IF NOT EXISTS ix_songs_rating ON songs(rating);
CREATE INDEX IF NOT EXISTS ix_songs_favorite ON songs(favorite);

CREATE TABLE IF NOT EXISTS song_tags (
    id INTEGER PRIMARY KEY,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'style',
    UNIQUE(song_id, name, kind)
);

CREATE INDEX IF NOT EXISTS ix_song_tags_name ON song_tags(name);
CREATE INDEX IF NOT EXISTS ix_song_tags_song ON song_tags(song_id);
"""

MUSIC_FTS_SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(
    title, style, lyrics, artist, persona, notes,
    content='songs', content_rowid='id', tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS songs_ai AFTER INSERT ON songs BEGIN
  INSERT INTO songs_fts(rowid, title, style, lyrics, artist, persona, notes)
  VALUES (new.id, new.title, new.style, new.lyrics, new.artist, new.persona, new.notes);
END;

CREATE TRIGGER IF NOT EXISTS songs_ad AFTER DELETE ON songs BEGIN
  INSERT INTO songs_fts(songs_fts, rowid, title, style, lyrics, artist, persona, notes)
  VALUES ('delete', old.id, old.title, old.style, old.lyrics, old.artist, old.persona, old.notes);
END;

CREATE TRIGGER IF NOT EXISTS songs_au AFTER UPDATE OF title, style, lyrics, artist, persona, notes ON songs BEGIN
  INSERT INTO songs_fts(songs_fts, rowid, title, style, lyrics, artist, persona, notes)
  VALUES ('delete', old.id, old.title, old.style, old.lyrics, old.artist, old.persona, old.notes);
  INSERT INTO songs_fts(rowid, title, style, lyrics, artist, persona, notes)
  VALUES (new.id, new.title, new.style, new.lyrics, new.artist, new.persona, new.notes);
END;
"""

AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac"}
TXT_EXTENSIONS = {".txt"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def compute_file_sha1(path: str | Path) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


class MusicLibrary:
    """Manages the music library, workspaces, Suno songs, and search index."""

    def __init__(self, db_path: str | Path | None = None, vault_dir: str | Path | None = None):
        if db_path is None:
            data_home = Path.home() / ".promptvault"
            data_home.mkdir(parents=True, exist_ok=True)
            self.db_path = data_home / "library.db"
        else:
            self.db_path = Path(db_path)

        self.data_dir = self.db_path.parent
        self.data_dir.mkdir(parents=True, exist_ok=True)

        if vault_dir is None:
            self.vault_dir = self.data_dir / "music_vault"
        else:
            self.vault_dir = Path(vault_dir)
        self.vault_dir.mkdir(parents=True, exist_ok=True)

        self._local = threading.local()
        self._init_db()

    @property
    def conn(self) -> sqlite3.Connection:
        c = getattr(self._local, "conn", None)
        if c is None:
            c = sqlite3.connect(str(self.db_path), timeout=30.0)
            c.row_factory = sqlite3.Row
            c.execute("PRAGMA foreign_keys = ON")
            self._local.conn = c
        return c

    def _init_db(self) -> None:
        c = self.conn
        with c:
            c.executescript(MUSIC_SCHEMA)
            # Schema migration: check if columns exist in songs
            cols = [r[1] for r in c.execute("PRAGMA table_info(songs)").fetchall()]
            if cols:
                if "persona" not in cols:
                    c.execute("ALTER TABLE songs ADD COLUMN persona TEXT DEFAULT ''")
                if "synced_lyrics" not in cols:
                    c.execute("ALTER TABLE songs ADD COLUMN synced_lyrics TEXT DEFAULT ''")
                if "lrc_content" not in cols:
                    c.execute("ALTER TABLE songs ADD COLUMN lrc_content TEXT DEFAULT ''")
                if "srt_content" not in cols:
                    c.execute("ALTER TABLE songs ADD COLUMN srt_content TEXT DEFAULT ''")
                if "has_synced_lyrics" not in cols:
                    c.execute("ALTER TABLE songs ADD COLUMN has_synced_lyrics INTEGER DEFAULT 0")
                if "vault_lrc_path" not in cols:
                    c.execute("ALTER TABLE songs ADD COLUMN vault_lrc_path TEXT DEFAULT ''")
                if "vault_srt_path" not in cols:
                    c.execute("ALTER TABLE songs ADD COLUMN vault_srt_path TEXT DEFAULT ''")
            c.execute("CREATE INDEX IF NOT EXISTS ix_songs_persona ON songs(persona)")

            # Check if songs_fts needs migration (e.g. persona column)
            fts_cols = [r[1] for r in c.execute("PRAGMA table_info(songs_fts)").fetchall()]
            if fts_cols and "persona" not in fts_cols:
                c.execute("DROP TRIGGER IF EXISTS songs_ai")
                c.execute("DROP TRIGGER IF EXISTS songs_ad")
                c.execute("DROP TRIGGER IF EXISTS songs_au")
                c.execute("DROP TABLE IF EXISTS songs_fts")

            c.executescript(MUSIC_FTS_SCHEMA)
            # Create music_workspaces table if not exists
            c.execute("""
            CREATE TABLE IF NOT EXISTS music_workspaces (
                id INTEGER PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                description TEXT DEFAULT '',
                color TEXT DEFAULT '#8b5cf6',
                icon TEXT DEFAULT '🎵',
                created_at TEXT,
                updated_at TEXT
            );
            """)

            # Migration: if music_workspaces is empty, populate from existing workspaces or default
            count = c.execute("SELECT COUNT(*) FROM music_workspaces").fetchone()[0]
            if count == 0:
                has_old_ws = c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'").fetchone() is not None
                if has_old_ws:
                    old_rows = c.execute("SELECT * FROM workspaces").fetchall()
                    for r in old_rows:
                        c.execute(
                            "INSERT OR IGNORE INTO music_workspaces (id, name, description, color, icon, created_at, updated_at) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?)",
                            (r["id"], r["name"], r["description"] or "", r["color"] or "#8b5cf6", r["icon"] or "🎵", r["created_at"], r["updated_at"])
                        )
                now = _now()
                c.execute(
                    "INSERT OR IGNORE INTO music_workspaces (name, description, color, icon, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    ("Genel", "Varsayılan müzik alanı", "#8b5cf6", "🎵", now, now)
                )

            # Ensure songs with missing or invalid workspace_id are pointed to Genel
            genel_row = c.execute("SELECT id FROM music_workspaces WHERE name='Genel' LIMIT 1").fetchone()
            if genel_row:
                c.execute(
                    "UPDATE songs SET workspace_id = ? WHERE workspace_id IS NULL OR workspace_id NOT IN (SELECT id FROM music_workspaces)",
                    (genel_row[0],)
                )

            # Clean up music-only workspaces from old shared workspaces table if present
            has_old_ws = c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'").fetchone() is not None
            has_images = c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='images'").fetchone() is not None
            if has_old_ws and has_images:
                c.execute("UPDATE workspaces SET icon='🎨' WHERE name='Genel' AND icon='🎵'")
                c.execute("""
                    DELETE FROM workspaces
                    WHERE id IN (
                        SELECT w.id FROM workspaces w
                        JOIN music_workspaces mw ON mw.name = w.name
                        WHERE (SELECT COUNT(*) FROM images WHERE workspace_id = w.id) = 0
                          AND (SELECT COUNT(*) FROM songs WHERE workspace_id = mw.id) > 0
                    )
                """)

    def close(self) -> None:
        c = getattr(self._local, "conn", None)
        if c is not None:
            c.close()
            self._local.conn = None

    # ------------------------------------------------------------- Workspaces
    def list_workspaces(self) -> list[dict[str, Any]]:
        c = self.conn
        query = """
            SELECT w.*,
                   (SELECT COUNT(*) FROM songs WHERE workspace_id = w.id) as song_count
            FROM music_workspaces w
            ORDER BY w.name ASC
        """
        rows = c.execute(query).fetchall()
        return [dict(r) for r in rows]

    def create_workspace(
        self,
        name: str,
        description: str = "",
        color: str = "#8b5cf6",
        icon: str = "🎵"
    ) -> dict[str, Any]:
        name = name.strip()
        if not name:
            raise ValueError("Çalışma alanı adı boş olamaz")
        now = _now()
        with self.conn as c:
            cur = c.execute(
                "INSERT INTO music_workspaces (name, description, color, icon, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (name, description.strip(), color.strip() or "#8b5cf6", icon.strip() or "🎵", now, now)
            )
            ws_id = cur.lastrowid
        return self.get_workspace(ws_id)

    def get_workspace(self, workspace_id: int) -> dict[str, Any] | None:
        c = self.conn
        query = """
            SELECT w.*, COUNT(s.id) as song_count
            FROM music_workspaces w
            LEFT JOIN songs s ON s.workspace_id = w.id
            WHERE w.id = ?
            GROUP BY w.id
        """
        row = c.execute(query, (workspace_id,)).fetchone()
        return dict(row) if row else None

    def update_workspace(
        self,
        workspace_id: int,
        name: str | None = None,
        description: str | None = None,
        color: str | None = None,
        icon: str | None = None,
    ) -> dict[str, Any] | None:
        ws = self.get_workspace(workspace_id)
        if not ws:
            return None
        fields: list[str] = ["updated_at = ?"]
        values: list[Any] = [_now()]
        if name is not None:
            fields.append("name = ?")
            values.append(name.strip())
        if description is not None:
            fields.append("description = ?")
            values.append(description.strip())
        if color is not None:
            fields.append("color = ?")
            values.append(color.strip())
        if icon is not None:
            fields.append("icon = ?")
            values.append(icon.strip())

        values.append(workspace_id)
        sql = f"UPDATE music_workspaces SET {', '.join(fields)} WHERE id = ?"
        with self.conn as c:
            c.execute(sql, values)
        return self.get_workspace(workspace_id)

    def delete_workspace(self, workspace_id: int) -> bool:
        ws = self.get_workspace(workspace_id)
        if not ws:
            return False
        if ws["name"] == "Genel":
            raise ValueError("Varsayılan 'Genel' çalışma alanı silinemez")
        genel = self.conn.execute("SELECT id FROM music_workspaces WHERE name='Genel' LIMIT 1").fetchone()
        genel_id = genel[0] if genel else None
        with self.conn as c:
            if genel_id:
                c.execute("UPDATE songs SET workspace_id = ? WHERE workspace_id = ?", (genel_id, workspace_id))
            cur = c.execute("DELETE FROM music_workspaces WHERE id = ?", (workspace_id,))
            return cur.rowcount > 0

    # ---------------------------------------------------------------- Songs
    def get_song(self, song_id: int) -> dict[str, Any] | None:
        c = self.conn
        query = """
            SELECT s.*, w.name as workspace_name, w.color as workspace_color, w.icon as workspace_icon
            FROM songs s
            LEFT JOIN music_workspaces w ON s.workspace_id = w.id
            WHERE s.id = ?
        """
        row = c.execute(query, (song_id,)).fetchone()
        if not row:
            return None
        data = dict(row)
        data["has_audio"] = bool(data.get("vault_audio_path") or data.get("audio_path"))
        data["has_synced_lyrics"] = bool(data.get("has_synced_lyrics") or data.get("synced_lyrics"))
        data["tags"] = self.get_song_tags(song_id)
        return data

    def get_song_tags(self, song_id: int) -> list[dict[str, Any]]:
        c = self.conn
        rows = c.execute(
            "SELECT name, kind FROM song_tags WHERE song_id = ? ORDER BY kind, name",
            (song_id,)
        ).fetchall()
        return [dict(r) for r in rows]

    def add_song(
        self,
        title: str,
        style: str = "",
        lyrics: str = "",
        suno_id: str = "",
        model: str = "Suno AI",
        persona: str = "",
        created_at: str = "",
        suno_url: str = "",
        workspace_id: int | None = None,
        artist: str = "",
        audio_path: str | Path | None = None,
        txt_path: str | Path | None = None,
        rating: int = 0,
        favorite: bool = False,
        notes: str = "",
        tags: list[str] | None = None,
    ) -> dict[str, Any]:
        """Adds a song to the library and copies files to the music vault."""
        now = _now()
        sha1 = ""
        vault_audio_rel = ""
        vault_txt_rel = ""
        effective_artist = artist.strip() or persona.strip()
        if workspace_id is None:
            genel = self.conn.execute("SELECT id FROM music_workspaces WHERE name='Genel' LIMIT 1").fetchone()
            workspace_id = genel[0] if genel else None

        # Vault copy for audio
        if audio_path:
            p_audio = Path(audio_path)
            if p_audio.exists():
                sha1 = compute_file_sha1(p_audio)
                sub = self.vault_dir / sha1[:2]
                sub.mkdir(parents=True, exist_ok=True)
                dest = sub / f"{sha1}{p_audio.suffix}"
                if not dest.exists():
                    shutil.copy2(p_audio, dest)
                vault_audio_rel = str(dest.relative_to(self.vault_dir))

        # Vault copy for txt
        if txt_path:
            p_txt = Path(txt_path)
            if p_txt.exists():
                t_sha = compute_file_sha1(p_txt)
                sub = self.vault_dir / t_sha[:2]
                sub.mkdir(parents=True, exist_ok=True)
                dest = sub / f"{t_sha}.txt"
                if not dest.exists():
                    shutil.copy2(p_txt, dest)
                vault_txt_rel = str(dest.relative_to(self.vault_dir))

        # If duplicate suno_id already exists, update it instead of making redundant copies
        with self.conn as c:
            existing = None
            if suno_id:
                existing = c.execute("SELECT id FROM songs WHERE suno_id = ?", (suno_id,)).fetchone()
            
            if existing:
                song_id = existing[0]
                update_fields = [
                    "title = ?", "style = ?", "lyrics = ?", "model = ?",
                    "updated_at = ?"
                ]
                update_vals: list[Any] = [title, style, lyrics, model, now]
                if suno_url:
                    update_fields.append("suno_url = ?")
                    update_vals.append(suno_url)
                if workspace_id is not None:
                    update_fields.append("workspace_id = ?")
                    update_vals.append(workspace_id)
                if persona:
                    update_fields.append("persona = ?")
                    update_vals.append(persona)
                if effective_artist:
                    update_fields.append("artist = ?")
                    update_vals.append(effective_artist)
                if vault_audio_rel:
                    update_fields.append("vault_audio_path = ?")
                    update_vals.append(vault_audio_rel)
                    update_fields.append("audio_path = ?")
                    update_vals.append(str(audio_path))
                if vault_txt_rel:
                    update_fields.append("vault_txt_path = ?")
                    update_vals.append(vault_txt_rel)
                    update_fields.append("txt_path = ?")
                    update_vals.append(str(txt_path))

                update_vals.append(song_id)
                c.execute(f"UPDATE songs SET {', '.join(update_fields)} WHERE id = ?", update_vals)
            else:
                cur = c.execute(
                    """
                    INSERT INTO songs (
                        suno_id, title, style, lyrics, model, persona, created_at, suno_url,
                        workspace_id, artist, audio_path, vault_audio_path,
                        txt_path, vault_txt_path, rating, favorite, notes,
                        sha1, added_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        suno_id, title, style, lyrics, model, persona, created_at, suno_url,
                        workspace_id, effective_artist, str(audio_path) if audio_path else "",
                        vault_audio_rel, str(txt_path) if txt_path else "",
                        vault_txt_rel, rating, 1 if favorite else 0, notes,
                        sha1, now, now
                    )
                )
                song_id = cur.lastrowid

            # Add auto tags: style tags and lyric sections
            all_tags: list[tuple[str, str]] = []
            for st in extract_style_tags(style):
                all_tags.append((st, "style"))
            for sc in extract_lyric_sections(lyrics):
                all_tags.append((sc, "structure"))
            if tags:
                for ut in tags:
                    clean = ut.strip()
                    if clean:
                        all_tags.append((clean, "user"))

            for tag_name, tag_kind in all_tags:
                c.execute(
                    "INSERT OR IGNORE INTO song_tags (song_id, name, kind) VALUES (?, ?, ?)",
                    (song_id, tag_name, tag_kind)
                )

        return self.get_song(song_id)  # type: ignore

    def add_from_txt_file(
        self,
        txt_path: str | Path,
        audio_path: str | Path | None = None,
        workspace_id: int | None = None,
        artist: str = ""
    ) -> dict[str, Any]:
        p = Path(txt_path)
        content = p.read_text(encoding="utf-8", errors="replace")
        parsed = parse_suno_txt(content, filename=p.name)
        effective_artist = artist or parsed.persona
        return self.add_song(
            title=parsed.title,
            style=parsed.style,
            lyrics=parsed.lyrics,
            suno_id=parsed.suno_id,
            model=parsed.model,
            persona=parsed.persona,
            created_at=parsed.created_at,
            suno_url=parsed.suno_url,
            workspace_id=workspace_id,
            artist=effective_artist,
            audio_path=audio_path,
            txt_path=txt_path,
        )

    def scan_folder(
        self,
        folder_path: str | Path,
        workspace_id: int | None = None,
        artist: str = "",
        progress: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, int]:
        """Scans a directory for Suno metadata txt files and matching audio files."""
        root = Path(folder_path).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError(f"Geçersiz klasör: {root}")

        txt_files: list[Path] = []
        audio_map: dict[str, Path] = {}

        # 1. Collect all txt and audio files
        for p in root.rglob("*"):
            if not p.is_file():
                continue
            suf = p.suffix.lower()
            if suf in TXT_EXTENSIONS:
                txt_files.append(p)
            elif suf in AUDIO_EXTENSIONS:
                # Key by clean stem and lowercase
                audio_map[p.stem.lower()] = p

        added = 0
        updated = 0
        skipped = 0

        # Try to pair txt with audio files
        for idx, txt in enumerate(txt_files):
            try:
                content = txt.read_text(encoding="utf-8", errors="replace")
                parsed = parse_suno_txt(content, filename=txt.name)
                
                # Check for matching audio
                matched_audio: Path | None = None
                # Method A: exact stem without "_metadata"
                clean_stem = re.sub(r"_metadata$", "", txt.stem, flags=re.IGNORECASE).lower()
                if clean_stem in audio_map:
                    matched_audio = audio_map[clean_stem]
                # Method B: matching by suno_id substring
                if not matched_audio and parsed.suno_id:
                    for a_stem, a_path in audio_map.items():
                        if parsed.suno_id.lower() in a_stem:
                            matched_audio = a_path
                            break

                effective_artist = artist or parsed.persona
                self.add_song(
                    title=parsed.title,
                    style=parsed.style,
                    lyrics=parsed.lyrics,
                    suno_id=parsed.suno_id,
                    model=parsed.model,
                    persona=parsed.persona,
                    created_at=parsed.created_at,
                    suno_url=parsed.suno_url,
                    workspace_id=workspace_id,
                    artist=effective_artist,
                    audio_path=matched_audio,
                    txt_path=txt,
                )
                added += 1
            except Exception:
                skipped += 1

            if progress and (idx % 5 == 0 or idx == len(txt_files) - 1):
                progress({"scanned": idx + 1, "total": len(txt_files), "added": added, "skipped": skipped})

        return {"scanned": len(txt_files), "added": added, "skipped": skipped}

    def update_song(self, song_id: int, **fields: Any) -> dict[str, Any] | None:
        song = self.get_song(song_id)
        if not song:
            return None

        allowed = {
            "title", "style", "lyrics", "model", "persona", "workspace_id",
            "artist", "rating", "favorite", "notes", "suno_url",
            "synced_lyrics", "lrc_content", "srt_content", "has_synced_lyrics",
            "vault_lrc_path", "vault_srt_path"
        }
        updates: list[str] = ["updated_at = ?"]
        values: list[Any] = [_now()]

        for k, v in fields.items():
            if k in allowed:
                updates.append(f"{k} = ?")
                if k in ("favorite", "has_synced_lyrics"):
                    values.append(1 if v else 0)
                else:
                    values.append(v)

        values.append(song_id)
        with self.conn as c:
            c.execute(f"UPDATE songs SET {', '.join(updates)} WHERE id = ?", values)
        return self.get_song(song_id)

    def save_synced_lyrics(
        self,
        song_id: int,
        items: list[dict[str, Any]],
        latency_ms: int = 120,
    ) -> dict[str, Any] | None:
        """Saves synchronized lyrics, generates LRC and SRT formats, and archives to vault."""
        song = self.get_song(song_id)
        if not song:
            return None

        from .sync import generate_lrc, generate_srt

        # Compensate for human reaction delay (offset)
        offset_sec = max(0.0, float(latency_ms) / 1000.0)
        compensated_items: list[dict[str, Any]] = []
        for it in items:
            s = max(0.0, float(it.get("start", 0.0)) - offset_sec)
            e = max(s + 0.5, float(it.get("end", s + 3.0)) - offset_sec)
            txt = str(it.get("text", "")).strip()
            compensated_items.append({"start": round(s, 2), "end": round(e, 2), "text": txt})

        lrc_text = generate_lrc(
            compensated_items,
            title=song.get("title", ""),
            artist=song.get("artist", "") or song.get("persona", ""),
            album=song.get("workspace_name", "")
        )
        srt_text = generate_srt(compensated_items)

        # Archive LRC and SRT to music vault
        sub_dir = self.vault_dir / f"sync_{song_id}"
        sub_dir.mkdir(parents=True, exist_ok=True)
        lrc_file = sub_dir / f"{song_id}.lrc"
        srt_file = sub_dir / f"{song_id}.srt"
        lrc_file.write_text(lrc_text, encoding="utf-8")
        srt_file.write_text(srt_text, encoding="utf-8")

        vault_lrc_rel = str(lrc_file.relative_to(self.vault_dir))
        vault_srt_rel = str(srt_file.relative_to(self.vault_dir))
        synced_json = json.dumps(compensated_items, ensure_ascii=False)

        now = _now()
        with self.conn as c:
            c.execute(
                """
                UPDATE songs SET
                    synced_lyrics = ?,
                    lrc_content = ?,
                    srt_content = ?,
                    has_synced_lyrics = 1,
                    vault_lrc_path = ?,
                    vault_srt_path = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (synced_json, lrc_text, srt_text, vault_lrc_rel, vault_srt_rel, now, song_id)
            )

        return self.get_song(song_id)

    def delete_song(self, song_id: int, delete_vault_files: bool = True) -> bool:
        song = self.get_song(song_id)
        if not song:
            return False

        if delete_vault_files:
            if song.get("vault_audio_path"):
                va = self.vault_dir / song["vault_audio_path"]
                if va.exists():
                    try:
                        va.unlink()
                    except Exception:
                        pass
            if song.get("vault_txt_path"):
                vt = self.vault_dir / song["vault_txt_path"]
                if vt.exists():
                    try:
                        vt.unlink()
                    except Exception:
                        pass

        with self.conn as c:
            c.execute("DELETE FROM songs WHERE id = ?", (song_id,))
        return True

    def bulk_delete(self, ids: list[int]) -> int:
        count = 0
        for sid in ids:
            if self.delete_song(sid):
                count += 1
        return count

    def bulk_assign_workspace(self, ids: list[int], workspace_id: int | None) -> int:
        if not ids:
            return 0
        now = _now()
        placeholders = ",".join("?" * len(ids))
        with self.conn as c:
            cur = c.execute(
                f"UPDATE songs SET workspace_id = ?, updated_at = ? WHERE id IN ({placeholders})",
                [workspace_id, now, *ids]
            )
            return cur.rowcount

    def resolve_audio_path(self, song_id: int) -> Path | None:
        song = self.get_song(song_id)
        if not song:
            return None
        if song.get("vault_audio_path"):
            p = self.vault_dir / song["vault_audio_path"]
            if p.exists():
                return p
        if song.get("audio_path"):
            p = Path(song["audio_path"])
            if p.exists():
                return p
        return None

    # ------------------------------------------------------------- Search
    def search(
        self,
        q: str = "",
        workspace_id: int | None = None,
        artist: str | None = None,
        sort: str = "added",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[int, list[dict[str, Any]]]:
        c = self.conn
        where_clauses: list[str] = []
        params: list[Any] = []

        if workspace_id is not None:
            where_clauses.append("s.workspace_id = ?")
            params.append(workspace_id)

        if artist:
            where_clauses.append("s.artist LIKE ?")
            params.append(f"%{artist}%")

        # Parse query string tokens
        if q.strip():
            tokens = shlex.split(q)
            fts_words: list[str] = []
            for tok in tokens:
                tok = tok.strip()
                if not tok:
                    continue
                if tok.startswith("ws:"):
                    ws_name = tok[3:]
                    where_clauses.append(
                        "s.workspace_id IN (SELECT id FROM music_workspaces WHERE name LIKE ?)"
                    )
                    params.append(f"%{ws_name}%")
                elif tok.startswith("artist:"):
                    where_clauses.append("s.artist LIKE ?")
                    params.append(f"%{tok[7:]}%")
                elif tok.startswith("persona:"):
                    where_clauses.append("s.persona LIKE ?")
                    params.append(f"%{tok[8:]}%")
                elif tok.startswith("style:"):
                    where_clauses.append("s.style LIKE ?")
                    params.append(f"%{tok[6:]}%")
                elif tok.startswith("lyrics:"):
                    where_clauses.append("s.lyrics LIKE ?")
                    params.append(f"%{tok[7:]}%")
                elif tok.startswith("model:"):
                    where_clauses.append("s.model LIKE ?")
                    params.append(f"%{tok[6:]}%")
                elif tok == "is:fav":
                    where_clauses.append("s.favorite = 1")
                elif tok == "is:audio":
                    where_clauses.append("(s.vault_audio_path != '' OR s.audio_path != '')")
                elif tok == "is:synced":
                    where_clauses.append("s.has_synced_lyrics = 1")
                elif tok.startswith("rating:>="):
                    try:
                        where_clauses.append("s.rating >= ?")
                        params.append(int(tok[9:]))
                    except ValueError:
                        pass
                elif tok.startswith("rating:"):
                    try:
                        where_clauses.append("s.rating = ?")
                        params.append(int(tok[7:]))
                    except ValueError:
                        pass
                else:
                    # Generic search term -> match FTS or LIKE
                    clean_term = tok.replace('"', '""')
                    fts_words.append(f'"{clean_term}"*')

            if fts_words:
                match_str = " AND ".join(fts_words)
                where_clauses.append(
                    "s.id IN (SELECT rowid FROM songs_fts WHERE songs_fts MATCH ?)"
                )
                params.append(match_str)

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        sort_map = {
            "added": "s.added_at DESC, s.id DESC",
            "oldest": "s.added_at ASC, s.id ASC",
            "rating": "s.rating DESC, s.id DESC",
            "title": "s.title COLLATE NOCASE ASC",
            "artist": "s.artist COLLATE NOCASE ASC, s.title ASC",
        }
        sort_sql = sort_map.get(sort, sort_map["added"])

        # Count total
        count_sql = f"SELECT COUNT(*) FROM songs s {where_sql}"
        total = c.execute(count_sql, params).fetchone()[0]

        # Fetch items
        data_sql = f"""
            SELECT s.*, w.name as workspace_name, w.color as workspace_color, w.icon as workspace_icon
            FROM songs s
            LEFT JOIN music_workspaces w ON s.workspace_id = w.id
            {where_sql}
            ORDER BY {sort_sql}
            LIMIT ? OFFSET ?
        """
        rows = c.execute(data_sql, [*params, limit, offset]).fetchall()
        items = []
        for r in rows:
            d = dict(r)
            d["has_audio"] = bool(d.get("vault_audio_path") or d.get("audio_path"))
            d["has_synced_lyrics"] = bool(d.get("has_synced_lyrics") or d.get("synced_lyrics"))
            items.append(d)

        return total, items

    def get_stats(self) -> dict[str, Any]:
        c = self.conn
        total_songs = c.execute("SELECT COUNT(*) FROM songs").fetchone()[0]
        total_workspaces = c.execute("SELECT COUNT(*) FROM music_workspaces").fetchone()[0]
        favorites = c.execute("SELECT COUNT(*) FROM songs WHERE favorite = 1").fetchone()[0]
        with_audio = c.execute("SELECT COUNT(*) FROM songs WHERE vault_audio_path != '' OR audio_path != ''").fetchone()[0]
        return {
            "total_songs": total_songs,
            "total_workspaces": total_workspaces,
            "favorites": favorites,
            "with_audio": with_audio,
        }

    def get_style_tags(self, limit: int = 100) -> list[dict[str, Any]]:
        c = self.conn
        query = """
            SELECT name, kind, COUNT(*) as count
            FROM song_tags
            WHERE kind = 'style'
            GROUP BY name
            ORDER BY count DESC, name ASC
            LIMIT ?
        """
        rows = c.execute(query, (limit,)).fetchall()
        return [dict(r) for r in rows]
