"""Data models for Suno AI songs and workspaces."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ParsedSong:
    suno_id: str = ""
    title: str = "İsimsiz Şarkı"
    style: str = ""
    lyrics: str = ""
    model: str = "Suno AI"
    persona: str = ""
    created_at: str = ""
    suno_url: str = ""
    tags: list[str] = field(default_factory=list)
    lyric_sections: list[str] = field(default_factory=list)


@dataclass
class Workspace:
    id: int
    name: str
    description: str = ""
    color: str = "#8b5cf6"
    icon: str = "🎵"
    song_count: int = 0
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "color": self.color,
            "icon": self.icon,
            "song_count": self.song_count,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


@dataclass
class Song:
    id: int
    suno_id: str
    title: str
    style: str = ""
    lyrics: str = ""
    model: str = "Suno AI"
    created_at: str = ""
    suno_url: str = ""
    workspace_id: int | None = None
    workspace_name: str | None = None
    workspace_color: str | None = None
    artist: str = ""
    persona: str = ""
    audio_path: str | None = None
    has_audio: bool = False
    rating: int = 0
    favorite: bool = False
    notes: str = ""
    duration: float | None = None
    tags: list[dict[str, Any]] = field(default_factory=list)
    added_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "suno_id": self.suno_id,
            "title": self.title,
            "style": self.style,
            "lyrics": self.lyrics,
            "model": self.model,
            "created_at": self.created_at,
            "suno_url": self.suno_url,
            "workspace_id": self.workspace_id,
            "workspace_name": self.workspace_name,
            "workspace_color": self.workspace_color,
            "artist": self.artist,
            "persona": self.persona,
            "audio_path": self.audio_path,
            "has_audio": self.has_audio,
            "rating": self.rating,
            "favorite": self.favorite,
            "notes": self.notes,
            "duration": self.duration,
            "tags": self.tags,
            "added_at": self.added_at,
            "updated_at": self.updated_at,
        }
