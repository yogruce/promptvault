"""Tests for Suno AI music module, parser, workspaces, and music API."""
from pathlib import Path
from fastapi.testclient import TestClient

from promptvault.music import (
    MusicLibrary,
    ParsedSong,
    clean_lyrics_for_sync,
    extract_lyric_sections,
    extract_style_tags,
    fmt_lrc,
    fmt_srt,
    generate_lrc,
    generate_srt,
    generate_synced_txt,
    parse_lrc,
    parse_suno_txt,
)
from promptvault.web.app import create_app

SAMPLE_SUNO_TXT = """=========================================
ŞARKI ADI   : Gece Yolculuğu
ŞARKI ID    : 8d1b2c34-5678-90ab-cdef-1234567890ab
MODEL       : Suno v4.0
TARİH       : 30.10.2026 14:00
LİNK        : https://suno.com/song/8d1b2c34-5678-90ab-cdef-1234567890ab
=========================================

[TAM STİL / PROMPT]
synthwave, 80s analog synth, driving bassline, punchy electronic drums, ethereal female vocals, 124 bpm, emotional, nostalgic

[ŞARKI SÖZLERİ & META ETİKETLER]
[Intro]
(Neon ışıklar parıldıyor)

[Verse 1]
Yıldızlar kayarken gecenin kalbinde
Rüzgar fısıldar eski bir ezgide
Sonsuz yollar önümde uzanır
Karanlık içinde umut parıldar

[Chorus]
Uzak diyarlara doğru sür arabayı
Unut dertleri geride bırak zamanı
Gecenin ritmi sarsın ruhumuzu
Yıldızlara uzansın sonsuz şarkımız

[Outro]
(Sessizlik ve synth yankısı)
=========================================
"""


USER_SUNO_SAMPLE = """=========================================
ŞARKI ADI   : Dört Yapraklı Yonca
ŞARKI ID    : 659ce234-9198-40c4-999e-3c1d1ce8a657
MODEL       : V6
PERSONA     : Kırık Plak
TARİH       : 17.10.2026 15:58:13
LİNK        : https://suno.com/song/659ce234-9198-40c4-999e-3c1d1ce8a657
=========================================

[TAM STİL / PROMPT]
Alternative rock, clean atmospheric verses rising into sweeping distorted choruses; emotional female mezzo-soprano with intimate, restrained phrasing opening to soaring projection; upbeat driving rock pulse building to high intensity; melodic lead bass up front, clean guitar arpeggios, wide distorted guitars, soaring lead-guitar solo.

[ŞARKI SÖZLERİ & META ETİKETLER]
[Intro | Prominent melodic lead bass; clean melancholic guitar arpeggios; establishing atmosphere]

[Verse 1 | Intimate female vocal; restrained clean guitars and bass; gentle dynamics]
Yüreğimizde bilmediğimiz bir yer var.
Günün birinde duyarız oradaki sesi.
Bakarız, orası geçen yazdan firari.
Her yerde çiçekler,
Desen desen renkler
Yakından duyulur yüreğin sesi.
Aradan süzülen bakışların sahibi,
Hep beklenen aşkın kendisi.

[Chorus | Powerful mezzo-soprano projection; wide distorted rock guitars; high emotional intensity]
Yalnızlıktı, duyguların isim babası.
Aşkı yaşatmaktı bütün çabası.
Sonunda bulundu dört yapraklı yonca.
Şansta lazım, varmak için sonuca
=========================================
"""


def test_sync_module_functions():
    assert fmt_lrc(75.4) == "[01:15.40]"
    assert fmt_srt(75.4) == "00:01:15,400"

    items = [
        {"start": 12.5, "end": 15.0, "text": "İlk satır"},
        {"start": 16.0, "end": 20.2, "text": "İkinci satır"},
    ]
    lrc = generate_lrc(items, title="Test Song", artist="Test Artist")
    assert "[ti:Test Song]" in lrc
    assert "[00:12.50] İlk satır" in lrc

    srt = generate_srt(items)
    assert "00:00:12,500 --> 00:00:15,000" in srt
    assert "İlk satır" in srt

    txt = generate_synced_txt(items)
    assert "[00:12.50] İlk satır" in txt

    parsed_lrc = parse_lrc(lrc)
    assert len(parsed_lrc) == 2
    assert parsed_lrc[0]["text"] == "İlk satır"
    assert parsed_lrc[0]["start"] == 12.5


def test_parse_suno_user_sample(tmp_path: Path):
    parsed = parse_suno_txt(USER_SUNO_SAMPLE, filename="Dört Yapraklı Yonca [659ce234]_metadata.txt")
    assert parsed.title == "Dört Yapraklı Yonca"
    assert parsed.suno_id == "659ce234-9198-40c4-999e-3c1d1ce8a657"
    assert parsed.model == "V6"
    assert parsed.persona == "Kırık Plak"
    assert "Alternative rock" in parsed.style
    assert "Yüreğimizde bilmediğimiz" in parsed.lyrics
    assert "Dört yapraklı yonca" in parsed.lyrics or "dört yapraklı yonca" in parsed.lyrics

    # Check sections extracted (without the pipe/cue)
    lower_sections = [s.lower() for s in parsed.lyric_sections]
    assert "intro" in lower_sections
    assert "verse 1" in lower_sections
    assert "chorus" in lower_sections

    # Check database saving with persona
    db_file = tmp_path / "user_sample.db"
    lib = MusicLibrary(db_file, tmp_path / "vault")
    txt_file = tmp_path / "dort_yaprakli.txt"
    txt_file.write_text(USER_SUNO_SAMPLE, encoding="utf-8")

    song = lib.add_from_txt_file(txt_file)
    assert song["title"] == "Dört Yapraklı Yonca"
    assert song["persona"] == "Kırık Plak"
    assert song["artist"] == "Kırık Plak"
    assert song["model"] == "V6"

    # Search with persona
    total, items = lib.search("persona:Plak")
    assert total == 1
    assert items[0]["title"] == "Dört Yapraklı Yonca"

    # Search with lyrics
    total, items = lib.search('lyrics:"bilmediğimiz"')
    assert total == 1


def test_parse_suno_txt():
    parsed = parse_suno_txt(SAMPLE_SUNO_TXT, filename="Gece Yolculuğu [8d1b2c34]_metadata.txt")
    assert parsed.title == "Gece Yolculuğu"
    assert parsed.suno_id == "8d1b2c34-5678-90ab-cdef-1234567890ab"
    assert "v4.0" in parsed.model
    assert "https://suno.com/song/" in parsed.suno_url
    assert "synthwave" in parsed.style
    assert "[Chorus]" in parsed.lyrics
    assert "Uzak diyarlara" in parsed.lyrics

    # Verify extracted tags
    assert "synthwave" in [t.lower() for t in parsed.tags]
    assert "124 bpm" in [t.lower() for t in parsed.tags]

    # Verify extracted lyric sections
    lower_sections = [s.lower() for s in parsed.lyric_sections]
    assert "intro" in lower_sections
    assert "verse 1" in lower_sections
    assert "chorus" in lower_sections
    assert "outro" in lower_sections


def test_workspaces_crud(tmp_path: Path):
    db_file = tmp_path / "music_test.db"
    lib = MusicLibrary(db_file, tmp_path / "vault")

    # Default workspace exists
    ws_list = lib.list_workspaces()
    assert len(ws_list) >= 1
    assert any(w["name"] == "Genel" for w in ws_list)

    # Create workspace
    new_ws = lib.create_workspace("Synthwave Artists", "80s electronic projects", "#ec4899", "⚡")
    assert new_ws["name"] == "Synthwave Artists"
    assert new_ws["color"] == "#ec4899"

    # Update workspace
    updated = lib.update_workspace(new_ws["id"], name="Synthwave Lab", description="Updated description")
    assert updated is not None
    assert updated["name"] == "Synthwave Lab"

    # Delete workspace
    ok = lib.delete_workspace(new_ws["id"])
    assert ok is True
    assert lib.get_workspace(new_ws["id"]) is None


def test_song_operations_and_fts_search(tmp_path: Path):
    db_file = tmp_path / "music_test2.db"
    lib = MusicLibrary(db_file, tmp_path / "vault")

    ws = lib.create_workspace("Rock & Metal", "Hard rock workspace", "#ef4444", "🎸")

    # Add song from sample text
    txt_file = tmp_path / "sample [12345678]_metadata.txt"
    txt_file.write_text(SAMPLE_SUNO_TXT, encoding="utf-8")

    song = lib.add_from_txt_file(txt_file, workspace_id=ws["id"], artist="Lumina")
    assert song["title"] == "Gece Yolculuğu"
    assert song["artist"] == "Lumina"
    assert song["workspace_id"] == ws["id"]
    assert song["workspace_name"] == "Rock & Metal"

    # Search by title/lyrics word in FTS
    total, items = lib.search("araba")
    assert total >= 1
    assert items[0]["id"] == song["id"]

    # Search with filters
    total, items = lib.search("artist:Lumina style:synthwave")
    assert total >= 1
    assert items[0]["title"] == "Gece Yolculuğu"

    # Update song
    up = lib.update_song(song["id"], rating=5, favorite=True, notes="Great bridge section")
    assert up is not None
    assert up["rating"] == 5
    assert up["favorite"] == 1

    # Search with rating filter
    total, items = lib.search("rating:>=4 is:fav")
    assert total >= 1

    # Bulk assign workspace
    ws2 = lib.create_workspace("Chillout", "Chill lounge", "#06b6d4", "☕")
    lib.bulk_assign_workspace([song["id"]], ws2["id"])
    song_refreshed = lib.get_song(song["id"])
    assert song_refreshed["workspace_id"] == ws2["id"]

    # Stats
    stats = lib.get_stats()
    assert stats["total_songs"] == 1
    assert stats["favorites"] == 1

    # Delete
    assert lib.delete_song(song["id"]) is True
    assert lib.get_song(song["id"]) is None


def test_music_api_client(tmp_path: Path):
    db_file = tmp_path / "web_music.db"
    music_lib = MusicLibrary(db_file, tmp_path / "vault")
    app = create_app(music_library=music_lib)
    client = TestClient(app)

    # 1. Stats
    r = client.get("/api/music/stats")
    assert r.status_code == 200
    assert "total_songs" in r.json()

    # 2. Create Workspace
    r = client.post("/api/music/workspaces", json={"name": "Pop Hits", "description": "Chart pop", "color": "#f59e0b", "icon": "⭐"})
    assert r.status_code == 200
    ws_id = r.json()["id"]

    # 3. Manual Add Song
    r = client.post("/api/music/manual-add", json={
        "title": "Neon Sunset",
        "style": "retrowave, chill synth, female vocal",
        "lyrics": "[Verse 1]\nDriving along the coast\n[Chorus]\nNeon sunset in your eyes",
        "suno_id": "9999-aaaa",
        "workspace_id": ws_id,
        "artist": "Echo Bay",
        "rating": 4,
        "favorite": True,
    })
    assert r.status_code == 200
    song_id = r.json()["id"]

    # 4. Search Songs
    r = client.get("/api/music/songs?q=sunset")
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["artist"] == "Echo Bay"

    # 5. Patch Song
    r = client.patch(f"/api/music/songs/{song_id}", json={"rating": 5, "notes": "Super track"})
    assert r.status_code == 200
    assert r.json()["rating"] == 5

    # 6. Synchronize lyrics (DistroKid style timings)
    sync_payload = {
        "items": [
            {"start": 1.25, "end": 4.50, "text": "Driving along the coast"},
            {"start": 5.00, "end": 8.75, "text": "Neon sunset in your eyes"},
        ],
        "latency_ms": 120,
    }
    r = client.post(f"/api/music/songs/{song_id}/sync", json=sync_payload)
    assert r.status_code == 200
    assert r.json()["has_synced_lyrics"] is True

    # 7. Download LRC format
    r = client.get(f"/api/music/songs/{song_id}/download/lrc")
    assert r.status_code == 200
    assert "[ti:Neon Sunset]" in r.text
    assert "[00:01." in r.text
    assert "Driving along the coast" in r.text

    # 8. Download SRT format
    r = client.get(f"/api/music/songs/{song_id}/download/srt")
    assert r.status_code == 200
    assert "00:00:01,130 -->" in r.text
    assert "Neon sunset in your eyes" in r.text

    # 9. Download TXT format
    r = client.get(f"/api/music/songs/{song_id}/download/txt")
    assert r.status_code == 200

    # 10. Delete Song
    r = client.delete(f"/api/music/songs/{song_id}")
    assert r.status_code == 200
    assert r.json()["deleted"] is True


def test_clean_lyrics_for_sync_strips_suno_tags():
    raw_lyrics = """
[Intro | Prominent melodic lead bass; clean melancholic guitar arpeggios; establishing atmosphere]

[Verse 1 | Intimate female vocal; gentle dynamics]
Yüreğimizde bilmediğimiz bir yer var.
Günün birinde duyarız oradaki sesi.

[Pre-Chorus]
Her adım hedefe hemen ulaşmıyor.

(Instrumental Break)

[Chorus | Powerful mezzo-soprano projection]
Yalnızlıktı, duyguların isim babası.
Sonunda bulundu dört yapraklı yonca.

(Guitar solo)

[Outro | Instrumental only]
"""
    cleaned = clean_lyrics_for_sync(raw_lyrics)

    # Verify no bracketed tags or cues leaked into lyrics
    assert all("[" not in line and "]" not in line for line in cleaned)
    assert all("instrumental" not in line.lower() for line in cleaned)
    assert all("guitar solo" not in line.lower() for line in cleaned)

    # Verify actual lyrics are intact
    assert cleaned == [
        "Yüreğimizde bilmediğimiz bir yer var.",
        "Günün birinde duyarız oradaki sesi.",
        "Her adım hedefe hemen ulaşmıyor.",
        "Yalnızlıktı, duyguların isim babası.",
        "Sonunda bulundu dört yapraklı yonca.",
    ]


def test_music_download_turkish_characters_and_audio(tmp_path: Path):
    db_file = tmp_path / "web_music.db"
    vault = tmp_path / "vault"
    vault.mkdir(parents=True)
    music_dir = vault / "music"
    music_dir.mkdir(parents=True)
    audio_file = music_dir / "test_track.mp3"
    audio_file.write_bytes(b"FAKE_MP3_CONTENT")

    music_lib = MusicLibrary(db_file, vault)
    app = create_app(music_library=music_lib)
    client = TestClient(app)

    # Add a song with Turkish characters and special characters in title
    song = music_lib.add_song(
        title="Şarkı & Yağmur / Gözler (Özgürlük)",
        artist="Çağlar Öztürk",
        style="Akustik gitar, melankolik, Türkçe vokal",
        lyrics="Yağmur yağıyor ince ince\nGüneş açtı.",
        audio_path=audio_file,
    )
    song_id = song["id"]

    # 1. Download TXT - must not fail with 500 (Latin-1 encoding issue) and contain metadata
    r_txt = client.get(f"/api/music/songs/{song_id}/download/txt")
    assert r_txt.status_code == 200
    assert "Content-Disposition" in r_txt.headers
    cd_txt = r_txt.headers["Content-Disposition"]
    assert "filename*=" in cd_txt or "filename=" in cd_txt
    assert "Yağmur yağıyor" in r_txt.text
    assert "Akustik gitar" in r_txt.text
    assert "Çağlar Öztürk" in r_txt.text

    # 2. Download Audio via /download/audio - must have song title in filename header
    r_audio = client.get(f"/api/music/songs/{song_id}/download/audio")
    assert r_audio.status_code == 200
    assert r_audio.content == b"FAKE_MP3_CONTENT"
    cd_audio = r_audio.headers.get("content-disposition", "")
    assert "filename" in cd_audio
    assert "Ya" in cd_audio or "ark" in urllib.parse.unquote(cd_audio)

    # 3. Download Audio via /audio?download=1
    r_stream_dl = client.get(f"/api/music/songs/{song_id}/audio?download=1")
    assert r_stream_dl.status_code == 200
    assert r_stream_dl.content == b"FAKE_MP3_CONTENT"
    cd_stream = r_stream_dl.headers.get("content-disposition", "")
    assert "filename" in cd_stream
    assert "Ya" in cd_stream or "ark" in urllib.parse.unquote(cd_stream)

