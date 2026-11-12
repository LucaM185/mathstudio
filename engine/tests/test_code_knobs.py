"""
No-code knobs read from custom clip code.   engine/.venv/bin/python -W ignore engine/tests/test_code_knobs.py

1. A clip written by the agent (binary sum, `fs = 110`, no font): finds Text / Font / Font size /
   colours / stroke / constants with the right values and contexts.
2. Applying knobs (the same way src/knobs.ts does) gives valid code that re-reads with the new
   value; inserting a font into calls that had none works; renders with the new font and size.
3. Fuzz: every library template + gallery class call, every knob rewritten -> still parses, the
   knob re-reads with the value written.
4. Edge cases: syntax errors, bare expressions without return, non-ASCII before a span (JS
   UTF-16 indices), globals (linked knobs), **kwargs calls (no insertion).
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, ENGINE)
TMP = tempfile.mkdtemp(prefix="mstest-knobs-")
sys.argv = [sys.argv[0], "--data", TMP]

import ast  # noqa: E402
import server  # noqa: E402  (parses --data, then lets manimlib import)
import code_knobs as K  # noqa: E402

FAILS = []


def check(cond, msg):
    print("  ✓" if cond else "  ✗", msg)
    if not cond:
        FAILS.append(msg)


def u16(s):
    return s.encode("utf-16-le")


def lit(kind, v, q='"'):
    if kind in ("number", "font_size"):
        return str(int(v)) if float(v).is_integer() and kind == "font_size" or isinstance(v, int) else repr(float(v))
    if kind == "bool":
        return "True" if v else "False"
    s = str(v).replace("\\", "\\\\").replace(q, "\\" + q).replace("\n", "\\n")
    return q + s + q


def apply(code, edits, text_for):
    """Same as src/knobs.ts applyEdits: replace spans from the end so earlier indices stay valid."""
    b = u16(code)
    for e in sorted(edits, key=lambda e: (e["s"], e["e"]), reverse=True):
        new = e["pre"] + text_for(e) + e["suf"]
        b = b[: e["s"] * 2] + u16(new) + b[e["e"] * 2:]
    return b.decode("utf-16-le")


def set_knob(code, k, v, edits=None):
    return apply(code, edits or k["edits"], lambda e: lit(k["kind"], v, e.get("q") or '"'))


def find(knobs, kind, **kw):
    for k in knobs:
        if k["kind"] == kind and all(k.get(a) == b for a, b in kw.items()):
            return k
    return None


SUM = r'''import random
sp = 0.6
fs = 110
rng = random.Random(7)
def row(M, y, color):
    out = []
    for i in range(4):
        m = Text(M[i], font_size=fs).set_color(color).move_to([sp * i, y, 0])
        out.append(m)
    return out
plus = Text('+', font_size=fs).set_color('#58C4DD').move_to([2, -0.1, 0])
line = Line([-1, -0.9, 0], [1, -0.9, 0], stroke_width=6, color='#BBBBBB')
ovf = Text(str(1), font_size=fs).set_color('#FC6255').move_to([-2, 2.9, 0])
items = [plus, line, ovf] + row('1010', 1.5, '#FFFFFF') + row('0110', -0.1, '#FFFFFF') + row('0000', -2.3, GREEN)
return VGroup(*items)
'''

print("1. agent-written clip")
r = K.analyze(SUM)
check(r["error"] is None, f"analyzes ({r['error']})")
ks = r["knobs"]
text = find(ks, "string")
check(text and text["value"] == "+" and text["where"] == "plus", "Text '+' of plus")
font = find(ks, "font")
check(font and font["default"] and font["value"] == "" and len(font["edits"]) == 3, "one Font knob, default, 3 insertions")
check(font and font["where"] == "row, plus, ovf", f"font used by plus, ovf, row ({font and font['where']})")
size = find(ks, "font_size")
check(size and size["value"] == 110 and size.get("name") == "fs" and len(size["edits"]) == 1, "Font size = fs = 110, one edit")
check(size and any(o["ctx"] == "ovf" and o.get("own") for o in size["occ"]), "ovf has its own font_size edit (to restyle one part)")
cols = {k["value"]: k for k in ks if k["kind"] == "color"}
check(set(cols) == {"#58C4DD", "#BBBBBB", "#FC6255", "#FFFFFF", "#83C167"}, f"palette {sorted(cols)}")
check(cols.get("#FFFFFF", {}).get("where") == "row(“1010”), row(“0110”)", f"white used by both rows ({cols.get('#FFFFFF', {}).get('where')})")
check(cols.get("#83C167", {}).get("where") == "row(“0000”)", "GREEN constant read as #83C167, used by row(“0000”)")
check(find(ks, "number", label="Stroke width") and find(ks, "number", label="Stroke width")["value"] == 6, "stroke width 6")
sp = find(ks, "number", label="sp")
check(sp and sp["value"] == 0.6, "constant sp = 0.6")
check(not find(ks, "number", label="fs"), "fs is not listed twice (it is the font size)")
check(not find(ks, "number", label="rng"), "computed values are not knobs")

print("2. applying knobs")
code = set_knob(SUM, font, "Georgia")
check("Text('+', font_size=fs, font=\"Georgia\")" in code, "font inserted after the last argument")
r2 = K.analyze(code)
f2 = find(r2["knobs"], "font")
check(f2 and f2["value"] == "Georgia" and not f2["default"], "re-reads Georgia")
code = set_knob(code, find(r2["knobs"], "font_size"), 64)
check("fs = 64" in code, "font size rewrites the constant")
code = set_knob(code, find(K.analyze(code)["knobs"], "color", value="#FC6255"), "#123456")
check("set_color('#123456')" in code, "colour keeps the quote style")
k_white = find(K.analyze(code)["knobs"], "color", value="#FFFFFF")
code = set_knob(code, k_white, "#ABCDEF")
check(code.count("'#ABCDEF'") == 2, "palette colour changes both rows")
k_g = find(K.analyze(code)["knobs"], "color", value="#83C167")
code = set_knob(code, k_g, "#00FF00")
check('"#00FF00")' in code and "GREEN" not in code, "colour constant replaced by a hex string")
# one part only: ovf's size detaches from fs
s3 = find(K.analyze(code)["knobs"], "font_size")
ovf = next(o for o in s3["occ"] if o["ctx"] == "ovf")
code = set_knob(code, s3, 30, ovf["own"])
check("Text(str(1), font_size=30" in code and "fs = 64" in code, "part-level size rewrites only ovf's argument")
sizes = [k for k in K.analyze(code)["knobs"] if k["kind"] == "font_size"]
check(sorted(k["value"] for k in sizes) == [30, 64], "now two size knobs: 64 (shared) and 30 (ovf)")
w = find(K.analyze(code)["knobs"], "weight")
code = set_knob(code, w, "BOLD")
check(code.count('weight="BOLD"') == 3 and find(K.analyze(code)["knobs"], "weight")["value"] == "BOLD", "weight BOLD on all three")
ast.parse("def f():\n" + "\n".join("    " + l for l in code.splitlines()))

# render it
R = server.Renderer()


def proj(c):
    return {"version": 1, "settings": {"name": "k", "duration": 2, "fps": 30, "background": "#1e1e1e", "resolution": [1280, 720]},
            "tracks": [{"id": "a", "name": "a"}], "assets": [], "globals": [],
            "clips": [{"id": "c1", "item": "custom", "name": "sum", "track": "a", "start": 0, "duration": 2, "params": {},
                       "code": c, "dynamic": False, "transform": {"x": 0, "y": 0, "z": 0, "scale": 1, "rotation": 0, "opacity": 1},
                       "enter": {"type": "none"}, "exit": {"type": "none"}, "keys": [], "effects": []}]}


_, m0 = R.frame(proj(SUM), 1, 640, 360)
_, m1 = R.frame(proj(code), 1, 640, 360)
check(not m0["errors"] and not m1["errors"], f"both render ({m1['errors']})")
check(m1["clips"]["c1"]["h"] < m0["clips"]["c1"]["h"] - 0.3, f"smaller font -> smaller clip ({m0['clips']['c1']['h']:.2f} -> {m1['clips']['c1']['h']:.2f})")

print("3. fuzz over library code")
import library  # noqa: E402
import codegen  # noqa: E402

n_items = n_knobs = 0
bad = []
for it in library.ITEMS:
    if it.get("hidden"):
        continue
    try:
        body = codegen.clip_body({"item": it["id"], "params": library.default_params(it["id"])})
    except Exception:  # noqa: BLE001
        continue
    res = K.analyze(body)
    if res["error"]:
        bad.append((it["id"], res["error"]))
        continue
    n_items += 1
    for k in res["knobs"]:
        n_knobs += 1
        v = {"number": 1.25, "font_size": 33, "color": "#13579B", "font": "Menlo", "weight": "BOLD", "slant": "ITALIC",
             "string": "fuzz’é", "latex": r"x^2", "bool": False}[k["kind"]]
        new = set_knob(body, k, v)
        r = K.analyze(new)
        if r["error"]:
            bad.append((it["id"], k["id"], r["error"]))
            continue
        same = [x for x in r["knobs"] if x["kind"] == k["kind"] and (x["value"] == v or (k["kind"] == "number" and x["value"] == 1.25))]
        if not same:
            bad.append((it["id"], k["id"], "value not re-read"))
check(n_items > 40 and n_knobs > 100, f"{n_items} items, {n_knobs} knobs rewritten")
check(not bad, f"all rewrites valid {bad[:5]}")

print("4. edge cases")
r = K.analyze("x = Text('a'\nreturn x")
check(r["error"] and r["knobs"] == [], f"syntax error reported ({r['error']})")
r = K.analyze("Circle(radius=1.5, color=BLUE)")
check(find(r["knobs"], "number", label="Radius") and find(r["knobs"], "color", value="#58C4DD"), "bare expression (no return) works")
uni = "# “ünïcode” ✓ 𝛑\nt1 = Text('é𝛑', font_size=30)\nreturn t1"
r = K.analyze(uni)
k = find(r["knobs"], "font_size")
check(k and set_knob(uni, k, 31).endswith("font_size=31)\nreturn t1"), "spans are UTF-16 indices (non-BMP char before)")
kt = find(r["knobs"], "string")
check(kt and kt["value"] == "é𝛑" and "Text('ok'" in set_knob(uni, kt, "ok", None).replace('"ok"', "'ok'"), "text after non-BMP")
G = [{"name": "FONT_SIZE", "type": "number", "value": 42}, {"name": "ACCENT", "type": "color", "value": "#FF0000"}, {"name": "FONT", "type": "font", "value": "Futura"}]
r = K.analyze("a = Text('x', font_size=FONT_SIZE, font=FONT).set_color(ACCENT)\nreturn a", G)
ks = r["knobs"]
check(find(ks, "font_size") and find(ks, "font_size")["linked"] == "FONT_SIZE" and find(ks, "font_size")["value"] == 42, "size linked to FONT_SIZE")
check(find(ks, "font") and find(ks, "font")["linked"] == "FONT" and find(ks, "font")["value"] == "Futura", "font linked to FONT")
check(find(ks, "color") and find(ks, "color")["linked"] == "ACCENT", "colour linked to ACCENT")
r = K.analyze("st = dict(font='Menlo')\nreturn Text('x', **st)")
check(not find(r["knobs"], "font", default=True), "no insertion into **kwargs calls")
r = K.analyze("v = 3\nreturn Square(side_length=v * 2, stroke_width=4)")
check(find(r["knobs"], "number", label="Side length") and find(r["knobs"], "number", label="Side length")["value"] == 3, "v * 2 -> knob on v")
r = K.analyze("return Text('a',\n    font_size=40,\n)")
c = set_knob("return Text('a',\n    font_size=40,\n)", find(r["knobs"], "font"), "Futura")
check(c == "return Text('a',\n    font_size=40, font=\"Futura\",\n)", "multi-line call with trailing comma")

print()
if FAILS:
    print(f"FAILED {len(FAILS)}:")
    for f in FAILS:
        print("  -", f)
    sys.exit(1)
print("all code-knob checks passed")
