"""FastAPI router for System Prompts."""
from __future__ import annotations

import re
import unicodedata
import urllib.parse
from fastapi import APIRouter, HTTPException, Query, Response

from .db import SystemPromptLibrary
from .models import CATEGORIES, SystemPromptCreate, SystemPromptOut, SystemPromptUpdate


def make_content_disposition(filename: str, disposition: str = "attachment") -> str:
    safe_name = re.sub(r'[\\/:*?"<>|\r\n\t]', '_', filename).strip() or "download"
    ascii_name = unicodedata.normalize('NFKD', safe_name).encode('ascii', 'ignore').decode('ascii')
    ascii_name = re.sub(r'[^\w\s.-]', '_', ascii_name).strip() or "download"
    encoded_name = urllib.parse.quote(safe_name, encoding='utf-8')
    return f"{disposition}; filename=\"{ascii_name}\"; filename*=utf-8''{encoded_name}"


def create_system_prompts_router(lib: SystemPromptLibrary) -> APIRouter:
    router = APIRouter(prefix="/api/system-prompts", tags=["system-prompts"])

    @router.get("/categories")
    def get_categories():
        return CATEGORIES

    @router.get("/stats")
    def get_stats():
        return lib.stats()

    @router.get("", response_model=list[SystemPromptOut])
    def list_prompts(
        category: str | None = Query(None, description="Filtre kategorisi (gemini_gems, chatgpt_artifacts, chatgpt_gpts, custom)"),
        is_favorite: bool | None = Query(None, description="Sadece favoriler"),
        q: str | None = Query(None, description="Arama metni"),
        limit: int = Query(200, ge=1, le=500),
        offset: int = Query(0, ge=0),
    ):
        return lib.list(category=category, is_favorite=is_favorite, q=q, limit=limit, offset=offset)

    @router.post("", response_model=SystemPromptOut, status_code=201)
    def create_prompt(body: SystemPromptCreate):
        try:
            return lib.add(body)
        except ValueError as e:
            raise HTTPException(400, str(e))

    @router.get("/{prompt_id}", response_model=SystemPromptOut)
    def get_prompt(prompt_id: int):
        item = lib.get(prompt_id)
        if not item:
            raise HTTPException(404, "Sistem promptu bulunamadı")
        return item

    @router.patch("/{prompt_id}", response_model=SystemPromptOut)
    def update_prompt(prompt_id: int, body: SystemPromptUpdate):
        try:
            item = lib.update(prompt_id, body)
            if not item:
                raise HTTPException(404, "Sistem promptu bulunamadı")
            return item
        except ValueError as e:
            raise HTTPException(400, str(e))

    @router.delete("/{prompt_id}")
    def delete_prompt(prompt_id: int):
        success = lib.delete(prompt_id)
        if not success:
            raise HTTPException(404, "Sistem promptu bulunamadı")
        return {"ok": True, "deleted": prompt_id}

    @router.post("/{prompt_id}/favorite", response_model=SystemPromptOut)
    def toggle_favorite(prompt_id: int):
        item = lib.toggle_favorite(prompt_id)
        if not item:
            raise HTTPException(404, "Sistem promptu bulunamadı")
        return item

    @router.get("/{prompt_id}/export")
    def export_prompt(prompt_id: int, format: str = Query("md", pattern="^(md|txt)$")):
        item = lib.get(prompt_id)
        if not item:
            raise HTTPException(404, "Sistem promptu bulunamadı")

        title = item["title"]
        safe_title = re.sub(r'[\\/*?:"<>|]', "_", title).strip() or "system_prompt"
        filename = f"{safe_title}.{format}"

        if format == "md":
            cat_name = CATEGORIES.get(item["category"], {}).get("name", item["category"])
            tags_str = ", ".join(item.get("tags", []))
            text = f"""# {title}

**Kategori:** {cat_name}
**Hedef Model:** {item.get('target_model') or 'Genel'}
**Etiketler:** {tags_str or 'Yok'}
**Açıklama:** {item.get('description') or ''}

---

## Sistem Talimatı / Prompt
```markdown
{item['content']}
```
"""
            media_type = "text/markdown; charset=utf-8"
        else:
            text = item["content"]
            media_type = "text/plain; charset=utf-8"

        disposition = make_content_disposition(filename)
        return Response(
            content=text.encode("utf-8"),
            media_type=media_type,
            headers={"Content-Disposition": disposition},
        )

    return router
