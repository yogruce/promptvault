"""SQLite-backed System Prompt Library for Gemini Gems, ChatGPT Artifacts, Custom GPTs, and Custom Prompts."""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import CATEGORIES, SystemPromptCreate, SystemPromptUpdate


SYSTEM_PROMPTS_SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS system_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'custom',
    content TEXT NOT NULL,
    description TEXT DEFAULT '',
    target_model TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    icon TEXT DEFAULT '',
    is_favorite INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_sys_prompts_cat ON system_prompts(category);
CREATE INDEX IF NOT EXISTS ix_sys_prompts_fav ON system_prompts(is_favorite);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


DEFAULT_STARTER_PROMPTS = [
    {
        "title": "Kodlama & Mimari Uzmanı Gem",
        "category": "gemini_gems",
        "icon": "💎",
        "target_model": "Gemini 1.5 Pro",
        "description": "Temiz kod, mimari prensipler (SOLID/DRY) ve refaktör odaklı kıdemli yazılım mühendisi Gems talimatı.",
        "tags": ["kodlama", "yazılım", "gemini", "refactor", "mimari"],
        "content": """Sen kıdemli bir yazılım mimarı ve kodlama uzmanısın. Kullanıcının sunduğu kodları inceler, modern standartlara ve tasarım kalıplarına uygun şekilde optimize edersin.

Kurallar & Davranış İlkeleri:
1. Kod Kalitesi: Yazdığın kodlar her zaman temiz, okunabilir, tip güvenli ve iyi dokümante edilmiş olmalıdır.
2. Gereksiz Açıklamadan Kaçın: Uzun teorik açıklamalar yerine doğrudan çalışan çözümler ve en kritik noktaları vurgulayan özetler sun.
3. Mimari: Kod önerirken SOLID prensiplerine, modülerliğe ve test edilebilirliğe özen göster.
4. Güvenlik ve Hata Yönetimi: Girdi doğrulaması, edge-case'ler ve exception handling konularını her zaman hesaba kat.
5. Kullanıcı bir dilde kod sorduysa o dilin en güncel best practice'lerini uygula."""
    },
    {
        "title": "Etkileşimli UI & Web Widget Üreticisi",
        "category": "chatgpt_artifacts",
        "icon": "📦",
        "target_model": "GPT-4o / Claude 3.5",
        "description": "HTML, CSS ve vanilla JS ile tek dosyada çalışan self-contained UI bileşenleri ve mini uygulamalar üretir.",
        "tags": ["artifacts", "ui", "html", "css", "javascript", "widget"],
        "content": """Sen kullanıcıya zengin, etkileşimli ve bağımsız (self-contained) web bileşenleri üreten bir Artifact Uzmanısın.

Yönergeler:
1. Tek Dosya Yapısı: Tüm HTML, CSS (<style>) ve JavaScript (<script>) kodlarını tek bir blokta birleştir. Harici bağımlılık gerektirmeden tarayıcıda doğrudan çalışmalıdır (CDN gerekiyorsa yalnızca Tailwind CSS veya standart kütüphaneler).
2. Görsel Kalite: Modern, minimalist, koyu mod (dark mode) uyumlu, Tailwind/modern CSS geçişleri ve zarif gölgeler kullan.
3. Etkileşim: Butonlar, kaydırıcılar veya form alanları tıklandığında anında tepki vermeli; canlı veri önizlemesi veya grafik animasyonu sağlamalıdır.
4. Mobil Uyum: Tasarım duyarlı (responsive) ve mobil ekranlara tam uyumlu olmalıdır."""
    },
    {
        "title": "Kıdemli Prompt Mühendisi & Danışman",
        "category": "chatgpt_gpts",
        "icon": "🤖",
        "target_model": "GPT-4o (Custom GPT)",
        "description": "Her türlü yapay zeka görevi için en yüksek doğruluk ve verim sağlayan özel promptlar kurgulayan GPT.",
        "tags": ["gpts", "prompt-engineering", "danışman", "optimizasyon"],
        "content": """Sen dünya standartlarında bir Prompt Mühendisisin. Amacın, kullanıcının isteklerini analiz edip LLM'lerden (ChatGPT, Gemini, Claude, Midjourney vb.) en yüksek performansı alacak kusursuz promptlar inşa etmektir.

Çerçeve (Role-Task-Context-Constraints-Format):
- Rol (Role): Yapay zekaya atanacak en yetkin uzmanlık kimliği.
- Görev (Task): Yapılacak işin net, eyleme dönük ve adım adım tanımı.
- Bağlam (Context): Gerekli arka plan bilgisi ve veri örnekleri.
- Kısıtlamalar (Constraints): Asla yapılmaması gerekenler, ton, uzunluk ve güvenlik sınırları.
- Format (Format): İstenen çıktı biçimi (Markdown, JSON, Tablo, Liste vb.).

Kullanıcı sana basit bir fikir verdiğinde bunu bu 5 aşamalı çerçeveye oturtarak profesyonel bir sistem/kullanıcı promptuna dönüştür."""
    },
    {
        "title": "Evrensel Sistem Prompt Şablonu",
        "category": "custom",
        "icon": "🛠️",
        "target_model": "Herhangi Bir LLM",
        "description": "Kendi özel asistan veya uzman sistem promptlarınızı oluşturmak için modüler başlangıç iskeleti.",
        "tags": ["şablon", "custom", "başlangıç", "modüler"],
        "content": """# KİMLİK & ROL
Sen [Uzmanlık Alanı / Rol Adı] konusunda uzman bir yapay zekasın. Temel amacın [Temel Hedef / Görev] görevini eksiksiz yerine getirmektir.

# BAĞLAM & HEDEF KİTLE
- Hedef Kitle: [Örn: Geliştiriciler / Girişimciler / Öğrenciler]
- Yaklaşım: [Örn: Çözüm odaklı, samimi ama profesyonel, doğrudan ve analitik]

# TEMEL YETENEKLER & SORUMLULUKLAR
1. [Görev 1: Detaylı açıklama]
2. [Görev 2: Detaylı açıklama]
3. [Görev 3: Detaylı açıklama]

# KISITLAMALAR VE KURALLAR
- Bilmediğin veya emin olmadığın konularda varsayım yapma; dürüstçe belirt.
- Yanıtlarını net tut; gereksiz dolgu cümleleri kullanma.
- Çıktılarını anlaşılır başlıklar ve maddeler halinde yapılandır."""
    }
]


class SystemPromptLibrary:
    def __init__(self, db_path: str | Path = ":memory:"):
        self.db_path = Path(db_path) if db_path != ":memory:" else ":memory:"
        if isinstance(self.db_path, Path):
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._write_lock = threading.RLock()
        self._init_db()

    @property
    def conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn") or self._local.conn is None:
            c = sqlite3.connect(str(self.db_path), check_same_thread=False)
            c.row_factory = sqlite3.Row
            c.execute("PRAGMA foreign_keys = ON;")
            self._local.conn = c
        return self._local.conn

    def _init_db(self) -> None:
        with self._write_lock:
            self.conn.executescript(SYSTEM_PROMPTS_SCHEMA)
            self.conn.commit()
            self._seed_if_empty()

    def _seed_if_empty(self) -> None:
        c = self.conn
        count = c.execute("SELECT COUNT(*) FROM system_prompts").fetchone()[0]
        if count == 0:
            now = _now()
            for p in DEFAULT_STARTER_PROMPTS:
                c.execute(
                    """
                    INSERT INTO system_prompts (
                        title, category, content, description, target_model, tags, icon, is_favorite, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        p["title"],
                        p["category"],
                        p["content"].strip(),
                        p["description"],
                        p["target_model"],
                        json.dumps(p["tags"], ensure_ascii=False),
                        p["icon"],
                        0,
                        now,
                        now,
                    )
                )
            self.conn.commit()

    def _row_to_dict(self, row: sqlite3.Row) -> dict[str, Any]:
        d = dict(row)
        if "tags" in d and isinstance(d["tags"], str):
            try:
                d["tags"] = json.loads(d["tags"])
            except Exception:
                d["tags"] = [t.strip() for t in d["tags"].split(",") if t.strip()]
        d["is_favorite"] = bool(d.get("is_favorite", 0))
        return d

    def add(self, prompt: SystemPromptCreate | dict[str, Any]) -> dict[str, Any]:
        if hasattr(prompt, "model_dump"):
            data = prompt.model_dump()
        elif hasattr(prompt, "dict"):
            data = prompt.dict()
        else:
            data = dict(prompt)
        title = (data.get("title") or "").strip()
        if not title:
            raise ValueError("Başlık boş olamaz")
        content = (data.get("content") or "").strip()
        if not content:
            raise ValueError("Sistem promptu içeriği boş olamaz")

        category = data.get("category") or "custom"
        if category not in CATEGORIES:
            category = "custom"

        icon = data.get("icon") or CATEGORIES.get(category, {}).get("icon", "⚡")
        description = (data.get("description") or "").strip()
        target_model = (data.get("target_model") or "").strip()
        tags = data.get("tags") or []
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        is_favorite = 1 if data.get("is_favorite") else 0
        now = _now()

        with self._write_lock:
            c = self.conn
            cur = c.execute(
                """
                INSERT INTO system_prompts (
                    title, category, content, description, target_model, tags, icon, is_favorite, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    title,
                    category,
                    content,
                    description,
                    target_model,
                    json.dumps(tags, ensure_ascii=False),
                    icon,
                    is_favorite,
                    now,
                    now,
                )
            )
            c.commit()
            item_id = cur.lastrowid
            return self.get(item_id)

    def get(self, prompt_id: int) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM system_prompts WHERE id=?", (prompt_id,)).fetchone()
        return self._row_to_dict(row) if row else None

    def list(
        self,
        category: str | None = None,
        is_favorite: bool | None = None,
        q: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        query = "SELECT * FROM system_prompts WHERE 1=1"
        params: list[Any] = []

        if category and category != "all" and category in CATEGORIES:
            query += " AND category=?"
            params.append(category)

        if is_favorite is not None:
            query += " AND is_favorite=?"
            params.append(1 if is_favorite else 0)

        if q and q.strip():
            term = f"%{q.strip().lower()}%"
            query += " AND (LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(description) LIKE ? OR LOWER(tags) LIKE ? OR LOWER(target_model) LIKE ?)"
            params.extend([term, term, term, term, term])

        query += " ORDER BY is_favorite DESC, updated_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        rows = self.conn.execute(query, params).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def update(self, prompt_id: int, updates: SystemPromptUpdate | dict[str, Any]) -> dict[str, Any] | None:
        if hasattr(updates, "model_dump"):
            data = updates.model_dump(exclude_unset=True)
        elif hasattr(updates, "dict"):
            data = updates.dict(exclude_unset=True)
        else:
            data = dict(updates)
        if not data:
            return self.get(prompt_id)

        existing = self.get(prompt_id)
        if not existing:
            return None

        fields: list[str] = []
        vals: list[Any] = []

        if "title" in data and data["title"] is not None:
            t = data["title"].strip()
            if not t:
                raise ValueError("Başlık boş olamaz")
            fields.append("title=?")
            vals.append(t)

        if "content" in data and data["content"] is not None:
            c = data["content"].strip()
            if not c:
                raise ValueError("İçerik boş olamaz")
            fields.append("content=?")
            vals.append(c)

        if "category" in data and data["category"] is not None:
            cat = data["category"] if data["category"] in CATEGORIES else "custom"
            fields.append("category=?")
            vals.append(cat)

        if "description" in data and data["description"] is not None:
            fields.append("description=?")
            vals.append(data["description"].strip())

        if "target_model" in data and data["target_model"] is not None:
            fields.append("target_model=?")
            vals.append(data["target_model"].strip())

        if "tags" in data and data["tags"] is not None:
            tags = data["tags"]
            if isinstance(tags, str):
                tags = [t.strip() for t in tags.split(",") if t.strip()]
            fields.append("tags=?")
            vals.append(json.dumps(tags, ensure_ascii=False))

        if "icon" in data and data["icon"] is not None:
            fields.append("icon=?")
            vals.append(data["icon"].strip())

        if "is_favorite" in data and data["is_favorite"] is not None:
            fields.append("is_favorite=?")
            vals.append(1 if data["is_favorite"] else 0)

        if not fields:
            return existing

        fields.append("updated_at=?")
        vals.append(_now())
        vals.append(prompt_id)

        with self._write_lock:
            self.conn.execute(f"UPDATE system_prompts SET {', '.join(fields)} WHERE id=?", vals)
            self.conn.commit()
            return self.get(prompt_id)

    def delete(self, prompt_id: int) -> bool:
        with self._write_lock:
            cur = self.conn.execute("DELETE FROM system_prompts WHERE id=?", (prompt_id,))
            self.conn.commit()
            return cur.rowcount > 0

    def toggle_favorite(self, prompt_id: int) -> dict[str, Any] | None:
        item = self.get(prompt_id)
        if not item:
            return None
        new_fav = 0 if item["is_favorite"] else 1
        with self._write_lock:
            self.conn.execute(
                "UPDATE system_prompts SET is_favorite=?, updated_at=? WHERE id=?",
                (new_fav, _now(), prompt_id)
            )
            self.conn.commit()
            return self.get(prompt_id)

    def stats(self) -> dict[str, Any]:
        c = self.conn
        total = c.execute("SELECT COUNT(*) FROM system_prompts").fetchone()[0]
        favs = c.execute("SELECT COUNT(*) FROM system_prompts WHERE is_favorite=1").fetchone()[0]

        cat_counts: dict[str, int] = {}
        for row in c.execute("SELECT category, COUNT(*) as cnt FROM system_prompts GROUP BY category"):
            cat_counts[row["category"]] = row["cnt"]

        # Ensure all registered categories exist in output
        for k in CATEGORIES:
            cat_counts.setdefault(k, 0)

        models: dict[str, int] = {}
        for row in c.execute("SELECT target_model, COUNT(*) as cnt FROM system_prompts WHERE target_model != '' GROUP BY target_model ORDER BY cnt DESC LIMIT 10"):
            models[row["target_model"]] = row["cnt"]

        return {
            "total": total,
            "favorites": favs,
            "categories": cat_counts,
            "models": models,
        }

    def close(self) -> None:
        if hasattr(self._local, "conn") and self._local.conn is not None:
            try:
                self._local.conn.close()
            except Exception:
                pass
            self._local.conn = None
