"""FastAPI main application for PromptVault Team Edition."""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import (
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

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Startup
        yield
        # Graceful shutdown: stop background worker cleanly
        gdrive_sync.stop_worker()

    app = FastAPI(
        title="PromptVault Team API",
        version="2.0.0-team",
        description="Team-wide AI Prompt & Personas Vault for ChatGPT, Gemini, Claude, and Corporate Drive Sync.",
        lifespan=lifespan,
    )

    # Enable CORS for browser extensions, userscripts, and web UI
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include routers
    app.include_router(create_entities_router(lib))
    app.include_router(create_prompts_router(lib))
    app.include_router(create_workspaces_router(lib))
    app.include_router(create_gdrive_router(gdrive_sync))
    app.include_router(create_execution_router(lib))

    @app.get("/")
    def root():
        return {
            "name": "PromptVault Team Edition",
            "version": "2.0.0-team",
            "status": "online",
            "features": [
                "ChatGPT, Gemini, Claude, Reasoning prompt vault",
                "Gemini Gems, Custom GPTs, Claude Skills management",
                "Real-time Google Workspace Shared Drive sync",
                "API Execution groundwork (Chat & Image generation)",
            ],
            "endpoints": {
                "entities": "/api/team/entities",
                "prompts": "/api/team/prompts",
                "workspaces": "/api/team/workspaces",
                "gdrive": "/api/team/gdrive/status",
                "execute": "/api/team/execute/preview",
            },
        }

    return app
