"""
Engine stress tests.  Run:   engine/.venv/bin/python engine/tests/test_engine.py [--export]
"""
import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, ENGINE)
TMP = tempfile.mkdtemp(prefix="mstest-")
DO_EXPORT = "--export" in sys.argv
sys.argv = [sys.argv[0], "--data", TMP]

import numpy as np  # noqa: E402
import server  # noqa: E402
import library  # noqa: E402
import codegen  # noqa: E402
import studio_runtime as rt  # noqa: E402

R = server.Renderer()
FAILS = []
BG = np.array([0x1e, 0x1e, 0x1e])


def check(cond, msg):
    if not cond:
        FAILS.append(msg)
        print("  FAIL:", msg)


def project(*clips, duration=None):
    return {
        "settings": {"background": "#1e1e1e", "duration": duration or 6},
        "tracks": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
        "clips": list(clips),
    }


def clip(item, cid="c1", track="a", start=0.0, duration=4.0, **kw):
    d = {"id": cid, "item": item, "name": item, "track": track, "start": start, "duration": duration,
         "params": library.default_params(item), "transform": {"x": 0, "y": 0, "scale": 1, "rotation": 0, "opacity": 1},
         "enter": {"type": "FadeIn", "duration": 1.0}, "exit": {"type": "FadeOut", "duration": 1.0}}
    d.update(kw)
    return d


def frame(p, t, w=480, h=270):
    data, meta = R.frame(p, t, w, h)
    arr = np.frombuffer(data, dtype=np.uint8).reshape(meta["h"], meta["w"], 4)
    return arr, meta


def ink(arr):
    """fraction of pixels that differ from the background"""
    diff = np.abs(arr[:, :, :3].astype(int) - BG).sum(axis=2)
    return float((diff > 30).mean())


# ----------------------------------------------------------------------------------------
print("1. every library item, scrubbing forward and backward")
t0 = time.time()
for it in library.ITEMS:
    if it.get("hidden"):
        continue
    p = project(clip(it["id"], enter={"type": it.get("enter", "FadeIn"), "duration": 1.0}))
    times = [0.0, 0.25, 0.5, 0.99, 2.0, 3.5, 3.9, 1.5, 0.1, 2.5]
    for t in times:
        arr, meta = frame(p, t)
        check(not meta["errors"], f"{it['id']} t={t}: {meta['errors']}")
    arr, meta = frame(p, 2.0)
    check(ink(arr) > 0.0002, f"{it['id']}: nothing visible during hold (ink={ink(arr):.5f})")
    check("c1" in meta["clips"] and meta["clips"]["c1"]["bbox"], f"{it['id']}: no bbox info")
    arr, meta = frame(p, 4.5)
    check(ink(arr) < 0.0001, f"{it['id']}: still visible after end")
print(f"   {time.time() - t0:.1f}s")

# ----------------------------------------------------------------------------------------
print("2. all enter / exit / effect animations on several mobject kinds")
from PIL import Image  # noqa: E402
img_path = os.path.join(TMP, "assets", "test.png")
os.makedirs(os.path.dirname(img_path), exist_ok=True)
Image.fromarray((np.random.rand(60, 90, 3) * 255).astype(np.uint8)).save(img_path)
svg_path = os.path.join(TMP, "assets", "test.svg")
open(svg_path, "w").write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="orange"/><rect x="20" y="20" width="30" height="30" fill="blue"/></svg>')
subjects = ["circle", "tex", "text", "axes_graph", "bullets", "counter", "image", "svg", "glow_dot"]
t0 = time.time()
for subj in subjects:
    params = library.default_params(subj)
    if subj == "image":
        params["path"] = "test.png"
    if subj == "svg":
        params["path"] = "test.svg"
    for ent in rt.ENTER_ANIMS:
        p = project(clip(subj, params=params, enter={"type": ent, "duration": 1.0}, exit={"type": "none"}))
        for t in (0.0, 0.3, 0.6, 0.95, 0.2, 1.5):
            arr, meta = frame(p, t)
            check(not meta["errors"], f"{subj}/enter {ent} t={t}: {meta['errors']}")
        check(ink(frame(p, 1.5)[0]) > 0.0003, f"{subj}/enter {ent}: invisible after enter")
    for ex in rt.EXIT_ANIMS:
        if ex.startswith("Transform"):
            continue
        p = project(clip(subj, params=params, enter={"type": "none"}, exit={"type": ex, "duration": 1.0}))
        for t in (2.0, 3.1, 3.5, 3.9, 3.2, 3.99):
            arr, meta = frame(p, t)
            check(not meta["errors"], f"{subj}/exit {ex} t={t}: {meta['errors']}")
        if ex != "none":
            # near the end the object should be (almost) gone
            check(ink(frame(p, 3.999)[0]) < ink(frame(p, 2.0)[0]) * 0.6 + 0.0005,
                  f"{subj}/exit {ex}: does not disappear")
    for eff in rt.EFFECTS:
        p = project(clip(subj, params=params, enter={"type": "none"}, exit={"type": "none"},
                         effects=[{"type": eff, "at": 1.0, "duration": 1.0}]))
        for t in (0.5, 1.0, 1.3, 1.6, 1.99, 1.2, 2.5):
            arr, meta = frame(p, t)
            check(not meta["errors"], f"{subj}/effect {eff} t={t}: {meta['errors']}")
print(f"   {time.time() - t0:.1f}s")

# ----------------------------------------------------------------------------------------
print("3. keyframes, transforms, z-order")
p = project(clip("square", keys=[{"t": 0, "x": -4, "y": 0, "scale": 1, "rotation": 0, "opacity": 1},
                                 {"t": 2, "x": 4, "y": 2, "scale": 2, "rotation": 90, "opacity": 0.5}],
                 enter={"type": "none"}, exit={"type": "none"}))
_, m0 = frame(p, 0.0)
_, m1 = frame(p, 1.0)
_, m2 = frame(p, 3.0)
check(abs(m0["clips"]["c1"]["x"] + 4) < 1e-6, f"key start x {m0['clips']['c1']['x']}")
check(abs(m1["clips"]["c1"]["x"]) < 1e-6, f"key middle x {m1['clips']['c1']['x']}")
check(abs(m2["clips"]["c1"]["x"] - 4) < 1e-6 and abs(m2["clips"]["c1"]["scale"] - 2) < 1e-6, "key end")
bb = m2["clips"]["c1"]["bbox"]
check(abs((bb[0] + bb[2]) / 2 - 4) < 0.05, f"bbox center x {bb}")
# z-order: track a (front) red square over track b (back) green square
front = clip("square", "f", "a", params={**library.default_params("square"), "fill": "#FF0000", "stroke": "#FF0000", "fill_opacity": 1},
             enter={"type": "none"}, exit={"type": "none"})
back = clip("square", "b", "b", params={**library.default_params("square"), "fill": "#00FF00", "stroke": "#00FF00", "fill_opacity": 1},
            enter={"type": "none"}, exit={"type": "none"})
arr, _ = frame(project(front, back), 1.0)
cpx = arr[135, 240, :3]
check(cpx[0] > 200 and cpx[1] < 80, f"front track should be on top, got {cpx}")
for c in (front, back):
    c["track"] = "b" if c["track"] == "a" else "a"
arr, _ = frame(project(front, back), 1.0)
cpx = arr[135, 240, :3]
check(cpx[1] > 200 and cpx[0] < 80, f"after swapping tracks green should be on top, got {cpx}")
# opacity
half = clip("square", "h", "a", params={**library.default_params("square"), "fill": "#FFFFFF", "fill_opacity": 1, "stroke": "#FFFFFF"},
            transform={"x": 0, "y": 0, "scale": 1, "rotation": 0, "opacity": 0.5}, enter={"type": "none"}, exit={"type": "none"})
arr, _ = frame(project(half), 1.0)
v = int(arr[135, 240, 0])
check(120 < v < 160, f"50% white over #1e1e1e should be ~142, got {v}")

# camera
sq = clip("square", "sq", params={**library.default_params("square"), "side": 1, "fill": "#FFFFFF", "fill_opacity": 1, "stroke": "#FFFFFF"},
          transform={"x": 2, "y": 0, "scale": 1, "rotation": 0, "opacity": 1}, enter={"type": "none"}, exit={"type": "none"})
pc = project(sq)
pc["settings"]["camera"] = [{"t": 0, "x": 0, "y": 0, "zoom": 1}, {"t": 2, "x": 2, "y": 0, "zoom": 2}]
a0, m0 = frame(pc, 0.0)
a2, m2 = frame(pc, 2.0)
check(abs(m2["camera"]["zoom"] - 2) < 1e-6 and abs(m2["camera"]["x"] - 2) < 1e-6, f"camera key values {m2['camera']}")
check(ink(a2) > ink(a0) * 3.2, f"zoom 2 makes the square ~4x the area ({ink(a0):.4f} -> {ink(a2):.4f})")
cpx = a2[135, 240, :3]
check(cpx.min() > 200, f"camera centred on the square, centre pixel {cpx}")
a1, m1 = frame(pc, 1.0)
check(1 < m1["camera"]["zoom"] < 2, "camera zoom interpolates")
_, m3 = frame(project(sq), 1.0)
check(m3["camera"]["zoom"] == 1.0, "camera resets when keys are removed")

# ----------------------------------------------------------------------------------------
print("4. transform into / matching")
a = clip("tex", "ta", params={**library.default_params("tex"), "tex": r"a^2 + b^2"}, start=0, duration=3,
         enter={"type": "Write", "duration": 1}, exit={"type": "TransformMatching", "duration": 1, "target": "tb"})
b = clip("tex", "tb", params={**library.default_params("tex"), "tex": r"a^2 + b^2 = c^2"}, start=3, duration=3,
         transform={"x": 0, "y": -1, "scale": 1, "rotation": 0, "opacity": 1}, enter={"type": "none"}, exit={"type": "none"})
p = project(a, b)
for t in (0.5, 2.0, 2.2, 2.5, 2.9, 2.3, 3.0, 4.0):
    arr, meta = frame(p, t)
    check(not meta["errors"], f"transform matching t={t}: {meta['errors']}")
a["exit"]["type"] = "TransformInto"
b2 = clip("circle", "tb", start=3, duration=3, enter={"type": "none"})
p = project(a, b2)
for t in (2.0, 2.5, 2.99, 2.1):
    arr, meta = frame(p, t)
    check(not meta["errors"], f"transform into t={t}: {meta['errors']}")

# ----------------------------------------------------------------------------------------
print("5. error handling")
bad = clip("custom", code="return Circle(radius=")
arr, meta = frame(project(bad), 1.0)
check("c1" in meta["errors"] and "SyntaxError" in meta["errors"]["c1"], f"syntax error not reported: {meta['errors']}")
bad = clip("custom", code="return 1/0")
arr, meta = frame(project(bad, clip("circle", "ok")), 1.0)
check("c1" in meta["errors"] and "ZeroDivision" in meta["errors"]["c1"], f"runtime error not reported {meta['errors']}")
check("ok" in meta["clips"], "a broken clip must not break others")
bad = clip("custom", code="return 5")
arr, meta = frame(project(bad), 1.0)
check("c1" in meta["errors"], "non-mobject return not reported")
bad = clip("axes_graph", params={**library.default_params("axes_graph"), "f": "np.sinn(x)"})
arr, meta = frame(project(bad), 1.0)
check("c1" in meta["errors"], "bad expression not reported")
bad = clip("tex", params={**library.default_params("tex"), "tex": r"\frac{1}{"})
arr, meta = frame(project(bad), 1.0)
check("c1" in meta["errors"], "bad latex not reported")
# Recover after fixing
arr, meta = frame(project(clip("tex")), 1.5)
check(not meta["errors"], f"recovery failed {meta['errors']}")

# ----------------------------------------------------------------------------------------
print("6. performance")
p = project(clip("circle", "a1", transform={"x": -3, "y": 0, "scale": 1, "rotation": 0, "opacity": 1}),
            clip("tex", "a2", "b"), clip("axes_graph", "a3", "b", start=1), clip("text", "a4", "a", start=0.5))
frame(p, 2, 1280, 720)
t0 = time.perf_counter()
n = 0
for i in range(60):
    for c in p["clips"]:
        if c["id"] == "a1":
            c["transform"]["x"] = -3 + i * 0.1   # simulates dragging
    frame(p, 2.0, 1280, 720)
    n += 1
dt = (time.perf_counter() - t0) / n * 1000
print(f"   drag re-render: {dt:.1f} ms/frame @1280x720")
check(dt < 60, f"drag re-render too slow: {dt:.1f}ms")
t0 = time.perf_counter()
for i in range(90):
    frame(p, i / 30, 1280, 720)
dt = (time.perf_counter() - t0) / 90 * 1000
print(f"   playback: {dt:.1f} ms/frame @1280x720")
check(dt < 80, f"playback too slow: {dt:.1f}ms")

# ----------------------------------------------------------------------------------------
print("6b. memory + scheduling (GL objects freed, memo text, cached morphs, background jobs)")
import threading  # noqa: E402

# GPU buffers of rebuilt mobjects must be released (gc_mode None leaked ~0.75 MB per edit)
check(R.camera.ctx.gc_mode == "context_gc", f"GL context gc_mode is {R.camera.ctx.gc_mode!r}")
dyn = clip("text", "dy1", dynamic=True, code="w = Text('Hi', font_size=40)\nw.rotate(t * 0.5)\nreturn w",
           enter={"type": "none"}, exit={"type": "none"})
pd = project(dyn)
import gc as _gc  # noqa: E402
_gc.collect()
R.collect_gl()
released = 0
for i in range(30):
    frame(pd, 0.5 + i * 0.05)
    _gc.collect()  # mobjects are reference cycles: their GL wrappers are queued by the cycle collector
    released += R.collect_gl() or 0
check(released >= 30, f"dynamic clip re-renders release their GL objects ({released} released over 30 frames)")
check(len(R.camera.ctx.objects) == 0, "nothing left queued after collect_gl")

# memoised Text: same look, independent copies, still manimlib classes
from manimlib.mobject.svg.text_mobject import Text as _MText  # noqa: E402
n0 = len(rt._TEXT_CACHE)
a = rt.Text("Memo test", font_size=40)
b = rt.Text("Memo test", font_size=40)
check(len(rt._TEXT_CACHE) == n0 + 1, "second identical Text comes from the cache")
check(isinstance(a, _MText) and type(a).__name__ == "Text", "memo Text is still a manimlib Text")
check(a is not b and all(x is not y for x, y in zip(a.get_family(), b.get_family())), "memo Text returns independent copies")
check(np.allclose(a.get_points(), b.get_points()) and len(a.get_family()) == len(b.get_family()), "memo Text copies are identical")
b.shift(np.array([3.0, 0, 0]))
check(abs(a.get_center()[0]) < 1e-6, "moving one memo copy leaves the other alone")
c = rt.Text("Memo test", font_size=40)
check(abs(c.get_center()[0]) < 1e-6, "the cached original is not changed by edits to copies")
d = rt.Text("Memo test", font_size=40, t2c={"Memo": "#ff0000"})
check(d[0].get_fill_color() != a[0].get_fill_color(), f"kwargs (t2c dict) are part of the memo key ({d[0].get_fill_color()} vs {a[0].get_fill_color()})")
class MyText(rt.Text):  # noqa: E302
    pass
n1 = len(rt._TEXT_CACHE)
MyText("Memo test", font_size=40)
check(len(rt._TEXT_CACHE) == n1, "subclasses of Text are not memoised")
ns = {}
exec(codegen.HEADER, ns)
check(ns["Text"] is rt.Text, "clip code / scene.py get the memo Text")

# a morph into a DYNAMIC target is built once, not every frame
src = clip("text", "ms1", duration=3.0, enter={"type": "none"},
           exit={"type": "TransformInto", "duration": 1.0, "rate": "smooth", "target": "mt1"})
tgt = clip("text", "mt1", "b", start=3.0, duration=2.0, dynamic=True, enter={"type": "none"}, exit={"type": "none"},
           code="w = Text('Target', font_size=40)\nw.shift(RIGHT * t)\nreturn w")
pm = project(src, tgt)
frame(pm, 2.2)
tl = R.preview.sync(pm)
anims = set()
for t in (2.3, 2.5, 2.7, 2.9):
    frame(pm, t)
    anims.add(id(tl.by_id["ms1"]._anim_cache[("tx", "mt1")][0]))
check(len(anims) == 1, f"morph into a dynamic clip reuses one animation ({len(anims)} built)")
arr, _ = frame(pm, 2.6)
check(ink(arr) > 0.002, "morph into a dynamic clip draws")

# background jobs step aside for the live preview; generator jobs run one step at a time
check(server._jobs.empty(), "job queue empty before scheduler test")
order = []


def gen_job(r):
    for i in range(3):
        order.append(f"bg{i}")
        yield
    return "strip-done"


server._live["at"] = 0.0
fut = server.submit(2, gen_job)
cont = server.run_job(R, server.next_job())
check(cont is not None and order == ["bg0"], "generator job ran one step")
server._jobs.put(cont)
server.submit(0, lambda r: order.append("frame"))
server.run_job(R, server.next_job())  # the frame cuts in before the rest of the strip
check(order == ["bg0", "frame"], f"live frame runs between generator steps ({order})")
t0 = time.perf_counter()
job = server.next_job()  # a live frame just finished: background waits LIVE_WINDOW
waited = time.perf_counter() - t0
check(waited >= server.LIVE_WINDOW * 0.8, f"background job held back after a live frame ({waited * 1000:.0f} ms)")
while job is not None:
    cont = server.run_job(R, job)
    job = cont
check(fut.result(timeout=1) == "strip-done" and order[-2:] == ["bg1", "bg2"], f"generator job completes ({order})")
# a frame arriving while a background job waits is served first
server._live["at"] = time.monotonic()
server.submit(2, lambda r: order.append("late-bg"))
threading.Timer(0.03, lambda: server.submit(0, lambda r: order.append("frame2"))).start()
server.run_job(R, server.next_job())
check(order[-1] == "frame2", f"a frame submitted while background waits goes first ({order[-2:]})")
server.run_job(R, server.next_job())
check(order[-1] == "late-bg" and server._jobs.empty(), "the waiting background job still runs")

# a filmstrip interrupted by live frames comes out identical (each step restores its GL state)
strip_clip = {**dyn, "duration": 2.0}
times = [0.25, 0.75, 1.25, 1.75]
whole = R.clip_strip(strip_clip, times)
steps = R.clip_strip_steps(strip_clip, times)
mixed = None
while True:
    try:
        next(steps)
    except StopIteration as stop:
        mixed = stop.value
        break
    frame(pm, 2.5, 640, 360)  # a live frame with another camera / size / background in between
check(isinstance(whole, bytes) and whole[:4] == b"\x89PNG", "filmstrip is a PNG")
from PIL import Image as _Img  # noqa: E402
import io as _io  # noqa: E402
wa = np.asarray(_Img.open(_io.BytesIO(whole)).convert("RGBA")).astype(int)
ma = np.asarray(_Img.open(_io.BytesIO(mixed)).convert("RGBA")).astype(int)
check(wa.shape == ma.shape and np.abs(wa - ma).mean() < 0.5, f"interleaved filmstrip matches ({wa.shape} vs {ma.shape})")

# ----------------------------------------------------------------------------------------
print("7. code generation")
everything = []
for i, it in enumerate([x for x in library.ITEMS if not x.get("hidden")]):
    everything.append(clip(it["id"], f"id{i}", "a" if i % 2 else "b", start=i * 0.1, duration=2))
p = project(*everything)
code = codegen.generate_script(p)
try:
    compile(code, "scene.py", "exec")
except SyntaxError as e:
    check(False, f"generated code does not compile: {e}")
# tricky strings
tricky = clip("text", params={**library.default_params("text"), "text": 'He said "hi" \\ and \'bye\'\nnew line'})
tricky_tex = clip("tex", "t2", params={**library.default_params("tex"), "tex": '\\text{"quoted"} \\\\ x'})
code = codegen.generate_script(project(tricky, tricky_tex))
try:
    compile(code, "scene.py", "exec")
except SyntaxError as e:
    check(False, f"tricky strings break codegen: {e}")
arr, meta = frame(project(tricky, tricky_tex), 2.0)
check(not meta["errors"], f"tricky strings render: {meta['errors']}")

# ----------------------------------------------------------------------------------------
print("3D. camera orientation, depth, z, pinned clips, editor grid")
import math


def proj_px(cam, p, w, h):
    """The preview overlay's projection (src/view3d.ts) in Python."""
    FW, FH = 14.222222222222221, 8.0
    t, ph, g = [math.radians(cam.get(k, 0)) for k in ("theta", "phi", "gamma")]
    def rz(a): return np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
    def rx(a): return np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
    Rm = rz(t) @ rx(ph) @ rz(g)
    v = Rm.T @ (np.array(p) - np.array([cam.get("x", 0), cam.get("y", 0), cam.get("z", 0)])) * cam.get("zoom", 1)
    k = 2 * math.tan(math.radians(22.5)) / FH
    den = 1 - v[2] * k
    return ((v[0] * 2 / FW / den + 1) * 0.5 * w, (1 - v[1] * 2 / FH / den) * 0.5 * h)


def blob(arr, thresh=200):
    ys, xs = np.nonzero(arr[:, :, :3].min(axis=2) > thresh)
    return (xs.mean(), ys.mean(), len(xs)) if len(xs) else (None, None, 0)


dot_code = "return Dot(radius=0.05, fill_color=WHITE)"
cam3 = {"t": 0, "x": 0.5, "y": 0.2, "z": 0.3, "zoom": 1.3, "theta": -30, "phi": 70, "gamma": 10}
for pos in [(1.5, -1.0, 1.2), (-2.0, 1.5, -0.5), (0.0, 0.0, 2.0)]:
    d = clip("custom", "dot", code=dot_code, enter={"type": "none"}, exit={"type": "none"},
             transform={"x": pos[0], "y": pos[1], "z": pos[2], "scale": 1, "rotation": 0, "opacity": 1})
    p3 = project(d)
    p3["settings"]["camera"] = [cam3]
    arr, meta = frame(p3, 1.0, 640, 360)
    bx, by, n = blob(arr)
    ex, ey = proj_px(cam3, pos, 640, 360)
    check(n > 0 and abs(bx - ex) < 1.5 and abs(by - ey) < 1.5, f"3D projection of {pos}: render ({bx}, {by}) vs formula ({ex:.1f}, {ey:.1f})")
    check(abs(meta["clips"]["dot"]["z"] - pos[2]) < 1e-9, "clip info reports z")
check(abs(meta["camera"]["theta"] + 30) < 1e-9 and abs(meta["camera"]["phi"] - 70) < 1e-9, f"meta camera angles {meta['camera']}")

# 3D orientation of clips: rx tips about x, ry turns about y (after the in-plane rotation)
rect_code = "return Rectangle(width=2, height=1, fill_color=WHITE, fill_opacity=1, stroke_width=0)"
def tilt_clip(**tr):
    return clip("custom", "r", code=rect_code, enter={"type": "none"}, exit={"type": "none"},
                transform={"x": 0, "y": 0, "z": 0, "scale": 1, "rotation": 0, "opacity": 1, **tr})
_, m_rx = frame(project(tilt_clip(rx=-90)), 1.0)
i_rx = m_rx["clips"]["r"]
check(abs(i_rx["bbox"][1]) < 0.02 and abs(i_rx["bbox"][3]) < 0.02 and abs(i_rx["zr"][0] + 0.5) < 0.02 and abs(i_rx["zr"][1] - 0.5) < 0.02,
      f"rx=-90 lays a 2x1 rectangle on the XZ floor: bbox {i_rx['bbox']} zr {i_rx['zr']}")
check(abs(i_rx.get("rx", 0) + 90) < 1e-9, "clip info reports rx")
_, m_ry = frame(project(tilt_clip(ry=90)), 1.0)
i_ry = m_ry["clips"]["r"]
check(abs(i_ry["bbox"][0]) < 0.02 and abs(i_ry["bbox"][2]) < 0.02 and abs(i_ry["zr"][0] + 1) < 0.02 and abs(i_ry["zr"][1] - 1) < 0.02,
      f"ry=90 turns it to face +x: bbox {i_ry['bbox']} zr {i_ry['zr']}")
# rotation first, then rx: a rectangle spun 90 deg and laid flat is 1 wide (x) and 2 deep (z)
_, m_both = frame(project(tilt_clip(rotation=90, rx=-90)), 1.0)
i_b = m_both["clips"]["r"]
check(abs((i_b["bbox"][2] - i_b["bbox"][0]) - 1) < 0.03 and abs((i_b["zr"][1] - i_b["zr"][0]) - 2) < 0.03, f"rotation then rx: bbox {i_b['bbox']} zr {i_b['zr']}")
# seen from the editor's Top view (eye on +y), a flat text is a thin line; laid flat (rx=-90) it reads
top_cam = {"t": 0, "x": 0, "y": 0, "z": 0, "zoom": 1, "theta": 180, "phi": 90, "gamma": 180}
for rxv, want in ((0, "edge-on"), (-90, "readable")):
    pt = project(tilt_clip(rx=rxv))
    pt["settings"]["camera"] = [top_cam]
    arr, _ = frame(pt, 1.0, 480, 270)
    ys, xs = np.nonzero(arr[:, :, :3].min(axis=2) > 200)
    hgt = (ys.max() - ys.min() + 1) if len(ys) else 0
    if want == "edge-on":
        check(hgt <= 4, f"flat rectangle from Top should be edge-on, height {hgt}px")
    else:
        # 1 unit deep of the 8-unit-high frame at 270px ~ 34px; 2 wide ~ 68px
        check(25 < hgt < 45 and 55 < (xs.max() - xs.min()) < 80, f"rx=-90 rectangle from Top: {xs.max() - xs.min()}x{hgt}px")
# keyframed rx interpolates and reaches the export
kc = tilt_clip()
kc["keys"] = [{"t": 0, "x": 0, "y": 0, "scale": 1, "rotation": 0, "opacity": 1},
              {"t": 2, "x": 0, "y": 0, "scale": 1, "rotation": 0, "rx": -90, "opacity": 1, "ease": "linear"}]
_, m_k = frame(project(kc), 1.0)
check(abs(m_k["clips"]["r"].get("rx", 0) + 45) < 1e-6, f"rx keyframes interpolate: {m_k['clips']['r'].get('rx')}")
kw = codegen.clip_kwargs(kc, 0)
check(kw["keys"][1].get("rx") == -90 and "rx" not in kw["keys"][0], f"codegen keeps rx keys: {kw['keys']}")
check(codegen.clip_kwargs(tilt_clip(ry=30), 0)["transform"].get("ry") == 30, "codegen keeps static ry")
# a key at rx 0 / z 0 must not fall back to a non-zero static value
kz = tilt_clip(rx=-90, z=2)
kz["keys"] = [{"t": 0, "x": 0, "y": 0, "z": 0, "scale": 1, "rotation": 0, "rx": 0, "opacity": 1},
              {"t": 2, "x": 0, "y": 0, "z": 2, "scale": 1, "rotation": 0, "rx": -90, "opacity": 1, "ease": "linear"}]
_, m_kz = frame(project(kz), 1.0)
check(abs(m_kz["clips"]["r"].get("rx", 0) + 45) < 1e-6 and abs(m_kz["clips"]["r"]["z"] - 1) < 1e-6,
      f"zero-valued z / rx keys beat the static transform: rx {m_kz['clips']['r'].get('rx')} z {m_kz['clips']['r']['z']}")

# camera angles interpolate; 2D projects keep working with angle-less keys
c_mid = rt.camera_at([{"t": 0, "theta": 0, "phi": 0, "x": 0, "y": 0, "zoom": 1}, {"t": 2, "theta": 90, "phi": 60, "zoom": 2, "ease": "linear"}], 1.0)
check(abs(c_mid["theta"] - 45) < 1e-6 and abs(c_mid["phi"] - 30) < 1e-6 and abs(c_mid["zoom"] - 1.5) < 1e-6, f"camera angles interpolate {c_mid}")
check(rt.camera_at([{"t": 0, "x": 1, "y": 2, "zoom": 1}], 0)["phi"] == 0, "2D keys default to a flat camera")

# a sphere looks different when the camera tilts (shading), and the projection keeps it centred
sph = clip("sphere", "s", enter={"type": "none"}, exit={"type": "none"})
pf = project(sph)
a_flat, _ = frame(pf, 1.0)
pf["settings"]["camera"] = [{"t": 0, "x": 0, "y": 0, "zoom": 1, "theta": -30, "phi": 70}]
a_tilt, _ = frame(pf, 1.0)
mask = np.abs(a_flat[:, :, :3].astype(int) - BG).sum(axis=2) > 30
shade = np.abs(a_flat[:, :, :3].astype(int) - a_tilt[:, :, :3].astype(int))[mask].mean()
check(ink(a_tilt) > 0.03 and shade > 4, f"tilted camera changes the sphere's shading (diff {shade:.1f} inside the sphere)")

# depth test: a cube in front of a sphere hides it from the front, not from behind
cube = clip("cube", "cu", "a", enter={"type": "none"}, exit={"type": "none"},
            params={**library.default_params("cube"), "fill": "#FF0000", "side": 1.5},
            transform={"x": 0, "y": -2, "z": 0, "scale": 1, "rotation": 0, "opacity": 1})
ball = clip("sphere", "sp", "b", enter={"type": "none"}, exit={"type": "none"},
            params={**library.default_params("sphere"), "fill": "#0000FF", "radius": 0.6})
pd = project(cube, ball)
pd["settings"]["camera"] = [{"t": 0, "x": 0, "y": 0, "zoom": 1, "theta": 0, "phi": 90}]  # front: looks along +y
a_front, _ = frame(pd, 1.0)
pd["settings"]["camera"] = [{"t": 0, "x": 0, "y": 0, "zoom": 1, "theta": 180, "phi": 90}]  # back: looks along -y
a_back, _ = frame(pd, 1.0)
cf = a_front[135, 240, :3].astype(int)
cb = a_back[135, 240, :3].astype(int)
check(cf[0] > cf[2] and cb[2] > cb[0], f"depth test: front view sees the cube {cf}, back view sees the sphere {cb}")

# pinned clips ignore the camera
pin = clip("custom", "pin", code=dot_code, enter={"type": "none"}, exit={"type": "none"}, fixed=True,
           transform={"x": 2, "y": 1, "z": 0, "scale": 1, "rotation": 0, "opacity": 1})
pp = project(pin)
pp["settings"]["camera"] = [{"t": 0, "x": -3, "y": 1, "zoom": 2.5, "theta": 40, "phi": 60}]
arr, meta = frame(pp, 1.0, 640, 360)
bx, by, n = blob(arr)
ex, ey = proj_px({}, (2, 1, 0), 640, 360)
check(n > 0 and abs(bx - ex) < 1.5 and abs(by - ey) < 1.5, f"pinned clip stays put: ({bx}, {by}) vs ({ex:.1f}, {ey:.1f})")
check(meta["clips"]["pin"]["fixed"] is True, "clip info reports fixed")
pp["clips"][0]["fixed"] = False
arr, _ = frame(pp, 1.0, 640, 360)
bx2, by2, _ = blob(arr)
check(bx2 is None or abs(bx2 - ex) > 20 or abs(by2 - ey) > 20, "unpinning makes it follow the camera again")

# editor-only ground grid
d0, _ = R.frame(project(sph), 1.0, 480, 270, {"x": 0, "y": 0, "z": 0, "zoom": 0.8, "theta": -30, "phi": 70})
d1, m1 = R.frame(project(sph), 1.0, 480, 270, {"x": 0, "y": 0, "z": 0, "zoom": 0.8, "theta": -30, "phi": 70, "grid": True})
g0 = np.frombuffer(d0, dtype=np.uint8).reshape(270, 480, 4)
g1 = np.frombuffer(d1, dtype=np.uint8).reshape(270, 480, 4)
check(ink(g1) > ink(g0) + 0.01, f"grid draws in the editor view ({ink(g0):.3f} -> {ink(g1):.3f})")
check(m1["camera"]["phi"] == 0 and abs(m1["view"]["phi"] - 70) < 1e-9, "editor view does not change the reported camera")

# code generation: 3D fields only when used
p3["clips"][0]["fixed"] = True
code = codegen.generate_script(p3)
check("theta=-30" in code and "phi=70" in code and "gamma=10" in code, "codegen writes camera angles")
check("z=2.0" in code and "fixed=True" in code, "codegen writes z and fixed")
code2 = codegen.generate_script(pc)
check("theta" not in code2 and "z=" not in code2 and "fixed" not in code2, "2D scripts stay 2D")
ns = {}
exec(compile(code.replace("from studio_runtime import *", "from studio_runtime import *"), "scene3d", "exec"), ns)
check("MainScene" in ns, "3D script executes")

# ----------------------------------------------------------------------------------------
print("G. project globals (constants in scene.py, linked params, live updates)")
gp = project(
    clip("text", "g1", params={**library.default_params("text"), "text": "ABC",
                              "font_size": {"$g": "BODY_SIZE"}, "font": {"$g": "BODY_FONT"}, "fill": {"$g": "INK"}},
         enter={"type": "none"}, exit={"type": "none"}),
    clip("custom", "g2", "b", code="return VGroup(*[Square(side_length=0.5) for _ in range(N)]).arrange(RIGHT, buff=GAP)",
         enter={"type": "none"}, exit={"type": "none"}, transform={"x": 0, "y": -2, "scale": 1, "rotation": 0, "opacity": 1}),
)
gp["globals"] = [
    {"id": "a", "name": "BODY_SIZE", "type": "number", "value": 40},
    {"id": "b", "name": "BODY_FONT", "type": "font", "value": "Menlo"},
    {"id": "c", "name": "INK", "type": "color", "value": "#FF0000"},
    {"id": "d", "name": "GAP", "type": "number", "value": 0.25},
    {"id": "e", "name": "N", "type": "number", "value": 3},
    {"id": "f", "name": "BLUE", "type": "color", "value": "#00FF00"},  # reserved -> rejected
    {"id": "g", "name": "2BAD", "type": "number", "value": 1},  # not an identifier
]
code = codegen.generate_script(gp)
check("BODY_SIZE = 40" in code and "BODY_FONT = 'Menlo'" in code and "INK = '#FF0000'" in code, "globals written at the top of scene.py")
check("font_size=BODY_SIZE" in code and "font=BODY_FONT" in code and "fill_color=INK" in code, "linked params emit the global's name")
check("BLUE = " not in code and "2BAD" not in code, "reserved / invalid global names are not written")
try:
    compile(code, "scene.py", "exec")
except SyntaxError as e:
    check(False, f"scene with globals does not compile: {e}")
arr, meta = frame(gp, 1)
check(not meta["errors"], f"globals preview errors: {meta['errors']}")
check("BLUE" in meta.get("global_errors", {}) and "2BAD" in meta.get("global_errors", {}), f"global_errors reported: {meta.get('global_errors')}")
w0 = meta["clips"]["g2"]["w"]
h_text0 = meta["clips"]["g1"]["h"]
red = ((arr[:, :, 0] > 180) & (arr[:, :, 1] < 80) & (arr[:, :, 2] < 80)).mean()
check(red > 0.0002, f"linked colour global applied (red ink {red:.4f})")
# change values: the preview rebuilds with them
gp["globals"][3]["value"] = 1.0
gp["globals"][4]["value"] = 5
gp["globals"][0]["value"] = 80
_, meta = frame(gp, 1)
w1 = meta["clips"]["g2"]["w"]
check(abs(w0 - (3 * 0.5 + 2 * 0.25)) < 0.05 and abs(w1 - (5 * 0.5 + 4 * 1.0)) < 0.05, f"GAP / N globals drive custom code ({w0:.2f} -> {w1:.2f})")
check(meta["clips"]["g1"]["h"] > h_text0 * 1.6, "font size global drives a linked param")
# a missing global is a clear clip error, not a crash
gp2 = {**gp, "globals": [g for g in gp["globals"] if g["name"] != "GAP"]}
_, meta = frame(gp2, 1)
check("g2" in meta["errors"] and "GAP" in meta["errors"]["g2"], f"missing global -> NameError on the clip: {meta['errors']}")
_, meta = frame(gp, 1)
check(not meta["errors"], "recovers once the global is back")
# clip thumbnails get the globals they read
try:
    png = R.clip_thumb(gp["clips"][1], gp["globals"])
    check(len(png) > 500, "clip thumb with globals renders")
except Exception as e:  # noqa: BLE001
    check(False, f"clip thumb with globals failed: {e}")


# ----------------------------------------------------------------------------------------
print("P. group parts: per-submobject timing for VGroups of every kind")


def code_clip(code, cid="g1", **kw):
    d = {"id": cid, "item": "custom", "name": cid, "track": "a", "start": 0.0, "duration": 4.0, "params": {}, "code": code,
         "transform": {"x": 0, "y": 0, "scale": 1, "rotation": 0, "opacity": 1},
         "enter": {"type": "FadeIn", "duration": 0.5}, "exit": {"type": "none"}}
    d.update(kw)
    return d


def ink_x(arr, x0, x1):
    """ink in a vertical band of the frame (x in scene units, frame 14.22 wide)"""
    w = arr.shape[1]
    a, b = int((x0 / 14.222 + 0.5) * w), int((x1 / 14.222 + 0.5) * w)
    return ink(arr[:, max(0, a):min(w, b)])


GROUPS = {
    "VGroup": "return VGroup(Square(fill_opacity=1).shift(LEFT*3), Circle(fill_opacity=1), Triangle(fill_opacity=1).shift(RIGHT*3))",
    "Group": "return Group(Square(fill_opacity=1).shift(LEFT*3), Circle(fill_opacity=1), Triangle(fill_opacity=1).shift(RIGHT*3))",
    "nested": "return VGroup(VGroup(Square(fill_opacity=1).shift(LEFT*3)), VGroup(Circle(fill_opacity=1), Dot()), Triangle(fill_opacity=1).shift(RIGHT*3))",
    "Text": 'return Text("A      B      C", font_size=200)',
    "Tex": 'return Tex(r"A \\quad B \\quad C", font_size=140)',
    "VGroup.arrange": "return VGroup(*[Square(fill_opacity=1) for _ in range(3)]).arrange(RIGHT, buff=2)",
}
for name, code in GROUPS.items():
    # last part appears at 2s with its own animation; the first one leaves at 3s
    parts = {"2": {"at": 2.0, "enter": {"type": "GrowFromCenter", "duration": 0.5}}, "0": {"until": 3.0, "exit": {"type": "FadeOut", "duration": 0.5}}}
    p = project(code_clip(code, parts=parts))
    a1, m1 = frame(p, 1.0)
    check(not m1["errors"], f"parts {name}: {m1['errors']}")
    left, right = ink_x(a1, -5, -1.5), ink_x(a1, 1.5, 5)
    check(left > 0.01 and right < 0.002, f"parts {name}: at 1s left part shown, right part hidden (l={left:.4f} r={right:.4f})")
    a2, _ = frame(p, 2.6)
    check(ink_x(a2, 1.5, 5) > 0.01, f"parts {name}: right part entered by 2.6s")
    a3, _ = frame(p, 3.6)
    check(ink_x(a3, -5, -1.5) < 0.002 and ink_x(a3, -1, 1) > 0.005, f"parts {name}: left part gone at 3.6s, middle still there")
    a0, _ = frame(p, 1.0)  # scrub back
    check(np.abs(a0.astype(int) - a1.astype(int)).mean() < 0.5, f"parts {name}: scrubbing back gives the same frame")
    try:
        tree = R.clip_parts(p["clips"][0])
        check(len(tree.get("children") or []) >= 3, f"parts {name}: tree lists the children ({tree.get('n')})")
    except Exception as e:  # noqa: BLE001
        check(False, f"parts {name}: clip_parts failed: {e}")

# nested path inside a group, effect over the parts, morph exit, dynamic clip
p = project(code_clip(GROUPS["nested"], parts={"1.1": {"at": 1.5}}, effects=[{"type": "Indicate", "at": 2.0, "duration": 1}]))
for t in (0.2, 1.0, 1.6, 2.5, 3.5, 1.0):
    _, m = frame(p, t)
    check(not m["errors"], f"parts nested t={t}: {m['errors']}")
p = project(code_clip(GROUPS["VGroup"], parts={"1": {"at": 1}}, exit={"type": "TransformInto", "duration": 1, "target": "g2"}),
            code_clip("return Star()" if hasattr(rt, "Star") else "return RegularPolygon(5, fill_opacity=1)", "g2", start=4.0, duration=2.0, enter={"type": "none"}),
            duration=6)
for t in (0.5, 1.5, 3.2, 3.7, 4.5):
    _, m = frame(p, t)
    check(not m["errors"], f"parts + morph t={t}: {m['errors']}")
p = project(code_clip("return VGroup(Square(fill_opacity=1).shift(LEFT*3 + UP*t*0.2), Circle(fill_opacity=1).shift(RIGHT*3))", dynamic=True,
                      parts={"1": {"at": 2}}))
a, m = frame(p, 1.0)
check(not m["errors"] and ink_x(a, 1.5, 5) < 0.002, f"parts dynamic: right part hidden before 2s {m['errors']}")
a, m = frame(p, 3.0)
check(ink_x(a, 1.5, 5) > 0.01, "parts dynamic: right part shown after 2s")
names_tree = R.clip_parts(code_clip("sq = Square()\nlbl = Tex('x+y')\nreturn VGroup(sq, lbl)"))
kids = names_tree.get("children") or []
check([k.get("label") for k in kids] == ["sq", "lbl"], f"parts tree names the variables: {[k.get('label') for k in kids]}")
check([g.get("label") for g in kids[1].get("children", [])] == ["x", "+", "y"], "parts tree labels Tex glyphs")
src = codegen.generate_script(project(code_clip(GROUPS["VGroup"], parts={"2": {"at": 2.0}})))
check("parts={" in src and "'2': dict(at=2.0)" in src, "codegen writes the parts timing")

# moved parts: per-part dx / dy offsets (drag a part in the preview)
print("P2. moved parts")
TWO = "return VGroup(Square(fill_opacity=1).shift(LEFT*2), Circle(fill_opacity=1).shift(RIGHT*2))"
base_c = code_clip(TWO, enter={"type": "none"})
a0, m0 = frame(project(base_c), 1.0)
check(not m0["errors"] and ink_x(a0, 1, 3) > 0.01 and ink_x(a0, 4, 6.5) < 0.002, "moved parts: circle starts at x=2")
info0 = m0["clips"]["g1"]
moved = code_clip(TWO, enter={"type": "none"}, parts={"1": {"dx": 3.0, "dy": 0.0}})
a1, m1 = frame(project(moved), 1.0)
check(not m1["errors"], f"moved parts: {m1['errors']}")
check(ink_x(a1, 1, 3) < 0.004 and ink_x(a1, 4, 6.5) > 0.01, f"moved parts: circle moved to x=5 ({ink_x(a1, 1, 3):.4f} / {ink_x(a1, 4, 6.5):.4f})")
check(ink_x(a1, -3, -1) > 0.01, "moved parts: the square did not move")
i1 = m1["clips"]["g1"]
check(abs(i1["bbox"][2] - 6.0) < 0.05 and abs(i1["bbox"][0] - (-3.0)) < 0.05, f"moved parts: clip box grows to the moved part {i1['bbox']}")
check(abs((i1.get("ox") or 0) - 1.5) < 0.05 and abs(i1["w"] - 9.0) < 0.05, f"moved parts: hit box offset from the pivot (ox={i1.get('ox')}, w={i1['w']})")
# keeps working with part timing + a nested offset, scrubbing back, and a transform on the clip
nested = code_clip("return VGroup(VGroup(Square(fill_opacity=1), Dot()).shift(LEFT*2), Circle(fill_opacity=1).shift(RIGHT*2))",
                   transform={"x": 0, "y": 0, "scale": 0.5, "rotation": 0, "opacity": 1},
                   parts={"0": {"dy": 4.0, "at": 1.0}, "0.1": {"dx": 1.0}, "1": {"until": 3.0}})
for t in (0.5, 1.5, 3.5, 1.5):
    _, m = frame(project(nested), t)
    check(not m["errors"], f"moved nested t={t}: {m['errors']}")
a2, _ = frame(project(nested), 1.5)
H = a2.shape[0]
top = ink(a2[: int(H * 0.25)])
check(top > 0.002, f"moved nested: group moved up (scaled by the clip's scale) {top:.4f}")
# live edit: changing the offset re-renders without rebuilding the clip's code
pm = project({**moved})
frame(pm, 1.0)
pm["clips"][0]["parts"] = {"1": {"dx": -6.0}}
a3, _ = frame(pm, 1.0)
check(ink_x(a3, 1, 6.5) < 0.004 and ink_x(a3, -5, -3) > 0.005, "moved parts: editing the offset re-renders")
pm["clips"][0]["parts"] = None
a4, _ = frame(pm, 1.0)
check(np.abs(a4.astype(int) - a0.astype(int)).mean() < 0.5, "moved parts: removing the offset restores the original")
src = codegen.generate_script(project(moved))
check("'1': dict(dx=3.0)" in src, "codegen writes part offsets")

# ----------------------------------------------------------------------------------------
if DO_EXPORT:
    print("8. export through the manimgl CLI and compare with the preview")
    a = clip("circle", "c1", transform={"x": -3, "y": 0.5, "scale": 1.2, "rotation": 0, "opacity": 1},
             enter={"type": "GrowFromCenter", "duration": 1}, exit={"type": "FadeOut", "duration": 0.5})
    b = clip("tex", "c2", "b", start=0.5, duration=2.5, enter={"type": "Write", "duration": 1},
             keys=[{"t": 0, "x": 2, "y": 0, "scale": 1, "rotation": 0, "opacity": 1},
                   {"t": 2, "x": 2, "y": -2, "scale": 1.5, "rotation": 20, "opacity": 1}])
    c = clip("image", "c3", "b", start=1, duration=2, params={"path": "test.png", "height": 2},
             transform={"x": 4, "y": 2, "scale": 1, "rotation": 0, "opacity": 1})
    p = project(a, b, c, duration=3)
    p["settings"]["fps"] = 15
    out = os.path.join(TMP, "out.mp4")
    rt.ASSET_DIRS.insert(0, os.path.join(TMP, "assets"))
    job = server.start_export({"project": p, "out": out, "resolution": [640, 360], "fps": 15})
    t0 = time.time()
    while server.EXPORTS[job]["status"] == "running" and time.time() - t0 < 180:
        time.sleep(0.5)
    st = server.EXPORTS[job]
    check(st["status"] == "done", f"export failed: {st['status']}\n{st['log'][-2000:]}")
    if st["status"] == "done":
        print(f"   exported in {time.time() - t0:.1f}s")
        n = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
                            "stream=nb_read_frames", "-of", "csv=p=0", out], capture_output=True, text=True).stdout.strip()
        check(n == "45", f"expected 45 frames, got {n}")
        for fi in (5, 20, 33):
            raw = subprocess.run(["ffmpeg", "-v", "error", "-i", out, "-vf", f"select=eq(n\\,{fi})", "-vframes", "1",
                                  "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
            vid = np.frombuffer(raw, dtype=np.uint8).reshape(360, 640, 3).astype(int)
            arr, _ = frame(p, fi / 15, 640, 360)
            diff = np.abs(vid - arr[:, :, :3].astype(int)).mean()
            print(f"   frame {fi}: mean abs diff preview vs export = {diff:.2f}")
            check(diff < 6, f"export frame {fi} differs from preview (diff {diff:.2f})")
    print("9. camera export + gif / mov formats")
    pc["settings"]["fps"] = 10
    pc["settings"]["duration"] = 2.5
    for fmt in ("mp4", "gif", "mov"):
        out = os.path.join(TMP, f"cam.{fmt}")
        job = server.start_export({"project": pc, "out": out, "resolution": [480, 270], "fps": 10, "format": fmt})
        t0 = time.time()
        while server.EXPORTS[job]["status"] == "running" and time.time() - t0 < 180:
            time.sleep(0.3)
        st = server.EXPORTS[job]
        check(st["status"] == "done" and os.path.exists(out), f"{fmt} export: {st['status']} {st['log'][-500:] if st['status'] != 'done' else ''}")
        if fmt == "mp4" and st["status"] == "done":
            raw = subprocess.run(["ffmpeg", "-v", "error", "-i", out, "-vf", "select=eq(n\\,20)", "-vframes", "1",
                                  "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
            vid = np.frombuffer(raw, dtype=np.uint8).reshape(270, 480, 3).astype(int)
            arr, _ = frame(pc, 2.0, 480, 270)
            diff = np.abs(vid - arr[:, :, :3].astype(int)).mean()
            check(diff < 6, f"camera export matches preview (diff {diff:.2f})")

    print("10. 3D export (orbiting camera, depth test, pinned title) vs preview")
    title = clip("text", "ti", "a", enter={"type": "none"}, exit={"type": "none"}, fixed=True,
                 transform={"x": 0, "y": 3.2, "z": 0, "scale": 1, "rotation": 0, "opacity": 1})
    surf = clip("surface_plot", "sf", "b", enter={"type": "none"}, exit={"type": "none"}, duration=3)
    ball = clip("sphere", "sb", "b", start=0, duration=3, enter={"type": "none"}, exit={"type": "none"},
                params={**library.default_params("sphere"), "radius": 0.5, "fill": "#FFAA00"},
                transform={"x": 1, "y": 1, "z": 1.5, "scale": 1, "rotation": 0, "opacity": 1})
    surf["track"] = "b"; ball["track"] = "a"; ball["id"] = "sb"
    p3 = project(title, surf, duration=2)
    p3["clips"].append({**ball, "track": "b", "start": 0, "duration": 2})
    p3["clips"][1]["duration"] = 2
    p3["settings"]["fps"] = 10
    p3["settings"]["camera"] = [{"t": 0, "x": 0, "y": 0, "zoom": 1, "theta": -40, "phi": 65},
                                {"t": 2, "x": 0, "y": 0, "z": 0.5, "zoom": 1.2, "theta": 30, "phi": 75, "ease": "linear"}]
    out = os.path.join(TMP, "orbit.mp4")
    job = server.start_export({"project": p3, "out": out, "resolution": [640, 360], "fps": 10})
    t0 = time.time()
    while server.EXPORTS[job]["status"] == "running" and time.time() - t0 < 180:
        time.sleep(0.3)
    st = server.EXPORTS[job]
    check(st["status"] == "done", f"3D export failed: {st['status']} {st['log'][-1500:]}")
    if st["status"] == "done":
        for fi in (0, 9, 18):
            raw = subprocess.run(["ffmpeg", "-v", "error", "-i", out, "-vf", f"select=eq(n\\,{fi})", "-vframes", "1",
                                  "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
            vid = np.frombuffer(raw, dtype=np.uint8).reshape(360, 640, 3).astype(int)
            arr, _ = frame(p3, fi / 10, 640, 360)
            diff = np.abs(vid - arr[:, :, :3].astype(int)).mean()
            print(f"   frame {fi}: mean abs diff preview vs export = {diff:.2f}")
            check(diff < 6, f"3D export frame {fi} differs from preview (diff {diff:.2f})")
            from PIL import Image
            Image.fromarray(np.concatenate([vid, arr[:, :, :3].astype(int)], axis=1).astype(np.uint8)).save(os.path.join(TMP, f"orbit-{fi}.png"))
        print("   side-by-side frames:", TMP)

print()
if DO_EXPORT:
    print("G2. export of a project with globals matches the preview")
    gp["settings"]["fps"] = 10
    gp["settings"]["duration"] = 2
    out = os.path.join(TMP, "globals.mp4")
    job = server.start_export({"project": gp, "out": out, "resolution": [640, 360], "fps": 10})
    t0 = time.time()
    while server.EXPORTS[job]["status"] == "running" and time.time() - t0 < 180:
        time.sleep(0.5)
    st = server.EXPORTS[job]
    check(st["status"] == "done", f"globals export failed: {st['status']}\n{st['log'][-2000:]}")
    if st["status"] == "done":
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", out, "-vf", "select=eq(n\\,10)", "-vframes", "1",
                              "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
        vid = np.frombuffer(raw, dtype=np.uint8).reshape(360, 640, 3).astype(int)
        arr, _ = frame(gp, 1.0, 640, 360)
        diff = np.abs(vid - arr[:, :, :3].astype(int)).mean()
        print(f"   globals frame: mean abs diff preview vs export = {diff:.2f}")
        check(diff < 6, f"globals export differs from preview (diff {diff:.2f})")

if DO_EXPORT:
    print("P2. export of a project with group part timing matches the preview")
    pp = project(code_clip(GROUPS["Tex"], parts={str(i): {"at": 0.4 * i, "enter": {"type": "FadeInUp", "duration": 0.4}} for i in range(3)}), duration=2)
    pp["settings"]["fps"] = 10
    out = os.path.join(TMP, "parts.mp4")
    job = server.start_export({"project": pp, "out": out, "resolution": [640, 360], "fps": 10})
    t0 = time.time()
    while server.EXPORTS[job]["status"] == "running" and time.time() - t0 < 180:
        time.sleep(0.5)
    st = server.EXPORTS[job]
    check(st["status"] == "done", f"parts export failed: {st['status']}\n{st['log'][-2000:]}")
    if st["status"] == "done":
        for fi in (3, 6, 15):
            raw = subprocess.run(["ffmpeg", "-v", "error", "-i", out, "-vf", f"select=eq(n\\,{fi})", "-vframes", "1",
                                  "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
            vid = np.frombuffer(raw, dtype=np.uint8).reshape(360, 640, 3).astype(int)
            arr, _ = frame(pp, fi / 10, 640, 360)
            diff = np.abs(vid - arr[:, :, :3].astype(int)).mean()
            print(f"   parts frame {fi}: mean abs diff preview vs export = {diff:.2f}")
            check(diff < 6, f"parts export frame {fi} differs from preview (diff {diff:.2f})")

print("FAILURES:", len(FAILS))
for f in FAILS[:80]:
    print(" -", f)
sys.exit(1 if FAILS else 0)
