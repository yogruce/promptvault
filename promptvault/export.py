"""Export matrix rows to text, JSON, JSONL, CSV and A1111 "prompts from file" formats."""
from __future__ import annotations

import csv
import io
import json
import shlex
from typing import Any, Iterable

FORMATS = {
    "txt": ("text/plain", "txt"),
    "json": ("application/json", "json"),
    "jsonl": ("application/x-ndjson", "jsonl"),
    "csv": ("text/csv", "csv"),
    "a1111": ("text/plain", "txt"),
}

# matrix param key -> A1111 "Prompts from file or textbox" argument
A1111_ARGS = {
    "steps": "steps", "cfg_scale": "cfg_scale", "cfg": "cfg_scale", "sampler": "sampler_name",
    "sampler_name": "sampler_name", "seed": "seed", "width": "width", "height": "height",
    "batch_size": "batch_size", "n_iter": "n_iter", "subseed": "subseed",
    "subseed_strength": "subseed_strength", "styles": "styles", "tiling": "tiling",
    "restore_faces": "restore_faces",
}


def _one_line(s: str) -> str:
    return " ".join(str(s).split())


def to_txt(rows: Iterable[dict[str, Any]]) -> str:
    return "\n".join(_one_line(r["prompt"]) for r in rows) + "\n"


def to_json(rows: Iterable[dict[str, Any]]) -> str:
    return json.dumps(list(rows), ensure_ascii=False, indent=2)


def to_jsonl(rows: Iterable[dict[str, Any]]) -> str:
    return "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)


def to_csv(rows: Iterable[dict[str, Any]]) -> str:
    rows = list(rows)
    pkeys: list[str] = []
    akeys: list[str] = []
    for r in rows:
        pkeys += [k for k in r.get("params", {}) if k not in pkeys]
        akeys += [k for k in r.get("axes", {}) if k not in akeys and k not in pkeys]
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["index", "prompt", "negative"] + pkeys + [f"axis:{k}" for k in akeys])
    for r in rows:
        w.writerow([r.get("index", ""), r["prompt"], r.get("negative", "")]
                   + [r["params"].get(k, "") for k in pkeys]
                   + [r["axes"].get(k, "") for k in akeys])
    return buf.getvalue()


def _arg(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return shlex.quote(_one_line(v))


def to_a1111(rows: Iterable[dict[str, Any]]) -> str:
    lines = []
    for r in rows:
        parts = [f"--prompt {_arg(r['prompt'])}"]
        if r.get("negative"):
            parts.append(f"--negative_prompt {_arg(r['negative'])}")
        for k, v in r.get("params", {}).items():
            arg = A1111_ARGS.get(k)
            if arg:
                parts.append(f"--{arg} {_arg(v)}")
        lines.append(" ".join(parts))
    return "\n".join(lines) + "\n"


def export_rows(rows: Iterable[dict[str, Any]], fmt: str) -> str:
    fn = {"txt": to_txt, "json": to_json, "jsonl": to_jsonl, "csv": to_csv, "a1111": to_a1111}.get(fmt)
    if fn is None:
        raise ValueError(f"Bilinmeyen format: {fmt} (geçerli: {', '.join(FORMATS)})")
    return fn(rows)
