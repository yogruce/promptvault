import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from promptvault import Library  # noqa: E402
from promptvault.pngmeta import make_blank_png, write_png_text  # noqa: E402
from promptvault.web.app import create_app  # noqa: E402


@pytest.fixture
def client(tmp_path):
    folder = tmp_path / "imgs"
    folder.mkdir()
    for i, p in enumerate(["a cat, (cute:1.2)", "a dog, sunny"]):
        (folder / f"{i}.png").write_bytes(write_png_text(make_blank_png(32, 32), {
            "parameters": f"{p}\nNegative prompt: bad\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: {i}"}))
    lib = Library(tmp_path / "lib.db")
    lib.scan(folder)
    with TestClient(create_app(lib)) as c:
        yield c, folder
    lib.close()


def test_gallery_and_detail(client):
    c, _ = client
    assert c.get("/").status_code == 200
    r = c.get("/api/images", params={"q": "tag:cute"}).json()
    assert r["total"] == 1
    img_id = r["items"][0]["id"]
    d = c.get(f"/api/images/{img_id}").json()
    assert d["params"]["steps"] == 20
    assert c.get(f"/api/images/{img_id}/thumb").status_code == 200
    assert c.get(f"/api/images/{img_id}/file").headers["content-type"] == "image/png"
    assert c.patch(f"/api/images/{img_id}", json={"rating": 9, "favorite": True}).json()["rating"] == 5
    tags = c.post(f"/api/images/{img_id}/tags", json={"tags": ["best"]}).json()
    assert any(t["name"] == "best" and t["source"] == "user" for t in tags)
    tags = c.delete(f"/api/images/{img_id}/tags/best").json()
    assert not any(t["name"] == "best" for t in tags)
    assert c.post("/api/bulk/tags", json={"ids": [img_id], "tags": ["x"]}).json()["updated"] == 1
    assert c.get("/api/tags", params={"kind": "user"}).json()[0]["name"] == "x"
    assert c.get("/api/images/999").status_code == 404


def test_matrix_endpoints(client):
    c, _ = client
    spec = {"prompt": "a {cat|dog}", "params": {"steps": ["20", "30"]}}
    r = c.post("/api/matrix/preview", json={"spec": spec}).json()
    assert r["count"] == 4 and r["rows"][1]["params"]["steps"] == 30
    e = c.post("/api/matrix/export", json={"spec": spec, "format": "a1111"})
    assert e.status_code == 200 and "attachment" in e.headers["content-disposition"]
    assert e.text.count("--prompt") == 4
    assert c.post("/api/matrix/preview", json={"spec": {"prompt": "{a|"}}).status_code == 400
    assert c.post("/api/matrices", json={"name": "t", "spec": spec}).json()[0]["name"] == "t"
    c.put("/api/wildcards/animal", json={"items": ["cat", "owl"]})
    r = c.post("/api/matrix/preview", json={"spec": {"prompt": "__animal__"}}).json()
    assert [x["prompt"] for x in r["rows"]] == ["cat", "owl"]


def test_scan_endpoint(client):
    c, folder = client
    import time
    assert c.post("/api/scan", json={"path": str(folder / "nope")}).status_code == 400
    c.post("/api/scan", json={"path": str(folder), "force": True})
    for _ in range(50):
        s = c.get("/api/scan").json()
        if not s["running"]:
            break
        time.sleep(0.05)
    assert s["stats"]["updated"] == 2


def test_upload_and_manual_prompt_edit(client):
    c, _ = client
    # 1. Test uploading single PNG with custom prompt
    png_data = make_blank_png(16, 16)
    files = {"file": ("my_upload.png", png_data, "image/png")}
    data = {"prompt": "cyberpunk street with rain", "model": "flux-dev", "tags": "cyber,rain"}
    res = c.post("/api/upload", files=files, data=data).json()
    assert res["prompt"] == "cyberpunk street with rain"
    assert res["model"] == "flux-dev"
    assert res["vault_exists"] is True

    img_id = res["id"]
    # Check that search finds it
    assert c.get("/api/images", params={"q": "cyberpunk"}).json()["total"] == 1

    # 2. Test manual prompt editing via PATCH
    patched = c.patch(f"/api/images/{img_id}", json={
        "prompt": "futuristic solar city, golden hour",
        "negative": "ugly, lowres"
    }).json()
    assert patched["prompt"] == "futuristic solar city, golden hour"
    assert patched["negative"] == "ugly, lowres"
    assert c.get("/api/images", params={"q": "solar"}).json()["total"] == 1

    # 3. Test manual-add without file
    m_res = c.post("/api/manual-add", json={
        "prompt": "an ethereal spirit in a mystical forest",
        "model": "SDXL",
        "tags": ["fantasy", "spirit"]
    }).json()
    assert m_res["prompt"] == "an ethereal spirit in a mystical forest"
    assert c.get(f"/api/images/{m_res['id']}/file").status_code == 200


def test_gdrive_endpoints(client):
    c, _ = client
    # 1. Status initially
    st = c.get("/api/gdrive/status").json()
    assert "configured" in st and "authenticated" in st

    # 2. Configure credentials
    cfg = c.post("/api/gdrive/config", json={"client_id": "fake_id", "client_secret": "fake_secret"}).json()
    assert cfg["configured"] is True

    # 3. Sync without authentication should raise 401
    assert c.post("/api/gdrive/sync").status_code == 401

    # 4. Logout
    out = c.post("/api/gdrive/logout").json()
    assert out["authenticated"] is False


def test_delete_endpoints(client):
    c, folder = client
    # 1. Single delete test
    r = c.get("/api/images").json()
    assert r["total"] == 2
    img1 = r["items"][0]
    img2 = r["items"][1]

    # Delete img1 without deleting original disk file
    del_res = c.delete(f"/api/images/{img1['id']}").json()
    assert del_res["deleted"] is True
    assert c.get(f"/api/images/{img1['id']}").status_code == 404
    # Total should now be 1
    assert c.get("/api/images").json()["total"] == 1
    # Original file on disk still exists
    assert (folder / "0.png").exists()

    # 404 on deleting non-existent image
    assert c.delete(f"/api/images/{img1['id']}").status_code == 404

    # 2. Bulk delete test
    bulk_res = c.post("/api/bulk/delete", json={"ids": [img2["id"]]}).json()
    assert bulk_res["deleted_count"] == 1
    assert c.get("/api/images").json()["total"] == 0


def test_userscript_and_extension_static(client):
    c, _ = client
    # Verify .user.js is served with proper content
    res = c.get("/static/suno_downloader.user.js")
    assert res.status_code == 200
    assert "// ==UserScript==" in res.text
    assert "Suno AI" in res.text

    # Verify extension manifest is served
    ext_res = c.get("/static/suno_extension/manifest.json")
    assert ext_res.status_code == 200
    assert "manifest_version" in ext_res.text


def test_gdrive_restore_endpoints(client):
    import json
    c, _ = client
    # 1. Restore status
    r = c.get("/api/gdrive/restore-status").json()
    assert r["running"] is False

    # 2. Restore local JSON
    backup_data = [
        {
            "sha1": "abcdef1234567890abcdef1234567890abcdef12",
            "prompt": "futuristic flying car at dusk",
            "negative": "blurry",
            "model": "SDXL",
            "generator": "comfyui",
            "rating": 5,
            "notes": "restored note"
        }
    ]
    file_payload = {"file": ("backup.json", json.dumps(backup_data).encode("utf-8"), "application/json")}
    res = c.post("/api/gdrive/restore-local-json", files=file_payload).json()
    assert res["ok"] is True
    assert res["result"]["restored"] == 1

    # Verify image exists in library
    imgs = c.get("/api/images", params={"q": "flying car"}).json()
    assert imgs["total"] == 1
    assert imgs["items"][0]["model"] == "SDXL"


