import json
from pathlib import Path

import pytest

from promptvault import Library, Matrix, MatrixError, MatrixSpec, expand, extract_tags, parse_metadata, read_metadata
from promptvault.export import export_rows
from promptvault.pngmeta import make_blank_png, read_png_info, write_png_text

A1111 = ("masterpiece, (red hair:1.3), [blurry background], <lora:add_detail:0.6>\n"
         "Negative prompt: lowres, watermark\n"
         'Steps: 30, Sampler: DPM++ 2M, CFG scale: 7, Seed: 1234, Size: 832x1216, Model: juggernaut, '
         'Lora hashes: "add_detail: 7c6bad76eb54, x: 1", Version: v1.10.1')


# ---------------------------------------------------------------- PNG layer
def test_png_roundtrip_text_ztxt_itxt(tmp_path):
    png = write_png_text(make_blank_png(10, 7), {"parameters": "kedi", "uni": "çiçek 🌸"})
    png = write_png_text(png, {"z": "x" * 500}, compress=True)
    f = tmp_path / "a.png"
    f.write_bytes(png)
    info = read_png_info(f)
    assert (info.width, info.height) == (10, 7)
    assert info.text == {"z": "x" * 500, "parameters": "kedi", "uni": "çiçek 🌸"}


def test_not_png(tmp_path):
    f = tmp_path / "x.png"
    f.write_bytes(b"hello")
    with pytest.raises(ValueError):
        read_png_info(f)


# ------------------------------------------------------------------ parsers
def test_a1111():
    m = parse_metadata({"parameters": A1111})
    assert m.generator == "a1111"
    assert m.prompt.startswith("masterpiece") and m.negative == "lowres, watermark"
    assert m.params["steps"] == 30 and m.params["cfg_scale"] == 7 and m.params["seed"] == 1234
    assert m.params["width"] == 832 and m.params["height"] == 1216
    assert m.model == "juggernaut"
    assert m.params["lora_hashes"] == "add_detail: 7c6bad76eb54, x: 1"
    assert m.loras == [("add_detail", 0.6)]


def test_comfyui_graph_with_links():
    graph = {
        "1": {"class_type": "KSampler", "inputs": {"seed": 5, "steps": 20, "cfg": 3.5, "sampler_name": "euler",
              "scheduler": "simple", "positive": ["2", 0], "negative": ["3", 0]}},
        "2": {"class_type": "ControlNetApply", "inputs": {"conditioning": ["4", 0], "strength": 1}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "ugly"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": ["5", 0]}},
        "5": {"class_type": "PrimitiveString", "inputs": {"value": "a castle"}},
        "6": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sdxl.safetensors"}},
        "7": {"class_type": "EmptyLatentImage", "inputs": {"width": 1024, "height": 768}},
    }
    m = parse_metadata({"prompt": json.dumps(graph)})
    assert m.generator == "comfyui"
    assert (m.prompt, m.negative) == ("a castle", "ugly")
    assert m.params["seed"] == 5 and m.params["cfg_scale"] == 3.5 and m.params["sampler"] == "euler"
    assert m.model == "sdxl.safetensors" and m.params["width"] == 1024


def test_novelai():
    m = parse_metadata({"Software": "NovelAI", "Description": "1girl",
                        "Comment": json.dumps({"prompt": "1girl, {smile}", "uc": "bad", "steps": 28, "scale": 5})})
    assert m.generator == "novelai" and m.prompt == "1girl, {smile}" and m.negative == "bad"
    assert m.params["cfg_scale"] == 5


def test_invokeai():
    m = parse_metadata({"invokeai_metadata": json.dumps(
        {"positive_prompt": "p", "negative_prompt": "n", "seed": 1, "model": {"name": "dreamshaper"}})})
    assert (m.generator, m.prompt, m.negative, m.model) == ("invokeai", "p", "n", "dreamshaper")


def test_fooocus_json_parameters():
    m = parse_metadata({"fooocus_scheme": "fooocus",
                        "parameters": json.dumps({"prompt": "cat", "negative_prompt": "dog", "steps": 30})})
    assert (m.generator, m.prompt, m.negative, m.params["steps"]) == ("fooocus", "cat", "dog", 30)


def test_generic_and_none():
    assert parse_metadata({"Description": "a sunset", "Software": "Midjourney v6"}).prompt == "a sunset"
    assert parse_metadata({"foo": "bar"}).generator == "none"


def test_gemini_and_other_generators():
    # 1. Gemini with prompt placed in 'parameters' chunk
    m1 = parse_metadata({"parameters": "a futuristic solar car", "Software": "Google Gemini"})
    assert m1.generator == "gemini" and m1.prompt == "a futuristic solar car"

    # 2. Gemini with Description chunk
    m2 = parse_metadata({"Description": "an owl in a library", "Software": "Gemini"})
    assert m2.generator == "gemini" and m2.prompt == "an owl in a library"

    # 3. Plain prompt in parameters chunk without A1111 markers or software should NOT be a1111
    m3 = parse_metadata({"parameters": "simple prompt without any step or sampler info"})
    assert m3.generator == "generic" and m3.prompt == "simple prompt without any step or sampler info"

    # 4. Imagen / DALL-E
    m4 = parse_metadata({"prompt": "space station", "Software": "Imagen 3"})
    assert m4.generator == "imagen" and m4.prompt == "space station"


def test_tags():
    tags = dict(extract_tags("masterpiece, (red_hair:1.3), [blurry], ((smile)), <lora:x:1>, a BREAK b"))
    assert tags["red hair"] == 1.3
    assert tags["blurry"] == pytest.approx(0.909, abs=1e-3)
    assert tags["smile"] == pytest.approx(1.21)
    assert {"masterpiece", "a", "b"} <= set(tags) and not any("lora" in t for t in tags)
    grouped = dict(extract_tags("(blue eyes, long hair:1.2), cat"))
    assert grouped == {"blue eyes": 1.2, "long hair": 1.2, "cat": 1.0}


# ------------------------------------------------------------------- matrix
def test_basic_product():
    assert expand("a {cat|dog} in {snow|rain}") == ["a cat in snow", "a cat in rain", "a dog in snow", "a dog in rain"]


def test_nesting_optional_and_cleanup():
    assert expand("{red {fox|owl}|cat}, {|detailed,} art") == [
        "red fox, art", "red fox, detailed, art", "red owl, art", "red owl, detailed, art",
        "cat, art", "cat, detailed, art"]


def test_ranges_combos_escape():
    assert expand("{1-3}") == ["1", "2", "3"]
    assert expand("{0.5-1:0.25}") == ["0.50", "0.75", "1.00"]
    assert expand("{2$$a|b|c}") == ["a, b", "a, c", "b, c"]
    assert expand("{1-2$$ and $$x|y}") == ["x", "y", "x and y"]
    assert expand(r"\{literal\} {a|b\|c}") == ["{literal} a", "{literal} b|c"]


def test_named_axes_link_and_forward_ref():
    assert expand("{@c}-eyes {@c:red|blue}") == ["red-eyes red", "blue-eyes blue"]
    m = Matrix(MatrixSpec(prompt="{@c:red|blue} hair", negative="{@c} shoes"))
    rows = list(m.rows())
    assert [(r["prompt"], r["negative"]) for r in rows] == [("red hair", "red shoes"), ("blue hair", "blue shoes")]
    assert m.count() == 2 and rows[0]["axes"]["c"] == "red"


def test_wildcards_and_errors():
    wc = {"color": ["red", "{light|dark} blue", "# comment"], "loop": ["__loop__"]}
    assert expand("__color__ cat", wc) == ["red cat", "light blue cat", "dark blue cat"]
    with pytest.raises(MatrixError):
        expand("__missing__")
    with pytest.raises(MatrixError):
        expand("__loop__", wc)
    with pytest.raises(MatrixError):
        expand("{a|b")
    with pytest.raises(MatrixError):
        expand("{@undefined}")


def test_params_count_and_random():
    spec = MatrixSpec(prompt="{a|b|c}", params={"steps": [20, 30], "cfg_scale": "{5-9:2}", "sampler": "euler"})
    m = Matrix(spec)
    assert m.count() == 3 * 2 * 3
    rows = list(m.rows())
    assert len(rows) == 18
    assert rows[0]["params"] == {"steps": 20, "cfg_scale": 5, "sampler": "euler"}
    assert rows[0]["axes"]["steps"] == "20" and rows[0]["axes"]["cfg_scale"] == "5"
    r1 = list(Matrix(MatrixSpec(prompt="{a|b|c|d}", params={"x": "{1-100}"}, mode="random", count=10, seed=7)).rows())
    r2 = list(Matrix(MatrixSpec(prompt="{a|b|c|d}", params={"x": "{1-100}"}, mode="random", count=10, seed=7)).rows())
    assert r1 == r2 and len(r1) == 10 and len({(r["prompt"], r["params"]["x"]) for r in r1}) == 10
    big = Matrix(MatrixSpec(prompt="{1-1000} {1-1000} {10::x|1::y}", mode="random", count=50, seed=1))
    assert big.count() == 2_000_000 and len(list(big.rows())) == 50
    assert len(list(Matrix(MatrixSpec(prompt="{1-100}", limit=5)).rows())) == 5


def test_exports():
    rows = list(Matrix(MatrixSpec(prompt='a "{x|y}"', negative="bad", params={"steps": [20], "foo": [1, 2]})).rows())
    assert export_rows(rows, "txt").splitlines() == ['a "x"', 'a "x"', 'a "y"', 'a "y"']
    a = export_rows(rows, "a1111").splitlines()[0]
    assert a.startswith("--prompt 'a \"x\"' --negative_prompt bad --steps 20") and "foo" not in a
    csv_text = export_rows(rows, "csv")
    assert csv_text.splitlines()[0] == "index,prompt,negative,steps,foo,axis:p1"
    assert len(json.loads(export_rows(rows, "json"))) == 4
    with pytest.raises(ValueError):
        export_rows(rows, "xml")


# ------------------------------------------------------------------ library
@pytest.fixture
def lib_with_files(tmp_path):
    folder = tmp_path / "imgs"
    (folder / "sub").mkdir(parents=True)
    (folder / "a.png").write_bytes(write_png_text(make_blank_png(), {"parameters": A1111}))
    (folder / "sub" / "b.png").write_bytes(write_png_text(make_blank_png(4, 4, (1, 2, 3)), {
        "Description": "a blue cat on a roof", "Software": "MyScript"}))
    (folder / "c.png").write_bytes(make_blank_png(5, 5, (9, 9, 9)))
    (folder / "broken.png").write_bytes(b"not a png")
    lib = Library(tmp_path / "db" / "lib.db")
    yield lib, folder
    lib.close()


def test_scan_search_tags(lib_with_files):
    lib, folder = lib_with_files
    s = lib.scan(folder)
    assert (s["total"], s["added"], s["error"]) == (4, 3, 1)
    assert lib.scan(folder)["skipped"] == 3
    assert lib.search("")[0] == 3
    assert lib.search("masterpiece")[0] == 1
    assert lib.search("master")[0] == 1          # prefix search
    assert lib.search("-masterpiece")[0] == 2
    assert lib.search('tag:"red hair"')[0] == 1
    assert lib.search("tag:red_hair")[0] == 1
    assert lib.search("lora:add_detail")[0] == 1
    assert lib.search("gen:a1111 model:jugger seed:1234 w:>=8")[0] == 1
    assert lib.search("neg:watermark")[0] == 1
    total, rows = lib.search("cat")
    img_id = rows[0]["id"]
    lib.add_tags(img_id, ["Favorite Pets", "kedi"])
    lib.update(img_id, rating=4, favorite=True, notes="çatı fotoğrafı")
    assert lib.search('tag:"favorite pets" is:fav rating:>=4')[0] == 1
    assert lib.search("çatı")[0] == 1
    # rescan with force keeps user tags
    lib.scan(folder, force=True)
    tags = {(t["name"], t["source"]) for t in lib.get(img_id)["tags"]}
    assert ("kedi", "user") in tags and ("cat", "auto") not in tags
    lib.remove_tags(img_id, ["kedi"])
    assert lib.search("tag:kedi")[0] == 0
    stats = lib.stats()
    assert stats["images"] == 3 and stats["generators"]["a1111"] == 1
    top = {t["name"] for t in lib.tag_stats(kind="prompt")}
    assert "masterpiece" in top


def test_moved_file_keeps_user_data(lib_with_files):
    lib, folder = lib_with_files
    lib.scan(folder)
    _, rows = lib.search("masterpiece")
    lib.add_tags(rows[0]["id"], ["keeper"])
    (folder / "a.png").rename(folder / "renamed.png")
    assert lib.scan(folder)["moved"] == 1
    assert lib.prune() == 0
    img = lib.get(rows[0]["id"])
    assert img["path"].endswith("renamed.png") and any(t["name"] == "keeper" for t in img["tags"])


def test_wildcards_and_matrices(lib_with_files, tmp_path):
    lib, folder = lib_with_files
    wdir = tmp_path / "wc"
    (wdir / "hair").mkdir(parents=True)
    (wdir / "hair" / "color.txt").write_text("red\nblue\n", encoding="utf-8")
    lib.set_wildcard("style", ["oil", "ink"])
    wc = lib.wildcards(wdir)
    assert wc["hair/color"] == ["red", "blue"] and wc["style"] == ["oil", "ink"]
    assert len(expand("__hair/color__ __style__", wc)) == 4
    lib.scan(folder)
    assert "masterpiece" in lib.wildcard_from_tags("top", "prompt")
    lib.save_matrix("m1", {"prompt": "{a|b}"})
    lib.save_matrix("m1", {"prompt": "{a|b|c}"})
    assert lib.list_matrices()[0]["spec"]["prompt"] == "{a|b|c}"
    assert lib.delete_matrix("m1") and not lib.list_matrices()


def test_read_metadata_helper(tmp_path):
    f = tmp_path / "x.png"
    f.write_bytes(write_png_text(make_blank_png(), {"parameters": A1111}))
    assert read_metadata(f).params["sampler"] == "DPM++ 2M"


def test_vault_preservation_and_manual_prompt_edit(lib_with_files):
    lib, folder = lib_with_files
    lib.scan(folder)
    _, rows = lib.search("masterpiece")
    assert rows
    img_id = rows[0]["id"]
    orig_path = Path(lib.get(img_id)["path"])
    assert orig_path.exists()
    vault_path = lib.resolve_image_path(img_id)
    assert vault_path is not None and vault_path.exists()

    # User manually edits prompt and negative
    lib.update(img_id, prompt="dragon, neon, (glowing wings:1.3)", negative="ugly")
    info = lib.get(img_id)
    assert info["prompt"] == "dragon, neon, (glowing wings:1.3)"
    assert info["negative"] == "ugly"
    # Tag sync should find 'dragon' and 'glowing wings'
    assert lib.search("dragon")[0] == 1
    assert lib.search("tag:dragon")[0] == 1
    assert lib.search('tag:"glowing wings"')[0] == 1

    # Now simulate the original file being DELETED from disk
    orig_path.unlink()
    assert not orig_path.exists()

    # Prune should NOT delete the image because it is preserved in the vault!
    pruned = lib.prune(purge_vault=False)
    assert pruned == 0

    # Image is still accessible via resolve_image_path
    resolved = lib.resolve_image_path(img_id)
    assert resolved is not None and resolved.exists()
    assert lib.get(img_id)["vault_exists"] is True
    assert lib.get(img_id)["original_exists"] is False

    # Now test explicit vault deletion
    assert lib.delete_image(img_id, delete_vault_file=True) is True
    assert lib.get(img_id) is None
    assert not resolved.exists()
    assert lib.search("dragon")[0] == 0


def test_cli_delete(tmp_path):
    from promptvault.cli import main
    db_file = tmp_path / "cli.db"
    img_file = tmp_path / "cli_test.png"
    img_file.write_bytes(write_png_text(make_blank_png(16, 16), {"parameters": "cli prompt"}))

    # Add image
    assert main(["--db", str(db_file), "scan", str(tmp_path)]) == 0
    lib = Library(db_file)
    total, items = lib.search()
    assert total == 1
    img_id = items[0]["id"]
    lib.close()

    # Delete via CLI
    assert main(["--db", str(db_file), "delete", str(img_id)]) == 0

    lib = Library(db_file)
    assert lib.get(img_id) is None
    # Original file is preserved by default
    assert img_file.exists()
    lib.close()
