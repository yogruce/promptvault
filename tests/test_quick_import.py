import base64
import pytest
from fastapi.testclient import TestClient

from promptvault import Library
from promptvault.pngmeta import make_blank_png
from promptvault.music import MusicLibrary
from promptvault.web.app import create_app


@pytest.fixture
def client_with_quick_import(tmp_path):
    lib = Library(tmp_path / "lib.db")
    music_lib = MusicLibrary(tmp_path / "music.db", tmp_path / "vault_music")
    app = create_app(lib, music_library=music_lib)
    with TestClient(app) as c:
        yield c, lib, music_lib
    lib.close()
    music_lib.close()


def test_quick_import_status_and_toggle(client_with_quick_import):
    c, _, _ = client_with_quick_import
    # 1. Status check
    r = c.get("/api/quick-import/status").json()
    assert r["enabled"] is True
    assert "supported_generators" in r

    # 2. Toggle off
    r = c.post("/api/quick-import/toggle", json={"enabled": False}).json()
    assert r["enabled"] is False

    # 3. Status should now be False
    r = c.get("/api/quick-import/status").json()
    assert r["enabled"] is False

    # 4. Import should be blocked when disabled
    r = c.post("/api/quick-import/image", json={"prompt": "test", "generator": "gemini", "image_b64": "dummy"})
    assert r.status_code == 403

    # 5. Toggle back on
    r = c.post("/api/quick-import/toggle", json={"enabled": True}).json()
    assert r["enabled"] is True


def test_quick_import_image(client_with_quick_import):
    c, lib, _ = client_with_quick_import
    blank_png = make_blank_png(32, 32)
    b64_str = f"data:image/png;base64,{base64.b64encode(blank_png).decode('utf-8')}"

    # Import Gemini image
    payload = {
        "prompt": "a cute cyberpunk cat with glowing neon eyes",
        "negative_prompt": "blurry, lowres",
        "generator": "gemini",
        "image_b64": b64_str,
        "source_url": "https://gemini.google.com/app/123",
    }
    r = c.post("/api/quick-import/image", json=payload)
    assert r.status_code == 200
    res = r.json()
    assert res["ok"] is True
    assert res["generator"] == "gemini"
    img_id = res["image_id"]

    # Verify image exists in library
    img = lib.get(img_id)
    assert img is not None
    assert "cyberpunk cat" in img["prompt"]
    assert img["generator"] == "gemini"


def test_quick_import_music(client_with_quick_import):
    c, _, music_lib = client_with_quick_import
    suno_txt = """=========================================
ŞARKI ADI   : Hızlı Tren
ŞARKI ID    : abc12345-6789-0123-4567-890123456789
MODEL       : V6
PERSONA     : Gece Kuşu
TARİH       : 30.10.2026 16:30:00
LİNK        : https://suno.com/song/abc12345-6789-0123-4567-890123456789
=========================================

[TAM STİL / PROMPT]
synthwave, 80s drums, driving bassline

[ŞARKI SÖZLERİ & META ETİKETLER]
[Verse 1]
Yollarda ışıklar parıldar
Gecenin ritmi akar
"""
    payload = {
        "metadata_txt": suno_txt,
    }
    r = c.post("/api/quick-import/music", json=payload)
    assert r.status_code == 200
    res = r.json()
    assert res["ok"] is True
    assert res["title"] == "Hızlı Tren"
    song_id = res["song_id"]

    # Verify song exists in music library
    song = music_lib.get_song(song_id)
    assert song is not None
    assert song["title"] == "Hızlı Tren"
    assert song["persona"] == "Gece Kuşu"
    assert "synthwave" in song["style"]
