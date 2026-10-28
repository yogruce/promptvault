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
