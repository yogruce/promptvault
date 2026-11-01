"""Authentication endpoints for PromptVault Team Edition."""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from ..db import TeamLibrary


class RegisterRequest(BaseModel):
    email: str
    name: str
    password: str
    role: str = "editor"  # First user automatically becomes admin


class LoginRequest(BaseModel):
    email: str
    password: str


def create_auth_router(lib: TeamLibrary) -> APIRouter:
    router = APIRouter(prefix="/api/team/auth", tags=["team-auth"])

    @router.post("/register")
    def register(req: RegisterRequest):
        try:
            res = lib.register_user(
                email=req.email,
                name=req.name,
                password=req.password,
                role=req.role,
            )
            return {"ok": True, "token": res["token"], "user": res["user"]}
        except ValueError as e:
            raise HTTPException(400, str(e))

    @router.post("/login")
    def login(req: LoginRequest):
        try:
            res = lib.login_user(email=req.email, password=req.password)
            return {"ok": True, "token": res["token"], "user": res["user"]}
        except ValueError as e:
            raise HTTPException(401, str(e))

    @router.get("/me")
    def get_me(authorization: str | None = Header(None)):
        if not authorization:
            raise HTTPException(401, "Oturum açılmadı (Token eksik)")
        token = authorization.replace("Bearer ", "").strip()
        user = lib.get_user_by_token(token)
        if not user:
            raise HTTPException(401, "Geçersiz veya süresi dolmuş oturum")
        return {"ok": True, "user": user}

    @router.get("/users")
    def list_users(authorization: str | None = Header(None)):
        token = (authorization or "").replace("Bearer ", "").strip()
        user = lib.get_user_by_token(token)
        if not user or user["role"] != "admin":
            raise HTTPException(403, "Bu işlem için Yönetici (Admin) yetkisi gereklidir.")
        return {"users": lib.list_users()}

    return router
