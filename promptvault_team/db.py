"""Database engine for PromptVault Team Edition.

Features:
- Multi-workspace and role/visibility segmentation
- High-performance SQLite with FTS5 full-text indexing for Prompts and System Entities (Gems/GPTs/Skills)
- Event listeners for real-time background sync to company Google Drive
- Dynamic variable parsing for prompt templates
"""
from __future__ import annotations

import json
import re
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .models import (
    LLMPlatform,
    PromptItem,
    PromptType,
    SystemEntity,
    SystemEntityType,
    Visibility,
    Workspace,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    icon TEXT DEFAULT '👥',
    color TEXT DEFAULT '#4f46e5',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    platform TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    system_instructions TEXT NOT NULL,
    template TEXT DEFAULT '',
    variables_json TEXT DEFAULT '[]',
    description TEXT DEFAULT '',
    tags_json TEXT DEFAULT '[]',
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
    author TEXT DEFAULT 'Admin',
    visibility TEXT DEFAULT 'team',
    model_hint TEXT DEFAULT '',
    temperature REAL DEFAULT 0.7,
    max_tokens INTEGER,
    extra_params_json TEXT DEFAULT '{}',
    gdrive_file_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    negative_prompt TEXT DEFAULT '',
    prompt_type TEXT DEFAULT 'chat_text',
    platform TEXT DEFAULT 'chatgpt',
    system_entity_id INTEGER REFERENCES system_entities(id) ON DELETE SET NULL,
    variables_json TEXT DEFAULT '{}',
    tags_json TEXT DEFAULT '[]',
    author TEXT DEFAULT 'Member',
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
    visibility TEXT DEFAULT 'team',
    rating INTEGER DEFAULT 0,
    favorite INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    source_url TEXT DEFAULT '',
    image_hash TEXT,
    image_vault_path TEXT,
    gdrive_file_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_type TEXT NOT NULL,     -- 'prompt' | 'system_entity' | 'backup_dump'
    item_id INTEGER,
    action TEXT NOT NULL,        -- 'upsert' | 'delete'
    status TEXT DEFAULT 'pending', -- 'pending' | 'syncing' | 'synced' | 'failed'
    retry_count INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- FTS5 full text search tables
CREATE VIRTUAL TABLE IF NOT EXISTS prompt_fts USING fts5(
    title, prompt, negative_prompt, notes, tags,
    content='prompts', content_rowid='id'
);

CREATE VIRTUAL TABLE IF NOT EXISTS entity_fts USING fts5(
    title, system_instructions, description, tags,
    content='system_entities', content_rowid='id'
);

-- Triggers for automatic FTS sync
CREATE TRIGGER IF NOT EXISTS prompt_ai AFTER INSERT ON prompts BEGIN
    INSERT INTO prompt_fts(rowid, title, prompt, negative_prompt, notes, tags)
    VALUES (new.id, new.title, new.prompt, new.negative_prompt, new.notes, new.tags_json);
END;

CREATE TRIGGER IF NOT EXISTS prompt_ad AFTER DELETE ON prompts BEGIN
    INSERT INTO prompt_fts(prompt_fts, rowid, title, prompt, negative_prompt, notes, tags)
    VALUES ('delete', old.id, old.title, old.prompt, old.negative_prompt, old.notes, old.tags_json);
END;

CREATE TRIGGER IF NOT EXISTS prompt_au AFTER UPDATE ON prompts BEGIN
    INSERT INTO prompt_fts(prompt_fts, rowid, title, prompt, negative_prompt, notes, tags)
    VALUES ('delete', old.id, old.title, old.prompt, old.negative_prompt, old.notes, old.tags_json);
    INSERT INTO prompt_fts(rowid, title, prompt, negative_prompt, notes, tags)
    VALUES (new.id, new.title, new.prompt, new.negative_prompt, new.notes, new.tags_json);
END;

CREATE TRIGGER IF NOT EXISTS entity_ai AFTER INSERT ON system_entities BEGIN
    INSERT INTO entity_fts(rowid, title, system_instructions, description, tags)
    VALUES (new.id, new.title, new.system_instructions, new.description, new.tags_json);
END;

CREATE TRIGGER IF NOT EXISTS entity_ad AFTER DELETE ON system_entities BEGIN
    INSERT INTO entity_fts(entity_fts, rowid, title, system_instructions, description, tags)
    VALUES ('delete', old.id, old.title, old.system_instructions, old.description, old.tags_json);
END;

CREATE TRIGGER IF NOT EXISTS entity_au AFTER UPDATE ON system_entities BEGIN
    INSERT INTO entity_fts(entity_fts, rowid, title, system_instructions, description, tags)
    VALUES ('delete', old.id, old.title, old.system_instructions, old.description, old.tags_json);
    INSERT INTO entity_fts(rowid, title, system_instructions, description, tags)
    VALUES (new.id, new.title, new.system_instructions, new.description, new.tags_json);
END;
"""

TEMPLATE_VAR_REGEX = re.compile(r"\{\{([a-zA-Z0-9_\-]+)\}\}")


def extract_template_variables(text: str) -> list[str]:
    """Find all unique {{variable}} names in the given template text."""
    if not text:
        return []
    matches = TEMPLATE_VAR_REGEX.findall(text)
    seen = set()
    result = []
    for m in matches:
        k = m.strip()
        if k and k not in seen:
            seen.add(k)
            result.append(k)
    return result


class TeamLibrary:
    """Thread-safe SQLite database manager for PromptVault Team."""

    def __init__(self, data_dir: str | Path | None = None):
        if data_dir is None:
            data_dir = Path.home() / ".promptvault_team"
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "team_vault.db"
        self.vault_media_dir = self.data_dir / "media"
        self.vault_media_dir.mkdir(parents=True, exist_ok=True)

        self._lock = threading.Lock()
        self._sync_listeners: list[Callable[[str, int, str], None]] = []
        self._init_db()

    def add_sync_listener(self, callback: Callable[[str, int, str], None]) -> None:
        """Register a callback for real-time changes: fn(item_type, item_id, action)"""
        self._sync_listeners.append(callback)

    def _notify_sync(self, item_type: str, item_id: int, action: str) -> None:
        # 1. Enqueue to database sync_queue table
        now = datetime.now(timezone.utc).isoformat()
        try:
            with self._get_conn() as conn:
                conn.execute(
                    "INSERT INTO sync_queue (item_type, item_id, action, status, created_at, updated_at) "
                    "VALUES (?, ?, ?, 'pending', ?, ?)",
                    (item_type, item_id, action, now, now),
                )
        except Exception:
            pass

        # 2. Trigger in-memory background worker callbacks immediately
        for listener in self._sync_listeners:
            try:
                listener(item_type, item_id, action)
            except Exception:
                pass

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        return conn

    def _init_db(self) -> None:
        with self._lock, self._get_conn() as conn:
            conn.executescript(SCHEMA)
            # Ensure default workspace exists
            cur = conn.execute("SELECT COUNT(*) FROM workspaces")
            if cur.fetchone()[0] == 0:
                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    "INSERT INTO workspaces (name, slug, description, icon, color, created_at) "
                    "VALUES ('Genel Çalışma Alanı', 'default', 'Tüm ekibin genel paylaşılan prompt kasası', '🌐', '#4f46e5', ?)",
                    (now,),
                )

    # ------------------------------------------------------------- Workspaces
    def list_workspaces(self) -> list[Workspace]:
        with self._get_conn() as conn:
            cur = conn.execute("SELECT * FROM workspaces ORDER BY id ASC")
            return [
                Workspace(
                    id=row["id"],
                    name=row["name"],
                    slug=row["slug"],
                    description=row["description"] or "",
                    icon=row["icon"] or "👥",
                    color=row["color"] or "#4f46e5",
                    created_at=row["created_at"],
                )
                for row in cur.fetchall()
            ]

    def create_workspace(self, name: str, slug: str | None = None, description: str = "", icon: str = "👥", color: str = "#4f46e5") -> Workspace:
        name = name.strip()
        if not slug:
            slug = re.sub(r"[^a-zA-Z0-9_\-]+", "-", name.lower()).strip("-") or "workspace"
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._get_conn() as conn:
            cur = conn.execute(
                "INSERT INTO workspaces (name, slug, description, icon, color, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (name, slug, description, icon, color, now),
            )
            wid = cur.lastrowid
        return Workspace(id=wid, name=name, slug=slug, description=description, icon=icon, color=color, created_at=now)

    # --------------------------------------------------------- System Entities (Gems, GPTs, Skills)
    def create_system_entity(
        self,
        title: str,
        platform: str,
        entity_type: str,
        system_instructions: str,
        template: str = "",
        description: str = "",
        tags: list[str] | None = None,
        workspace_id: int | None = None,
        author: str = "Admin",
        visibility: str = Visibility.TEAM.value,
        model_hint: str = "",
        temperature: float = 0.7,
        max_tokens: int | None = None,
        extra_params: dict[str, Any] | None = None,
    ) -> SystemEntity:
        now = datetime.now(timezone.utc).isoformat()
        variables = extract_template_variables(template or system_instructions)
        tags = tags or []
        extra_params = extra_params or {}

        with self._lock, self._get_conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO system_entities (
                    title, platform, entity_type, system_instructions, template,
                    variables_json, description, tags_json, workspace_id, author,
                    visibility, model_hint, temperature, max_tokens, extra_params_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    title.strip(),
                    platform.strip().lower(),
                    entity_type.strip().lower(),
                    system_instructions.strip(),
                    template.strip(),
                    json.dumps(variables, ensure_ascii=False),
                    description.strip(),
                    json.dumps(tags, ensure_ascii=False),
                    workspace_id,
                    author.strip(),
                    visibility,
                    model_hint.strip(),
                    temperature,
                    max_tokens,
                    json.dumps(extra_params, ensure_ascii=False),
                    now,
                    now,
                ),
            )
            entity_id = cur.lastrowid

        self._notify_sync("system_entity", entity_id, "upsert")
        return self.get_system_entity(entity_id)  # type: ignore

    def get_system_entity(self, entity_id: int) -> SystemEntity | None:
        with self._get_conn() as conn:
            cur = conn.execute("SELECT * FROM system_entities WHERE id = ?", (entity_id,))
            row = cur.fetchone()
            if not row:
                return None
            return SystemEntity(
                id=row["id"],
                title=row["title"],
                platform=row["platform"],
                entity_type=row["entity_type"],
                system_instructions=row["system_instructions"],
                template=row["template"] or "",
                variables=json.loads(row["variables_json"] or "[]"),
                description=row["description"] or "",
                tags=json.loads(row["tags_json"] or "[]"),
                workspace_id=row["workspace_id"],
                author=row["author"] or "Admin",
                visibility=row["visibility"] or "team",
                model_hint=row["model_hint"] or "",
                temperature=row["temperature"] if row["temperature"] is not None else 0.7,
                max_tokens=row["max_tokens"],
                extra_params=json.loads(row["extra_params_json"] or "{}"),
                gdrive_file_id=row["gdrive_file_id"],
                created_at=row["created_at"],
                updated_at=row["updated_at"],
            )

    def list_system_entities(
        self,
        platform: str | None = None,
        entity_type: str | None = None,
        workspace_id: int | None = None,
        search_query: str | None = None,
        limit: int = 100,
    ) -> list[SystemEntity]:
        with self._get_conn() as conn:
            if search_query:
                q = f"""
                SELECT se.* FROM system_entities se
                JOIN entity_fts f ON f.rowid = se.id
                WHERE entity_fts MATCH ?
                """
                params: list[Any] = [search_query]
            else:
                q = "SELECT se.* FROM system_entities se WHERE 1=1"
                params = []

            if platform:
                q += " AND se.platform = ?"
                params.append(platform.lower())
            if entity_type:
                q += " AND se.entity_type = ?"
                params.append(entity_type.lower())
            if workspace_id is not None:
                q += " AND (se.workspace_id = ? OR se.visibility = 'company')"
                params.append(workspace_id)

            q += " ORDER BY se.id DESC LIMIT ?"
            params.append(limit)

            cur = conn.execute(q, params)
            results = []
            for row in cur.fetchall():
                results.append(
                    SystemEntity(
                        id=row["id"],
                        title=row["title"],
                        platform=row["platform"],
                        entity_type=row["entity_type"],
                        system_instructions=row["system_instructions"],
                        template=row["template"] or "",
                        variables=json.loads(row["variables_json"] or "[]"),
                        description=row["description"] or "",
                        tags=json.loads(row["tags_json"] or "[]"),
                        workspace_id=row["workspace_id"],
                        author=row["author"] or "Admin",
                        visibility=row["visibility"] or "team",
                        model_hint=row["model_hint"] or "",
                        temperature=row["temperature"] if row["temperature"] is not None else 0.7,
                        max_tokens=row["max_tokens"],
                        extra_params=json.loads(row["extra_params_json"] or "{}"),
                        gdrive_file_id=row["gdrive_file_id"],
                        created_at=row["created_at"],
                        updated_at=row["updated_at"],
                    )
                )
            return results

    # ------------------------------------------------------------- Prompts
    def add_prompt(
        self,
        title: str,
        prompt: str,
        negative_prompt: str = "",
        prompt_type: str = PromptType.CHAT_TEXT.value,
        platform: str = LLMPlatform.CHATGPT.value,
        system_entity_id: int | None = None,
        variables: dict[str, str] | None = None,
        tags: list[str] | None = None,
        author: str = "Member",
        workspace_id: int | None = None,
        visibility: str = Visibility.TEAM.value,
        rating: int = 0,
        notes: str = "",
        source_url: str = "",
        image_bytes: bytes | None = None,
    ) -> PromptItem:
        now = datetime.now(timezone.utc).isoformat()
        tags = tags or []
        variables = variables or {}

        image_hash = None
        image_vault_path = None
        if image_bytes:
            import hashlib
            image_hash = hashlib.sha256(image_bytes).hexdigest()
            fn = f"{image_hash}.png"
            dest = self.vault_media_dir / fn
            dest.write_bytes(image_bytes)
            image_vault_path = str(dest)

        with self._lock, self._get_conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO prompts (
                    title, prompt, negative_prompt, prompt_type, platform,
                    system_entity_id, variables_json, tags_json, author, workspace_id,
                    visibility, rating, notes, source_url, image_hash, image_vault_path,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    title.strip() or "İsimsiz Prompt",
                    prompt.strip(),
                    negative_prompt.strip(),
                    prompt_type,
                    platform.lower(),
                    system_entity_id,
                    json.dumps(variables, ensure_ascii=False),
                    json.dumps(tags, ensure_ascii=False),
                    author.strip(),
                    workspace_id,
                    visibility,
                    max(0, min(5, rating)),
                    notes.strip(),
                    source_url.strip(),
                    image_hash,
                    image_vault_path,
                    now,
                    now,
                ),
            )
            pid = cur.lastrowid

        # Trigger real-time sync event
        self._notify_sync("prompt", pid, "upsert")
        return self.get_prompt(pid)  # type: ignore

    def get_prompt(self, prompt_id: int) -> PromptItem | None:
        with self._get_conn() as conn:
            cur = conn.execute("SELECT * FROM prompts WHERE id = ?", (prompt_id,))
            row = cur.fetchone()
            if not row:
                return None
            return PromptItem(
                id=row["id"],
                title=row["title"],
                prompt=row["prompt"],
                negative_prompt=row["negative_prompt"] or "",
                prompt_type=row["prompt_type"] or PromptType.CHAT_TEXT.value,
                platform=row["platform"] or LLMPlatform.CHATGPT.value,
                system_entity_id=row["system_entity_id"],
                variables=json.loads(row["variables_json"] or "{}"),
                tags=json.loads(row["tags_json"] or "[]"),
                author=row["author"] or "Member",
                workspace_id=row["workspace_id"],
                visibility=row["visibility"] or "team",
                rating=row["rating"] or 0,
                favorite=bool(row["favorite"]),
                notes=row["notes"] or "",
                source_url=row["source_url"] or "",
                image_hash=row["image_hash"],
                image_vault_path=row["image_vault_path"],
                gdrive_file_id=row["gdrive_file_id"],
                created_at=row["created_at"],
                updated_at=row["updated_at"],
            )

    def list_prompts(
        self,
        platform: str | None = None,
        prompt_type: str | None = None,
        workspace_id: int | None = None,
        system_entity_id: int | None = None,
        search_query: str | None = None,
        limit: int = 100,
    ) -> list[PromptItem]:
        with self._get_conn() as conn:
            if search_query:
                q = """
                SELECT p.* FROM prompts p
                JOIN prompt_fts f ON f.rowid = p.id
                WHERE prompt_fts MATCH ?
                """
                params: list[Any] = [search_query]
            else:
                q = "SELECT p.* FROM prompts p WHERE 1=1"
                params = []

            if platform:
                q += " AND p.platform = ?"
                params.append(platform.lower())
            if prompt_type:
                q += " AND p.prompt_type = ?"
                params.append(prompt_type.lower())
            if workspace_id is not None:
                q += " AND (p.workspace_id = ? OR p.visibility = 'company')"
                params.append(workspace_id)
            if system_entity_id is not None:
                q += " AND p.system_entity_id = ?"
                params.append(system_entity_id)

            q += " ORDER BY p.id DESC LIMIT ?"
            params.append(limit)

            cur = conn.execute(q, params)
            results = []
            for row in cur.fetchall():
                results.append(
                    PromptItem(
                        id=row["id"],
                        title=row["title"],
                        prompt=row["prompt"],
                        negative_prompt=row["negative_prompt"] or "",
                        prompt_type=row["prompt_type"] or PromptType.CHAT_TEXT.value,
                        platform=row["platform"] or LLMPlatform.CHATGPT.value,
                        system_entity_id=row["system_entity_id"],
                        variables=json.loads(row["variables_json"] or "{}"),
                        tags=json.loads(row["tags_json"] or "[]"),
                        author=row["author"] or "Member",
                        workspace_id=row["workspace_id"],
                        visibility=row["visibility"] or "team",
                        rating=row["rating"] or 0,
                        favorite=bool(row["favorite"]),
                        notes=row["notes"] or "",
                        source_url=row["source_url"] or "",
                        image_hash=row["image_hash"],
                        image_vault_path=row["image_vault_path"],
                        gdrive_file_id=row["gdrive_file_id"],
                        created_at=row["created_at"],
                        updated_at=row["updated_at"],
                    )
                )
            return results

    def update_gdrive_id(self, item_type: str, item_id: int, gdrive_file_id: str) -> None:
        """Record the remote Google Drive file ID once uploaded."""
        table = "prompts" if item_type == "prompt" else "system_entities"
        with self._lock, self._get_conn() as conn:
            conn.execute(f"UPDATE {table} SET gdrive_file_id = ? WHERE id = ?", (gdrive_file_id, item_id))
