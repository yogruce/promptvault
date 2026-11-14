"""GitHub update checker and in-place updater for PromptVault.

Works both for git clones and ZIP-downloaded installations without touching
user data (~/.promptvault, .venv, database, vault, or gdrive credentials).
"""
from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

GITHUB_OWNER = os.environ.get("PROMPTVAULT_GH_OWNER", "yogruce")
GITHUB_REPO = os.environ.get("PROMPTVAULT_GH_REPO", "promptvault")
GITHUB_BRANCH = os.environ.get("PROMPTVAULT_GH_BRANCH", "main")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VERSION_FILE = PROJECT_ROOT / ".promptvault_version"

# Only these top-level items are synced from the GitHub archive so .venv / user files are never touched.
SYNC_DIRS = ("promptvault", "scripts", "tests")
SYNC_FILES = (
    "pyproject.toml",
    "requirements.txt",
    "README.md",
    "start.bat",
    "start_web.bat",
    "online.bat",
    "guncelle.bat",
    ".gitignore",
)


def _http_get_json(url: str, timeout: int = 8) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "PromptVault-Updater/1.0",
            "Accept": "application/vnd.github+json",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_local_sha() -> str | None:
    """Return the locally recorded commit SHA (via .git or .promptvault_version)."""
    if (PROJECT_ROOT / ".git").exists():
        try:
            res = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=str(PROJECT_ROOT),
                capture_output=True,
                text=True,
                timeout=5,
            )
            if res.returncode == 0 and res.stdout.strip():
                return res.stdout.strip()
        except Exception:
            pass

    if VERSION_FILE.exists():
        try:
            data = json.loads(VERSION_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("sha"):
                return str(data["sha"]).strip()
        except Exception:
            txt = VERSION_FILE.read_text(encoding="utf-8").strip()
            if txt:
                return txt
    return None


def save_local_sha(sha: str, message: str = "", date: str = "") -> None:
    payload = {"sha": sha, "branch": GITHUB_BRANCH, "message": message, "date": date}
    VERSION_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def check_for_updates(timeout: int = 8) -> dict[str, Any]:
    """Check GitHub for a newer commit on the configured branch."""
    local_sha = get_local_sha()
    has_git = (PROJECT_ROOT / ".git").exists() and shutil.which("git") is not None
    api_url = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/commits/{GITHUB_BRANCH}"

    try:
        data = _http_get_json(api_url, timeout=timeout)
        remote_sha = data.get("sha", "")
        commit = data.get("commit", {})
        message = (commit.get("message") or "").splitlines()[0] if commit.get("message") else ""
        date = (commit.get("committer") or {}).get("date") or ""
        update_available = bool(remote_sha and remote_sha != local_sha)
        return {
            "ok": True,
            "repo": f"{GITHUB_OWNER}/{GITHUB_REPO}",
            "branch": GITHUB_BRANCH,
            "has_git": has_git,
            "current_sha": local_sha,
            "remote_sha": remote_sha,
            "commit_message": message,
            "commit_date": date,
            "update_available": update_available,
        }
    except Exception as e:
        return {
            "ok": False,
            "repo": f"{GITHUB_OWNER}/{GITHUB_REPO}",
            "branch": GITHUB_BRANCH,
            "has_git": has_git,
            "current_sha": local_sha,
            "remote_sha": None,
            "commit_message": "",
            "commit_date": "",
            "update_available": False,
            "error": str(e),
        }


def _copy_tree_overwrite(src_dir: Path, dst_dir: Path) -> int:
    copied = 0
    for root, dirs, files in os.walk(src_dir):
        # Skip __pycache__
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        rel = Path(root).relative_to(src_dir)
        target_root = dst_dir / rel
        target_root.mkdir(parents=True, exist_ok=True)
        for fname in files:
            if fname.endswith(".pyc"):
                continue
            shutil.copy2(Path(root) / fname, target_root / fname)
            copied += 1
    return copied


def apply_update(timeout: int = 30) -> dict[str, Any]:
    """Download and apply the latest version from GitHub without deleting user data."""
    status = check_for_updates(timeout=10)
    if not status.get("ok"):
        raise RuntimeError(f"GitHub bağlantı hatası: {status.get('error')}")

    remote_sha = status.get("remote_sha") or ""
    if not status.get("update_available") and status.get("current_sha"):
        return {
            "ok": True,
            "updated": False,
            "message": "Uygulama zaten en güncel sürümde.",
            "sha": remote_sha,
        }

    # Prefer git pull when this is a clean git repository
    if status.get("has_git"):
        res = subprocess.run(
            ["git", "pull", "--ff-only", "origin", GITHUB_BRANCH],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if res.returncode == 0:
            save_local_sha(remote_sha, status.get("commit_message", ""), status.get("commit_date", ""))
            return {
                "ok": True,
                "updated": True,
                "method": "git",
                "sha": remote_sha,
                "message": "GitHub üzerinden güncellendi. Değişikliklerin geçerli olması için uygulamayı yeniden başlatın.",
                "restart_required": True,
            }

    # Fallback / ZIP-based in-place update (never touches .venv or user data)
    zip_url = f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/archive/refs/heads/{GITHUB_BRANCH}.zip"
    req = urllib.request.Request(zip_url, headers={"User-Agent": "PromptVault-Updater/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        zip_bytes = resp.read()

    copied_files = 0
    with tempfile.TemporaryDirectory() as tmpdir:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            zf.extractall(tmpdir)
        extracted_roots = [p for p in Path(tmpdir).iterdir() if p.is_dir()]
        if not extracted_roots:
            raise RuntimeError("İndirilen güncelleme arşivi boş")
        src_root = extracted_roots[0]

        for dname in SYNC_DIRS:
            s_dir = src_root / dname
            if s_dir.exists():
                copied_files += _copy_tree_overwrite(s_dir, PROJECT_ROOT / dname)

        for fname in SYNC_FILES:
            s_file = src_root / fname
            if s_file.exists():
                shutil.copy2(s_file, PROJECT_ROOT / fname)
                copied_files += 1

    save_local_sha(remote_sha, status.get("commit_message", ""), status.get("commit_date", ""))
    return {
        "ok": True,
        "updated": True,
        "method": "zip",
        "copied_files": copied_files,
        "sha": remote_sha,
        "message": f"GitHub'dan {copied_files} dosya güncellendi. Uygulamayı yeniden başlatın.",
        "restart_required": True,
    }


def _cli() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="PromptVault GitHub Updater")
    parser.add_argument("--check", action="store_true", help="Check for updates")
    parser.add_argument("--apply", action="store_true", help="Check and apply update if available")
    args = parser.parse_args()

    if args.apply:
        st = check_for_updates(timeout=5)
        if not st.get("ok"):
            print(f"[UYARI] GitHub guncelleme kontrolu yapilamadi: {st.get('error')}")
            return 0
        if not st.get("update_available"):
            if not st.get("current_sha") and st.get("remote_sha"):
                save_local_sha(st["remote_sha"], st.get("commit_message", ""), st.get("commit_date", ""))
            print("[OK] PromptVault guncel.")
            return 0
        print(f"[GUNCELLEME] Yeni surum bulundu ({str(st.get('remote_sha'))[:7]}): {st.get('commit_message')}")
        res = apply_update(timeout=30)
        print(f"[BASARILI] {res.get('message')}")
        return 0

    st = check_for_updates(timeout=5)
    print(json.dumps(st, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())
