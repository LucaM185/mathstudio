"""
Gallery mobjects: every gallery picture of the mathstudio library is a ManimGL class, not an image.

    engine/.venv/bin/python engine/tests/test_gallery.py

Checks that each picture has its class, that the scanner imports the class instead of the picture,
that every class converts, renders something through the real preview renderer, and that the
animated (t-driven) ones actually move, stay put and rebuild fast enough for live preview.
"""
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, ENGINE)
TMP = tempfile.mkdtemp(prefix="msgallery-")
sys.argv = [sys.argv[0], "--data", TMP]

import numpy as np  # noqa: E402
import server  # noqa: E402
import library  # noqa: E402
import library_imported as li  # noqa: E402

LIB = li.LIB_DIR
GALLERIES = {
    "non-commercial/gallery": ["images"],
    "element-gallery": ["images", "media"],
}
EXPECTED_DYNAMIC = {"Interference", "MandelbrotZoom", "ComplexSquare", "DeepNetwork", "DoublePendulum",
                    "FourierHeart", "FourierSquare", "GradientDescent", "LorenzAttractor", "Tesseract"}
FAILS = []


def check(cond, msg):
    if not cond:
        FAILS.append(msg)
        print("  FAIL:", msg)


# ---------------------------------------------------------------------------------------------
print("1. every gallery picture has a mobject class")
classes = {}  # rel of the .py -> gallery root
for root, pic_dirs in GALLERIES.items():
    mdir = os.path.join(LIB, root, "mobjects")
    have = {f[:-3] for f in os.listdir(mdir) if f.endswith(".py") and not f.startswith("_")}
    for f in have:
        classes[f"{root}/mobjects/{f}.py"] = root
    for d in pic_dirs:
        for f in os.listdir(os.path.join(LIB, root, d)):
            stem = os.path.splitext(f)[0]
            if f.startswith("."):
                continue
            check(stem in have, f"{root}/{d}/{f} has no mobjects/{stem}.py")
print(f"   {len(classes)} classes")
check(len(classes) >= 194, f"expected at least 194 gallery classes, found {len(classes)}")

# ---------------------------------------------------------------------------------------------
print("2. the scanner imports classes, not pictures")
scanned = {it["rel"]: it for it in li.scan()}
for rel in scanned:
    parts = rel.split("/")
    check(not (rel.startswith("non-commercial/gallery/images/") or rel.startswith("element-gallery/images/")
               or rel.startswith("element-gallery/media/")), f"picture still scanned: {rel}")
    check("examples_assets" not in parts, f"documentation screenshot still scanned: {rel}")
    check(not (parts[-2:-1] == ["mobjects"] and parts[-1].startswith("_")), f"helper module scanned as an item: {rel}")
for rel in classes:
    check(rel in scanned, f"class not scanned: {rel}")

# ---------------------------------------------------------------------------------------------
print("2b. no two gallery modules define the same top-level name differently")
# an exported scene puts every imported module at its top level: a clash would swap definitions
import ast  # noqa: E402
import import_runner  # noqa: E402
seen = {}
for rel in sorted(classes):
    for node in import_runner._bundle(os.path.join(LIB, rel), set()).body:
        names = [node.name] if isinstance(node, (ast.FunctionDef, ast.ClassDef)) else \
            [t.id for t in node.targets if isinstance(t, ast.Name)] if isinstance(node, ast.Assign) else []
        for name in names:
            src = ast.unparse(node)
            if name in seen and seen[name][0] != src:
                check(False, f"'{name}' defined differently in {seen[name][1]} and {rel}")
            seen.setdefault(name, (src, rel))

# ---------------------------------------------------------------------------------------------
print("3. every class converted (run import_convert.py after editing a gallery class)")
records = {r["rel"]: r for r in li.converted()}
items = {it["rel"]: it for it in li.library_items()}
for rel, root in sorted(classes.items()):
    r = records.get(rel)
    check(r is not None, f"not converted: {rel}")
    if r is None:
        continue
    check(r["status"] == "ok", f"conversion failed: {rel}: {r.get('error', '')[:200]}")
    check(r.get("kind") == "class", f"{rel}: kind {r.get('kind')}, expected class")
    check(r["nc"] == root.startswith("non-commercial"), f"{rel}: licence flag nc={r['nc']}")
    check("ImageMobject(" not in r.get("code", ""), f"{rel}: still wraps an image")
    name = os.path.basename(rel)[:-3]
    check(bool(r.get("dynamic")) == (name in EXPECTED_DYNAMIC and root == "element-gallery"),
          f"{rel}: dynamic={r.get('dynamic')}")
    it = items.get(rel)
    if it and it["dynamic"]:
        check(it["code"] == f"return {it['fn']}(t=t)", f"{rel}: dynamic item code {it['code']!r}")
    check(bool(r.get("doc")), f"{rel}: no docstring (used as the item description)")
for rel, r in records.items():
    if rel.startswith(("non-commercial/gallery/images/", "element-gallery/images/", "element-gallery/media/")):
        check(False, f"stale picture record: {rel}")
# clips saved with a picture's old id resolve to its class
old = li.slug_for("non-commercial/gallery/images/BrickRow.png")
check(library.BY_ID.get(old, {}).get("rel") == "non-commercial/gallery/mobjects/BrickRow.py", "old BrickRow picture id does not resolve")
old = li.slug_for("element-gallery/media/LorenzAttractor.mp4")
check(library.BY_ID.get(old, {}).get("rel") == "element-gallery/mobjects/LorenzAttractor.py", "old LorenzAttractor clip id does not resolve")

# ---------------------------------------------------------------------------------------------
print("4. every class renders through the preview renderer")
R = server.Renderer()
BG = np.array([0x1e, 0x1e, 0x1e])


def project(item_id, duration=4.0):
    return {
        "settings": {"background": "#1e1e1e", "duration": duration},
        "tracks": [{"id": "a", "name": "A"}],
        "clips": [{"id": "c1", "item": item_id, "name": "g", "track": "a", "start": 0.0, "duration": duration,
                   "params": {}, "transform": {"x": 0, "y": 0, "scale": 1, "rotation": 0, "opacity": 1},
                   "enter": {"type": "none"}, "exit": {"type": "none"}}],
    }


def frame(p, t, w=480, h=270):
    data, meta = R.frame(p, t, w, h)
    return np.frombuffer(data, dtype=np.uint8).reshape(meta["h"], meta["w"], 4)[:, :, :3].astype(int), meta


def ink(arr):
    return float((np.abs(arr - BG).sum(axis=2) > 30).mean())


slow = []
for rel in sorted(classes):
    it = items.get(rel)
    if it is None:
        continue
    t0 = time.perf_counter()
    arr, meta = frame(project(it["id"]), 2.0)
    dt = time.perf_counter() - t0
    if dt > 1.5:
        slow.append((rel, round(dt, 2)))
    check(not meta.get("errors"), f"{rel}: clip error {str(meta.get('errors'))[:240]}")
    # clips show at natural size: a thin 3-unit line covers ~0.1% of a 480x270 frame
    check(ink(arr) > 0.0008, f"{rel}: renders (almost) nothing (ink {ink(arr):.4f})")
print(f"   slow first frames: {slow}")

# ---------------------------------------------------------------------------------------------
print("5. animated classes move, keep their place and rebuild fast")
for rel, it in items.items():
    if not it["dynamic"]:
        continue
    p = project(it["id"], duration=6.0)
    frames = [frame(p, t)[0] for t in (0.5, 1.7, 2.9)]
    check(np.abs(frames[0] - frames[1]).sum() > 0 and np.abs(frames[1] - frames[2]).sum() > 0, f"{rel}: does not animate")
    ns = {}
    exec("from manimlib import *\nfrom studio_runtime import *\nimport numpy as np\nimport math\n", ns)
    exec(it["prelude"], ns)
    fn = ns[it["fn"]]
    fn(0.0)  # warm caches
    sizes, times = [], []
    for t in np.linspace(0.2, 5.0, 9):
        t0 = time.perf_counter()
        m = fn(float(t))
        times.append(time.perf_counter() - t0)
        sizes.append((round(m.get_width(), 3), round(m.get_height(), 3)))
    check(max(times) < 0.08, f"{rel}: rebuild takes {max(times) * 1000:.0f} ms per frame")
    name = os.path.basename(rel)[:-3]
    if name not in ("DeepNetwork", "FourierSquare", "MandelbrotZoom", "ComplexSquare", "GradientDescent"):
        check(len(set(sizes)) == 1, f"{rel}: size changes over time {sorted(set(sizes))[:3]}")

# ---------------------------------------------------------------------------------------------
print("6. library thumbnails (fit, enter animation, GPU fractals, 3D)")
by_name = {os.path.basename(rel)[:-3] + ("@nc" if it["nc"] else ""): it for rel, it in items.items()}
for name in ("MandelbrotSet", "JuliaSet", "NewtonFractal@nc", "SphereElement", "SurfaceElement", "FourierHeart", "PiCreature@nc"):
    it = by_name.get(name)
    check(it is not None, f"no library item {name}")
    if it is None:
        continue
    res = R.thumb(it["id"])
    check(res is not None, f"{name}: no thumbnail")
    if res:
        still = np.asarray(res[0])[:, :, :3].astype(int)
        bg = np.array([0x1b, 0x1d, 0x23])
        check(float((np.abs(still - bg).sum(axis=2) > 30).mean()) > 0.01, f"{name}: blank thumbnail")

# ---------------------------------------------------------------------------------------------
print("7. export through the manimgl CLI matches the preview (library files, shaders, 3D, animation)")
import subprocess  # noqa: E402


def gclip(name, cid, track, x, y, scale):
    it = by_name[name]
    return {"id": cid, "item": it["id"], "name": cid, "track": track, "start": 0.0, "duration": 3.0, "params": {},
            "transform": {"x": x, "y": y, "scale": scale, "rotation": 0, "opacity": 1},
            "enter": {"type": "FadeIn", "duration": 0.5}, "exit": {"type": "none"}}


ep = {"settings": {"background": "#1e1e1e", "duration": 3, "fps": 10},
      "tracks": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
      "clips": [gclip("PiCreature@nc", "pi", "a", -5, 2, 0.7), gclip("DoublePendulum@nc", "dp1", "a", -1.5, 2, 0.6),
                gclip("DoublePendulum", "dp2", "b", 2, 2, 0.6), gclip("MandelbrotSet", "mb", "a", 5, 2, 0.6),
                gclip("FourierHeart", "fh", "b", -4.5, -1.8, 0.6), gclip("SphereElement", "sp", "a", -1, -1.8, 0.8),
                gclip("CoinFlipTree@nc", "ct", "b", 2.5, -1.8, 0.8), gclip("Tesseract", "ts", "a", 5.5, -1.8, 0.45)]}
out = os.path.join(TMP, "gallery.mp4")
job = server.start_export({"project": ep, "out": out, "resolution": [640, 360], "fps": 10})
t0 = time.time()
while server.EXPORTS[job]["status"] == "running" and time.time() - t0 < 300:
    time.sleep(0.5)
st = server.EXPORTS[job]
check(st["status"] == "done", f"export failed: {st['status']}\n{st['log'][-2000:]}")
if st["status"] == "done":
    for fi in (8, 18, 28):
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", out, "-vf", f"select=eq(n\\,{fi})", "-vframes", "1",
                              "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
        vid = np.frombuffer(raw, dtype=np.uint8).reshape(360, 640, 3).astype(int)
        arr, meta = frame(ep, fi / 10, 640, 360)
        diff = np.abs(vid - arr).mean()
        print(f"   frame {fi}: mean abs diff preview vs export = {diff:.2f}")
        check(not meta["errors"], f"preview errors {meta['errors']}")
        check(diff < 5, f"export frame {fi} differs from preview (diff {diff:.2f})")
        # the pi creature (top left) is drawn in the export too
        check(ink(vid[40:140, 30:150]) > 0.05, f"export frame {fi}: pi creature missing")

print()
if FAILS:
    print(f"{len(FAILS)} FAILURES")
    sys.exit(1)
print("ALL GALLERY CHECKS PASSED")
