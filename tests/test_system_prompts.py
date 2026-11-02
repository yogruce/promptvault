"""Tests for the System Prompts module (Gemini Gems, ChatGPT Artifacts, Custom GPTs, Custom)."""
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from promptvault.db import Library
from promptvault.system_prompts import (
    SystemPromptLibrary,
    CATEGORIES,
    SystemPromptCreate,
    SystemPromptUpdate,
)
from promptvault.web.app import create_app


@pytest.fixture
def sys_lib(tmp_path):
    db_file = tmp_path / "sys_test.db"
    lib = SystemPromptLibrary(db_file)
    yield lib
    lib.close()


def test_seed_and_categories(sys_lib):
    stats = sys_lib.stats()
    assert stats["total"] == 4
    assert stats["categories"]["gemini_gems"] >= 1
    assert stats["categories"]["chatgpt_artifacts"] >= 1
    assert stats["categories"]["chatgpt_gpts"] >= 1
    assert stats["categories"]["custom"] >= 1

    all_items = sys_lib.list()
    assert len(all_items) == 4
    gemini_items = sys_lib.list(category="gemini_gems")
    assert len(gemini_items) == 1
    assert gemini_items[0]["category"] == "gemini_gems"


def test_crud_operations(sys_lib):
    # Create
    item = sys_lib.add({
        "title": "Flutter Uzmanı",
        "category": "gemini_gems",
        "content": "Sen kıdemli bir Flutter ve Dart uzmanısın. BLoC pattern kullan.",
        "description": "Mobil uygulama geliştirme Gem'i",
        "target_model": "Gemini 1.5 Pro",
        "tags": ["flutter", "dart", "mobile"],
        "icon": "📱",
        "is_favorite": True,
    })
    assert item["id"] is not None
    assert item["title"] == "Flutter Uzmanı"
    assert item["is_favorite"] is True
    assert "flutter" in item["tags"]

    # Read
    fetched = sys_lib.get(item["id"])
    assert fetched is not None
    assert fetched["title"] == "Flutter Uzmanı"

    # Search
    search_res = sys_lib.list(q="BLoC")
    assert len(search_res) >= 1
    assert any(x["id"] == item["id"] for x in search_res)

    # Favorite filter
    favs = sys_lib.list(is_favorite=True)
    assert any(x["id"] == item["id"] for x in favs)

    # Update
    updated = sys_lib.update(item["id"], {
        "title": "Flutter & Riverpod Uzmanı",
        "target_model": "Gemini 1.5 Flash",
    })
    assert updated["title"] == "Flutter & Riverpod Uzmanı"
    assert updated["target_model"] == "Gemini 1.5 Flash"

    # Toggle favorite
    toggled = sys_lib.toggle_favorite(item["id"])
    assert toggled["is_favorite"] is False

    # Validation errors
    with pytest.raises(ValueError):
        sys_lib.add({"title": "", "content": "foo"})
    with pytest.raises(ValueError):
        sys_lib.add({"title": "test", "content": "   "})

    # Delete
    assert sys_lib.delete(item["id"]) is True
    assert sys_lib.get(item["id"]) is None


def test_api_endpoints(tmp_path):
    db_file = tmp_path / "web_sys.db"
    main_lib = Library(db_file)
    sys_lib = SystemPromptLibrary(db_file)
    app = create_app(library=main_lib, system_prompts_library=sys_lib)

    with TestClient(app) as client:
        # Categories
        cat_res = client.get("/api/system-prompts/categories")
        assert cat_res.status_code == 200
        cats = cat_res.json()
        assert "gemini_gems" in cats
        assert "chatgpt_artifacts" in cats
        assert "chatgpt_gpts" in cats
        assert "custom" in cats

        # Stats
        stats_res = client.get("/api/system-prompts/stats")
        assert stats_res.status_code == 200
        assert stats_res.json()["total"] == 4

        # List
        list_res = client.get("/api/system-prompts")
        assert list_res.status_code == 200
        assert len(list_res.json()) == 4

        # Filter by category
        art_res = client.get("/api/system-prompts", params={"category": "chatgpt_artifacts"})
        assert art_res.status_code == 200
        assert len(art_res.json()) == 1

        # Create new prompt
        new_payload = {
            "title": "SVG İkon Üretici",
            "category": "chatgpt_artifacts",
            "content": "Yalnızca temiz, viewbox tanımlı SVG kodları üret.",
            "description": "SVG ikon ve vektör çizim asistanı",
            "target_model": "Claude 3.5 Sonnet",
            "tags": ["svg", "icon", "vector"],
            "icon": "🎨",
            "is_favorite": False,
        }
        create_res = client.post("/api/system-prompts", json=new_payload)
        assert create_res.status_code == 201
        created = create_res.json()
        pid = created["id"]
        assert created["title"] == "SVG İkon Üretici"

        # Toggle favorite
        fav_res = client.post(f"/api/system-prompts/{pid}/favorite")
        assert fav_res.status_code == 200
        assert fav_res.json()["is_favorite"] is True

        # Patch update
        patch_res = client.patch(f"/api/system-prompts/{pid}", json={"description": "Güncel açıklama"})
        assert patch_res.status_code == 200
        assert patch_res.json()["description"] == "Güncel açıklama"

        # Export MD
        export_md = client.get(f"/api/system-prompts/{pid}/export", params={"format": "md"})
        assert export_md.status_code == 200
        assert "SVG İkon Üretici" in export_md.text
        assert "Content-Disposition" in export_md.headers

        # Export TXT
        export_txt = client.get(f"/api/system-prompts/{pid}/export", params={"format": "txt"})
        assert export_txt.status_code == 200
        assert export_txt.text == "Yalnızca temiz, viewbox tanımlı SVG kodları üret."

        # Delete
        del_res = client.delete(f"/api/system-prompts/{pid}")
        assert del_res.status_code == 200
        assert client.get(f"/api/system-prompts/{pid}").status_code == 404

    main_lib.close()
    sys_lib.close()
