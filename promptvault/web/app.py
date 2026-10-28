"""FastAPI web interface for PromptVault."""
from __future__ import annotations

import base64
import threading
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ..db import TAG_KINDS, Library
from ..export import FORMATS, export_rows
from ..gdrive import GDriveManager
from ..matrix import Matrix, MatrixError, MatrixSpec
from ..pngmeta import make_blank_png

STATIC = Path(__file__).parent / "static"
THUMB_SIZE = 384


class ScanRequest(BaseModel):
    path: str
    recursive: bool = True
    force: bool = False


class ImagePatch(BaseModel):
    rating: int | None = None
    favorite: bool | None = None
    notes: str | None = None
    prompt: str | None = None
    negative: str | None = None
    model: str | None = None
    generator: str | None = None
    seed: int | None = None
    params: dict[str, Any] | None = None


class TagsBody(BaseModel):
    tags: list[str]


class BulkTags(BaseModel):
    ids: list[int]
    tags: list[str]


class BulkDeleteBody(BaseModel):
    ids: list[int]
    delete_original: bool = False


class MatrixBody(BaseModel):
    spec: dict[str, Any]
    limit: int = 200
    format: str = "txt"


class SaveMatrix(BaseModel):
    name: str
    spec: dict[str, Any]


class WildcardBody(BaseModel):
    items: list[str]


class WildcardFromTags(BaseModel):
    name: str
    kind: str = "prompt"
    query: str = ""
    limit: int = 50


class ManualAddBody(BaseModel):
    prompt: str
    negative: str = ""
    model: str = ""
    generator: str = ""
    tags: list[str] = []
    notes: str = ""
    rating: int = 0
    data_b64: str | None = None
    filename: str = "entry.png"


class GDriveConfigBody(BaseModel):
    client_id: str
    client_secret: str


def pick_folder_dialog(title: str = "Taranacak Klasörü Seçin") -> str | None:
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        folder = filedialog.askdirectory(title=title)
        root.destroy()
        return str(folder) if folder else None
    except Exception:
        import subprocess
        ps = """
        Add-Type -AssemblyName System.Windows.Forms
        $d = New-Object System.Windows.Forms.FolderBrowserDialog
        $d.Description = 'Taranacak Klasörü Seçin'
        if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Write-Output $d.SelectedPath
        }
        """
        res = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)
        out = res.stdout.strip()
        return out if out else None


def create_app(library: Library | None = None, wildcard_dir: str | Path | None = None) -> FastAPI:
    lib = library or Library()
    gdrive = GDriveManager(lib.data_dir)
    app = FastAPI(title="PromptVault", version="1.0")
    app.state.library = lib
    app.state.gdrive = gdrive
    scan_state: dict[str, Any] = {"running": False, "stats": None, "error": None, "path": None}
    scan_lock = threading.Lock()
    thumb_dir = lib.data_dir / "thumbs"

    def _image(image_id: int) -> dict[str, Any]:
        img = lib.get(image_id)
        if img is None:
            raise HTTPException(404, "Görsel bulunamadı")
        return img

    def _matrix(spec: dict[str, Any]) -> Matrix:
        try:
            return Matrix(MatrixSpec.from_dict(spec), lib.wildcards(wildcard_dir))
        except (MatrixError, TypeError) as e:
            raise HTTPException(400, str(e))

    # ---------------------------------------------------------- library
    @app.get("/api/stats")
    def stats():
        return lib.stats()

    @app.get("/api/images")
    def images(q: str = "", sort: str = "added", limit: int = Query(60, le=500), offset: int = 0):
        total, items = lib.search(q, sort=sort, limit=limit, offset=offset)
        return {"total": total, "items": items}

    @app.get("/api/images/{image_id}")
    def image(image_id: int):
        return _image(image_id)

    @app.patch("/api/images/{image_id}")
    def patch_image(image_id: int, body: ImagePatch):
        _image(image_id)
        lib.update(image_id, **body.model_dump(exclude_unset=True))
        return _image(image_id)

    @app.get("/api/images/{image_id}/file")
    def image_file(image_id: int):
        p = lib.resolve_image_path(image_id)
        if not p or not p.exists():
            # Check thumbnail fallback
            img = _image(image_id)
            thumb = thumb_dir / f"{img['sha1']}.webp"
            if thumb.exists():
                return FileResponse(thumb, media_type="image/webp")
            raise HTTPException(404, "Dosya kasada veya diskte bulunamadı")
        return FileResponse(p, media_type="image/png")

    @app.get("/api/images/{image_id}/thumb")
    def image_thumb(image_id: int):
        img = _image(image_id)
        thumb = thumb_dir / f"{img['sha1']}.webp"
        if thumb.exists():
            return FileResponse(thumb, media_type="image/webp", headers={"Cache-Control": "max-age=86400"})

        p = lib.resolve_image_path(image_id)
        if not p or not p.exists():
            raise HTTPException(404, "Dosya diskte veya kasada yok")
        try:
            from PIL import Image
        except ImportError:
            return FileResponse(p, media_type="image/png")
        thumb_dir.mkdir(parents=True, exist_ok=True)
        try:
            with Image.open(p) as im:
                im.thumbnail((THUMB_SIZE, THUMB_SIZE))
                if im.mode not in ("RGB", "RGBA"):
                    im = im.convert("RGBA")
                im.save(thumb, "WEBP", quality=82)
            return FileResponse(thumb, media_type="image/webp", headers={"Cache-Control": "max-age=86400"})
        except Exception:
            return FileResponse(p, media_type="image/png")

    @app.post("/api/images/{image_id}/tags")
    def add_tags(image_id: int, body: TagsBody):
        _image(image_id)
        lib.add_tags(image_id, body.tags)
        return _image(image_id)["tags"]

    @app.delete("/api/images/{image_id}/tags/{name}")
    def delete_tag(image_id: int, name: str, kind: str = "user"):
        lib.remove_tags(image_id, [name], kind=kind or None)
        return _image(image_id)["tags"]

    @app.delete("/api/images/{image_id}")
    def delete_image(image_id: int, delete_original: bool = False):
        _image(image_id)
        ok = lib.delete_image(image_id, delete_vault_file=True, delete_original=delete_original)
        if not ok:
            raise HTTPException(404, "Görsel silinemedi veya bulunamadı")
        return {"deleted": True, "id": image_id}

    @app.post("/api/bulk/tags")
    def bulk_tags(body: BulkTags):
        return {"updated": lib.bulk_add_tags(body.ids, body.tags)}

    @app.post("/api/bulk/delete")
    def bulk_delete(body: BulkDeleteBody):
        count = lib.bulk_delete(body.ids, delete_vault_file=True, delete_original=body.delete_original)
        return {"deleted_count": count}

    @app.get("/api/tags")
    def tags(kind: str | None = None, prefix: str = "", q: str = "", limit: int = Query(200, le=5000)):
        if kind and kind not in TAG_KINDS:
            raise HTTPException(400, f"kind: {', '.join(TAG_KINDS)}")
        return lib.tag_stats(kind=kind, prefix=prefix, query=q, limit=limit)

    # ------------------------------------------------------------- upload & manual entry
    @app.post("/api/upload")
    async def upload_image(
        file: UploadFile = File(...),
        prompt: str | None = Form(None),
        negative: str | None = Form(None),
        model: str | None = Form(None),
        generator: str | None = Form(None),
        tags: str | None = Form(None),
        notes: str = Form(""),
        rating: int = Form(0),
    ):
        data = await file.read()
        if not data:
            raise HTTPException(400, "Dosya boş")
        tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None
        return lib.add_bytes(
            data=data,
            filename=file.filename or "upload.png",
            prompt=prompt.strip() if prompt and prompt.strip() else None,
            negative=negative.strip() if negative and negative.strip() else None,
            model=model.strip() if model and model.strip() else None,
            generator=generator.strip() if generator and generator.strip() else None,
            tags=tag_list,
            notes=notes or "",
            rating=rating,
        )

    @app.post("/api/manual-add")
    def manual_add(body: ManualAddBody):
        if body.data_b64:
            try:
                data = base64.b64decode(body.data_b64)
            except Exception:
                raise HTTPException(400, "Geçersiz base64 görsel verisi")
        else:
            data = make_blank_png(128, 128, (48, 52, 68))
        return lib.add_bytes(
            data=data,
            filename=body.filename,
            prompt=body.prompt,
            negative=body.negative,
            model=body.model,
            generator=body.generator or None,
            tags=body.tags,
            notes=body.notes,
            rating=body.rating,
        )

    # ------------------------------------------------------------- scan
    @app.post("/api/dialog/pick-folder")
    def dialog_pick_folder():
        folder = pick_folder_dialog()
        return {"path": folder}

    @app.post("/api/scan")
    def start_scan(body: ScanRequest):
        path = Path(body.path).expanduser()
        if not path.exists():
            raise HTTPException(400, f"Yol bulunamadı: {path}")
        with scan_lock:
            if scan_state["running"]:
                raise HTTPException(409, "Zaten bir tarama sürüyor")
            scan_state.update(running=True, stats=None, error=None, path=str(path))

        def run():
            try:
                scan_state["stats"] = lib.scan(path, body.recursive, body.force,
                                               progress=lambda s: scan_state.__setitem__("stats", s))
            except Exception as e:  # pragma: no cover - surfaced to UI
                scan_state["error"] = str(e)
            finally:
                scan_state["running"] = False

        threading.Thread(target=run, daemon=True).start()
        return scan_state

    @app.get("/api/scan")
    def scan_status():
        return scan_state

    @app.post("/api/prune")
    def prune():
        return {"removed": lib.prune(purge_vault=False)}

    # ----------------------------------------------------------- matrix
    @app.post("/api/matrix/preview")
    def matrix_preview(body: MatrixBody):
        m = _matrix(body.spec)
        try:
            rows = list(m.rows(limit=min(body.limit, 2000)))
            return {"count": m.count(), "rows": rows}
        except (MatrixError, RecursionError) as e:
            raise HTTPException(400, str(e))

    @app.post("/api/matrix/export")
    def matrix_export(body: MatrixBody):
        if body.format not in FORMATS:
            raise HTTPException(400, f"format: {', '.join(FORMATS)}")
        m = _matrix(body.spec)
        try:
            text = export_rows(m.rows(), body.format)
        except (MatrixError, RecursionError) as e:
            raise HTTPException(400, str(e))
        mime, ext = FORMATS[body.format]
        name = "prompts_a1111" if body.format == "a1111" else "prompts"
        return Response(text, media_type=f"{mime}; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{name}.{ext}"'})

    @app.get("/api/matrices")
    def matrices():
        return lib.list_matrices()

    @app.post("/api/matrices")
    def save_matrix(body: SaveMatrix):
        if not body.name.strip():
            raise HTTPException(400, "İsim gerekli")
        lib.save_matrix(body.name.strip(), body.spec)
        return lib.list_matrices()

    @app.delete("/api/matrices/{name}")
    def delete_matrix(name: str):
        lib.delete_matrix(name)
        return lib.list_matrices()

    @app.get("/api/wildcards")
    def wildcards():
        return lib.wildcards(wildcard_dir)

    @app.put("/api/wildcards/{name:path}")
    def put_wildcard(name: str, body: WildcardBody):
        lib.set_wildcard(name, body.items)
        return lib.wildcards(wildcard_dir)

    @app.delete("/api/wildcards/{name:path}")
    def delete_wildcard(name: str):
        lib.delete_wildcard(name)
        return lib.wildcards(wildcard_dir)

    @app.post("/api/wildcards/from-tags")
    def wildcard_from_tags(body: WildcardFromTags):
        items = lib.wildcard_from_tags(body.name, body.kind, body.query, body.limit)
        return {"name": body.name, "items": items}

    # ----------------------------------------------------------- google drive
    @app.get("/api/gdrive/status")
    def gdrive_status():
        return gdrive.get_status()

    @app.post("/api/gdrive/config")
    def gdrive_config(body: GDriveConfigBody):
        gdrive.save_client_config(body.client_id, body.client_secret)
        return gdrive.get_status()

    @app.post("/api/gdrive/login")
    def gdrive_login():
        if not gdrive.is_configured():
            raise HTTPException(400, "Google Drive henüz yapılandırılmadı. Lütfen Client ID ve Secret girin.")

        def run_oauth():
            try:
                from google_auth_oauthlib.flow import InstalledAppFlow
                flow = InstalledAppFlow.from_client_secrets_file(
                    str(gdrive.client_file),
                    scopes=["https://www.googleapis.com/auth/drive.file"],
                )
                creds = flow.run_local_server(port=0, open_browser=True)
                gdrive.token_file.write_text(creds.to_json(), encoding="utf-8")
                # Auto initialize the Prompt Vault folder
                gdrive.get_or_create_vault_folder()
            except Exception as e:
                pass

        threading.Thread(target=run_oauth, daemon=True).start()
        return {"status": "login_started", "message": "Tarayıcıda Google giriş penceresi açılıyor..."}

    @app.post("/api/gdrive/logout")
    def gdrive_logout():
        gdrive.logout()
        return gdrive.get_status()

    @app.post("/api/gdrive/sync")
    def gdrive_sync():
        if not gdrive.is_authenticated():
            raise HTTPException(401, "Google Drive oturumu açık değil.")

        def run_sync():
            try:
                gdrive.sync_new_images(lib)
            except Exception:
                pass

        threading.Thread(target=run_sync, daemon=True).start()
        return gdrive.get_status()

    # ------------------------------------------------------------ static
    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(STATIC / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app
