"""FastAPI endpoints for Team Prompts (ChatGPT, Gemini, Claude, etc.)."""
from __future__ import annotations

from typing import Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..db import TeamLibrary
from ..models import LLMPlatform, PromptType, Visibility


class PromptCreateRequest(BaseModel):
    title: str
    prompt: str
    negative_prompt: str = ""
    prompt_type: str = PromptType.CHAT_TEXT.value
    platform: str = LLMPlatform.CHATGPT.value
    system_entity_id: int | None = None
    variables: dict[str, str] = {}
    tags: list[str] = []
    author: str = "Member"
    workspace_id: int | None = None
    visibility: str = Visibility.TEAM.value
    rating: int = 0
    notes: str = ""
    source_url: str = ""


def create_prompts_router(lib: TeamLibrary) -> APIRouter:
    router = APIRouter(prefix="/api/team/prompts", tags=["team-prompts"])

    @router.get("")
    def list_prompts(
        platform: str | None = None,
        prompt_type: str | None = None,
        workspace_id: int | None = None,
        system_entity_id: int | None = None,
        q: str | None = None,
        limit: int = Query(100, le=500),
    ):
        items = lib.list_prompts(
            platform=platform,
            prompt_type=prompt_type,
            workspace_id=workspace_id,
            system_entity_id=system_entity_id,
            search_query=q,
            limit=limit,
        )
        return {"items": [item.__dict__ for item in items], "total": len(items)}

    @router.post("")
    def add_prompt(req: PromptCreateRequest):
        if not req.prompt.strip():
            raise HTTPException(400, "Prompt içeriği boş olamaz.")
        item = lib.add_prompt(
            title=req.title,
            prompt=req.prompt,
            negative_prompt=req.negative_prompt,
            prompt_type=req.prompt_type,
            platform=req.platform,
            system_entity_id=req.system_entity_id,
            variables=req.variables,
            tags=req.tags,
            author=req.author,
            workspace_id=req.workspace_id,
            visibility=req.visibility,
            rating=req.rating,
            notes=req.notes,
            source_url=req.source_url,
        )
        return {"ok": True, "prompt": item.__dict__}

    @router.get("/{prompt_id}")
    def get_prompt(prompt_id: int):
        item = lib.get_prompt(prompt_id)
        if not item:
            raise HTTPException(404, "Prompt bulunamadı.")
        return item.__dict__

    return router
