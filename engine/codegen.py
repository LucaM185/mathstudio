"""
Project JSON  ->  ManimGL python code.

The project (edited by the UI) is turned into a regular manimgl script that uses
`studio_runtime.StudioScene`.  The live preview executes *the same* factory source
code, so preview and final render are identical.
"""
from __future__ import annotations

import re

import library

PLACEHOLDER = re.compile(r"\$\{(\w+)\}")
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
HEADER = "from manimlib import *\nfrom studio_runtime import *\nimport numpy as np\nimport math"


# --------------------------------------------------------------------------------------
# Project globals: user-editable constants (fonts, sizes, spacing, colours...) that are written
# at the top of scene.py and that clip code and linked template params read by name.
# --------------------------------------------------------------------------------------
_reserved: set | None = None


def reserved_names() -> set:
    """Names a global may not take: everything the scene header imports, plus Python's own."""
    global _reserved
    if _reserved is None:
        import builtins
        import keyword
        ns: dict = {}
        exec(HEADER, ns)
        _reserved = set(ns) | set(dir(builtins)) | set(keyword.kwlist) | {"t", "a", "self"}
    return _reserved


def global_value(g: dict) -> str:
    t = g.get("type") or "number"
    v = g.get("value")
    if t == "int":
        try:
            return str(int(round(float(v))))
        except (TypeError, ValueError):
            return "0"
    if t == "number":
        return fmt_num(v if v is not None else 0)
    if t == "color":
        s = str(v or "#FFFFFF")
        return repr(s.upper() if re.fullmatch(r"#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?", s) else "#FFFFFF")
    if t == "bool":
        return "True" if v else "False"
    return repr("" if v is None else str(v))  # text, font


def project_globals(project: dict):
    """([(name, python literal)], {name: error}) for the project's globals, in order."""
    out, errors, seen = [], {}, set()
    for g in project.get("globals") or []:
        name = str(g.get("name") or "")
        if not IDENT.match(name):
            errors[name or "?"] = "not a valid Python name (letters, digits and _, not starting with a digit)"
            continue
        if name in reserved_names():
            errors[name] = f"{name} is already a ManimGL / Python name; pick another"
            continue
        if name in seen:
            errors[name] = "defined twice"
            continue
        seen.add(name)
        out.append((name, global_value(g)))
    return out, errors


def globals_source(project: dict) -> str:
    return "".join(f"{n} = {v}\n" for n, v in project_globals(project)[0])


# --------------------------------------------------------------------------------------
# Literals
# --------------------------------------------------------------------------------------
def fmt_num(v) -> str:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return "0"
    if f != f or f in (float("inf"), float("-inf")):
        return "0"
    if abs(f - round(f)) < 1e-9 and abs(f) < 1e12:
        return f"{int(round(f))}.0" if not isinstance(v, int) else str(int(round(f)))
    s = f"{f:.6f}".rstrip("0").rstrip(".")
    return s


def py_str(s: str) -> str:
    s = "" if s is None else str(s)
    if "\n" not in s and '"' not in s and not s.endswith("\\") and "\\" in s:
        return 'r"' + s + '"'
    return repr(s)


def global_ref(value):
    """A template param linked to a project global is stored as {"$g": "NAME"}."""
    if isinstance(value, dict):
        name = value.get("$g")
        if isinstance(name, str) and IDENT.match(name):
            return name
    return None


def literal(value, p: dict) -> str:
    ref = global_ref(value)
    if ref is not None and p["type"] != "asset":
        return ref
    t = p["type"]
    if t == "number":
        return fmt_num(value if value is not None else p.get("default", 0))
    if t == "int":
        try:
            return str(int(round(float(value))))
        except (TypeError, ValueError):
            return str(int(p.get("default", 0)))
    if t == "color":
        v = str(value or p.get("default") or "#FFFFFF")
        if not re.fullmatch(r"#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?", v):
            v = "#FFFFFF"
        return repr(v.upper())
    if t == "bool":
        return "True" if value else "False"
    if t == "latex":
        return py_str(value if value is not None else p.get("default", ""))
    if t == "text":
        return repr("" if value is None else str(value))
    if t == "expr":
        v = (value if value is not None else p.get("default", "0")) or "0"
        v = str(v).replace("\n", " ").strip()
        return f"({v})"
    if t == "select":
        v = value if value is not None else p.get("default")
        if v not in p.get("options", []):
            v = p.get("default")
        if v in ("NORMAL", "BOLD", "LEFT", "CENTER", "RIGHT"):
            return repr(v)
        return v if p.get("raw") else repr(v)
    if t == "asset":
        return repr(str(value or ""))
    return repr(value)


def expand_template(item: dict, params: dict) -> str:
    pmap = {p["id"]: p for p in item["params"]}

    def sub(m):
        pid = m.group(1)
        p = pmap.get(pid)
        if p is None:
            return m.group(0)
        return literal(params.get(pid, p.get("default")), p)

    return PLACEHOLDER.sub(sub, item["code"])


def effective_imports(project: dict) -> dict:
    """Definitions of the imported mobjects this project uses: {fn: code}, in first-use order.

    A project keeps its own copy in project["imports"] (the agent edits that copy with set_import);
    without one, the library's converted definition is used.
    """
    own = {imp["fn"]: imp["code"] for imp in (project.get("imports") or []) if imp.get("fn") and imp.get("code")}
    out: dict = {}
    for clip, _ in ordered_clips(project):
        if clip.get("code"):
            continue
        item = library.BY_ID.get(clip.get("item"))
        if item and item.get("prelude"):
            fn = item["fn"]
            if fn not in out:
                out[fn] = own.get(fn, item["prelude"])
    return out


def clip_body(clip: dict) -> str:
    if clip.get("code"):
        return clip["code"]
    item = library.BY_ID.get(clip.get("item"))
    if item is None:
        return "return VMobject()"
    return expand_template(item, clip.get("params") or {})


def is_dynamic(clip: dict) -> bool:
    if "dynamic" in clip and clip["dynamic"] is not None:
        return bool(clip["dynamic"])
    item = library.BY_ID.get(clip.get("item"))
    return bool(item and item.get("dynamic"))


def ident(clip: dict) -> str:
    base = re.sub(r"\W+", "_", (clip.get("name") or clip.get("item") or "mob").lower()).strip("_") or "mob"
    if base[0].isdigit():
        base = "m_" + base
    cid = re.sub(r"\W+", "", str(clip["id"]))[-6:]
    return f"make_{base}_{cid}"


def factory_source(clip: dict, fn_name: str | None = None) -> str:
    fn_name = fn_name or ident(clip)
    body = clip_body(clip).rstrip() or "return VMobject()"
    if "return" not in body:
        # single expression without return
        lines = body.splitlines()
        lines[-1] = "return " + lines[-1]
        body = "\n".join(lines)
    sig = "(t=0.0, a=0.0)" if is_dynamic(clip) else "()"
    indented = "\n".join(("    " + ln) if ln.strip() else "" for ln in body.splitlines())
    return f"def {fn_name}{sig}:\n{indented}\n"


# --------------------------------------------------------------------------------------
# Clip kwargs (shared by preview and codegen)
# --------------------------------------------------------------------------------------
def _anim_tuple(spec, default_dur=1.0):
    if not spec or spec.get("type", "none") == "none":
        return ("none", 0.0, "smooth", None)
    return (
        spec.get("type"),
        float(spec.get("duration", default_dur) or 0.0),
        spec.get("rate") or "smooth",
        spec.get("target") or None,
    )


PART_PATH = re.compile(r"^\d+(\.\d+)*$")


def clip_parts(clip: dict) -> dict:
    """{path: dict(at=, until=, enter=(...), exit=(...), dx=, dy=)} for the clip's part timing / position overrides."""
    out = {}
    for path, spec in sorted((clip.get("parts") or {}).items(), key=lambda kv: [int(x) for x in kv[0].split(".")] if PART_PATH.match(str(kv[0])) else [1e9]):
        if not PART_PATH.match(str(path)) or not isinstance(spec, dict):
            continue
        ent = {}
        for k in ("at", "until"):
            v = spec.get(k)
            if v is not None:
                try:
                    ent[k] = round(float(v), 4)
                except (TypeError, ValueError):
                    pass
        for k in ("enter", "exit"):
            a = spec.get(k)
            if isinstance(a, dict) and a.get("type"):
                ent[k] = _anim_tuple(a)[:3]
        # moved parts: offset from where the clip's code puts them, in the clip's own units
        for k in ("dx", "dy"):
            try:
                v = round(float(spec.get(k) or 0.0), 4)
            except (TypeError, ValueError):
                v = 0.0
            if v:
                ent[k] = v
        if ent:
            out[str(path)] = ent
    return out


def clip_kwargs(clip: dict, layer: int) -> dict:
    tr = clip.get("transform") or {}
    keys = []
    for k in sorted(clip.get("keys") or [], key=lambda k: k.get("t", 0)):
        key = {
            "t": float(k.get("t", 0)),
            "x": float(k.get("x", tr.get("x", 0))),
            "y": float(k.get("y", tr.get("y", 0))),
        }
        # z / rx / ry are written only when used; a key that omits one falls back to the static
        # transform, so a zero key value must still be written when the static value isn't zero
        z = float(k.get("z", tr.get("z", 0)) or 0)
        if z or float(tr.get("z", 0) or 0):
            key["z"] = z
        key.update({
            "scale": float(k.get("scale", tr.get("scale", 1))),
            "rotation": float(k.get("rotation", tr.get("rotation", 0))),
        })
        for ax in ("rx", "ry"):
            v = float(k.get(ax, tr.get(ax, 0)) or 0)
            if v or float(tr.get(ax, 0) or 0):
                key[ax] = v
        key.update({
            "opacity": float(k.get("opacity", tr.get("opacity", 1))),
            "ease": k.get("ease") or "smooth",
        })
        keys.append(key)
    effects = []
    for e in clip.get("effects") or []:
        effects.append((e.get("type"), float(e.get("at", 0)), float(e.get("duration", 1)), e.get("rate") or "smooth"))
    return dict(
        id=str(clip["id"]),
        name=clip.get("name") or "",
        start=float(clip.get("start", 0)),
        duration=float(clip.get("duration", 3)),
        layer=layer,
        transform=_transform(tr),
        keys=keys,
        enter=_anim_tuple(clip.get("enter")),
        exit=_anim_tuple(clip.get("exit")),
        effects=effects,
        dynamic=is_dynamic(clip),
        fixed=bool(clip.get("fixed")),
        parts=clip_parts(clip),
    )


def _transform(tr: dict) -> dict:
    out = dict(x=float(tr.get("x", 0)), y=float(tr.get("y", 0)))
    z = float(tr.get("z", 0) or 0)
    if z:
        out["z"] = z
    out.update(scale=float(tr.get("scale", 1)), rotation=float(tr.get("rotation", 0)))
    for ax in ("rx", "ry"):
        v = float(tr.get(ax, 0) or 0)
        if v:
            out[ax] = v
    out["opacity"] = float(tr.get("opacity", 1))
    return out


def ordered_clips(project: dict):
    """Yields (clip, layer) for visible clips. layer = index of track (0 = front)."""
    tracks = project.get("tracks") or []
    index = {t["id"]: i for i, t in enumerate(tracks)}
    hidden = {t["id"] for t in tracks if t.get("hidden")}
    clips = [c for c in project.get("clips") or [] if c.get("track") in index and c.get("track") not in hidden]
    clips.sort(key=lambda c: (-index[c["track"]], float(c.get("start", 0))))
    for c in clips:
        yield c, index[c["track"]]


# --------------------------------------------------------------------------------------
# Script generation
# --------------------------------------------------------------------------------------
def _py(v, indent=0):
    if isinstance(v, float):
        return fmt_num(v)
    if isinstance(v, bool):
        return "True" if v else "False"
    if isinstance(v, int):
        return str(v)
    if v is None:
        return "None"
    if isinstance(v, str):
        return repr(v)
    if isinstance(v, tuple):
        inner = [_py(x) for x in v]
        while inner and inner[-1] == "None":
            inner.pop()
        return "(" + ", ".join(inner) + ("," if len(inner) == 1 else "") + ")"
    if isinstance(v, dict):
        return "dict(" + ", ".join(f"{k}={_py(x)}" for k, x in v.items()) + ")"
    if isinstance(v, list):
        if not v:
            return "[]"
        pad = " " * (indent + 4)
        return "[\n" + "".join(f"{pad}{_py(x, indent + 4)},\n" for x in v) + " " * indent + "]"
    return repr(v)


def clip_call(clip: dict, layer: int, fn_name: str, indent: str = "        ") -> str:
    kw = clip_kwargs(clip, layer)
    parts = [fn_name]
    for key in ("id", "name", "start", "duration", "layer"):
        parts.append(f"{key}={_py(kw[key])}")
    tr = kw["transform"]
    if tr != dict(x=0.0, y=0.0, scale=1.0, rotation=0.0, opacity=1.0):
        parts.append(f"transform={_py(tr)}")
    if kw["keys"]:
        parts.append("keys=" + _py(kw["keys"], len(indent) + 4))
    if kw["enter"][0] != "none":
        parts.append(f"enter={_py(kw['enter'])}")
    if kw["exit"][0] != "none":
        parts.append(f"exit={_py(kw['exit'])}")
    if kw["effects"]:
        parts.append("effects=" + _py(kw["effects"], len(indent) + 4))
    if kw["dynamic"]:
        parts.append("dynamic=True")
    if kw["fixed"]:
        parts.append("fixed=True")
    if kw["parts"]:
        # the group's parts: path = child indices (mob.submobjects[i]...), at / until in s from the clip start, dx / dy = moved by
        pad = indent + "        "
        rows = "".join(f"{pad}{p!r}: {_py(spec)},\n" for p, spec in kw["parts"].items())
        parts.append("parts={\n" + rows + indent + "    }")
    inner = (",\n" + indent + "    ").join(parts)
    return f"{indent}self.clip(\n{indent}    {inner},\n{indent})\n"


def camera_keys(project: dict) -> list:
    keys = (project.get("settings") or {}).get("camera") or []
    out = []
    for k in sorted(keys, key=lambda k: float(k.get("t", 0))):
        key = {"t": float(k.get("t", 0)), "x": float(k.get("x", 0)), "y": float(k.get("y", 0))}
        # 3D fields are only written when used, so 2D scripts stay short
        for name in ("z", "theta", "phi", "gamma"):
            v = float(k.get(name, 0) or 0)
            if v:
                key[name] = v
        key["zoom"] = float(k.get("zoom", 1) or 1)
        key["ease"] = k.get("ease") or "smooth"
        out.append(key)
    return out


def project_duration(project: dict) -> float:
    s = project.get("settings") or {}
    return float(s.get("duration") or 0) or max(
        [float(c.get("start", 0)) + float(c.get("duration", 0)) for c in project.get("clips") or []] + [1.0]
    )


def generate_script(project: dict, scene_name: str = "MainScene") -> str:
    settings = project.get("settings") or {}
    tracks = project.get("tracks") or []
    out = []
    out.append('"""')
    out.append(f"{settings.get('name') or 'Untitled'} - generated by MathStudio")
    out.append("")
    out.append(f"Render with:   manimgl scene.py {scene_name} -w")
    out.append('"""')
    out.append("from manimlib import *")
    out.append("from studio_runtime import *")
    out.append("import numpy as np")
    out.append("import math")
    out.append("")
    gl = project_globals(project)[0]
    if gl:
        out.append("# ── globals (edit these to restyle the whole scene)")
        out.extend(f"{n} = {v}" for n, v in gl)
        out.append("")
    # imported mobjects: defined once here, called from every clip that uses them
    for fn, code in effective_imports(project).items():
        out.append(f"# ── imported mobject: {fn}")
        out.append(code.rstrip())
        out.append("")
        out.append("")
    out.append("")
    out.append("")
    clips = list(ordered_clips(project))
    names = {}
    for clip, _ in clips:
        fn = ident(clip)
        names[clip["id"]] = fn
        out.append(f"# {clip.get('name') or clip.get('item')}")
        out.append(factory_source(clip, fn))
        out.append("")
    out.append(f"class {scene_name}(StudioScene):")
    out.append(f"    duration = {fmt_num(project_duration(project))}")
    out.append(f"    background = {repr(settings.get('background') or '#1e1e1e')}")
    out.append(f"    fps = {int(settings.get('fps') or 30)}")
    cam = camera_keys(project)
    if cam:
        out.append("    camera_keys = " + _py(cam, 4))
    out.append("")
    out.append("    def build(self):")
    if not clips:
        out.append("        pass")
    current_layer = None
    by_id = {c["id"]: c for c, _ in clips}
    for clip, layer in clips:
        if layer != current_layer:
            current_layer = layer
            tname = tracks[layer].get("name") if layer < len(tracks) else f"Track {layer + 1}"
            out.append(f"        # ── {tname} (z = {len(tracks) - layer})")
        ex = clip.get("exit") or {}
        if ex.get("type") in ("TransformInto", "TransformMatching") and ex.get("target") in by_id:
            # the morph lives in this clip's exit=(...): spell out what happens and when
            dur = float(ex.get("duration", 1) or 0)
            end = float(clip.get("start", 0)) + float(clip.get("duration", 0))
            tgt = by_id[ex["target"]]
            out.append(f"        # transform: {clip.get('name') or clip['id']} -> {tgt.get('name') or tgt['id']}"
                       f"  ({fmt_num(end - dur)}s to {fmt_num(end)}s)")
        out.append(clip_call(clip, layer, names[clip["id"]]).rstrip("\n"))
    out.append("")
    return "\n".join(out)


# --------------------------------------------------------------------------------------
# A project as one reusable mobject (see library_user.py)
# --------------------------------------------------------------------------------------
def _indent(src: str, pad: str = "    ") -> str:
    return "\n".join((pad + ln) if ln.strip() else "" for ln in src.splitlines())


def project_mobject_source(project: dict, fn: str, bbox=None, title: str = "") -> str:
    """Python source defining `fn(t=0.0, speed=1.0, loop=False, start_at=0.0)`: the project's
    timeline, replayed inside one mobject (studio_runtime.project_mobject).

    Self-contained, so it works as an import prelude: the imported definitions the project uses
    come first, then one builder function holding the project's globals and clip factories as
    locals (nothing leaks into, or clashes with, the scene that uses the mobject).
    """
    clips = list(ordered_clips(project))
    out = [f"# MathStudio mobject made from the project {title or (project.get('settings') or {}).get('name') or 'Untitled'!r}."]
    out.append("# It replays that project's timeline (without its camera and background).")
    for _, code in effective_imports(project).items():
        out.append(code.rstrip())
        out.append("")
    build = f"_{fn}_timeline"
    out.append("")
    out.append(f"def {build}():")
    for n, v in project_globals(project)[0]:
        out.append(f"    {n} = {v}")
    names = {}
    for clip, _ in clips:
        names[clip["id"]] = ident(clip)
        out.append("")
        out.append(f"    # {clip.get('name') or clip.get('item')}")
        out.append(_indent(factory_source(clip, names[clip["id"]])))
    out.append("")
    out.append("    tl = Timeline()")
    for clip, layer in clips:
        call = clip_call(clip, layer, names[clip["id"]], indent="    ").rstrip("\n")
        out.append(call.replace("    self.clip(", "    tl.clip(", 1))
    out.append("    return tl")
    out.append("")
    out.append("")
    box = "None" if not bbox else "(" + ", ".join(fmt_num(round(float(v), 4)) for v in bbox) + ")"
    out.append(f"def {fn}(t=0.0, speed=1.0, loop=False, start_at=0.0):")
    out.append(f"    return project_mobject({build}, t=t, duration={fmt_num(project_duration(project))}, bbox={box},")
    out.append("                           speed=speed, loop=loop, start_at=start_at)")
    return "\n".join(out) + "\n"


# --------------------------------------------------------------------------------------
# Preview timeline (persistent, cached)
# --------------------------------------------------------------------------------------
class PreviewState:
    """Keeps Clip objects alive between frame requests so built mobjects are reused."""

    def __init__(self):
        import studio_runtime as rt
        self.rt = rt
        self.ns = {}
        exec("from manimlib import *\nfrom studio_runtime import *\nimport numpy as np\nimport math", self.ns)
        self.fn_cache: dict[str, object] = {}
        self.clips: dict[str, object] = {}
        self.sig: dict[str, tuple] = {}
        self.errors: dict[str, str] = {}
        self.import_src: dict[str, str] = {}
        self.import_errors: dict[str, str] = {}
        self.base_ns: dict | None = None  # header-only namespace each import module starts from
        self.globals_src = ""
        self.global_errors: dict[str, str] = {}
        self.morph_sig: dict = {}

    def factory_for(self, clip: dict):
        src = factory_source(clip, "__factory__")
        fn = self.fn_cache.get(src)
        if fn is None:
            ns = dict(self.ns)
            exec(compile(src, f"<clip {clip.get('name')}>", "exec"), ns)
            fn = ns["__factory__"]
            if len(self.fn_cache) > 400:
                self.fn_cache.clear()
            self.fn_cache[src] = fn
        return fn, src

    def _load_imports(self, project: dict):
        changed = False
        for fn, code in effective_imports(project).items():
            if self.import_src.get(fn) != code:
                # Each import runs in its own module namespace: different library files often
                # define the same top-level names (Spotlight, DoublePendulum, helpers...), and in
                # one shared namespace the last one loaded would silently replace the others.
                # Its names are still copied into the shared namespace for custom clip code.
                if self.base_ns is None:
                    self.base_ns = {}
                    exec("from manimlib import *\nfrom studio_runtime import *\nimport numpy as np\nimport math", self.base_ns)
                module = dict(self.base_ns)
                try:
                    exec(compile(code, f"<import {fn}>", "exec"), module)
                except Exception as e:  # noqa: BLE001 - the clips using it show the error
                    self.import_errors[fn] = f"{type(e).__name__}: {e}"
                else:
                    self.import_errors.pop(fn, None)
                    self.ns.update({k: v for k, v in module.items()
                                    if not k.startswith("__") and self.base_ns.get(k, module) is not v})
                    self.ns[fn] = module[fn]
                self.import_src[fn] = code
                changed = True
        if changed:
            self.fn_cache.clear()
            self.clips.clear()
            self.sig.clear()

    def _load_globals(self, project: dict):
        gl, self.global_errors = project_globals(project)
        src = "".join(f"{n} = {v}\n" for n, v in gl)
        if src == self.globals_src:
            return
        for name in re.findall(r"^(\w+) = ", self.globals_src, re.M):
            self.ns.pop(name, None)
        exec(src, self.ns)
        self.globals_src = src
        # factories captured a copy of the namespace: rebuild them with the new values
        self.fn_cache.clear()
        self.clips.clear()
        self.sig.clear()

    def sync(self, project: dict):
        rt = self.rt
        self._load_imports(project)
        self._load_globals(project)
        timeline = rt.Timeline(camera=camera_keys(project))
        self.errors = {}
        seen = set()
        morph_sig: dict = {}
        for clip, layer in ordered_clips(project):
            cid = str(clip["id"])
            seen.add(cid)
            kw = clip_kwargs(clip, layer)
            try:
                fn, src = self.factory_for(clip)
            except SyntaxError as e:
                self.errors[cid] = f"SyntaxError: {e.msg} (line {(e.lineno or 1) - 1})"
                continue
            except Exception as e:
                self.errors[cid] = f"{type(e).__name__}: {e}"
                continue
            c = self.clips.get(cid)
            anim_sig = (kw["enter"], kw["exit"], tuple(kw["effects"]), kw["duration"])
            if c is None or self.sig.get(cid, (None,))[0] != src:
                c = rt.Clip(fn, **kw)
                self.clips[cid] = c
                self.sig[cid] = (src, anim_sig)
            else:
                old_anim_sig = self.sig[cid][1]
                c.start = kw["start"]
                c.duration = max(kw["duration"], 1e-3)
                c.layer = layer
                c.name = kw["name"]
                c.transform = {**rt.DEFAULT_TRANSFORM, **kw["transform"]}
                c.keys = kw["keys"]
                c.enter = rt._norm_anim(kw["enter"])
                c.exit = rt._norm_anim(kw["exit"])
                c.effects = [rt._norm_effect(e) for e in kw["effects"]]
                c.set_fixed(kw["fixed"])
                c.set_parts(kw["parts"])
                if old_anim_sig != anim_sig:
                    c._anim_cache.clear()
                    self.sig[cid] = (src, anim_sig)
            # what a morph (TransformInto / Matching) from or into this clip is built from
            morph_sig[cid] = (src, anim_sig, repr(kw["transform"]), repr(kw["keys"]), repr(kw["parts"]), kw["fixed"])
            timeline.add(c)
        # transform-into animations depend on both clips: keep a built morph while neither changed
        # (dropping them on every sync rebuilt each morph on every frame: 30-40 ms per frame)
        changed = {cid for cid, ms in morph_sig.items() if self.morph_sig.get(cid) != ms}
        for c in timeline.clips:
            if any(isinstance(k, tuple) for k in c._anim_cache):
                c._anim_cache = {k: v for k, v in c._anim_cache.items()
                                 if not isinstance(k, tuple) or (c.id not in changed and k[1] in morph_sig and k[1] not in changed)}
        self.morph_sig = morph_sig
        for cid in list(self.clips):
            if cid not in seen:
                del self.clips[cid]
                self.sig.pop(cid, None)
        return timeline
