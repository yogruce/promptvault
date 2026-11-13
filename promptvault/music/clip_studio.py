"""Klip Analiz Stüdyosu utilities: Premiere Pro marker CSV, timecodes, and Visualizer Composer prompt."""
from __future__ import annotations

import csv
import io
import math
from pathlib import Path
from typing import Iterable

_PROMPT_PATH = Path(__file__).with_name("visualizer_composer_prompt.txt")


def get_visualizer_composer_prompt() -> str:
    """Returns the full Visualizer Composer Gem system prompt."""
    if _PROMPT_PATH.exists():
        return _PROMPT_PATH.read_text(encoding="utf-8")
    return ""


def sec_to_mmss(seconds: float) -> str:
    """Formats seconds as MM:SS.mm."""
    s = max(0.0, float(seconds))
    m = int(s // 60)
    rem = s % 60
    return f"{m:02d}:{rem:05.2f}"


def sec_to_timecode(seconds: float, fps: int = 24) -> str:
    """Formats seconds as SMPTE HH:MM:SS:FF timecode."""
    fps = max(1, int(fps))
    total = max(0.0, float(seconds))
    h = int(total // 3600)
    m = int((total % 3600) // 60)
    s = int(total % 60)
    f = int(round((total - int(total)) * fps))
    if f >= fps:
        f = fps - 1
    return f"{h:02d}:{m:02d}:{s:02d}:{f:02d}"


def generate_premiere_markers_csv(
    duration: float,
    peak_times: Iterable[float],
    step: int = 15,
    fps: int = 24,
) -> str:
    """Generates Adobe Premiere Pro / DaVinci Resolve compatible marker CSV content."""
    duration = max(0.0, float(duration))
    step = max(1, int(step))
    fps = max(1, int(fps))

    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=",", lineterminator="\n")
    writer.writerow(["Marker Name", "Description", "In", "Out", "Duration", "Marker Type", "Seconds"])

    total_ceil = int(math.ceil(duration))
    for sec in range(0, total_ceil, step):
        end_sec = min(float(sec + step), duration)
        tc_in = sec_to_timecode(sec, fps)
        tc_out = sec_to_timecode(end_sec, fps)
        dur_tc = sec_to_timecode(max(0.0, end_sec - sec), fps)
        writer.writerow([
            f"SAHNE_{sec // step + 1:02d} ({step}sn)",
            f"Omni Flash {step}sn Video Sekansi",
            tc_in,
            tc_out,
            dur_tc,
            "Subclip",
            f"{sec:.3f}",
        ])

    for idx, pt in enumerate(peak_times, 1):
        pt_val = max(0.0, float(pt))
        tc = sec_to_timecode(pt_val, fps)
        scene_num = int(pt_val // step) + 1
        rel_sec = pt_val % step
        writer.writerow([
            f"BEAT_PEAK_{idx:02d}",
            f"Sahne {scene_num:02d} ici (at +{rel_sec:.1f}s) Akustik Vurus",
            tc,
            tc,
            "00:00:00:00",
            "Cue",
            f"{pt_val:.3f}",
        ])

    return buf.getvalue()
