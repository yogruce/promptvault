"""Isolated Quick Import integration module for PromptVault.

Allows 1-click importing of images and prompts from Gemini, ChatGPT, Flow/ImageFX,
and songs + metadata from Suno AI via browser userscript or extension.
This module is fully decoupled and can be toggled on/off at runtime.
"""
from __future__ import annotations

import base64
import json
import re
import urllib.request
from pathlib import Path
from typing import Any
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException

from promptvault.db import Library
from promptvault.music.db import MusicLibrary
from promptvault.music.parser import parse_suno_txt


SETTINGS_FILENAME = "quick_import_settings.json"


def _get_settings_path(data_dir: Path) -> Path:
    return data_dir / SETTINGS_FILENAME


def is_quick_import_enabled(data_dir: Path) -> bool:
    p = _get_settings_path(data_dir)
    if not p.exists():
        return True  # Default enabled
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return bool(data.get("enabled", True))
    except Exception:
        return True


def set_quick_import_enabled(data_dir: Path, enabled: bool) -> bool:
    p = _get_settings_path(data_dir)
    try:
        p.write_text(json.dumps({"enabled": bool(enabled)}, indent=2), encoding="utf-8")
        return bool(enabled)
    except Exception:
        return False


def _fetch_or_decode_bytes(url_or_b64: str) -> bytes:
    if not url_or_b64:
        raise ValueError("Görsel veya ses verisi boş olamaz")

    # Check if base64 data URL: data:image/png;base64,....
    if url_or_b64.startswith("data:"):
        match = re.search(r"base64,(.*)", url_or_b64)
        if match:
            return base64.b64decode(match.group(1))
        raise ValueError("Geçersiz base64 data URL formatı")

    # If pure base64 (no scheme)
    if not url_or_b64.startswith("http://") and not url_or_b64.startswith("https://"):
        try:
            return base64.b64decode(url_or_b64)
        except Exception:
            pass

    # Fetch from HTTP URL
    req = urllib.request.Request(
        url_or_b64,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PromptVault/1.0"}
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read()


class ImageImportRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    generator: str = "gemini"  # "gemini" | "chatgpt" | "flow" | "imagen"
    image_b64: str | None = None
    image_url: str | None = None
    source_url: str | None = None
    model: str | None = None


class MusicImportRequest(BaseModel):
    metadata_txt: str | None = None
    title: str | None = None
    style: str | None = None
    lyrics: str | None = None
    persona: str | None = None
    model: str | None = None
    suno_id: str | None = None
    suno_url: str | None = None
    audio_url: str | None = None
    audio_b64: str | None = None
    artist: str | None = None


class ToggleRequest(BaseModel):
    enabled: bool


def create_quick_import_router(lib: Library, music_lib: MusicLibrary) -> APIRouter:
    router = APIRouter(prefix="/api/quick-import", tags=["quick-import"])
    data_dir = lib.data_dir

    @router.get("/status")
    def get_status():
        enabled = is_quick_import_enabled(data_dir)
        return {
            "enabled": enabled,
            "version": "1.0",
            "supported_generators": ["gemini", "chatgpt", "flow", "suno", "imagen"],
        }

    @router.post("/toggle")
    def toggle_status(req: ToggleRequest):
        new_state = set_quick_import_enabled(data_dir, req.enabled)
        return {"enabled": new_state}

    @router.post("/image")
    async def import_image(req: ImageImportRequest):
        if not is_quick_import_enabled(data_dir):
            raise HTTPException(403, "Hızlı aktarım (Quick Import) PromptVault ayarlarından kapatılmıştır.")

        img_bytes: bytes | None = None
        if req.image_b64:
            img_bytes = _fetch_or_decode_bytes(req.image_b64)
        elif req.image_url:
            try:
                img_bytes = _fetch_or_decode_bytes(req.image_url)
            except Exception as e:
                raise HTTPException(400, f"Görsel URL'den indirilemedi: {e}")

        if not img_bytes:
            raise HTTPException(400, "Görsel verisi (image_b64 veya image_url) gönderilmedi.")

        prompt = req.prompt.strip()
        gen = req.generator.strip().lower() or "gemini"
        notes = f"Kaynak: {req.source_url}" if req.source_url else ""

        # Save to image vault
        try:
            record = lib.add_bytes(
                data=img_bytes,
                filename=f"{gen}_import.png",
                prompt=prompt,
                negative=req.negative_prompt.strip() or None,
                generator=gen,
                model=req.model or gen,
                notes=notes or "",
            )
            image_id = record.get("id")
            # Add generator tag automatically
            if image_id:
                lib.add_tags(image_id, [gen], kind="gen")
            return {
                "ok": True,
                "status": "imported",
                "image_id": image_id,
                "prompt": prompt,
                "generator": gen,
            }
        except Exception as e:
            raise HTTPException(500, f"Görsel kasaya kaydedilemedi: {e}")

    @router.post("/music")
    async def import_music(req: MusicImportRequest):
        if not is_quick_import_enabled(data_dir):
            raise HTTPException(403, "Hızlı aktarım (Quick Import) PromptVault ayarlarından kapatılmıştır.")

        parsed = None
        if req.metadata_txt:
            parsed = parse_suno_txt(req.metadata_txt)

        title = (parsed.title if parsed and parsed.title else req.title) or "İsimsiz Şarkı"
        style = (parsed.style if parsed and parsed.style else req.style) or ""
        lyrics = (parsed.lyrics if parsed and parsed.lyrics else req.lyrics) or ""
        suno_id = (parsed.suno_id if parsed and parsed.suno_id else req.suno_id) or ""
        model = (parsed.model if parsed and parsed.model else req.model) or "Suno AI"
        persona = (parsed.persona if parsed and parsed.persona else req.persona) or ""
        suno_url = (parsed.suno_url if parsed and parsed.suno_url else req.suno_url) or ""
        artist = req.artist or persona

        # Handle Audio file if url or b64 provided
        audio_path = None
        if req.audio_b64:
            try:
                audio_bytes = _fetch_or_decode_bytes(req.audio_b64)
                fn = f"{suno_id or 'suno'}.mp3"
                tmp_p = music_lib.vault_dir / f"tmp_{fn}"
                tmp_p.write_bytes(audio_bytes)
                audio_path = tmp_p
            except Exception:
                pass
        elif req.audio_url:
            try:
                audio_bytes = _fetch_or_decode_bytes(req.audio_url)
                fn = f"{suno_id or 'suno'}.mp3"
                tmp_p = music_lib.vault_dir / f"tmp_{fn}"
                tmp_p.write_bytes(audio_bytes)
                audio_path = tmp_p
            except Exception:
                pass

        # Write metadata txt if available
        txt_path = None
        if req.metadata_txt:
            fn = f"{suno_id or 'suno'}_metadata.txt"
            tmp_t = music_lib.vault_dir / f"tmp_{fn}"
            tmp_t.write_text(req.metadata_txt, encoding="utf-8")
            txt_path = tmp_t

        try:
            saved = music_lib.add_song(
                title=title,
                style=style,
                lyrics=lyrics,
                suno_id=suno_id,
                model=model,
                persona=persona,
                suno_url=suno_url,
                artist=artist,
                audio_path=audio_path,
                txt_path=txt_path,
                tags=parsed.tags if parsed else None,
            )
            # Clean up temp files if created
            if audio_path and Path(audio_path).exists() and "tmp_" in Path(audio_path).name:
                try:
                    Path(audio_path).unlink()
                except Exception:
                    pass
            if txt_path and Path(txt_path).exists() and "tmp_" in Path(txt_path).name:
                try:
                    Path(txt_path).unlink()
                except Exception:
                    pass

            return {
                "ok": True,
                "song_id": saved["id"],
                "title": saved["title"],
                "artist": saved["artist"],
                "has_audio": bool(saved.get("audio_path") or saved.get("vault_audio_path")),
            }
        except Exception as e:
            raise HTTPException(500, f"Şarkı müzik kasasına kaydedilemedi: {e}")

    return router
