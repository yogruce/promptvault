"""FastAPI router for Suno AI songs, workspaces, and music management."""
from __future__ import annotations

import mimetypes
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from .db import MusicLibrary


class WorkspaceCreate(BaseModel):
    name: str
    description: str = ""
    color: str = "#8b5cf6"
    icon: str = "🎵"


class WorkspacePatch(BaseModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None
    icon: str | None = None


class SongPatch(BaseModel):
    title: str | None = None
    style: str | None = None
    lyrics: str | None = None
    model: str | None = None
    workspace_id: int | None = None
    artist: str | None = None
    rating: int | None = None
    favorite: bool | None = None
    notes: str | None = None
    suno_url: str | None = None


class BulkSongDelete(BaseModel):
    ids: list[int]


class BulkAssignWorkspace(BaseModel):
    ids: list[int]
    workspace_id: int | None = None


class MusicScanRequest(BaseModel):
    path: str
    workspace_id: int | None = None
    artist: str = ""


class ManualSongAdd(BaseModel):
    title: str
    style: str = ""
    lyrics: str = ""
    suno_id: str = ""
    model: str = "Suno AI"
    workspace_id: int | None = None
    artist: str = ""
    rating: int = 0
    favorite: bool = False
    notes: str = ""
    tags: list[str] = []


def create_music_router(music_lib: MusicLibrary) -> APIRouter:
    router = APIRouter(prefix="/api/music", tags=["music"])
    scan_state: dict[str, Any] = {"running": False, "stats": None, "error": None, "path": None}
    scan_lock = threading.Lock()

    # ------------------------------------------------------------- Stats
    @router.get("/stats")
    def stats():
        return music_lib.get_stats()

    # -------------------------------------------------------- Workspaces
    @router.get("/workspaces")
    def list_workspaces():
        return music_lib.list_workspaces()

    @router.post("/workspaces")
    def create_workspace(body: WorkspaceCreate):
        try:
            return music_lib.create_workspace(
                name=body.name,
                description=body.description,
                color=body.color,
                icon=body.icon,
            )
        except Exception as e:
            raise HTTPException(400, str(e))

    @router.patch("/workspaces/{ws_id}")
    def patch_workspace(ws_id: int, body: WorkspacePatch):
        ws = music_lib.update_workspace(
            workspace_id=ws_id,
            name=body.name,
            description=body.description,
            color=body.color,
            icon=body.icon,
        )
        if not ws:
            raise HTTPException(404, "Çalışma alanı bulunamadı")
        return ws

    @router.delete("/workspaces/{ws_id}")
    def delete_workspace(ws_id: int):
        ok = music_lib.delete_workspace(ws_id)
        if not ok:
            raise HTTPException(404, "Çalışma alanı bulunamadı")
        return {"deleted": True, "id": ws_id}

    # ------------------------------------------------------------- Songs
    @router.get("/songs")
    def search_songs(
        q: str = "",
        workspace_id: int | None = None,
        artist: str | None = None,
        sort: str = "added",
        limit: int = Query(50, le=500),
        offset: int = 0,
    ):
        total, items = music_lib.search(
            q=q,
            workspace_id=workspace_id,
            artist=artist,
            sort=sort,
            limit=limit,
            offset=offset,
        )
        return {"total": total, "items": items}

    @router.get("/songs/{song_id}")
    def get_song(song_id: int):
        song = music_lib.get_song(song_id)
        if not song:
            raise HTTPException(404, "Şarkı bulunamadı")
        return song

    @router.patch("/songs/{song_id}")
    def patch_song(song_id: int, body: SongPatch):
        song = music_lib.get_song(song_id)
        if not song:
            raise HTTPException(404, "Şarkı bulunamadı")
        updated = music_lib.update_song(song_id, **body.model_dump(exclude_unset=True))
        return updated

    @router.delete("/songs/{song_id}")
    def delete_song(song_id: int):
        ok = music_lib.delete_song(song_id)
        if not ok:
            raise HTTPException(404, "Şarkı bulunamadı veya silinemedi")
        return {"deleted": True, "id": song_id}

    @router.post("/bulk/delete")
    def bulk_delete(body: BulkSongDelete):
        count = music_lib.bulk_delete(body.ids)
        return {"deleted_count": count}

    @router.post("/bulk/workspace")
    def bulk_assign_workspace(body: BulkAssignWorkspace):
        count = music_lib.bulk_assign_workspace(body.ids, body.workspace_id)
        return {"updated_count": count}

    # ------------------------------------------------------------- Audio
    @router.get("/songs/{song_id}/audio")
    def stream_audio(song_id: int):
        p = music_lib.resolve_audio_path(song_id)
        if not p or not p.exists():
            raise HTTPException(404, "Bu şarkı için ses dosyası bulunamadı")
        mime, _ = mimetypes.guess_type(str(p))
        return FileResponse(p, media_type=mime or "audio/mpeg")

    # ------------------------------------------------------------- Tags
    @router.get("/tags")
    def get_style_tags(limit: int = Query(100, le=500)):
        return music_lib.get_style_tags(limit=limit)

    # ------------------------------------------------------------- Upload & Add
    @router.post("/upload")
    async def upload_song_files(
        txt_file: UploadFile | None = File(None),
        audio_file: UploadFile | None = File(None),
        workspace_id: int | None = Form(None),
        artist: str = Form(""),
    ):
        """Uploads Suno txt metadata file and/or MP3 audio file."""
        if not txt_file and not audio_file:
            raise HTTPException(400, "En az bir dosya (txt veya ses dosyası) seçilmelidir")

        temp_dir = music_lib.data_dir / "temp_uploads"
        temp_dir.mkdir(parents=True, exist_ok=True)

        txt_temp: Path | None = None
        audio_temp: Path | None = None

        if txt_file:
            txt_temp = temp_dir / txt_file.filename
            data = await txt_file.read()
            txt_temp.write_bytes(data)

        if audio_file:
            audio_temp = temp_dir / audio_file.filename
            data = await audio_file.read()
            audio_temp.write_bytes(data)

        try:
            if txt_temp:
                content = txt_temp.read_text(encoding="utf-8", errors="replace")
                from .parser import parse_suno_txt
                parsed = parse_suno_txt(content, filename=txt_temp.name)
                song = music_lib.add_song(
                    title=parsed.title,
                    style=parsed.style,
                    lyrics=parsed.lyrics,
                    suno_id=parsed.suno_id,
                    model=parsed.model,
                    created_at=parsed.created_at,
                    suno_url=parsed.suno_url,
                    workspace_id=workspace_id,
                    artist=artist,
                    audio_path=audio_temp,
                    txt_path=txt_temp,
                )
            else:
                # Audio only
                song = music_lib.add_song(
                    title=audio_temp.stem,  # type: ignore
                    audio_path=audio_temp,
                    workspace_id=workspace_id,
                    artist=artist,
                )
            return song
        finally:
            # Clean up temp upload files
            if txt_temp and txt_temp.exists():
                try:
                    txt_temp.unlink()
                except Exception:
                    pass
            if audio_temp and audio_temp.exists():
                try:
                    audio_temp.unlink()
                except Exception:
                    pass

    @router.post("/manual-add")
    def manual_add(body: ManualSongAdd):
        return music_lib.add_song(
            title=body.title,
            style=body.style,
            lyrics=body.lyrics,
            suno_id=body.suno_id,
            model=body.model,
            workspace_id=body.workspace_id,
            artist=body.artist,
            rating=body.rating,
            favorite=body.favorite,
            notes=body.notes,
            tags=body.tags,
        )

    # ------------------------------------------------------------- Scan
    @router.post("/scan")
    def start_music_scan(body: MusicScanRequest):
        p = Path(body.path).expanduser().resolve()
        if not p.exists() or not p.is_dir():
            raise HTTPException(400, f"Klasör bulunamadı: {p}")

        with scan_lock:
            if scan_state["running"]:
                raise HTTPException(409, "Zaten bir müzik taraması sürüyor")
            scan_state.update(running=True, stats=None, error=None, path=str(p))

        def run():
            try:
                res = music_lib.scan_folder(
                    folder_path=p,
                    workspace_id=body.workspace_id,
                    artist=body.artist,
                    progress=lambda s: scan_state.__setitem__("stats", s),
                )
                scan_state["stats"] = res
            except Exception as e:
                scan_state["error"] = str(e)
            finally:
                scan_state["running"] = False

        threading.Thread(target=run, daemon=True).start()
        return scan_state

    @router.get("/scan")
    def get_music_scan_status():
        return scan_state

    return router
