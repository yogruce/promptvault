"""Music and Suno AI module for PromptVault."""
from .models import ParsedSong, Song, Workspace
from .parser import extract_lyric_sections, extract_style_tags, parse_suno_txt
from .db import MusicLibrary
from .router import create_music_router
from .sync import (
    clean_lyrics_for_sync,
    fmt_lrc,
    fmt_srt,
    generate_lrc,
    generate_srt,
    generate_synced_txt,
    parse_lrc,
)

__all__ = [
    "ParsedSong",
    "Song",
    "Workspace",
    "parse_suno_txt",
    "extract_style_tags",
    "extract_lyric_sections",
    "MusicLibrary",
    "create_music_router",
    "clean_lyrics_for_sync",
    "fmt_lrc",
    "fmt_srt",
    "generate_lrc",
    "generate_srt",
    "generate_synced_txt",
    "parse_lrc",
]
