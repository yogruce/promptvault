"""Lyrics synchronization, timestamp formatting, and LRC / SRT / TXT export utilities."""
from __future__ import annotations

import re
from typing import Any


def fmt_lrc(t: float) -> str:
    """Format seconds into standard [mm:ss.xx] timestamp."""
    t = max(0.0, float(t))
    m = int(t // 60)
    s = t - (m * 60)
    return f"[{m:02d}:{s:05.2f}]"


def fmt_srt(t: float) -> str:
    """Format seconds into SubRip SRT hh:mm:ss,ms timestamp."""
    ms = int(round(max(0.0, float(t)) * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def generate_lrc(
    items: list[dict[str, Any]],
    title: str = "",
    artist: str = "",
    album: str = "",
) -> str:
    """Generates standard .lrc file content with metadata tags."""
    lines: list[str] = []
    if title:
        lines.append(f"[ti:{title}]")
    if artist:
        lines.append(f"[ar:{artist}]")
    if album:
        lines.append(f"[al:{album}]")
    lines.append("[by:PromptVault]")
    lines.append("")

    for item in items:
        s = item.get("start", 0.0)
        txt = item.get("text", "").strip()
        if txt:
            lines.append(f"{fmt_lrc(s)} {txt}")

    return "\n".join(lines)


def generate_srt(items: list[dict[str, Any]]) -> str:
    """Generates SubRip .srt subtitle format."""
    blocks: list[str] = []
    for i, item in enumerate(items, 1):
        s = float(item.get("start", 0.0))
        e = float(item.get("end", s + 3.0))
        if e <= s:
            e = s + 1.0
        txt = item.get("text", "").strip()
        blocks.append(f"{i}\n{fmt_srt(s)} --> {fmt_srt(e)}\n{txt}\n")
    return "\n".join(blocks)


def generate_synced_txt(items: list[dict[str, Any]]) -> str:
    """Generates timestamped text format ([mm:ss.xx] Line)."""
    lines: list[str] = []
    for item in items:
        s = item.get("start", 0.0)
        txt = item.get("text", "").strip()
        lines.append(f"{fmt_lrc(s)} {txt}")
    return "\n".join(lines)


def parse_lrc(lrc_content: str) -> list[dict[str, Any]]:
    """Parses existing .lrc format into timed lyric items."""
    pattern = re.compile(r"\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\](.*)")
    items: list[dict[str, Any]] = []

    for line in lrc_content.splitlines():
        line = line.strip()
        match = pattern.match(line)
        if match:
            m, s, txt = match.groups()
            sec = int(m) * 60 + float(s)
            items.append({"start": sec, "text": txt.strip()})

    # Estimate end times
    for i in range(len(items)):
        if i + 1 < len(items):
            items[i]["end"] = items[i + 1]["start"]
        else:
            items[i]["end"] = items[i]["start"] + 3.5

    return items


INSTRUMENTAL_CUE_RE = re.compile(
    r"^\s*\((?:instrumental|guitar\s+solo|solo|intro|outro|bridge|verse\s*\d*|chorus|drop|beat\s+drop|instrumental\s+break|fade\s+out|applause)[^)]*\)\s*$",
    re.IGNORECASE,
)
METADATA_HEADER_RE = re.compile(
    r"^(?:şarkı\s+adı|şarkı\s+ıd|şarkı\s+id|model|persona|tarih|link|title|song\s+id|date|url)\s*:",
    re.IGNORECASE,
)
BRACKET_TAG_RE = re.compile(r"\[[^\]]*\]")


def clean_lyrics_for_sync(text: str) -> list[str]:
    """Cleans lyrics by stripping Suno AI structure/prompt tags (e.g. [Verse 1 | Cues], [Chorus], [Intro]).
    
    Returns only actual singable lyric lines.
    """
    if not text:
        return []

    lines: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith(("===", "---", "___")):
            continue
        if METADATA_HEADER_RE.match(line):
            continue
        if INSTRUMENTAL_CUE_RE.match(line):
            continue

        # Strip all [Tag] or [Section | Cue] bracketed elements from line
        stripped = BRACKET_TAG_RE.sub("", line).strip()
        stripped = re.sub(r"\s+", " ", stripped)

        if stripped:
            lines.append(stripped)

    return lines

