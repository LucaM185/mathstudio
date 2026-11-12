"""No-code knobs for clips with custom code.

The Inspector can't show template params for a clip whose code was rewritten (by the user or the AI
agent), so this module reads the code and finds the standard things people want to tune without
code — text content, font, font size, weight, colours, stroke widths, opacities and the simple
constants at the top of the code (``sp = 0.6``).

Each knob carries *edits*: character spans in the clip's code (JavaScript string indices, i.e. UTF-16
code units) plus the text to put around the new literal.  The client rewrites the code itself (so
dragging a number is instant) and shifts the remaining spans; nothing here runs the code.

    analyze(code, globals) -> {"knobs": [...], "error": str | None}

Knob:
    id        stable within one analysis ("font_size:0", "color:#FFFFFF"...)
    group     "text" | "color" | "shape" | "value"
    kind      "text" | "font" | "font_size" | "weight" | "slant" | "color" | "number" | "bool" | "string"
    label     what the field is called
    value     current value (resolved through linked globals)
    linked    the project global the spots read, if they all read the same one
    default   True when the value is ManimGL's default (the argument is not written yet)
    where     short list of what uses it ("plus, ovf, row ×3")
    occ       [{ctx, edits}] one per use: ctx = variable / function / string the use belongs to,
              so the Parts section can restyle a single part
    edits     every edit of every occurrence (span s..e replaced by pre + literal + suf)
"""
from __future__ import annotations

import ast
import re
from collections import OrderedDict

HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$")

# classes whose look is set by font / font_size / weight... (ManimGL 1.7.2)
FONT_CLASSES = {"Text", "MarkupText", "Code"}  # take font=, weight=, slant=
SIZED_CLASSES = FONT_CLASSES | {"Tex", "TexText", "OldTex", "OldTexText", "MTex", "MTexText", "Title",
                                "Integer", "DecimalNumber", "BulletedList"}
CONTENT_CLASSES = {"Text": "text", "MarkupText": "text", "Tex": "latex", "TexText": "latex", "OldTex": "latex",
                   "OldTexText": "latex", "MTex": "latex", "MTexText": "latex", "Title": "text"}
DEFAULT_FONT_SIZE = 48
WEIGHTS = ["THIN", "ULTRALIGHT", "LIGHT", "BOOK", "NORMAL", "MEDIUM", "SEMIBOLD", "BOLD", "ULTRABOLD", "HEAVY"]
SLANTS = ["NORMAL", "ITALIC", "OBLIQUE"]

COLOR_KWARGS = {"color", "fill_color", "stroke_color", "background_color", "backstroke_color"}
COLOR_METHODS = {"set_color", "set_fill", "set_stroke", "set_backstroke", "set_color_by_gradient"}
SHAPE_KWARGS = OrderedDict([
    ("stroke_width", ("Stroke width", 0, None, 0.5)),
    ("fill_opacity", ("Fill opacity", 0, 1, 0.05)),
    ("stroke_opacity", ("Stroke opacity", 0, 1, 0.05)),
    ("opacity", ("Opacity", 0, 1, 0.05)),
    ("radius", ("Radius", 0, None, 0.05)),
    ("side_length", ("Side length", 0, None, 0.05)),
    ("buff", ("Spacing (buff)", None, None, 0.05)),
])

_COLORS: dict | None = None


def manim_colors() -> dict:
    """{"BLUE": "#58C4DD", ...} from ManimGL's constants (computed once)."""
    global _COLORS
    if _COLORS is None:
        _COLORS = {}
        try:
            import manimlib.constants as C
            for k, v in vars(C).items():
                if k.isupper() and isinstance(v, str) and HEX_RE.match(v):
                    _COLORS[k] = norm_hex(v)
        except Exception:  # noqa: BLE001
            pass
    return _COLORS


def norm_hex(s: str) -> str:
    s = s.upper()
    if len(s) == 4:
        s = "#" + "".join(ch * 2 for ch in s[1:])
    return s


class _Src:
    """Maps ast (line, utf-8 byte col) positions of the wrapped code back to JS indices in the original."""

    def __init__(self, code: str):
        self.code = code
        lines = code.split("\n")
        body_lines = list(lines)
        self.prefix = [0] * len(lines)
        # same wrapping as codegen.factory_source: a bare expression gets "return " in front
        stripped = code.rstrip()
        if "return" not in stripped and stripped:
            last = len(stripped.split("\n")) - 1
            body_lines[last] = "return " + body_lines[last]
            self.prefix[last] = 7
        wrapped = []
        for i, ln in enumerate(body_lines):
            if ln.strip():
                wrapped.append("    " + ln)
                self.prefix[i] += 4
            else:
                wrapped.append("")
        self.wrapped = "def _clip(t=0.0, a=0.0):\n" + "\n".join(wrapped) + "\n"
        self.lines = lines
        self.wlines = wrapped
        # JS index of each original line's start
        self.starts = []
        pos = 0
        for ln in lines:
            self.starts.append(pos)
            pos += _js_len(ln) + 1

    def idx(self, lineno: int, col: int) -> int:
        i = lineno - 2  # line 1 is the def
        if i < 0:
            return 0
        wl = self.wlines[i] if i < len(self.wlines) else ""
        chars = len(wl.encode("utf-8")[:col].decode("utf-8", "ignore"))
        chars = max(0, chars - self.prefix[i])
        orig = self.lines[i] if i < len(self.lines) else ""
        return self.starts[i] + _js_len(orig[:chars])

    def span(self, node) -> tuple[int, int]:
        return self.idx(node.lineno, node.col_offset), self.idx(node.end_lineno, node.end_col_offset)

    def end(self, node) -> int:
        return self.idx(node.end_lineno, node.end_col_offset)

    def text(self, s: int, e: int) -> str:
        return _js_slice(self.code, s, e)


def _js_len(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def _js_slice(s: str, a: int, b: int) -> str:
    u = s.encode("utf-16-le")
    return u[a * 2:b * 2].decode("utf-16-le", "ignore")


def _call_name(node: ast.Call) -> str | None:
    f = node.func
    if isinstance(f, ast.Name):
        return f.id
    if isinstance(f, ast.Attribute):
        return f.attr
    return None


def _num(node):
    """Number literal (with an optional unary minus) -> value, else None."""
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
        v = _num(node.operand)
        if v is not None:
            return -v if isinstance(node.op, ast.USub) else v
    return None


def _str(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


class _Analyzer:
    def __init__(self, code: str, globals_: list):
        self.src = _Src(code)
        self.tree = ast.parse(self.src.wrapped)
        self.fn = self.tree.body[0]
        self.colors = manim_colors()
        self.globals = {g.get("name"): g for g in globals_ or [] if g.get("name")}
        self.parents: dict = {}
        for node in ast.walk(self.tree):
            for ch in ast.iter_child_nodes(node):
                self.parents[ch] = node
        # names assigned anywhere (anything assigned is not a global / colour constant)
        self.stores: dict = {}
        for node in ast.walk(self.fn):
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
                self.stores[node.id] = self.stores.get(node.id, 0) + 1
            elif isinstance(node, ast.arg):
                self.stores[node.arg] = self.stores.get(node.arg, 0) + 1
            elif isinstance(node, (ast.FunctionDef, ast.Lambda)) and node is not self.fn:
                for a in node.args.args + node.args.kwonlyargs:
                    self.stores[a.arg] = self.stores.get(a.arg, 0) + 1
        # top-level constants: NAME = literal, assigned exactly once
        self.consts: dict = {}
        for st in self.fn.body:
            if isinstance(st, ast.Assign) and len(st.targets) == 1 and isinstance(st.targets[0], ast.Name):
                name = st.targets[0].id
                if self.stores.get(name) != 1:
                    continue
                v = st.value
                if _num(v) is not None or (isinstance(v, ast.Constant) and isinstance(v.value, (bool, str))) \
                        or (isinstance(v, ast.Name) and v.id in self.globals and v.id not in self.stores):
                    self.consts[name] = st
        self.user_fns = {n.name for n in ast.walk(self.fn) if isinstance(n, ast.FunctionDef) and n is not self.fn}
        self.used_consts: set = set()  # constants shown inside another knob (font size, colours...)

    # ------------------------------------------------------------------ helpers
    def is_global(self, node) -> bool:
        return isinstance(node, ast.Name) and node.id in self.globals and node.id not in self.stores

    def ctx(self, node) -> str:
        """What a use belongs to: the variable it is assigned to (top level), the helper function it is
        in or is passed to (``row``), else the string it draws."""
        cur = node
        assigned = None
        while cur in self.parents:
            par = self.parents[cur]
            if isinstance(par, ast.Call) and isinstance(par.func, ast.Name) and par.func.id in self.user_fns and cur is not par.func:
                # row(MA, 1.5, WHITE) -> "row(MA)": tells the calls of one helper apart
                first = par.args[0] if par.args else None
                if isinstance(first, ast.Name) and first is not cur:
                    return f"{par.func.id}({first.id})"
                if _str(first) is not None and first is not cur and len(first.value) <= 8:
                    return f"{par.func.id}(\u201c{first.value}\u201d)"
                return par.func.id
            if assigned is None and isinstance(par, ast.Assign) and len(par.targets) == 1 and isinstance(par.targets[0], ast.Name):
                assigned = par.targets[0].id
            if isinstance(par, (ast.FunctionDef, ast.Lambda)) and par is not self.fn:
                return getattr(par, "name", None) or assigned or "lambda"
            if par is self.fn:
                break
            cur = par
        if assigned:
            return assigned
        call = node if isinstance(node, ast.Call) else self.parents.get(node)
        if isinstance(call, ast.Call) and call.args and _str(call.args[0]) is not None:
            s = _str(call.args[0])
            return "\u201c%s\u201d" % (s if len(s) <= 12 else s[:11] + "\u2026")
        return ""

    def const_target(self, node):
        """The literal node a value comes from: itself, or the top-level constant it names."""
        if _num(node) is not None or _str(node) is not None or self.is_global(node):
            return node
        if isinstance(node, ast.Constant) and isinstance(node.value, bool):
            return node
        if isinstance(node, ast.Name) and node.id in self.consts:
            self.used_consts.add(node.id)
            return self.consts[node.id].value
        # fs * 0.8 -> fs, if it's the only constant in there
        names = [n for n in ast.walk(node) if isinstance(n, ast.Name) and n.id in self.consts]
        if len({n.id for n in names}) == 1 and isinstance(node, ast.BinOp):
            self.used_consts.add(names[0].id)
            return self.consts[names[0].id].value
        return None

    def literal_edit(self, node) -> dict:
        s, e = self.src.span(node)
        q = '"'
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            raw = self.src.text(s, e).lstrip("rbuRBU")
            q = raw[:1] if raw[:1] in "'\"" else '"'
        return {"s": s, "e": e, "pre": "", "suf": "", "q": q}

    def insert_edit(self, call: ast.Call, kw: str) -> dict | None:
        if any(k.arg is None for k in call.keywords):
            return None  # **style might already set it
        last = None
        for n in list(call.args) + list(call.keywords):
            if last is None or (n.end_lineno, n.end_col_offset) > (last.end_lineno, last.end_col_offset):
                last = n
        if last is None:
            pos = self.src.end(call) - 1
            pre = f"{kw}="
        else:
            pos = self.src.end(last)
            pre = f", {kw}="
        return {"s": pos, "e": pos, "pre": pre, "suf": "", "q": '"'}

    def value_of(self, node):
        if node is None:
            return None
        if self.is_global(node):
            return self.globals[node.id].get("value")
        v = _num(node)
        if v is not None:
            return v
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name) and node.id in self.colors:
            return self.colors[node.id]
        if isinstance(node, ast.Name) and node.id in ("BOLD", "NORMAL", "ITALIC", "OBLIQUE"):
            return node.id
        return None

    # ------------------------------------------------------------------ passes
    def run(self) -> list:
        knobs: list = []
        pos = lambda n: (n.lineno, n.col_offset)  # noqa: E731 - code order, not ast.walk's breadth-first order
        calls = sorted((n for n in ast.walk(self.fn) if isinstance(n, ast.Call)), key=pos)
        text_calls = [c for c in calls if _call_name(c) in SIZED_CLASSES]

        # --- text content
        for c in text_calls:
            cls = _call_name(c)
            if cls in CONTENT_CLASSES and len(c.args) == 1 and _str(c.args[0]) is not None:
                knobs.append(self.knob("text", "string" if CONTENT_CLASSES[cls] == "text" else "latex",
                                       "Text" if CONTENT_CLASSES[cls] == "text" else "LaTeX",
                                       [(self.ctx(c), c.args[0], None, None)], group="text"))

        # --- font / weight / slant (Text, MarkupText, Code) and font size (every text class)
        for kw, kind, label, classes, default in (
            ("font", "font", "Font", FONT_CLASSES, ""),
            ("font_size", "font_size", "Font size", SIZED_CLASSES, DEFAULT_FONT_SIZE),
            ("weight", "weight", "Weight", {"Text", "MarkupText"}, "NORMAL"),
            ("slant", "slant", "Slant", {"Text", "MarkupText"}, "NORMAL"),
        ):
            groups: "OrderedDict[str, list]" = OrderedDict()
            for c in text_calls:
                if _call_name(c) not in classes:
                    continue
                arg = next((k.value for k in c.keywords if k.arg == kw), None)
                if arg is None:
                    if kind in ("weight", "slant") and _call_name(c) == "Code":
                        continue
                    ins = self.insert_edit(c, kw)
                    if ins is None:
                        continue
                    groups.setdefault("default", []).append((self.ctx(c), None, ins, ins))
                    continue
                tgt = self.const_target(arg)
                if tgt is None and isinstance(arg, ast.Name) and kind in ("weight", "slant") and arg.id in WEIGHTS + SLANTS:
                    tgt = arg
                if tgt is None:
                    continue  # computed: not a knob
                s, e = self.src.span(tgt)
                # one knob per font / weight in use; one per size *source* (fs = 110 drives many)
                key = f"v:{self.value_of(tgt)!r}" if kind in ("font", "weight", "slant") else f"{s}:{e}"
                own = None if tgt is arg else self.literal_edit(arg)  # restyling one part detaches it
                groups.setdefault(key, []).append((self.ctx(c), tgt, None, own))
            for key, uses in groups.items():
                k = self.knob(kind, kind, label, uses, group="text", default=default if key == "default" else None)
                if k:
                    knobs.append(k)

        # --- shape kwargs (literal or constant)
        for kwname, (label, lo, hi, step) in SHAPE_KWARGS.items():
            groups = OrderedDict()
            for c in calls:
                for k in c.keywords:
                    if k.arg != kwname:
                        continue
                    tgt = self.const_target(k.value)
                    if tgt is None or (_num(tgt) is None and not self.is_global(tgt)):
                        continue
                    s, e = self.src.span(tgt)
                    groups.setdefault(f"{s}:{e}", []).append((self.ctx(c), tgt, None, None if tgt is k.value else self.literal_edit(k.value)))
            for key, uses in groups.items():
                kn = self.knob(kwname, "number", label, uses, group="shape")
                if kn:
                    kn.update({"min": lo, "max": hi, "step": step})
                    knobs.append(kn)

        # --- colours: hex strings, colour constants and colour-typed globals, grouped by value
        color_uses: "OrderedDict[str, list]" = OrderedDict()
        for node in sorted((n for n in ast.walk(self.fn) if hasattr(n, "lineno")), key=pos):
            hexv = None
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and HEX_RE.match(node.value):
                hexv = norm_hex(node.value)
            elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id not in self.stores:
                if node.id in self.colors:
                    hexv = self.colors[node.id]
                elif self.is_global(node) and self.globals[node.id].get("type") == "color":
                    hexv = "$" + node.id
            if hexv is None:
                continue
            # a top-level colour constant shows up once, under the constant's uses
            ctx = self.ctx(node)
            par = self.parents.get(node)
            if isinstance(par, ast.Assign) and par in self.consts.values():
                name = par.targets[0].id
                self.used_consts.add(name)
                ctx = self._const_users(name) or name
            color_uses.setdefault(hexv, []).append((ctx, node, None, None))
        for hexv, uses in sorted(color_uses.items(), key=lambda kv: min(self.src.span(u[1])[0] for u in kv[1])):
            kn = self.knob("color", "color", "Color", uses, group="color")
            if kn:
                knobs.append(kn)

        # --- remaining top-level constants
        for name, st in self.consts.items():
            if name in self.used_consts:
                continue
            v = st.value
            if not any(isinstance(n, ast.Name) and n.id == name and isinstance(n.ctx, ast.Load) for n in ast.walk(self.fn)):
                continue  # never read
            kind = "bool" if isinstance(v, ast.Constant) and isinstance(v.value, bool) else \
                "number" if _num(v) is not None else \
                "string" if _str(v) is not None else \
                ({"number": "number", "bool": "bool", "font": "font"}.get(self.globals[v.id].get("type"), "string") if self.is_global(v) else None)
            if kind is None:
                continue
            kn = self.knob("const:" + name, kind, name, [(self._const_users(name), v, None, None)], group="value")
            if kn:
                kn["name"] = name
                note = self._line_comment(st)
                if note:
                    kn["note"] = note
                if kind == "number":
                    val = abs(kn["value"] or 0)
                    kn["step"] = 1 if isinstance(kn["value"], int) and val >= 10 else 0.5 if val >= 10 else 0.05 if val >= 0.5 else 0.01
                knobs.append(kn)

        # unique ids
        seen: dict = {}
        for k in knobs:
            base = k["id"]
            n = seen.get(base, 0)
            seen[base] = n + 1
            if n:
                k["id"] = f"{base}#{n}"
        return knobs

    def _const_users(self, name: str) -> str:
        users = []
        for n in ast.walk(self.fn):
            if isinstance(n, ast.Name) and n.id == name and isinstance(n.ctx, ast.Load):
                c = self.ctx(n)
                if c and c not in users:
                    users.append(c)
        return ", ".join(users[:4]) + (" …" if len(users) > 4 else "")

    def _line_comment(self, st) -> str | None:
        i = st.end_lineno - 2
        if 0 <= i < len(self.src.lines):
            m = re.search(r"#\s*(.+)$", self.src.lines[i])
            if m and "'" not in self.src.lines[i][: m.start()].replace("\"", "'")[-1:]:
                return m.group(1).strip()[:60]
        return None

    def knob(self, kid: str, kind: str, label: str, uses: list, group: str, default=None) -> dict | None:
        """uses = [(ctx, literal node or None, insert edit or None, own edit or None)]; the own edit
        rewrites just that use (its argument) instead of the shared constant it reads."""
        occ: "OrderedDict[str, dict]" = OrderedDict()
        edits_all = []
        seen_spans = set()
        value = None
        linked = set()
        const_name = None
        for ctx, node, ins, own in uses:
            if node is not None:
                ed = self.literal_edit(node)
                if self.is_global(node):
                    linked.add(node.id)
                if value is None:
                    value = self.value_of(node)
                par = self.parents.get(node)
                if isinstance(par, ast.Assign) and par in self.consts.values():
                    const_name = par.targets[0].id
            else:
                ed = ins
            o = occ.setdefault(ctx or "", {"ctx": ctx or "", "edits": [], "own": [], "n": 0})
            o["n"] += 1
            if own is not None:
                o["own"].append(own)
            span = (ed["s"], ed["e"], ed["pre"])
            if span in seen_spans:
                continue
            seen_spans.add(span)
            o["edits"].append(ed)
            edits_all.append(ed)
        if not edits_all:
            return None
        if value is None:
            value = default
        if kind == "color" and isinstance(value, str):
            value = norm_hex(value) if HEX_RE.match(value) else value
        names = [(o["ctx"] + (f" ×{o['n']}" if o["n"] > 1 else "")) for o in occ.values() if o["ctx"]]
        where = ", ".join(names[:4]) + (" …" if len(names) > 4 else "")
        out = {
            "id": kid if kind not in ("color",) else f"color:{value}",
            "group": group, "kind": kind, "label": label, "value": value,
            "linked": next(iter(linked)) if len(linked) == 1 and len(uses) == len([u for u in uses if u[1] is not None and self.is_global(u[1])]) else None,
            "default": default is not None and all(u[1] is None for u in uses),
            "where": where,
            "occ": [{"ctx": o["ctx"], "edits": o["edits"], **({"own": o["own"]} if o["own"] else {})}
                    for o in occ.values() if o["edits"] or o["own"]],
            "edits": edits_all,
        }
        if const_name and not kid.startswith("const:"):
            out["name"] = const_name
        if kind == "weight":
            out["options"] = WEIGHTS
        if kind == "slant":
            out["options"] = SLANTS
        if kind == "font_size":
            out.update({"min": 1, "max": None, "step": 1})
        if kind in ("string", "latex"):
            out["id"] = f"{kid}:{edits_all[0]['s']}"
        return out


def analyze(code: str, globals_: list | None = None) -> dict:
    if not code or not code.strip():
        return {"knobs": [], "error": None}
    try:
        a = _Analyzer(code, globals_ or [])
    except SyntaxError as e:
        return {"knobs": [], "error": f"SyntaxError: {e.msg} (line {max(1, (e.lineno or 2) - 1)})"}
    try:
        return {"knobs": a.run(), "error": None}
    except Exception as e:  # noqa: BLE001 - never break the inspector
        return {"knobs": [], "error": f"{type(e).__name__}: {e}"}
