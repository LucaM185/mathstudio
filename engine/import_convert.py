"""
Batch-convert every file of the mathstudio library into a mobject definition.

    cd engine && .venv/bin/python import_convert.py

Writes mathstudio_imports.json next to this file: one record per library file with
  status "ok"    -> `code` is a top-level definition `def <fn>(): return <Mobject>` (validated)
  status "fail"  -> `error` says why (not a mobject source, does not run under manimgl, ...)

Python modules go through import_runner.py in a subprocess (timeout per file).
Images and SVGs become ImageMobject / SVGMobject of the library copy.
Videos become an ImageMobject of their first frame (extracted with ffmpeg).
"""

from __future__ import annotations

import concurrent.futures as cf
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import library_imported as li  # noqa: E402

PY = os.path.join(HERE, ".venv", "bin", "python")
OUT = li.CONVERTED        # public records (MIT + own work)
OUT_NC = li.CONVERTED_NC  # non-commercial records: not in git (see library_imported)
FRAMES = os.path.join(HERE, "imported_frames")
TIMEOUT = 90
WORKERS = 6


slug_for = li.slug_for


def convert_python(item: dict) -> dict:
    fn = item["fn"]
    try:
        proc = subprocess.run(
            [PY, "-W", "ignore", os.path.join(HERE, "import_runner.py"), item["path"], fn],
            cwd=HERE, capture_output=True, text=True, timeout=TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return {"status": "fail", "error": f"timed out after {TIMEOUT}s"}
    line = next((l for l in proc.stdout.splitlines() if l.startswith("__RESULT__")), None)
    if line is None:
        tail = (proc.stderr or "").strip().splitlines()[-1:] or ["no output"]
        return {"status": "fail", "error": f"runner crashed: {tail[0][:200]}"}
    res = json.loads(line[len("__RESULT__"):])
    if res.get("ok"):
        return {"status": "ok", "kind": res["kind"], "export": res["export"], "code": res["code"],
                "dynamic": bool(res.get("dynamic")), "doc": res.get("doc", "")}
    return {"status": "fail", "error": res.get("error", "unknown")}


def convert_image(item: dict) -> dict:
    code = f"def {item['fn']}():\n    return ImageMobject({item['path']!r})\n"
    try:
        from PIL import Image
        with Image.open(item["path"]) as im:
            im.load()
    except Exception as e:  # noqa: BLE001
        return {"status": "fail", "error": f"unreadable image: {e}"[:200]}
    return {"status": "ok", "kind": "image", "export": None, "code": code}


def convert_svg(item: dict) -> dict:
    try:
        with open(item["path"], encoding="utf8", errors="replace") as f:
            head = f.read(4000).lower()
    except OSError as e:
        return {"status": "fail", "error": str(e)}
    if "<svg" not in head:
        return {"status": "fail", "error": "not an SVG document"}
    code = f"def {item['fn']}():\n    return SVGMobject({item['path']!r})\n"
    return {"status": "ok", "kind": "svg", "export": None, "code": code}


def convert_video(item: dict) -> dict:
    if not shutil.which("ffmpeg"):
        return {"status": "fail", "error": "ffmpeg not installed (needed for the first frame)"}
    os.makedirs(FRAMES, exist_ok=True)
    png = os.path.join(FRAMES, os.path.splitext(os.path.basename(item["path"]))[0] + ".png")
    if not os.path.exists(png):
        r = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", item["path"], "-frames:v", "1", png],
                           capture_output=True, text=True)
        if r.returncode or not os.path.exists(png):
            return {"status": "fail", "error": "could not read a frame"}
    code = f"def {item['fn']}():\n    return ImageMobject({png!r})\n"
    return {"status": "ok", "kind": "video", "export": None, "code": code}


def convert(item: dict) -> dict:
    kind = item["kind"]
    if kind == "python":
        return convert_python(item)
    if kind == "image":
        return convert_image(item)
    if kind == "svg":
        return convert_svg(item)
    if kind == "video":
        return convert_video(item)
    return {"status": "fail", "error": f"not a mobject source (.{item['ext']} data or documentation)"}


def main():
    t0 = time.time()
    files = li.scan()
    jobs = []
    for it in files:
        slug = slug_for(it["rel"])
        jobs.append({**it, "slug": slug, "fn": slug})
    results = []
    with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(convert, j): j for j in jobs}
        for n, fut in enumerate(cf.as_completed(futs), 1):
            j = futs[fut]
            try:
                r = fut.result()
            except Exception as e:  # noqa: BLE001
                r = {"status": "fail", "error": f"{type(e).__name__}: {e}"[:200]}
            # no absolute "path": `rel` locates the file, and the record must not carry this machine's paths
            results.append({k: j[k] for k in ("rel", "slug", "fn", "name", "source", "license", "nc", "kind", "ext", "importable")} | r)
            if n % 100 == 0:
                print(f"{n}/{len(jobs)}  ok={sum(1 for x in results if x['status']=='ok')}  {time.time()-t0:.0f}s", flush=True)
    results.sort(key=lambda r: r["rel"])
    for path, part in ((OUT, [r for r in results if not r["nc"]]), (OUT_NC, [r for r in results if r["nc"]])):
        with open(path, "w", encoding="utf8") as f:
            json.dump(part, f, ensure_ascii=False, indent=1)
    ok = sum(1 for r in results if r["status"] == "ok")
    print(f"done: {ok} ok, {len(results) - ok} failed, {time.time()-t0:.0f}s -> {OUT} + {os.path.basename(OUT_NC)}")


if __name__ == "__main__":
    main()
