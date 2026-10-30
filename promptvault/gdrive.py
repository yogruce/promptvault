"""Google Drive integration for PromptVault.

Manages OAuth2 authentication, creation of the 'Prompt Vault' folder,
and uploading new/un-synced images and metadata backups.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Callable

SCOPES = ["https://www.googleapis.com/auth/drive.file"]


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
                if not folder_id:
                    folder_id = self.get_or_create_vault_folder()
                if folder_id:
                    folder_info = {
                        "id": folder_id,
                        "url": f"https://drive.google.com/drive/folders/{folder_id}",
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

        # Query existing folder named 'Prompt Vault'
        q = "mimeType='application/vnd.google-apps.folder' and name='Prompt Vault' and trashed=false"
        res = srv.files().list(q=q, fields="files(id, name, webViewLink)").execute()
        files = res.get("files", [])
        if files:
            folder_id = files[0]["id"]
            url = files[0].get("webViewLink") or f"https://drive.google.com/drive/folders/{folder_id}"
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
        """Create/update PromptVault_Backup.json in the Drive folder."""
        from googleapiclient.http import MediaInMemoryUpload

        rows = library.conn.execute("SELECT id, sha1, prompt, negative, model, generator, seed, params, rating, favorite, notes, added_at FROM images").fetchall()
        data = [dict(r) for r in rows]
        payload = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")

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
        if not isinstance(data, list):
            raise ValueError("Geçersiz JSON formatı: Görsel listesi bekleniyor.")
        return self.restore_records(library, data)

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
            items = json.loads(fh.read().decode("utf-8"))
            if not isinstance(items, list):
                raise ValueError("Yedek dosyası bozuk veya geçersiz liste formatında.")

            result = self.restore_records(library, items, download_images=download_images, service=service, folder_id=folder_id, progress_callback=progress_callback)
            self._restore_progress.update(running=False, result=result)
            return result
        except Exception as e:
            self._restore_progress.update(running=False, error=str(e))
            raise
        finally:
            self._restoring = False

    def restore_records(self, library, items: list[dict[str, Any]], download_images: bool = False, service=None, folder_id: str | None = None, progress_callback: Callable[[dict[str, Any]], None] | None = None) -> dict[str, Any]:
        """Insert or update image records and optionally download corresponding image binaries."""
        from datetime import datetime, timezone
        from .parsers import ParsedMeta

        self._restore_progress["total"] = len(items)
        c = library.conn

        # Pre-cache Drive files if downloading images
        drive_file_map: dict[str, str] = {}
        if download_images and service and folder_id:
            try:
                page_token = None
                while True:
                    f_res = service.files().list(
                        q=f"'{folder_id}' in parents and trashed=false and mimeType contains 'image/'",
                        fields="nextPageToken, files(id, name)",
                        pageToken=page_token
                    ).execute()
                    for f in f_res.get("files", []):
                        drive_file_map[f["name"]] = f["id"]
                    page_token = f_res.get("nextPageToken")
                    if not page_token:
                        break
            except Exception:
                pass

        restored_count = 0
        updated_count = 0
        downloaded_images = 0

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
            now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
            added_at = item.get("added_at") or now_iso

            # Check if local vault file exists
            vault_file = library.vault_dir / sha1[:2] / f"{sha1}.png"
            vault_path_str = str(vault_file) if vault_file.exists() else None
            img_size = vault_file.stat().st_size if vault_file.exists() else int(item.get("size") or 0)
            width = int(item.get("width") or 0)
            height = int(item.get("height") or 0)
            gdrive_id = item.get("gdrive_id")

            # Try to download missing image if requested
            if download_images and service and not vault_file.exists():
                matched_fid = None
                for name, fid in drive_file_map.items():
                    if sha1[:8] in name:
                        matched_fid = fid
                        break
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
                        except Exception:
                            pass
                    except Exception:
                        pass

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
                            gdrive_id=COALESCE(?, gdrive_id),
                            updated_at=?
                        WHERE id=?
                    """, (vault_path_str, prompt, negative, model, generator, params_str, rating, favorite, notes, gdrive_id, now_iso, image_id))
                    updated_count += 1
                else:
                    unique_path = f"[vault]/{sha1[:8]}.png"
                    cur = c.execute("""
                        INSERT INTO images(path, vault_path, sha1, size, mtime, width, height, generator,
                                           prompt, negative, model, seed, params, raw, rating, favorite, notes, added_at, updated_at, gdrive_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?)
                    """, (unique_path, vault_path_str, sha1, img_size, datetime.now().timestamp(),
                          width, height, generator, prompt, negative, model,
                          seed if isinstance(seed, int) and abs(seed) < 2 ** 63 else None,
                          params_str, rating, favorite, notes, added_at, now_iso, gdrive_id))
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

        return {
            "total": len(items),
            "restored": restored_count,
            "updated": updated_count,
            "images_downloaded": downloaded_images,
        }
