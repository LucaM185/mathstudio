"""
The second library: the files of the copied mathstudio library (engine/mathstudio_library/).

Two steps:

1. `scan()` lists every file and its licence. Used by import_convert.py.
2. import_convert.py turns each file into a mobject definition and writes mathstudio_imports.json.
   `library_items()` turns the accepted ones into ordinary library items (category "Imported"),
   so they get the same previews, hover animation and search as the built-in elements.

Licences come from the tree a file lives in (SOURCE.txt / LICENSE files):

* `non-commercial/` and `manim-assets/manimgl/3b1b-videos/`: CC BY-NC-SA 4.0 (3Blue1Brown).
  Non-commercial only: flagged `nc` and drawn with a red overlay in the UI.
* other `manim-assets/**`: MIT.
* `element-gallery/`: hand-written Manim scenes, no third-party licence file: treated as own work.

The non-commercial trees are not in the public repository or the release builds (.gitignore,
.dockerignore). import_convert.py therefore writes two files: mathstudio_imports.json (public:
MIT + own work) and mathstudio_imports_nc.json (the `nc` records, kept out of git); a checkout
without the second one simply has no non-commercial items.

Gallery pictures are not library items. `non-commercial/gallery/images/X.png` and
`element-gallery/{images,media}/X.*` were only previews; the mobject itself is the ManimGL class
in the sibling `mobjects/X.py`, which is imported instead. Modules whose name starts with `_`
in a `mobjects/` folder are shared helpers: they are spliced into the items that import them and
are not items of their own. Screenshots in plugin documentation (`examples_assets/`) are skipped too.
"""

from __future__ import annotations

import hashlib
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
LIB_DIR = os.path.join(HERE, "mathstudio_library")
CONVERTED = os.path.join(HERE, "mathstudio_imports.json")
CONVERTED_NC = os.path.join(HERE, "mathstudio_imports_nc.json")  # optional, not in git

SKIP_DIRS = {".git", "__pycache__", ".venv"}
SKIP_NAMES = {".DS_Store", ".gitignore"}

KIND_BY_EXT = {
    ".py": "python",
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".tif": "image", ".tiff": "image",
    ".svg": "svg",
    ".mp4": "video",
}

SOURCES = {
    "non-commercial": "3Blue1Brown (non-commercial)",
    "element-gallery": "Element gallery",
    "manim-assets": "Manim assets",
}


def license_of(rel: str) -> tuple[str, bool]:
    parts = rel.split("/")
    if parts[0] == "non-commercial":
        return "CC BY-NC-SA 4.0 — non-commercial", True
    if parts[:3] == ["manim-assets", "manimgl", "3b1b-videos"]:
        return "CC BY-NC-SA 4.0 — non-commercial", True
    if parts[0] == "manim-assets":
        return "MIT", False
    return "Own work (no third-party licence)", False


def source_of(rel: str) -> str:
    parts = rel.split("/")
    if parts[:3] == ["manim-assets", "manimgl", "3b1b-videos"]:
        return SOURCES["non-commercial"]
    if parts[0] == "manim-assets":
        return f"Manim assets · {parts[1]}" if len(parts) > 2 else "Manim assets"
    return SOURCES.get(parts[0], parts[0])


def replaced_by_code(full: str) -> bool:
    """A gallery picture / clip whose mobject exists as code (../mobjects/<stem>.py)."""
    stem = os.path.splitext(os.path.basename(full))[0]
    return os.path.isfile(os.path.join(os.path.dirname(os.path.dirname(full)), "mobjects", stem + ".py"))


def skipped(root: str, fn: str, kind: str) -> bool:
    if fn in SKIP_NAMES:
        return True
    if kind == "python" and fn.startswith("_") and os.path.basename(root) == "mobjects":
        return True  # shared helper module of a gallery
    if kind in ("image", "video"):
        if os.path.basename(root) == "examples_assets":
            return True  # documentation screenshots
        if replaced_by_code(os.path.join(root, fn)):
            return True
    return False


def scan() -> list[dict]:
    """Every file of the library, with its licence. Not cached: the converter wants a fresh view."""
    out: list[dict] = []
    for root, dirs, files in os.walk(LIB_DIR):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for fn in sorted(files):
            ext = os.path.splitext(fn)[1].lower()
            if skipped(root, fn, KIND_BY_EXT.get(ext, "other")):
                continue
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, LIB_DIR).replace(os.sep, "/")
            lic, nc = license_of(rel)
            out.append({
                "rel": rel,
                "path": full,
                "name": os.path.splitext(fn)[0].replace("_", " "),
                "ext": ext.lstrip("."),
                "kind": KIND_BY_EXT.get(ext, "other"),
                "source": source_of(rel),
                "license": lic,
                "nc": nc,
                "importable": KIND_BY_EXT.get(ext, "other") in ("python", "image", "svg", "video"),
            })
    return out


_converted: list[dict] | None = None


def converted() -> list[dict]:
    """The records written by import_convert.py ([] before the first conversion)."""
    global _converted
    if _converted is None:
        records: list[dict] = []
        for path in (CONVERTED, CONVERTED_NC):
            try:
                with open(path, encoding="utf8") as f:
                    records += json.load(f)
            except (OSError, ValueError):
                pass
        records.sort(key=lambda r: r["rel"])
        _converted = records
    return _converted


def library_items() -> list[dict]:
    """Accepted files as library items, the same shape as the built-in ones.

    `code` is the one-line body a clip uses; `prelude` is the definition that the scene
    file gets once, at the top (see codegen.effective_imports).
    """
    out = []
    for r in converted():
        if r.get("status") != "ok":
            continue
        dynamic = bool(r.get("dynamic"))
        doc = r.get("doc") or ""
        out.append({
            "id": r["slug"],
            "name": r["name"],
            "category": "Imported",
            "enter": "FadeIn",
            # classes taking a time argument `t` animate: the clip rebuilds them every frame
            "dynamic": dynamic,
            "params": [],
            "code": f"return {r['fn']}(t=t)" if dynamic else f"return {r['fn']}()",
            "prelude": r["code"],
            "fn": r["fn"],
            "rel": r["rel"],
            "kind": r["kind"],
            "source": r["source"],
            "license": r["license"],
            "nc": r["nc"],
            "importable": True,
            "desc": f"{doc} · {r['source']} · {r['license']}" if doc else f"{r['source']} · {r['license']}",
            "tags": [r["kind"], r["ext"], r["source"].lower()],
        })
    return out


def slug_for(rel: str) -> str:
    """Stable item id of a library file."""
    stem = os.path.splitext(rel)[0]
    base = re.sub(r"\W+", "_", stem).strip("_").lower()[:48]
    return f"imp_{base}_{hashlib.sha1(rel.encode()).hexdigest()[:6]}"


def aliases() -> dict[str, dict]:
    """Ids the gallery pictures had when they were items themselves -> the class item replacing them,
    so clips saved in older projects still resolve."""
    out = {}
    for it in library_items():
        parts = it["rel"].split("/")
        if len(parts) < 2 or parts[-2] != "mobjects":
            continue
        gallery = os.path.join(LIB_DIR, *parts[:-2])
        stem = os.path.splitext(parts[-1])[0]
        for sub in ("images", "media"):
            d = os.path.join(gallery, sub)
            if not os.path.isdir(d):
                continue
            for fn in os.listdir(d):
                if os.path.splitext(fn)[0] == stem:
                    out[slug_for("/".join(parts[:-2] + [sub, fn]))] = it
    return out


def failures() -> list[dict]:
    return [{"rel": r["rel"], "error": r.get("error", "")} for r in converted() if r.get("status") != "ok"]
