"""
Mobjects made from projects ("My mobjects").   engine/.venv/bin/python engine/tests/test_project_mobject.py

Builds a library item from a project (animated + still), places it in another project and checks
the preview matches the source project, the exported scene runs, nesting works, and the Free
plan forces every mobject to be public.
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, ENGINE)
TMP = tempfile.mkdtemp(prefix="mstest-pm-")
sys.argv = [sys.argv[0], "--data", TMP]
os.environ.pop("MATHSTUDIO_PLAN", None)

import numpy as np  # noqa: E402
import server  # noqa: E402
import library  # noqa: E402
import codegen  # noqa: E402

R = server.Renderer()
U = library.user
FAILS = []
BG = np.array([0x1e, 0x1e, 0x1e])


def check(cond, msg):
    print("  ✓" if cond else "  ✗", msg)
    if not cond:
        FAILS.append(msg)


def clip(item, cid, start=0.0, duration=4.0, track="a", **kw):
    d = {"id": cid, "item": item, "name": f"{item} {cid}", "track": track, "start": start, "duration": duration,
         "params": library.default_params(item), "transform": {"x": 0, "y": 0, "scale": 1, "rotation": 0, "opacity": 1},
         "enter": {"type": "none"}, "exit": {"type": "none"}, "keys": [], "effects": []}
    d.update(kw)
    return d


def proj(name, clips, duration=4.0, globals_=None):
    return {"version": 1, "settings": {"name": name, "background": "#1e1e1e", "duration": duration},
            "tracks": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}], "clips": clips, "globals": globals_ or []}


def frame(p, t, state="test"):
    data, meta = R.frame(p, t, 480, 270, None, state)
    return np.frombuffer(data, dtype=np.uint8).reshape(meta["h"], meta["w"], 4)[:, :, :3].astype(int), meta


def ink(a):
    return float((np.abs(a - BG).sum(axis=2) > 30).mean())


# a dot that moves from left to right, a circle whose colour is a project global, and a text label
src = proj("Moving dot", [
    clip("dot", "d1", keys=[{"id": "k1", "t": 0, "x": -4, "y": 0, "scale": 1, "rotation": 0, "opacity": 1},
                            {"id": "k2", "t": 4, "x": 4, "y": 0, "scale": 1, "rotation": 0, "opacity": 1, "ease": "linear"}],
         transform={"x": -4, "y": 0, "scale": 1, "rotation": 0, "opacity": 1}),
    clip("circle", "c1", track="b", params={**library.default_params("circle"), "stroke": {"$g": "RING"}},
         transform={"x": 0, "y": 1.5, "scale": 1, "rotation": 0, "opacity": 1}),
    clip("text", "t1", start=1.0, duration=3.0, params={**library.default_params("text"), "text": "inside"},
         transform={"x": 0, "y": -2, "scale": 1, "rotation": 0, "opacity": 1}),
], globals_=[{"id": "g1", "name": "RING", "type": "color", "value": "#FF0000"}])

print("▸ animated mobject from a project")
check(U.plan() == "free", "default plan is free")
item = U.build(src, "Moving dot", visibility="private", mode="animated", source_path="/tmp/Moving dot.mstudio")
library.sync_user()
check(item["id"] in library.BY_ID and item["category"] == "My mobjects", f"registered as {item['id']}")
check(item["visibility"] == "public", "free plan: asked for private, got public")
check(item["dynamic"] and [p["id"] for p in item["params"]] == ["speed", "loop", "start_at"], "dynamic, params speed/loop/start_at")
x0, y0, x1, y1 = item["bbox"]
check(x0 < -4 and x1 > 4 and y1 > 2 and y0 < -2, f"bbox covers the whole motion ({x0:.2f},{y0:.2f})–({x1:.2f},{y1:.2f})")
check("RING = '#FF0000'" in item["prelude"] and "\nRING" not in item["prelude"], "globals are locals of the builder (no top-level clash)")
check(any(it["id"] == item["id"] for it in library.public_items()), "listed in /library")

print("▸ the mobject in another project replays the source")
# the mobject is centred on what it draws: placed at the centre of its box it lines up with the source
CX, CY = (x0 + x1) / 2, (y0 + y1) / 2
AT = {"x": CX, "y": CY, "scale": 1, "rotation": 0, "opacity": 1}
host = proj("Host", [clip(item["id"], "h1", duration=6.0, transform=AT)], duration=6.0)
host["clips"][0]["params"] = library.default_params(item["id"])
for t in (0.5, 2.0, 3.5):
    a, _ = frame(src, t, "src")
    b, meta = frame(host, t, "host")
    diff = float((np.abs(a - b).sum(axis=2) > 60).mean())
    if t == 2.0:
        from PIL import Image
        os.makedirs(os.path.join(ENGINE, "..", "tests", "out"), exist_ok=True)
        Image.fromarray(np.hstack([a, b]).astype(np.uint8)).save(os.path.join(ENGINE, "..", "tests", "out", "pm-engine-compare.png"))
    check(ink(b) > 0.003 and diff < 0.004, f"t={t}: host frame matches the source (ink {ink(b):.4f}, diff {diff:.4f})")
check(not meta["errors"], f"no clip errors {meta['errors']}")
info = meta["clips"]["h1"]
check(info.get("full") and info["w"] < info["full"][0], f"hit box is the drawn content, not the padded box ({info['w']:.2f} < {info['full'][0]:.2f})")
a, _ = frame(host, 5.5, "host")
b, _ = frame(src, 3.999, "src")
check(float((np.abs(a - b).sum(axis=2) > 60).mean()) < 0.004, "after the end it holds the last frame")
host["clips"][0]["params"] = {**library.default_params(item["id"]), "loop": True}
a, _ = frame(host, 4.5, "host")
b, _ = frame(src, 0.5, "src")
check(float((np.abs(a - b).sum(axis=2) > 60).mean()) < 0.004, "loop starts over")
host["clips"][0]["params"] = {**library.default_params(item["id"]), "speed": 2.0}
a, _ = frame(host, 1.0, "host")
b, _ = frame(src, 2.0, "src")
check(float((np.abs(a - b).sum(axis=2) > 60).mean()) < 0.004, "speed 2 plays twice as fast")
host["clips"][0]["params"] = library.default_params(item["id"])
host["clips"][0]["transform"] = {"x": 2, "y": 1, "scale": 0.4, "rotation": 0, "opacity": 1}
_, meta = frame(host, 2.0, "host")
bb = meta["clips"]["h1"]["bbox"]
check(bb and bb[2] - bb[0] < 4.0, f"scaled down like any mobject (width {bb[2] - bb[0]:.2f})")

print("▸ export")
code = codegen.generate_script(host)
check(item["fn"] in code and "def _" + item["fn"] + "_timeline" in code, "scene.py carries the definition")
ns = {}
exec(compile(code, "scene.py", "exec"), ns)
check("MainScene" in ns, "scene.py runs")
fn = ns[item["fn"]]
m = fn(t=2.0)
check(len(m.submobjects) >= 4, f"definition builds standalone ({len(m.submobjects)} parts)")
out = os.path.join(TMP, "export")
server.write_export_dir(host, out)
check(os.path.exists(os.path.join(out, "studio_runtime.py")), "export dir written")

print("▸ still mobject")
still = U.build(src, "Dot still", mode="still", at=2.0)
library.sync_user()
check(not still["dynamic"] and still["bbox"] is None and still["params"][0]["default"] == 2.0, "still: static, frame-at param")
h2 = proj("Host2", [clip(still["id"], "s1")])
_, meta = frame(h2, 1.0, "host2")
ci = meta["clips"]["s1"]
check(not meta["errors"] and ci["w"] >= 2 and ci["h"] > 3.5, f"still renders ({ci['w']:.2f} × {ci['h']:.2f})")

print("▸ nesting: a project that uses a project mobject")
nested_src = proj("Two dots", [clip(item["id"], "n1", params=library.default_params(item["id"]),
                                    transform={"x": 0, "y": 1.5, "scale": 0.5, "rotation": 0, "opacity": 1}),
                               clip("square", "n2", track="b", transform={"x": 0, "y": -2, "scale": 1, "rotation": 0, "opacity": 1})])
nested = U.build(nested_src, "Two dots")
library.sync_user()
h3 = proj("Host3", [clip(nested["id"], "x1", params=library.default_params(nested["id"]))])
a, meta = frame(h3, 2.0, "host3")
check(not meta["errors"] and ink(a) > 0.003, f"nested mobject renders {meta['errors']}")
ns = {}
exec(compile(codegen.generate_script(h3), "scene.py", "exec"), ns)
check(nested["fn"] in ns and item["fn"] in ns, "nested export defines both")

print("▸ update / replace")
again = U.build(src, "Moving dot v2", replace=item["id"])
library.sync_user()
check(again["id"] == item["id"] and again["fn"] != item["fn"] and again["created"] == item["created"], "replacing keeps id, new definition")
try:
    U.build(nested_src, "Two dots", replace=item["id"])
    check(False, "replacing a mobject with a project that uses it is refused")
except ValueError as e:
    check("itself" in str(e), f"self-use refused: {e}")
try:
    U.build(proj("Empty", []), "Empty")
    check(False, "empty project refused")
except ValueError as e:
    check("no visible clips" in str(e), "empty project refused")
bad = proj("Bad", [clip("custom", "b1", code="raise RuntimeError('boom')\nreturn Circle()")])
try:
    U.build(bad, "Bad")
    check(False, "broken project refused")
except ValueError as e:
    check("boom" in str(e), f"broken project error is readable: {e}")

print("▸ visibility & plan")
try:
    U.update_meta(item["id"], visibility="private")
    check(False, "free plan can't make a mobject private")
except ValueError as e:
    check("Pro" in str(e), "free plan: private refused")
os.environ["MATHSTUDIO_PLAN"] = "pro"
p = U.build(src, "Private dot", visibility="private")
check(p["visibility"] == "private", "pro plan: private kept")
check(U.update_meta(p["id"], visibility="public")["visibility"] == "public", "pro plan: can switch back to public")
os.environ.pop("MATHSTUDIO_PLAN")
check(U.update_meta(p["id"], name="Renamed")["name"] == "Renamed", "rename")

print("▸ persistence + thumbnails")
n = len(U.ITEMS)
U.load(TMP)
library.sync_user()
check(len(U.ITEMS) == n and item["id"] in library.BY_ID, f"{n} mobjects reload from disk")
res = server.make_thumb(R, item["id"])
check(res and os.path.getsize(res[0]) > 1000, "thumbnail renders")
k1 = server.thumb_paths(item["id"])
U.update_meta(item["id"], name="Another name")
library.sync_user()
check(server.thumb_paths(item["id"]) == k1, "renaming keeps the cached thumbnail")
check(U.delete(p["id"]) and p["id"] not in [i["id"] for i in U.ITEMS], "delete")
library.sync_user()
check(p["id"] not in library.BY_ID, "deleted mobject unregistered")

print()
print("FAILED:" if FAILS else "all project-mobject checks passed", *FAILS, sep="\n  ")
sys.exit(1 if FAILS else 0)
