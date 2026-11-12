"""
"My mobjects": mobjects made from whole projects (Projects popup → ⋯ → Make into mobject…).

A project becomes one library item: `codegen.project_mobject_source` writes a self-contained
definition (the item's `prelude`, like the imported library's) that replays the project's timeline
inside a single mobject, so it can be dropped into any other project, scaled, moved, animated.

* Animated (default): a dynamic item; `t` drives the project's own clock (speed / loop / start at).
* Still: one frame of the project, chosen with the "Frame at" param.

Each item is one JSON file in <engine data>/mobjects/<id>.json (a snapshot of the project at the
time it was made; "Update" replaces it). Visibility is "public" or "private"; on the Free plan
(MATHSTUDIO_PLAN, set by the Electron main process from the account) every mobject is public:
`visibility_for` enforces that here, whatever the client asks for.
"""
from __future__ import annotations

import getpass
import json
import os
import re
import time
import uuid

CATEGORY = "My mobjects"
HEADER = "from manimlib import *\nfrom studio_runtime import *\nimport numpy as np\nimport math"

DIR: str | None = None
ITEMS: list[dict] = []


def plan() -> str:
    return "pro" if (os.environ.get("MATHSTUDIO_PLAN") or "free").strip().lower() == "pro" else "free"


def visibility_for(requested) -> str:
    """The visibility a mobject gets: private only on the Pro plan."""
    if plan() != "pro":
        return "public"
    return "private" if requested == "private" else "public"


def author() -> str:
    try:
        return os.environ.get("MATHSTUDIO_AUTHOR") or getpass.getuser()
    except Exception:  # noqa: BLE001
        return "me"


# --------------------------------------------------------------------------------------
# Storage
# --------------------------------------------------------------------------------------
def load(data_dir: str) -> list[dict]:
    global DIR, ITEMS
    DIR = os.path.join(data_dir, "mobjects")
    os.makedirs(DIR, exist_ok=True)
    items = []
    for fn in sorted(os.listdir(DIR)):
        if not fn.endswith(".json") or fn.startswith("."):
            continue
        try:
            with open(os.path.join(DIR, fn), encoding="utf8") as f:
                it = json.load(f)
            if it.get("id") and it.get("prelude") and it.get("fn"):
                items.append(it)
        except (OSError, ValueError):
            continue
    items.sort(key=lambda it: -float(it.get("updated") or 0))
    ITEMS = items
    return items


def _file(item_id: str) -> str:
    if not re.fullmatch(r"pm_[a-z0-9_]+", item_id or ""):
        raise ValueError("bad mobject id")
    return os.path.join(DIR, item_id + ".json")


def save(item: dict):
    path = _file(item["id"])
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf8") as f:
        json.dump(item, f, indent=1)
    os.replace(tmp, path)
    others = [it for it in ITEMS if it["id"] != item["id"]]
    ITEMS[:] = [item] + others


def delete(item_id: str) -> bool:
    try:
        os.unlink(_file(item_id))
    except (FileNotFoundError, ValueError):
        pass
    before = len(ITEMS)
    ITEMS[:] = [it for it in ITEMS if it["id"] != item_id]
    return len(ITEMS) != before


def by_id(item_id: str) -> dict | None:
    return next((it for it in ITEMS if it["id"] == item_id), None)


def public_item(it: dict) -> dict:
    """What the client gets (everything but nothing secret: the prelude is shown in the code view)."""
    return dict(it)


def thumb_key(it: dict) -> dict:
    """Only what changes the look: renaming or changing visibility keeps the thumbnail."""
    return {k: it.get(k) for k in ("id", "prelude", "code", "params", "dynamic", "thumb_params", "enter")}


# --------------------------------------------------------------------------------------
# Building
# --------------------------------------------------------------------------------------
def _camel(name: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", name or "")
    s = "".join(w[:1].upper() + w[1:] for w in words)[:32] or "Project"
    return ("P" + s) if s[0].isdigit() else s


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")[:28] or "project"
    return f"pm_{s}_{uuid.uuid4().hex[:6]}"


def _project_assets(project: dict) -> list[str]:
    import library
    out = set()
    for c in project.get("clips") or []:
        item = library.BY_ID.get(c.get("item"))
        if not item:
            continue
        out.update(item.get("assets") or [])  # nested project mobjects
        for p in item.get("params") or []:
            if p.get("type") == "asset":
                v = (c.get("params") or {}).get(p["id"])
                if v:
                    out.add(v)
    return sorted(out)


def _content_bounds(mobs):
    """(lo, hi) over the leaves that draw something, or None when nothing is drawn."""
    import numpy as np
    import studio_runtime as rt
    pts = []
    for m in mobs:
        for leaf in m.family_members_with_points():
            if not rt._is_invisible(leaf):
                pts.append(leaf.get_points())
    if not pts:
        return None
    p = np.vstack(pts)
    return p.min(axis=0), p.max(axis=0)


def _evaluate(project: dict, fn: str, title: str, times: list[float]):
    """Run the generated definition on its own and look at the given times.
    Returns (union of drawn bounds (lo, hi) or None, {clip name: error}, [times with content])."""
    import numpy as np
    import codegen
    src = codegen.project_mobject_source(project, fn, None, title)
    module: dict = {}
    exec(HEADER, module)
    exec(compile(src, f"<mobject {title}>", "exec"), module)
    tl = module[f"_{fn}_timeline"]()
    lo = hi = None
    errors: dict = {}
    shown = []
    for t in times:
        mobs, _ = tl.frame(t)
        for c in tl.clips:
            if c.error:
                errors.setdefault(c.name, c.error)
        b = _content_bounds(mobs)
        if b is None:
            continue
        shown.append(t)
        lo = b[0] if lo is None else np.minimum(lo, b[0])
        hi = b[1] if hi is None else np.maximum(hi, b[1])
    return (None if lo is None else (lo, hi)), errors, shown


def build(project: dict, name: str, desc: str = "", visibility: str = "public", mode: str = "animated",
          at: float | None = None, thumb_t: float | None = None, replace: str | None = None,
          source_path: str | None = None) -> dict:
    """Make (or remake) a library item from `project`. Raises ValueError with a readable message."""
    import codegen
    name = (name or "").strip() or ((project.get("settings") or {}).get("name") or "Untitled")
    clips = list(codegen.ordered_clips(project))
    if not clips:
        raise ValueError("The project has no visible clips to turn into a mobject.")
    old = by_id(replace) if replace else None
    if old and any(c.get("item") == old["id"] for c, _ in clips):
        raise ValueError(f"This project uses “{old['name']}” itself, so it can't replace it. Make a new mobject instead.")
    mode = "still" if mode == "still" else "animated"
    dur = codegen.project_duration(project)
    fn = f"PM_{_camel(name)}_{uuid.uuid4().hex[:8]}"
    at = min(max(float(at if at is not None else min(1.0, dur / 2)), 0.0), max(dur - 1e-3, 0.0))

    if mode == "animated":
        n = int(min(90, max(12, dur * 10)))
        times = [dur * i / n for i in range(n)] + [max(dur - 1e-3, 0.0)]
    else:
        times = [at]
    bounds, errors, shown = _evaluate(project, fn, name, times)
    if bounds is None:
        if errors:
            k, v = next(iter(errors.items()))
            raise ValueError(f"The project doesn't render: {k}: {v}")
        raise ValueError("Nothing is visible at that time." if mode == "still" else "Nothing in the project is ever visible.")
    bbox = None
    if mode == "animated":
        (x0, y0), (x1, y1) = bounds[0][:2], bounds[1][:2]
        bbox = (float(x0), float(y0), float(x1), float(y1))
    prelude = codegen.project_mobject_source(project, fn, bbox, name)

    import library
    num, boolean = library.num, library.boolean
    if mode == "animated":
        params = [num("speed", "Speed", 1.0, 0.1, 8, 0.1), boolean("loop", "Loop", False),
                  num("start_at", "Start at (s)", 0.0, 0, round(dur, 3), 0.1)]
        code = f"return {fn}(t=t, speed=${{speed}}, loop=${{loop}}, start_at=${{start_at}})"
        tt = thumb_t if thumb_t is not None else (shown[len(shown) // 2] if shown else at)
        thumb_params = {"start_at": round(min(max(float(tt), 0.0), dur), 3)}
    else:
        params = [num("start_at", "Frame at (s)", round(at, 3), 0, round(dur, 3), 0.1)]
        code = f"return {fn}(start_at=${{start_at}})"
        thumb_params = {}
    now = time.time() * 1000
    vis = visibility_for(visibility)
    item = {
        "id": old["id"] if old else _slug(name),
        "name": name,
        "category": CATEGORY,
        "user": True,
        "enter": "FadeIn",
        "dynamic": mode == "animated",
        "params": params,
        "code": code,
        "prelude": prelude,
        "fn": fn,
        "mode": mode,
        "duration": round(dur, 3),
        "bbox": bbox,
        "thumb_params": thumb_params,
        "assets": _project_assets(project),
        "visibility": vis,
        "author": author(),
        "source_path": source_path or (old or {}).get("source_path"),
        "source_name": (project.get("settings") or {}).get("name") or name,
        "clips": len(clips),
        "created": (old or {}).get("created") or now,
        "updated": now,
        "desc": (desc or "").strip() or f"Made from the project “{(project.get('settings') or {}).get('name') or name}” · {len(clips)} clip{'s' if len(clips) != 1 else ''} · {dur:g}s",
        "tags": ["project", "my mobject", vis, mode],
        "warnings": [f"{k}: {v}" for k, v in errors.items()],
    }
    save(item)
    return item


def update_meta(item_id: str, name=None, desc=None, visibility=None) -> dict:
    it = by_id(item_id)
    if it is None:
        raise ValueError("No such mobject")
    it = dict(it)
    if name is not None and str(name).strip():
        it["name"] = str(name).strip()
    if desc is not None:
        it["desc"] = str(desc).strip()
    if visibility is not None:
        if visibility == "private" and plan() != "pro":
            raise ValueError("Private mobjects need MathStudio Pro. On the Free plan every mobject is public.")
        it["visibility"] = visibility_for(visibility)
        it["tags"] = [t for t in it.get("tags") or [] if t not in ("public", "private")] + [it["visibility"]]
    it["updated"] = time.time() * 1000
    save(it)
    return it
