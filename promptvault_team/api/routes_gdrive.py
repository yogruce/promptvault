"""FastAPI endpoints for Corporate Google Drive management & Real-time Sync."""
from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from ..gdrive_service import CorporateGDriveSync


class DriveConfigRequest(BaseModel):
    shared_drive_id: str = ""
    root_folder_name: str = "PromptVault Team Vault"


def create_gdrive_router(gdrive_sync: CorporateGDriveSync) -> APIRouter:
    router = APIRouter(prefix="/api/team/gdrive", tags=["team-gdrive"])

    @router.get("/status")
    def get_status():
        return gdrive_sync.get_status()

    @router.get("/config")
    def get_config():
        return gdrive_sync.load_config()

    @router.post("/config")
    def update_config(req: DriveConfigRequest):
        gdrive_sync.save_config(
            shared_drive_id=req.shared_drive_id,
            root_folder_name=req.root_folder_name,
        )
        return {"ok": True, "config": gdrive_sync.load_config()}

    @router.post("/upload-service-account")
    async def upload_service_account(file: UploadFile = File(...)):
        content = await file.read()
        success = gdrive_sync.save_service_account_json(content)
        if not success:
            raise HTTPException(400, "Geçersiz Service Account JSON dosyası.")
        return {"ok": True, "status": gdrive_sync.get_status()}

    return router
