"""Pydantic models for System Prompts (Gemini Gems, ChatGPT Artifacts, Custom GPTs, Custom)."""
from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


CATEGORIES = {
    "gemini_gems": {"name": "Gemini Gems", "icon": "💎", "desc": "Google Gemini özel Gem sistem talimatları"},
    "chatgpt_artifacts": {"name": "ChatGPT Artifacts", "icon": "📦", "desc": "Etkileşimli kod, HTML/UI ve SVG üreten Artifact promptları"},
    "chatgpt_gpts": {"name": "ChatGPT GPTs", "icon": "🤖", "desc": "OpenAI Custom GPT sistem talimatları ve persona promptları"},
    "custom": {"name": "Özel / Custom", "icon": "🛠️", "desc": "Özel LLM ve genel amaçlı sistem promptları"},
}


class SystemPromptBase(BaseModel):
    title: str = Field(..., min_length=1, description="Sistem promptu başlığı")
    category: str = Field("custom", description="Kategori: gemini_gems | chatgpt_artifacts | chatgpt_gpts | custom")
    content: str = Field(..., min_length=1, description="Sistem promptu ana içeriği ve talimatlar")
    description: str = Field("", description="Kısa açıklama veya rol özeti")
    target_model: str = Field("", description="Önerilen model: Gemini 1.5 Pro, GPT-4o, Claude 3.5 Sonnet vb.")
    tags: list[str] = Field(default_factory=list, description="Etiket listesi")
    icon: str = Field("", description="İsteğe bağlı ikon veya emoji")
    is_favorite: bool = Field(False, description="Favori durumu")


class SystemPromptCreate(SystemPromptBase):
    pass


class SystemPromptUpdate(BaseModel):
    title: str | None = None
    category: str | None = None
    content: str | None = None
    description: str | None = None
    target_model: str | None = None
    tags: list[str] | None = None
    icon: str | None = None
    is_favorite: bool | None = None


class SystemPromptOut(SystemPromptBase):
    id: int
    created_at: str
    updated_at: str
