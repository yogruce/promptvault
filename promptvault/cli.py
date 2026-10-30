"""PromptVault command line interface."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from .db import Library, default_db_path
from .export import FORMATS, export_rows
from .matrix import Matrix, MatrixError, MatrixSpec
from .parsers import parse_metadata
from .pngmeta import read_png_info


def _print_json(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2, default=str))


def _short(s: str, n: int = 90) -> str:
    s = " ".join((s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def cmd_read(args) -> int:
    for f in args.files:
        info = read_png_info(f)
        meta = parse_metadata(info.text).to_dict()
        if not args.raw:
            meta.pop("raw", None)
        meta.update(file=str(f), width=info.width, height=info.height)
        _print_json(meta)
    return 0


def cmd_add(args, lib: Library) -> int:
    path = Path(args.file).resolve()
    if not path.exists():
        print(f"Dosya bulunamadı: {path}", file=sys.stderr)
        return 1
    data = path.read_bytes()
    res = lib.add_bytes(
        data=data,
        filename=path.name,
        prompt=args.prompt,
        negative=args.negative,
        model=args.model,
        tags=args.tags,
    )
    print(f"Görsel kasaya eklendi (ID: {res.get('id')})")
    return 0


def cmd_scan(args, lib: Library) -> int:
    def progress(s):
        if sys.stderr.isatty():
            print(f"\r{s['done']}/{s['total']}  +{s['added']} ~{s['updated']} ={s['skipped']} !{s['error']}",
                  end="", file=sys.stderr)
    total = {}
    for folder in args.paths:
        stats = lib.scan(folder, recursive=not args.no_recursive, force=args.force, progress=progress)
        for k, v in stats.items():
            total[k] = total.get(k, 0) + v
    if sys.stderr.isatty():
        print(file=sys.stderr)
    print(f"Toplam {total.get('total', 0)} PNG: {total.get('added', 0)} eklendi, {total.get('updated', 0)} "
          f"güncellendi, {total.get('moved', 0)} taşındı, {total.get('skipped', 0)} değişmedi, "
          f"{total.get('error', 0)} hata")
    return 0


def cmd_search(args, lib: Library) -> int:
    total, rows = lib.search(" ".join(args.query), sort=args.sort, limit=args.limit, offset=args.offset)
    if args.json:
        _print_json({"total": total, "items": rows})
        return 0
    for r in rows:
        star = "★" if r["favorite"] else " "
        print(f"{r['id']:>6} {star} [{r['generator'] or '-':<8}] {_short(r['prompt'])}")
        print(f"         {r['path']}")
    print(f"-- {len(rows)} / {total} sonuç")
    return 0


def cmd_show(args, lib: Library) -> int:
    img = lib.get(args.id)
    if img is None:
        print("Bulunamadı", file=sys.stderr)
        return 1
    if not args.raw:
        img.pop("raw", None)
    _print_json(img)
    return 0


def cmd_tag(args, lib: Library) -> int:
    for i in args.ids:
        if args.remove:
            lib.remove_tags(i, args.tags)
        else:
            lib.add_tags(i, args.tags)
    print("Tamam")
    return 0


def cmd_tags(args, lib: Library) -> int:
    rows = lib.tag_stats(kind=args.kind, prefix=args.filter or "", query=args.query or "", limit=args.limit)
    if args.json:
        _print_json(rows)
    else:
        for r in rows:
            print(f"{r['count']:>6}  {r['kind']:<9} {r['name']}  (ort. ağırlık {r['avg_weight']})")
    return 0


def cmd_stats(args, lib: Library) -> int:
    _print_json(lib.stats())
    return 0


def cmd_prune(args, lib: Library) -> int:
    print(f"{lib.prune()} kayıt silindi")
    return 0


def cmd_delete(args, lib: Library) -> int:
    count = lib.bulk_delete(args.ids, delete_vault_file=True, delete_original=args.delete_file)
    print(f"{count} görsel kasadan silindi.")
    return 0


def _parse_param(s: str):
    key, sep, val = s.partition("=")
    if not sep:
        raise SystemExit(f"--param biçimi anahtar=değer olmalı: {s}")
    if "{" in val:
        return key.strip(), val  # template syntax, e.g. steps={20-40:10}
    return key.strip(), [v.strip() for v in val.split(",")]


def cmd_matrix(args, lib: Library) -> int:
    if args.spec:
        spec = MatrixSpec.from_dict(json.loads(Path(args.spec).read_text(encoding="utf-8")))
    else:
        spec = MatrixSpec()
    if args.template is not None:
        t = args.template
        spec.prompt = Path(t[1:]).read_text(encoding="utf-8") if t.startswith("@") else t
    if args.negative is not None:
        spec.negative = args.negative
    for p in args.param or []:
        k, v = _parse_param(p)
        spec.params[k] = v
    if args.random:
        spec.mode, spec.count = "random", args.random
    if args.seed is not None:
        spec.seed = args.seed
    if args.limit is not None:
        spec.limit = args.limit
    try:
        m = Matrix(spec, lib.wildcards(args.wildcards))
        if args.count:
            print(m.count())
            return 0
        text = export_rows(m.rows(), args.format)
    except MatrixError as e:
        print(f"Matris hatası: {e}", file=sys.stderr)
        return 2
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
        print(f"{args.output} yazıldı", file=sys.stderr)
    else:
        sys.stdout.write(text)
    return 0


def cmd_wildcard(args, lib: Library) -> int:
    if args.action == "list":
        for name, items in sorted(lib.wildcards(args.dir).items()):
            print(f"__{name}__  ({len(items)} satır)")
    elif args.action == "set":
        items = Path(args.file).read_text(encoding="utf-8").splitlines() if args.file else args.items
        lib.set_wildcard(args.name, items)
        print(f"__{args.name}__ kaydedildi")
    elif args.action == "import":
        n = 0
        for name, items in lib.wildcards(args.dir).items():
            lib.set_wildcard(name, items)
            n += 1
        print(f"{n} wildcard içe aktarıldı")
    elif args.action == "from-tags":
        items = lib.wildcard_from_tags(args.name, args.kind, args.query or "", args.limit)
        print(f"__{args.name}__ ← {len(items)} etiket")
    elif args.action == "delete":
        lib.delete_wildcard(args.name)
        print("Silindi")
    return 0


def _is_port_in_use(host: str, port: int) -> bool:
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind((host, port))
            return False
        except OSError:
            return True


def _try_free_port(port: int) -> bool:
    import os
    import subprocess
    import time
    if sys.platform != "win32":
        return False
    try:
        out = subprocess.check_output(
            f'netstat -aon | findstr ":{port}" | findstr "LISTENING"',
            shell=True,
            text=True,
            stderr=subprocess.DEVNULL,
        )
        current_pid = os.getpid()
        killed = False
        for line in out.strip().splitlines():
            parts = line.split()
            if len(parts) >= 5 and "LISTENING" in parts:
                pid_str = parts[-1]
                if pid_str.isdigit():
                    pid = int(pid_str)
                    if pid != current_pid and pid > 0:
                        try:
                            t_out = subprocess.check_output(
                                f'tasklist /FI "PID eq {pid}" /FO CSV /NH',
                                shell=True,
                                text=True,
                                stderr=subprocess.DEVNULL,
                            )
                            if "python" in t_out.lower():
                                print(f"[BİLGİ] {port} portunu tutan eski Python süreci (PID: {pid}) sonlandırılıyor...")
                                subprocess.run(f"taskkill /F /PID {pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                                killed = True
                        except Exception:
                            pass
        if killed:
            time.sleep(1)
        return killed
    except Exception:
        return False


def cmd_serve(args, lib: Library) -> int:
    try:
        import uvicorn
        from .web.app import create_app
    except ImportError:
        print("Web arayüzü için: pip install promptvault[web]", file=sys.stderr)
        return 1

    if _is_port_in_use(args.host, args.port):
        _try_free_port(args.port)

    if _is_port_in_use(args.host, args.port):
        url = f"http://{args.host}:{args.port}"
        print(f"\n[UYARI] {args.port} portu başka bir uygulama tarafından kullanılıyor.")
        print(f"Tarayıcınızdan {url} adresini kontrol edebilir veya farklı bir port ile başlatabilirsiniz:")
        print(f"  promptvault serve --port {args.port + 1}\n")
        return 1

    url = f"http://{args.host}:{args.port}"
    print(f"PromptVault arayüzü: {url}")
    if args.open:
        import threading
        import time
        import webbrowser

        def _delayed_open():
            time.sleep(0.4)
            webbrowser.open(url)

        threading.Thread(target=_delayed_open, daemon=True).start()
    try:
        uvicorn.run(create_app(lib, args.wildcards), host=args.host, port=args.port, log_level="warning")
    except OSError as e:
        if "10048" in str(e) or getattr(e, "winerror", None) == 10048 or getattr(e, "errno", None) == 98:
            print(f"\n[BİLGİ] Port {args.port} zaten kullanımda (PromptVault arka planda açık olabilir).")
            print(f"Tarayıcınızdan doğrudan erişebilirsiniz: {url}\n")
            return 0
        raise
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="promptvault", description="Yapay zeka prompt ve PNG metadata yöneticisi")
    p.add_argument("--db", default=None, help=f"veritabanı yolu (varsayılan {default_db_path()})")
    p.add_argument("--version", action="version", version=__version__)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("read", help="PNG metadata'sını veritabanına eklemeden göster")
    s.add_argument("files", nargs="+")
    s.add_argument("--raw", action="store_true", help="ham chunk'ları da göster")

    s = sub.add_parser("add", help="tekil görseli özel prompt veya metadata ile kasaya ekle")
    s.add_argument("file", help="PNG görsel yolu")
    s.add_argument("-p", "--prompt", help="özel prompt (varsa görseldeki metadata'nın yerine geçer)")
    s.add_argument("-n", "--negative", help="özel negatif prompt")
    s.add_argument("-m", "--model", help="model adı")
    s.add_argument("-t", "--tags", nargs="+", help="kullanıcı etiketleri")

    s = sub.add_parser("scan", help="klasör(ler)i tara ve indeksle")
    s.add_argument("paths", nargs="+")
    s.add_argument("--force", action="store_true", help="değişmemiş dosyaları da yeniden oku")
    s.add_argument("--no-recursive", action="store_true")

    s = sub.add_parser("search", help="ara (örn. 'kedi tag:portrait -tag:nsfw gen:comfyui is:fav')")
    s.add_argument("query", nargs="*")
    s.add_argument("--sort", default="added", choices=["added", "oldest", "mtime", "rating", "path"])
    s.add_argument("--limit", type=int, default=30)
    s.add_argument("--offset", type=int, default=0)
    s.add_argument("--json", action="store_true")

    s = sub.add_parser("show", help="görsel detayları")
    s.add_argument("id", type=int)
    s.add_argument("--raw", action="store_true")

    s = sub.add_parser("tag", help="görsellere kullanıcı etiketi ekle/kaldır")
    s.add_argument("ids", type=int, nargs="+")
    s.add_argument("-t", "--tags", nargs="+", required=True)
    s.add_argument("--remove", action="store_true")

    s = sub.add_parser("tags", help="etiket istatistikleri")
    s.add_argument("--kind", choices=["prompt", "lora", "model", "user", "generator"])
    s.add_argument("--filter")
    s.add_argument("--query", help="yalnızca bu aramanın sonuçlarındaki etiketler")
    s.add_argument("--limit", type=int, default=50)
    s.add_argument("--json", action="store_true")

    sub.add_parser("stats", help="kütüphane özeti")
    sub.add_parser("prune", help="diskte olmayan dosyaların kayıtlarını sil")

    s = sub.add_parser("delete", help="görselleri kasadan sil")
    s.add_argument("ids", type=int, nargs="+", help="silinecek görsel ID'leri")
    s.add_argument("--delete-file", action="store_true", help="orijinal kaynak dosyayı da diskten sil (varsayılan: yalnızca kasadan silinir)")

    s = sub.add_parser("matrix", help="prompt matrisi üret")
    s.add_argument("template", nargs="?", help="şablon metni ya da @dosya.txt")
    s.add_argument("--spec", help="JSON matris tanımı dosyası")
    s.add_argument("-n", "--negative")
    s.add_argument("-p", "--param", action="append", help="anahtar=v1,v2 ya da anahtar={20-40:10}")
    s.add_argument("-f", "--format", default="txt", choices=list(FORMATS))
    s.add_argument("-o", "--output")
    s.add_argument("--count", action="store_true", help="yalnızca kombinasyon sayısını yaz")
    s.add_argument("--random", type=int, metavar="N", help="tüm kombinasyonlar yerine N rastgele örnek")
    s.add_argument("--seed", type=int)
    s.add_argument("--limit", type=int)
    s.add_argument("--wildcards", help="*.txt wildcard klasörü")

    s = sub.add_parser("wildcard", help="wildcard listelerini yönet")
    s.add_argument("action", choices=["list", "set", "import", "from-tags", "delete"])
    s.add_argument("name", nargs="?")
    s.add_argument("items", nargs="*")
    s.add_argument("--file")
    s.add_argument("--dir", help="*.txt wildcard klasörü")
    s.add_argument("--kind", default="prompt")
    s.add_argument("--query")
    s.add_argument("--limit", type=int, default=50)

    s = sub.add_parser("serve", help="web arayüzünü başlat")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=7860)
    s.add_argument("--open", action="store_true", help="tarayıcıda aç")
    s.add_argument("--wildcards", help="*.txt wildcard klasörü")
    return p


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = build_parser().parse_args(argv)
    if args.cmd == "read":
        return cmd_read(args)
    if args.cmd == "wildcard" and args.action in ("set", "from-tags", "delete") and not args.name:
        raise SystemExit("wildcard adı gerekli")
    lib = Library(args.db)
    handler = globals()[f"cmd_{args.cmd}"]
    return handler(args, lib)


if __name__ == "__main__":
    raise SystemExit(main())
