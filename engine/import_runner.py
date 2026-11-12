"""
Convert ONE source file of the mathstudio library into a mobject definition, in a subprocess.

    python import_runner.py <file.py> <fn_name>

Prints a single JSON line on stdout:
    {"ok": true,  "fn": "...", "code": "...", "kind": "class|scene", "export": "Name"}
    {"ok": false, "error": "..."}

The produced `code` is a self-contained top-level definition

    def <fn_name>():
        ...return a Mobject...

that is only accepted if it executes in exactly the namespace a scene gets
(`from manimlib import *`, `from studio_runtime import *`, numpy, math) and returns a
non-empty Mobject. Anything else is reported as a failure with the reason.
"""

from __future__ import annotations

import ast
import contextlib
import json
import os
import re
import sys
import traceback

HEADER = "from manimlib import *\nfrom studio_runtime import *\nimport numpy as np\nimport math\n"

# Import rewrites so Manim Community / legacy code has a chance to run under manimgl.
REWRITES = [
    (re.compile(r"^(\s*)from manimlib\.imports import", re.M), r"\1from manimlib import"),
    (re.compile(r"^(\s*)from manim(\.[\w.]+)? import", re.M), r"\1from manimlib import"),
    (re.compile(r"^(\s*)import manim\s*$", re.M), r"\1import manimlib as manim"),
]


LIB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mathstudio_library")
# roots a local import can resolve against (the 3b1b helper module lives in its video tree;
# the manim plugins are packages inside their own folder)
EXTRA_ROOTS = [
    os.path.join(LIB, "non-commercial", "3b1b-videos"),
    os.path.join(LIB, "manim-assets", "manimgl", "3b1b-videos"),
    os.path.join(LIB, "non-commercial", "reusable", "mobjects"),
    os.path.join(LIB, "non-commercial", "reusable", "full"),
    os.path.join(LIB, "manim-assets", "manimce", "plugins", "manim-physics"),
    os.path.join(LIB, "manim-assets", "manimce", "plugins", "manim-ml"),
    os.path.join(LIB, "manim-assets", "manimce", "plugins", "manim-chemistry"),
]


def _find_module(modname: str, here: str, level: int = 0) -> str | None:
    """Path of a library module `modname` (dotted), or None if it is not a local file."""
    parts = modname.split(".") if modname else []
    roots = []
    if level:
        base = here
        for _ in range(level - 1):
            base = os.path.dirname(base)
        roots.append(base)
    else:
        roots.append(here)
        d = here
        while d.startswith(LIB) and d != LIB:
            d = os.path.dirname(d)
            roots.append(d)
        roots += EXTRA_ROOTS
    for root in roots:
        cand = os.path.join(root, *parts)
        for p in (cand + ".py", os.path.join(cand, "__init__.py")):
            if os.path.isfile(p):
                return p
    return None


def _bundle(path: str, seen: set[str]) -> ast.Module:
    """Parse a file and splice in the source of every local module it imports."""
    real = os.path.realpath(path)
    seen.add(real)
    src = open(real, encoding="utf8", errors="replace").read()
    for rx, rep in REWRITES:
        src = rx.sub(rep, src)
    tree = _strip_main(ast.parse(src))
    here = os.path.dirname(real)
    body = []
    for node in tree.body:
        target = None
        if isinstance(node, ast.ImportFrom):
            target = _find_module(node.module or "", here, node.level)
        elif isinstance(node, ast.Import):
            target = _find_module(node.names[0].name, here) if len(node.names) == 1 else None
        if target and os.path.realpath(target) not in seen:
            sub = _bundle(target, seen)
            body.extend(sub.body)
            continue
        if target:  # already included earlier
            continue
        if isinstance(node, ast.ImportFrom) and not node.level and (node.module or "").split(".")[0] == "custom":
            continue  # 3b1b's private `custom` package is not shipped: scenes that only need manimlib still run
        body.append(node)
    tree.body = body
    return tree


def _strip_main(tree: ast.Module) -> ast.Module:
    keep = []
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module == "__future__":
            continue  # only legal at the top of a file; not needed on Python 3.12
        if isinstance(node, ast.If):
            t = ast.unparse(node.test)
            if "__name__" in t and "__main__" in t:
                continue
        keep.append(node)
    tree.body = keep
    return tree


def _base_names(cls: ast.ClassDef) -> list[str]:
    out = []
    for b in cls.bases:
        out.append(ast.unparse(b))
    return out


def _own_names(path: str) -> set[str]:
    try:
        return {n.name for n in ast.parse(open(path, encoding="utf8", errors="replace").read()).body
                if isinstance(n, (ast.ClassDef, ast.FunctionDef))}
    except SyntaxError:
        return set()


def _candidates(tree: ast.Module, own: set[str] | None = None) -> list[tuple[str, str]]:
    """(kind, class name) in preference order: the file's own definitions before the helpers
    spliced in from imported modules, scenes first, then other classes."""
    scenes, others, funcs = [], [], []
    scene_names = {n.name for n in tree.body if isinstance(n, ast.ClassDef)
                   and "construct" in {m.name for m in n.body if isinstance(m, ast.FunctionDef)}}
    for _ in range(4):  # subclasses of scenes are scenes
        for n in tree.body:
            if isinstance(n, ast.ClassDef) and any(b.split(".")[-1] in scene_names for b in _base_names(n)):
                scene_names.add(n.name)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and not node.name.startswith("_"):
            if not any(a.arg not in ("self",) for a in node.args.args[: len(node.args.args) - len(node.args.defaults)]):
                funcs.append(("function", node.name))
            continue
        if not isinstance(node, ast.ClassDef):
            continue
        methods = {n.name for n in node.body if isinstance(n, ast.FunctionDef)}
        if "construct" in methods or node.name in scene_names:
            scenes.append(("scene", node.name))
        elif any(b.split(".")[-1] not in ("object",) for b in _base_names(node)):
            others.append(("class", node.name))
        else:
            others.append(("class", node.name))
    ordered = scenes + others + funcs
    if own:
        ordered = [c for c in ordered if c[1] in own] + [c for c in ordered if c[1] not in own]
    return ordered


def _wrapper(kind: str, name: str, fn: str, dynamic: bool = False) -> str:
    if kind == "scene":
        return f"def {fn}():\n    return collect_scene({name})\n"
    if kind == "function":
        return f"def {fn}():\n    return {name}()\n"
    if dynamic:
        # an animated class: the clip passes the time since it started
        return f"def {fn}(t=None):\n    return {name}() if t is None else {name}(t=t)\n"
    return f"def {fn}():\n    return {name}()\n"


def _takes_time(tree: ast.Module, name: str) -> bool:
    """True if class `name` defines __init__ with a parameter called `t` (an animated mobject)."""
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == name:
            for m in node.body:
                if isinstance(m, ast.FunctionDef) and m.name == "__init__":
                    return any(a.arg == "t" for a in m.args.args + m.args.kwonlyargs)
    return False


def _summary(tree: ast.Module, name: str) -> str:
    for node in tree.body:
        if isinstance(node, (ast.ClassDef, ast.FunctionDef)) and node.name == name:
            doc = ast.get_docstring(node) or ""
            return " ".join(doc.split("\n\n")[0].split())[:300]
    return ""


def _is_good(result) -> bool:
    from manimlib import Mobject
    if not isinstance(result, Mobject):
        return False
    try:
        return len(result.get_family()) > 1 or result.get_num_points() > 0
    except Exception:
        return False


def convert(path: str, fn: str) -> dict:
    try:
        tree = _bundle(path, set())
    except SyntaxError as e:
        return {"ok": False, "error": f"SyntaxError line {e.lineno}: {e.msg}"}
    module_src = ast.unparse(tree)
    cands = _candidates(tree, _own_names(path))
    if not cands:
        return {"ok": False, "error": "no class or scene in the file"}

    errors = []
    for kind, name in cands[:6]:
        dynamic = kind == "class" and _takes_time(tree, name)
        code = module_src.rstrip() + "\n\n\n" + _wrapper(kind, name, fn, dynamic)
        ns: dict = {"__name__": "__studio_import__"}
        try:
            with contextlib.redirect_stdout(sys.stderr):
                exec(compile(HEADER, "<header>", "exec"), ns)
                exec(compile(code, f"<{os.path.basename(path)}>", "exec"), ns)
                result = ns[fn]()
        except BaseException as e:  # noqa: BLE001 - we want every failure as data
            last = traceback.format_exception_only(type(e), e)[-1].strip()
            errors.append(f"{name}: {last[:240]}")
            continue
        if _is_good(result) and dynamic:
            try:  # an animated class must also build at its first frame
                with contextlib.redirect_stdout(sys.stderr):
                    if not _is_good(ns[fn](0.0)):
                        raise ValueError("nothing visible at t = 0")
            except BaseException as e:  # noqa: BLE001
                errors.append(f"{name}(t=0): {traceback.format_exception_only(type(e), e)[-1].strip()[:240]}")
                continue
        if _is_good(result):
            return {"ok": True, "fn": fn, "code": code, "kind": kind, "export": name,
                    "dynamic": dynamic, "doc": _summary(tree, name)}
        errors.append(f"{name}: returned no visible mobject")
    return {"ok": False, "error": " | ".join(errors) or "nothing usable"}


def main():
    path, fn = sys.argv[1], sys.argv[2]
    # the module may import sibling modules of its own tree
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, os.path.dirname(os.path.abspath(path)))
    try:
        out = convert(path, fn)
    except BaseException as e:  # noqa: BLE001
        out = {"ok": False, "error": f"{type(e).__name__}: {e}"[:300]}
    sys.stdout.write("\n__RESULT__" + json.dumps(out) + "\n")


if __name__ == "__main__":
    main()
