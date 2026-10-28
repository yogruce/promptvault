"""Create demo PNGs carrying metadata in the formats of several generators.

Usage:  python scripts/make_samples.py [output_dir]
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from promptvault.pngmeta import make_blank_png, write_png_text  # noqa: E402

SUBJECTS = ["a red fox", "an old lighthouse", "a cyberpunk girl", "a wizard owl", "a mountain village"]
STYLES = ["oil painting", "watercolor", "(photorealistic:1.3)", "anime style", "pixel art"]
EXTRAS = ["golden hour", "((dramatic lighting))", "fog", "[soft focus]", "night, neon lights"]
MODELS = ["sdxl_base_1.0.safetensors", "juggernautXL_v9.safetensors", "flux1-dev.safetensors"]
NEG = "blurry, lowres, watermark, (worst quality:1.4)"


def a1111(prompt, seed, model):
    return {"parameters": f"{prompt}, <lora:add_detail:0.6>\nNegative prompt: {NEG}\n"
            f"Steps: 30, Sampler: DPM++ 2M, Schedule type: Karras, CFG scale: 7, Seed: {seed}, "
            f"Size: 1024x1024, Model hash: abc123, Model: {Path(model).stem}, "
            f'Lora hashes: "add_detail: 7c6bad76eb54", Version: v1.10.1'}


def comfy(prompt, seed, model):
    graph = {
        "3": {"class_type": "KSampler", "inputs": {"seed": seed, "steps": 25, "cfg": 4.5, "sampler_name": "euler",
              "scheduler": "normal", "denoise": 1, "model": ["10", 0], "positive": ["6", 0],
              "negative": ["7", 0], "latent_image": ["5", 0]}},
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": model}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 832, "height": 1216, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["10", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["10", 1]}},
        "10": {"class_type": "LoraLoader", "inputs": {"lora_name": "film_grain.safetensors", "strength_model": 0.8,
               "strength_clip": 0.8, "model": ["4", 0], "clip": ["4", 1]}},
    }
    return {"prompt": json.dumps(graph), "workflow": json.dumps({"nodes": []})}


def novelai(prompt, seed, model):
    return {"Software": "NovelAI", "Source": "NovelAI Diffusion V3", "Description": prompt,
            "Comment": json.dumps({"prompt": prompt, "uc": NEG, "steps": 28, "scale": 5.0, "seed": seed,
                                   "sampler": "k_euler_ancestral", "width": 832, "height": 1216})}


def invoke(prompt, seed, model):
    return {"invokeai_metadata": json.dumps({
        "positive_prompt": prompt, "negative_prompt": NEG, "seed": seed, "steps": 30, "cfg_scale": 6.5,
        "scheduler": "dpmpp_2m_k", "width": 1024, "height": 1024,
        "model": {"name": Path(model).stem, "base": "sdxl"}})}


def generic(prompt, seed, model):
    return {"Description": prompt, "Software": "MyScript"}


FORMATS = [a1111, comfy, novelai, invoke, generic]


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    rnd = random.Random(42)
    n = 0
    for fmt in FORMATS:
        for i in range(6):
            prompt = f"masterpiece, {rnd.choice(SUBJECTS)}, {rnd.choice(STYLES)}, {rnd.choice(EXTRAS)}"
            seed = rnd.randint(0, 2 ** 32)
            color = tuple(rnd.randint(30, 220) for _ in range(3))
            png = write_png_text(make_blank_png(256, 256, color), fmt(prompt, seed, rnd.choice(MODELS)))
            sub = out / fmt.__name__
            sub.mkdir(exist_ok=True)
            (sub / f"{fmt.__name__}_{i:02d}.png").write_bytes(png)
            n += 1
    print(f"{n} örnek PNG oluşturuldu: {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path("samples"))
