"""Google Drive integration for PromptVault.

Manages OAuth2 authentication, creation of the 'Prompt Vault' folder,
and uploading new/un-synced images and metadata backups.
"""
from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path
from typing import Any, Callable

SCOPES = ["https://www.googleapis.com/auth/drive"]


def extract_folder_id(folder_id_or_url: str) -> str:
    """Extract a Google Drive folder ID from a URL or raw ID string."""
    raw = (folder_id_or_url or "").strip()
    if not raw:
        raise ValueError("Klasör ID veya URL boş olamaz")
    m = re.search(r"/folders/([A-Za-z0-9_-]+)", raw)
    if m:
        return m.group(1)
    m = re.search(r"[?&]id=([A-Za-z0-9_-]+)", raw)
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{10,}", raw):
        return raw
    raise ValueError("Geçerli bir Google Drive klasör ID veya bağlantısı girin")


class GDriveManager:
    def __init__(self, data_dir: str | Path):
        self.dir = Path(data_dir) / "gdrive"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.client_file = self.dir / "client_secret.json"
        self.token_file = self.dir / "token.json"
        self.state_file = self.dir / "state.json"
        self._lock = threading.Lock()
        self._syncing = False
        self._sync_progress: dict[str, Any] = {"running": False, "total": 0, "done": 0, "error": None}
        self._restoring = False
        self._restore_progress: dict[str, Any] = {"running": False, "total": 0, "done": 0, "error": None, "result": None}

    # ------------------------------------------------------------- auth config
    def is_configured(self) -> bool:
        return self.client_file.exists()

    def is_authenticated(self) -> bool:
        if not self.token_file.exists():
            return False
        try:
            creds = self.get_credentials()
            return bool(creds and (creds.valid or creds.refresh_token))
        except Exception:
            return False

    def save_client_config(self, client_id: str, client_secret: str, redirect_uris: list[str] | None = None) -> None:
        client_id = client_id.strip()
        client_secret = client_secret.strip()
        uris = redirect_uris or ["http://localhost", "http://127.0.0.1", "http://127.0.0.1:7860/api/gdrive/callback"]
        cfg = {
            "installed": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": uris,
            }
        }
        self.client_file.write_text(json.dumps(cfg, indent=2), encoding="utf-8")

    def save_client_file(self, content: bytes | str) -> None:
        if isinstance(content, bytes):
            self.client_file.write_bytes(content)
        else:
            self.client_file.write_text(content, encoding="utf-8")

    def get_credentials(self):
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials

        if not self.token_file.exists():
            return None
        try:
            token_data = json.loads(self.token_file.read_text(encoding="utf-8"))
            saved_scopes = token_data.get("scopes") or []
            if saved_scopes and not all(s in saved_scopes for s in SCOPES):
                return None
        except Exception:
            pass
        creds = Credentials.from_authorized_user_file(str(self.token_file), SCOPES)
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
            self.token_file.write_text(creds.to_json(), encoding="utf-8")
        return creds

    def build_service(self):
        from googleapiclient.discovery import build

        creds = self.get_credentials()
        if not creds:
            raise RuntimeError("Google Drive oturumu açık değil")
        return build("drive", "v3", credentials=creds)

    def logout(self) -> None:
        with self._lock:
            if self.token_file.exists():
                self.token_file.unlink()
            if self.state_file.exists():
                self.state_file.unlink()

    # ----------------------------------------------------------- status info
    def get_status(self) -> dict[str, Any]:
        authed = self.is_authenticated()
        user_info = None
        folder_info = None
        api_error = None
        if authed:
            try:
                service = self.build_service()
                about = service.about().get(fields="user,storageQuota").execute()
                u = about.get("user", {})
                user_info = {
                    "name": u.get("displayName", ""),
                    "email": u.get("emailAddress", ""),
                    "photo": u.get("photoLink", ""),
                }
                folder_id = self.get_saved_folder_id()
                folder_url = None
                if folder_id:
                    try:
                        f = service.files().get(fileId=folder_id, fields="id,trashed,webViewLink").execute()
                        if f.get("trashed"):
                            folder_id = None
                        else:
                            folder_url = f.get("webViewLink") or f"https://drive.google.com/drive/folders/{folder_id}"
                    except Exception:
                        folder_id = None
                if not folder_id:
                    folder_id, folder_url = self.get_or_create_vault_folder(service)
                if folder_id:
                    folder_info = {
                        "id": folder_id,
                        "url": folder_url or f"https://drive.google.com/drive/folders/{folder_id}",
                    }
            except Exception as e:
                authed = False
                api_error = str(e)

        return {
            "configured": self.is_configured(),
            "authenticated": authed,
            "user": user_info,
            "folder": folder_info,
            "error": api_error,
            "sync": self._sync_progress,
            "restore": self._restore_progress,
        }

    # ----------------------------------------------------------- folder
    def get_saved_folder_id(self) -> str | None:
        if self.state_file.exists():
            try:
                return json.loads(self.state_file.read_text(encoding="utf-8")).get("folder_id")
            except Exception:
                pass
        return None

    def set_folder_id(self, folder_id_or_url: str, service=None) -> dict[str, str]:
        """Point PromptVault to an existing Google Drive folder by ID or URL."""
        folder_id = extract_folder_id(folder_id_or_url)
        url = f"https://drive.google.com/drive/folders/{folder_id}"
        name = ""

        srv = service or (self.build_service() if self.is_authenticated() else None)
        if srv is not None:
            meta = srv.files().get(
                fileId=folder_id,
                fields="id,name,mimeType,trashed,webViewLink",
            ).execute()
            if meta.get("trashed"):
                raise ValueError("Seçilen Google Drive klasörü çöp kutusunda")
            if meta.get("mimeType") != "application/vnd.google-apps.folder":
                raise ValueError("Belirtilen kimlik bir Google Drive klasörüne ait değil")
            url = meta.get("webViewLink") or url
            name = meta.get("name") or ""

        self.state_file.write_text(json.dumps({"folder_id": folder_id, "url": url}), encoding="utf-8")
        return {"folder_id": folder_id, "url": url, "name": name}

    def get_or_create_vault_folder(self, service=None) -> tuple[str, str]:
        """Return (folder_id, folder_url) for 'Prompt Vault'."""
        srv = service or self.build_service()
        saved_id = self.get_saved_folder_id()
        if saved_id:
            try:
                f = srv.files().get(fileId=saved_id, fields="id,trashed,webViewLink").execute()
                if not f.get("trashed"):
                    url = f.get("webViewLink") or f"https://drive.google.com/drive/folders/{saved_id}"
                    return saved_id, url
            except Exception:
                pass

        # Query existing folder named 'Prompt Vault' (or 'Prompt Vult')
        q = "mimeType='application/vnd.google-apps.folder' and (name='Prompt Vault' or name='Prompt Vult') and trashed=false"
        res = srv.files().list(q=q, fields="files(id, name, webViewLink)").execute()
        files = res.get("files", [])
        if files:
            chosen = files[0]
            if len(files) > 1:
                # Prefer a folder that already contains PromptVault_Backup.json
                for cand in files:
                    bq = f"'{cand['id']}' in parents and name='PromptVault_Backup.json' and trashed=false"
                    if srv.files().list(q=bq, fields="files(id)", pageSize=1).execute().get("files"):
                        chosen = cand
                        break
            folder_id = chosen["id"]
            url = chosen.get("webViewLink") or f"https://drive.google.com/drive/folders/{folder_id}"
        else:
            meta = {
                "name": "Prompt Vault",
                "mimeType": "application/vnd.google-apps.folder",
                "description": "PromptVault AI görselleri ve prompt kütüphanesi yedekleri",
            }
            folder = srv.files().create(body=meta, fields="id,webViewLink").execute()
            folder_id = folder["id"]
            url = folder.get("webViewLink") or f"https://drive.google.com/drive/folders/{folder_id}"

        # Save state
        self.state_file.write_text(json.dumps({"folder_id": folder_id, "url": url}), encoding="utf-8")
        return folder_id, url

    # ------------------------------------------------------------- upload sync
    def sync_new_images(self, library, progress_callback: Callable[[dict[str, Any]], None] | None = None) -> dict[str, Any]:
        """Find images not yet synced to Google Drive and upload them."""
        with self._lock:
            if self._syncing:
                raise RuntimeError("Zaten bir Google Drive eşitlemesi devam ediyor")
            self._syncing = True
            self._sync_progress.update(running=True, total=0, done=0, error=None)

        try:
            service = self.build_service()
            folder_id, folder_url = self.get_or_create_vault_folder(service)

            from googleapiclient.http import MediaFileUpload

            # Query images needing upload
            c = library.conn
            rows = c.execute("SELECT id, path, vault_path, sha1, prompt, model, generator FROM images WHERE gdrive_id IS NULL ORDER BY id ASC").fetchall()
            items = [dict(r) for r in rows]

            self._sync_progress["total"] = len(items)
            uploaded_count = 0

            for i, img in enumerate(items):
                local_path = library.resolve_image_path(img["id"])
                if not local_path or not local_path.exists():
                    continue

                ext = local_path.suffix or ".png"
                name = f"{img['id']}_{img['sha1'][:8]}{ext}"
                desc = (img.get("prompt") or "")[:400]
                if img.get("model"):
                    desc = f"Model: {img['model']} | {desc}"

                file_metadata = {
                    "name": name,
                    "parents": [folder_id],
                    "description": desc,
                }
                media = MediaFileUpload(str(local_path), mimetype="image/png", resumable=True)
                uploaded = service.files().create(body=file_metadata, media_body=media, fields="id").execute()
                gdrive_id = uploaded.get("id")

                # Mark image as synced
                with library._write_lock:
                    from datetime import datetime, timezone
                    now_str = datetime.now(timezone.utc).isoformat(timespec="seconds")
                    c.execute("UPDATE images SET gdrive_id=?, gdrive_synced_at=? WHERE id=?", (gdrive_id, now_str, img["id"]))
                    c.commit()

                uploaded_count += 1
                self._sync_progress["done"] = uploaded_count
                if progress_callback:
                    progress_callback(dict(self._sync_progress, current=name))

            # Also create/update a JSON library backup in the folder
            self._backup_json_library(library, service, folder_id)

            res = {
                "total_new": len(items),
                "uploaded": uploaded_count,
                "folder_url": folder_url,
            }
            self._sync_progress.update(running=False, result=res)
            return res
        except Exception as e:
            self._sync_progress.update(running=False, error=str(e))
            raise
        finally:
            self._syncing = False

    def _backup_json_library(self, library, service, folder_id: str) -> None:
        """Create/update PromptVault_Backup.json in the Drive folder (v2: images + workspaces + music + system prompts)."""
        from googleapiclient.http import MediaInMemoryUpload

        c = library.conn
        workspaces = [
            dict(r)
            for r in c.execute(
                "SELECT id, name, description, color, icon, created_at, updated_at FROM workspaces ORDER BY id ASC"
            ).fetchall()
        ]
        img_rows = c.execute("""
            SELECT i.id, i.sha1, i.prompt, i.negative, i.model, i.generator, i.seed,
                   i.params, i.rating, i.favorite, i.notes, i.added_at, i.width, i.height,
                   i.size, i.gdrive_id, w.name AS workspace_name
            FROM images i
            LEFT JOIN workspaces w ON w.id = i.workspace_id
            ORDER BY i.id ASC
        """).fetchall()

        bundle: dict[str, Any] = {
            "version": 2,
            "workspaces": workspaces,
            "images": [dict(r) for r in img_rows],
            "music_workspaces": [],
            "songs": [],
            "system_prompts": [],
        }

        tables = {
            r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        if "music_workspaces" in tables:
            bundle["music_workspaces"] = [
                dict(r)
                for r in c.execute(
                    "SELECT id, name, description, color, icon, created_at, updated_at FROM music_workspaces ORDER BY id ASC"
                ).fetchall()
            ]
        if "songs" in tables:
            bundle["songs"] = [
                dict(r)
                for r in c.execute("""
                    SELECT s.suno_id, s.title, s.style, s.lyrics, s.model, s.created_at, s.suno_url,
                           s.artist, s.persona, s.synced_lyrics, s.lrc_content, s.srt_content,
                           s.has_synced_lyrics, s.rating, s.favorite, s.notes, s.duration, s.bpm,
                           s.analysis_json, s.has_analysis, s.sha1, s.added_at, s.updated_at,
                           mw.name AS workspace_name
                    FROM songs s
                    LEFT JOIN music_workspaces mw ON mw.id = s.workspace_id
                    ORDER BY s.id ASC
                """).fetchall()
            ]
        if "system_prompts" in tables:
            bundle["system_prompts"] = [
                dict(r)
                for r in c.execute(
                    "SELECT title, category, content, description, target_model, tags, icon, is_favorite, created_at, updated_at FROM system_prompts ORDER BY id ASC"
                ).fetchall()
            ]

        payload = json.dumps(bundle, ensure_ascii=False, indent=2).encode("utf-8")

        # Check if backup file exists
        q = f"'{folder_id}' in parents and name='PromptVault_Backup.json' and trashed=false"
        existing = service.files().list(q=q, fields="files(id)").execute().get("files", [])

        media = MediaInMemoryUpload(payload, mimetype="application/json")
        if existing:
            file_id = existing[0]["id"]
            service.files().update(fileId=file_id, media_body=media).execute()
        else:
            meta = {"name": "PromptVault_Backup.json", "parents": [folder_id]}
            service.files().create(body=meta, media_body=media).execute()

    # ------------------------------------------------------------- restore
    def restore_from_json_bytes(self, library, json_bytes: bytes) -> dict[str, Any]:
        """Restore metadata from an uploaded or local JSON backup file."""
        data = json.loads(json_bytes.decode("utf-8"))
        if isinstance(data, list):
            return self.restore_records(library, data)
        if isinstance(data, dict) and isinstance(data.get("images"), list):
            return self.restore_records(
                library,
                data["images"],
                workspaces=data.get("workspaces") or [],
                music_workspaces=data.get("music_workspaces") or [],
                songs=data.get("songs") or [],
                system_prompts=data.get("system_prompts") or [],
            )
        raise ValueError("Geçersiz JSON formatı: Görsel listesi veya yedek paketi bekleniyor.")

    def restore_from_gdrive(self, library, download_images: bool = False, progress_callback: Callable[[dict[str, Any]], None] | None = None) -> dict[str, Any]:
        """Find PromptVault_Backup.json in Drive and restore records (and optionally images)."""
        with self._lock:
            if self._restoring:
                raise RuntimeError("Zaten bir geri yükleme işlemi devam ediyor")
            self._restoring = True
            self._restore_progress.update(running=True, total=0, done=0, error=None, result=None)

        try:
            service = self.build_service()
            folder_id, folder_url = self.get_or_create_vault_folder(service)

            # Query PromptVault_Backup.json
            q = f"'{folder_id}' in parents and name='PromptVault_Backup.json' and trashed=false"
            res = service.files().list(q=q, fields="files(id, name)").execute()
            files = res.get("files", [])
            if not files:
                raise RuntimeError("Google Drive 'Prompt Vault' klasöründe 'PromptVault_Backup.json' yedeği bulunamadı.")

            file_id = files[0]["id"]
            import io
            from googleapiclient.http import MediaIoBaseDownload
            request = service.files().get_media(fileId=file_id)
            fh = io.BytesIO()
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()

            fh.seek(0)
            raw_backup = json.loads(fh.read().decode("utf-8"))
            if isinstance(raw_backup, list):
                items = raw_backup
                workspaces: list[dict[str, Any]] = []
                music_workspaces: list[dict[str, Any]] = []
                songs: list[dict[str, Any]] = []
                system_prompts: list[dict[str, Any]] = []
            elif isinstance(raw_backup, dict) and isinstance(raw_backup.get("images"), list):
                items = raw_backup["images"]
                workspaces = raw_backup.get("workspaces") or []
                music_workspaces = raw_backup.get("music_workspaces") or []
                songs = raw_backup.get("songs") or []
                system_prompts = raw_backup.get("system_prompts") or []
            else:
                raise ValueError("Yedek dosyası bozuk veya geçersiz formatta.")

            result = self.restore_records(
                library,
                items,
                download_images=download_images,
                service=service,
                folder_id=folder_id,
                progress_callback=progress_callback,
                workspaces=workspaces,
                music_workspaces=music_workspaces,
                songs=songs,
                system_prompts=system_prompts,
            )
            self._restore_progress.update(running=False, result=result)
            return result
        except Exception as e:
            self._restore_progress.update(running=False, error=str(e))
            raise
        finally:
            self._restoring = False

    def restore_records(
        self,
        library,
        items: list[dict[str, Any]],
        download_images: bool = False,
        service=None,
        folder_id: str | None = None,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
        workspaces: list[dict[str, Any]] | None = None,
        music_workspaces: list[dict[str, Any]] | None = None,
        songs: list[dict[str, Any]] | None = None,
        system_prompts: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Insert or update image records (plus workspaces, music, system prompts) and optionally download image binaries."""
        from datetime import datetime, timezone
        from .parsers import ParsedMeta

        self._restore_progress["total"] = len(items)
        c = library.conn
        now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")

        # 1. Restore image workspaces and build name -> id map
        workspaces_restored = 0
        ws_name_to_id: dict[str, int] = {}
        with library._write_lock:
            for ws in (workspaces or []):
                wname = (ws.get("name") or "").strip()
                if not wname:
                    continue
                existing_ws = c.execute("SELECT id FROM workspaces WHERE name=?", (wname,)).fetchone()
                if not existing_ws:
                    c.execute(
                        "INSERT INTO workspaces(name, description, color, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (
                            wname,
                            ws.get("description") or "",
                            ws.get("color") or "#8b5cf6",
                            ws.get("icon") or "🎨",
                            ws.get("created_at") or now_iso,
                            ws.get("updated_at") or now_iso,
                        ),
                    )
                    workspaces_restored += 1
            for r in c.execute("SELECT id, name FROM workspaces").fetchall():
                ws_name_to_id[r["name"]] = r["id"]
            c.commit()

        # Pre-cache Drive files if downloading images (root folder + immediate subfolders)
        drive_file_map: dict[str, str] = {}
        download_errors: list[str] = []
        if download_images and service and folder_id:
            folders_to_scan = [folder_id]
            try:
                sub_res = service.files().list(
                    q=f"'{folder_id}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'",
                    fields="files(id, name)",
                    pageSize=100,
                ).execute()
                for sf in sub_res.get("files", []):
                    folders_to_scan.append(sf["id"])
            except Exception as e:
                download_errors.append(f"Alt klasör tarama hatası: {e}")

            for scan_fid in folders_to_scan:
                try:
                    page_token = None
                    while True:
                        f_res = service.files().list(
                            q=f"'{scan_fid}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'",
                            fields="nextPageToken, files(id, name)",
                            pageSize=1000,
                            pageToken=page_token,
                        ).execute()
                        for f in f_res.get("files", []):
                            drive_file_map[f["name"]] = f["id"]
                        page_token = f_res.get("nextPageToken")
                        if not page_token:
                            break
                except Exception as e:
                    download_errors.append(f"Drive dosya listesi hatası: {e}")

        restored_count = 0
        updated_count = 0
        downloaded_images = 0
        thumb_dir = library.data_dir / "thumbs"

        for idx, item in enumerate(items):
            sha1 = item.get("sha1")
            if not sha1:
                continue

            prompt = item.get("prompt") or ""
            negative = item.get("negative") or ""
            model = item.get("model") or ""
            generator = item.get("generator") or "manual"
            seed = item.get("seed")
            params = item.get("params")
            if isinstance(params, dict):
                params_str = json.dumps(params, ensure_ascii=False)
                params_dict = params
            elif isinstance(params, str):
                params_str = params
                try:
                    params_dict = json.loads(params)
                except Exception:
                    params_dict = {}
            else:
                params_str = "{}"
                params_dict = {}

            rating = int(item.get("rating") or 0)
            favorite = int(item.get("favorite") or 0)
            notes = item.get("notes") or ""
            added_at = item.get("added_at") or now_iso

            ws_name = (item.get("workspace_name") or "").strip()
            target_ws_id: int | None = None
            if ws_name:
                if ws_name not in ws_name_to_id:
                    with library._write_lock:
                        c.execute(
                            "INSERT OR IGNORE INTO workspaces(name, description, color, icon, created_at, updated_at) VALUES (?, '', '#8b5cf6', '🎨', ?, ?)",
                            (ws_name, now_iso, now_iso),
                        )
                        c.commit()
                        row_ws = c.execute("SELECT id FROM workspaces WHERE name=?", (ws_name,)).fetchone()
                        if row_ws:
                            ws_name_to_id[ws_name] = row_ws["id"]
                            workspaces_restored += 1
                target_ws_id = ws_name_to_id.get(ws_name)
            if target_ws_id is None:
                target_ws_id = ws_name_to_id.get("Genel")

            # Check if local vault file exists (any supported extension)
            vault_file = library.vault_dir / sha1[:2] / f"{sha1}.png"
            existing_vault = None
            for ext in (".png", ".jpg", ".jpeg", ".webp", ".jfif"):
                cand = library.vault_dir / sha1[:2] / f"{sha1}{ext}"
                if cand.exists():
                    existing_vault = cand
                    break

            vault_path_str = str(existing_vault) if existing_vault else None
            img_size = existing_vault.stat().st_size if existing_vault else int(item.get("size") or 0)
            width = int(item.get("width") or 0)
            height = int(item.get("height") or 0)
            gdrive_id = item.get("gdrive_id")

            # Try to download missing image if requested
            if download_images and service and existing_vault is None:
                matched_fid = None
                for name, fid in drive_file_map.items():
                    if sha1 in name or sha1[:8] in name:
                        matched_fid = fid
                        break
                if not matched_fid and gdrive_id:
                    matched_fid = gdrive_id
                if matched_fid:
                    try:
                        import io
                        from googleapiclient.http import MediaIoBaseDownload
                        req = service.files().get_media(fileId=matched_fid)
                        buf = io.BytesIO()
                        dl = MediaIoBaseDownload(buf, req)
                        dl_done = False
                        while not dl_done:
                            _, dl_done = dl.next_chunk()
                        buf.seek(0)
                        data_bytes = buf.read()
                        saved_p = library._store_in_vault(sha1, data=data_bytes)
                        vault_path_str = str(saved_p)
                        img_size = len(data_bytes)
                        gdrive_id = matched_fid
                        downloaded_images += 1
                        try:
                            from PIL import Image
                            with Image.open(io.BytesIO(data_bytes)) as im:
                                width, height = im.size
                                thumb_path = thumb_dir / f"{sha1}.webp"
                                if not thumb_path.exists():
                                    thumb_dir.mkdir(parents=True, exist_ok=True)
                                    im_thumb = im.copy()
                                    im_thumb.thumbnail((384, 384))
                                    if im_thumb.mode not in ("RGB", "RGBA"):
                                        im_thumb = im_thumb.convert("RGBA")
                                    im_thumb.save(thumb_path, "WEBP", quality=82)
                        except Exception:
                            pass
                    except Exception as e:
                        if len(download_errors) < 5:
                            download_errors.append(f"{sha1[:8]}: {e}")

            with library._write_lock:
                row = c.execute("SELECT id FROM images WHERE sha1=?", (sha1,)).fetchone()
                if row:
                    image_id = row["id"]
                    c.execute("""
                        UPDATE images SET
                            vault_path=COALESCE(?, vault_path),
                            prompt=COALESCE(NULLIF(?,''), prompt),
                            negative=COALESCE(NULLIF(?,''), negative),
                            model=COALESCE(NULLIF(?,''), model),
                            generator=COALESCE(NULLIF(?,''), generator),
                            params=COALESCE(NULLIF(?,'{}'), params),
                            rating=COALESCE(NULLIF(?, 0), rating),
                            favorite=COALESCE(NULLIF(?, 0), favorite),
                            notes=COALESCE(NULLIF(?,''), notes),
                            workspace_id=COALESCE(?, workspace_id),
                            gdrive_id=COALESCE(?, gdrive_id),
                            updated_at=?
                        WHERE id=?
                    """, (vault_path_str, prompt, negative, model, generator, params_str, rating, favorite, notes, target_ws_id, gdrive_id, now_iso, image_id))
                    updated_count += 1
                else:
                    unique_path = f"[vault]/{sha1[:8]}.png"
                    cur = c.execute("""
                        INSERT INTO images(path, vault_path, sha1, size, mtime, width, height, generator,
                                           prompt, negative, model, seed, params, raw, rating, favorite, notes, workspace_id, added_at, updated_at, gdrive_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?)
                    """, (unique_path, vault_path_str, sha1, img_size, datetime.now().timestamp(),
                          width, height, generator, prompt, negative, model,
                          seed if isinstance(seed, int) and abs(seed) < 2 ** 63 else None,
                          params_str, rating, favorite, notes, target_ws_id, added_at, now_iso, gdrive_id))
                    image_id = cur.lastrowid
                    restored_count += 1

                # Generate auto tags
                meta_for_tags = ParsedMeta(
                    generator=generator,
                    prompt=prompt,
                    negative=negative,
                    params=params_dict,
                    loras=[],
                )
                library._set_auto_tags(image_id, meta_for_tags)
                c.commit()

            self._restore_progress["done"] = idx + 1
            if progress_callback:
                progress_callback(dict(self._restore_progress))

        # 2. Restore music workspaces & songs if present
        songs_restored = 0
        tables = {
            r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        if "music_workspaces" in tables and (music_workspaces or songs):
            mws_map: dict[str, int] = {}
            with library._write_lock:
                for mws in (music_workspaces or []):
                    mname = (mws.get("name") or "").strip()
                    if not mname:
                        continue
                    c.execute(
                        "INSERT OR IGNORE INTO music_workspaces(name, description, color, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (
                            mname,
                            mws.get("description") or "",
                            mws.get("color") or "#8b5cf6",
                            mws.get("icon") or "🎵",
                            mws.get("created_at") or now_iso,
                            mws.get("updated_at") or now_iso,
                        ),
                    )
                for r in c.execute("SELECT id, name FROM music_workspaces").fetchall():
                    mws_map[r["name"]] = r["id"]
                if "songs" in tables:
                    for s in (songs or []):
                        title = (s.get("title") or "").strip()
                        if not title:
                            continue
                        suno_id = s.get("suno_id") or ""
                        s_sha1 = s.get("sha1") or ""
                        mw_name = (s.get("workspace_name") or "").strip()
                        if mw_name and mw_name not in mws_map:
                            c.execute(
                                "INSERT OR IGNORE INTO music_workspaces(name, description, color, icon, created_at, updated_at) VALUES (?, '', '#8b5cf6', '🎵', ?, ?)",
                                (mw_name, now_iso, now_iso),
                            )
                            rw = c.execute("SELECT id FROM music_workspaces WHERE name=?", (mw_name,)).fetchone()
                            if rw:
                                mws_map[mw_name] = rw["id"]
                        mw_id = mws_map.get(mw_name) or mws_map.get("Genel")
                        existing_song = None
                        if suno_id:
                            existing_song = c.execute("SELECT id FROM songs WHERE suno_id=?", (suno_id,)).fetchone()
                        if not existing_song and s_sha1:
                            existing_song = c.execute("SELECT id FROM songs WHERE sha1=?", (s_sha1,)).fetchone()
                        if not existing_song:
                            existing_song = c.execute("SELECT id FROM songs WHERE title=? AND lyrics=?", (title, s.get("lyrics") or "")).fetchone()
                        if not existing_song:
                            c.execute("""
                                INSERT INTO songs(
                                    suno_id, title, style, lyrics, model, created_at, suno_url, workspace_id,
                                    artist, persona, synced_lyrics, lrc_content, srt_content, has_synced_lyrics,
                                    rating, favorite, notes, duration, bpm, analysis_json, has_analysis,
                                    sha1, added_at, updated_at
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """, (
                                suno_id or None, title, s.get("style") or "", s.get("lyrics") or "",
                                s.get("model") or "Suno AI", s.get("created_at") or "", s.get("suno_url") or "",
                                mw_id, s.get("artist") or "", s.get("persona") or "",
                                s.get("synced_lyrics") or "", s.get("lrc_content") or "", s.get("srt_content") or "",
                                int(s.get("has_synced_lyrics") or 0), int(s.get("rating") or 0),
                                int(s.get("favorite") or 0), s.get("notes") or "",
                                s.get("duration"), s.get("bpm"), s.get("analysis_json") or "",
                                int(s.get("has_analysis") or 0), s_sha1,
                                s.get("added_at") or now_iso, s.get("updated_at") or now_iso,
                            ))
                            songs_restored += 1
                c.commit()

        # 3. Restore system prompts if present
        system_prompts_restored = 0
        if "system_prompts" in tables and system_prompts:
            with library._write_lock:
                for sp in system_prompts:
                    sp_title = (sp.get("title") or "").strip()
                    sp_content = sp.get("content") or ""
                    sp_cat = sp.get("category") or "custom"
                    if not sp_title or not sp_content:
                        continue
                    exists_sp = c.execute(
                        "SELECT id FROM system_prompts WHERE title=? AND category=?",
                        (sp_title, sp_cat),
                    ).fetchone()
                    if not exists_sp:
                        tags_val = sp.get("tags")
                        if isinstance(tags_val, list):
                            tags_val = json.dumps(tags_val, ensure_ascii=False)
                        c.execute("""
                            INSERT INTO system_prompts(
                                title, category, content, description, target_model, tags, icon,
                                is_favorite, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            sp_title, sp_cat, sp_content, sp.get("description") or "",
                            sp.get("target_model") or "", tags_val or "[]",
                            sp.get("icon") or "", int(sp.get("is_favorite") or 0),
                            sp.get("created_at") or now_iso, sp.get("updated_at") or now_iso,
                        ))
                        system_prompts_restored += 1
                c.commit()

        return {
            "total": len(items),
            "restored": restored_count,
            "updated": updated_count,
            "images_downloaded": downloaded_images,
            "workspaces_restored": workspaces_restored,
            "songs_restored": songs_restored,
            "system_prompts_restored": system_prompts_restored,
            "drive_files_found": len(drive_file_map),
            "download_errors": download_errors,
        }
