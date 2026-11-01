"""FastAPI main application for PromptVault Team Edition with Auth & Visual Vault."""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import (
    create_auth_router,
    create_entities_router,
    create_execution_router,
    create_gdrive_router,
    create_prompts_router,
    create_workspaces_router,
)
from .db import TeamLibrary
from .gdrive_service import CorporateGDriveSync


def create_team_app(data_dir: str | Path | None = None) -> FastAPI:
    lib = TeamLibrary(data_dir=data_dir)
    gdrive_sync = CorporateGDriveSync(lib=lib)
    static_dir = Path(__file__).resolve().parent / "static"

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        gdrive_sync.stop_worker()

    app = FastAPI(
        title="PromptVault Team API",
        version="2.0.0-team",
        description="Team-wide AI Prompt & Visual Vault with Real Auth, ChatGPT, Gemini, Claude and Drive Sync.",
        lifespan=lifespan,
    )

    # Enable CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include routers
    app.include_router(create_auth_router(lib))
    app.include_router(create_entities_router(lib))
    app.include_router(create_prompts_router(lib))
    app.include_router(create_workspaces_router(lib))
    app.include_router(create_gdrive_router(gdrive_sync))
    app.include_router(create_execution_router(lib))

    # Mount static directory
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    @app.get("/")
    def root():
        index_file = static_dir / "index.html"
        if index_file.exists():
            return FileResponse(
                str(index_file),
                media_type="text/html",
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0",
                },
            )
        return {
            "name": "PromptVault Team Edition",
            "version": "2.0.0-team",
            "status": "online",
        }

    return app
