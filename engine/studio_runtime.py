"""
MathStudio runtime for ManimGL.

A timeline of *clips*. Each clip owns one mobject (built by a factory function),
lives on a track (tracks decide the drawing order / z order), and has:

  * an enter animation, an exit animation and optional "effect" animations
  * a transform (position / scale / rotation / opacity) that can be keyframed

The state of the whole scene can be evaluated at any time `t`, which is what makes
instant scrubbing in the editor possible.  `StudioScene` plays the same timeline
inside a regular ManimGL scene, so `manimgl scene.py -w` renders exactly what the
editor preview shows.
"""
from __future__ import annotations

import math
import os
import traceback

import numpy as np
from manimlib import *  # noqa: F401,F403
from manimlib.animation.animation import Animation
from manimlib.mobject.mobject import Mobject, Group
from manimlib.utils import rate_functions as _rf
from manimlib.mobject.svg.string_mobject import StringMobject as StringMobject_

# --------------------------------------------------------------------------------------
# Compatibility patches for ManimGL 1.7.x
# --------------------------------------------------------------------------------------
try:
    from manimlib.mobject.svg.text_mobject import MarkupText as _MarkupText
    if not hasattr(_MarkupText, "validate_markup_string"):
        # MarkupText / Code call this removed helper; pango validates markup itself.
        _MarkupText.validate_markup_string = staticmethod(lambda *a, **k: None)
    from manimlib.mobject.svg.string_mobject import StringMobject as _StringMobject
    from manimlib.mobject.svg.svg_mobject import SVGMobject as _SVGMobject
    if not hasattr(_StringMobject, "get_file_path_by_content"):
        # Multi-span markup (e.g. syntax highlighted Code) relies on these removed helpers
        _StringMobject.get_file_path_by_content = lambda self, content: content

        def _mobjects_from_file(self, content):
            return _SVGMobject.mobjects_from_svg_string(self, self.get_svg_string_by_content(content))
        _SVGMobject.mobjects_from_file = _mobjects_from_file
except Exception:  # pragma: no cover
    pass


try:
    # Performance: ShaderWrapper.refresh_id hashes str() of every shader source plus the uniforms
    # dict (numpy reprs via array2string) — ~0.15 ms per wrapper, paid for every submobject of every
    # freshly built / copied mobject (dynamic clips: every frame). Same batching key, built from
    # hashable parts instead: shader sources are lru-cached strings, so their hashes are cached too.
    from manimlib.shader_wrapper import ShaderWrapper as _ShaderWrapper

    def _uniform_key(v):
        if isinstance(v, np.ndarray):
            return (v.dtype.str, v.shape, v.tobytes())
        try:
            hash(v)
            return v
        except TypeError:
            return repr(v)

    def _fast_refresh_id(self):
        self.id = hash((
            tuple(self.program_code.values()),
            tuple((k, _uniform_key(v)) for k, v in self.mobject_uniforms.items()),
            self.depth_test,
            self.render_primitive,
            tuple(self.texture_paths.items()),
        ))

    _ShaderWrapper.refresh_id = _fast_refresh_id
except Exception:  # pragma: no cover
    pass


def _latex_hint() -> str:
    import sys
    if sys.platform == "darwin":
        return "install MacTeX (or BasicTeX + `sudo tlmgr install dvisvgm`)"
    return "on Ubuntu/Debian: sudo apt install texlive-latex-extra texlive-science dvisvgm"


try:
    # Tex / Equation mobjects shell out to `latex` + `dvisvgm`. Without them ManimGL raises a bare
    # FileNotFoundError (or silently draws nothing when only dvisvgm is missing): say what to install.
    import glob as _glob
    import shutil as _shutil
    from manimlib.utils import tex_file_writing as _tfw

    def _find_tex_bin(name):
        found = _shutil.which(name)
        if found:
            return found
        # GUI launches don't always inherit the shell PATH that a TeX install extends
        for d in ["/Library/TeX/texbin", *sorted(_glob.glob("/usr/local/texlive/*/bin/*"), reverse=True)]:
            if os.path.isfile(os.path.join(d, name)):
                os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
                return os.path.join(d, name)
        return None

    _full_tex_to_svg = _tfw.full_tex_to_svg

    def _checked_full_tex_to_svg(full_tex, compiler="latex", message=""):
        missing = [b for b in (compiler, "dvisvgm") if not _find_tex_bin(b)]
        if missing:
            raise RuntimeError(f"LaTeX is not installed ({', '.join(missing)} not found) — "
                               f"Tex/Equation mobjects need it; {_latex_hint()}. Text mobjects work without it.")
        return _full_tex_to_svg(full_tex, compiler, message)

    _tfw.full_tex_to_svg = _checked_full_tex_to_svg

    # ManimGL's default preamble loads 16 packages; dsfont, calligra, wasysym... only come with big
    # extras (Ubuntu texlive-fonts-extra, not in BasicTeX), and one missing .sty fails EVERY formula.
    # Drop the \usepackage lines whose package isn't installed (one kpsewhich call, cached): plain
    # maths works with a minimal TeX, only the few commands of a missing package (\mathds...) fail.
    import re as _re
    import subprocess as _sp
    _sty_ok = {}
    _USEPKG = _re.compile(r"^\s*\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}\s*$")

    def _installed_styles(names):
        todo = [n for n in names if n not in _sty_ok]
        kpse = _find_tex_bin("kpsewhich") if todo else None
        if todo and kpse:
            try:
                out = _sp.run([kpse, *[n + ".sty" for n in todo]], capture_output=True, text=True, timeout=20).stdout
                found = {os.path.basename(line.strip())[:-4] for line in out.splitlines() if line.strip().endswith(".sty")}
                for n in todo:
                    _sty_ok[n] = n in found
            except Exception:
                pass
        return {n: _sty_ok.get(n, True) for n in names}  # unknown → keep the line

    def _available_preamble(preamble):
        lines = preamble.split("\n")
        pkgs = [m.group(1) for m in map(_USEPKG.match, lines) if m and "," not in m.group(1)]
        ok = _installed_styles(pkgs)
        kept = [ln for ln in lines if not ((m := _USEPKG.match(ln)) and not ok.get(m.group(1), True))]
        if not ok.get("microtype", True):
            kept = [ln for ln in kept if "\\DisableLigatures" not in ln]
        return "\n".join(kept)

    _get_tex_config = _tfw.get_tex_config

    def _available_tex_config(template=""):
        compiler, preamble = _get_tex_config(template)
        if not _find_tex_bin(compiler):
            return compiler, preamble
        return compiler, _available_preamble(preamble)

    _tfw.get_tex_config = _available_tex_config
except Exception:  # pragma: no cover
    pass


# --------------------------------------------------------------------------------------
# Memoised text mobjects
# --------------------------------------------------------------------------------------
# Dynamic clips (code that reads `t`) rebuild their mobject every frame, and that code nearly
# always creates the same Text / Tex again (`Text(WORD, font=...)` then rotates / shifts it).
# Building one costs ~0.7 ms (markup, SVG lookup, glyph copies, restyle, centring); a copy of an
# identical one ~0.08 ms. These subclasses keep the same names (SVG cache keys and the parts
# tree use the class name) and are exported by `from studio_runtime import *`, so clip code
# picks them up; isinstance checks against manimlib's classes still hold. Only these exact
# classes are memoised — user subclasses construct normally.
import collections as _collections
from manimlib.mobject.svg.text_mobject import Text as _Text, MarkupText as _MarkupTextBase
from manimlib.mobject.svg.tex_mobject import Tex as _Tex, TexText as _TexText

_TEXT_CACHE: "_collections.OrderedDict" = _collections.OrderedDict()
_TEXT_CACHE_MAX = 512


def _text_key_part(v):
    if isinstance(v, (str, int, float, bool, type(None))):
        return v
    if isinstance(v, (list, tuple)):
        return (type(v).__name__, tuple(_text_key_part(x) for x in v))
    if isinstance(v, dict):
        return ("dict", tuple(sorted((str(k), _text_key_part(x)) for k, x in v.items())))
    if isinstance(v, np.ndarray):
        return ("nd", v.dtype.str, v.shape, v.tobytes())
    if isinstance(v, np.generic):
        return v.item()
    hash(v)  # anything else must be hashable (colours, enums...) or the call isn't memoised
    return (type(v).__qualname__, v)


class _MemoText(type(_Text)):
    def __call__(cls, *args, **kwargs):
        if cls not in _MEMO_CLASSES:
            return super().__call__(*args, **kwargs)
        try:
            key = (cls, _text_key_part(args), _text_key_part(kwargs))
            hash(key)
        except Exception:
            return super().__call__(*args, **kwargs)
        hit = _TEXT_CACHE.get(key)
        if hit is not None:
            _TEXT_CACHE.move_to_end(key)
            return hit.copy()
        mob = super().__call__(*args, **kwargs)
        _TEXT_CACHE[key] = mob.copy()
        if len(_TEXT_CACHE) > _TEXT_CACHE_MAX:
            _TEXT_CACHE.popitem(last=False)
        return mob


def _memo_class(base):
    cls = _MemoText(base.__name__, (base,), {"__module__": base.__module__, "__qualname__": base.__qualname__})
    return cls


Text = _memo_class(_Text)
MarkupText = _memo_class(_MarkupTextBase)
Tex = _memo_class(_Tex)
TexText = _memo_class(_TexText)
_MEMO_CLASSES = (Text, MarkupText, Tex, TexText)


# --------------------------------------------------------------------------------------
# Imported mobjects (mathstudio library)
# --------------------------------------------------------------------------------------
def collect_scene(scene_cls):
    """Run a Scene's construct() without a window and return what it builds as one VGroup.

    Used by the imported library: a file that is a Scene becomes a mobject, namely the
    final state of everything the scene adds or animates. Animations are finished, not played.
    """
    from manimlib.animation.animation import Animation
    collected = []

    def _backdrop(m):
        """Full-screen black plates / video-screen placeholders: scene chrome, not content."""
        try:
            from manimlib.mobject.frame import FullScreenRectangle, ScreenRectangle
            from manimlib.mobject.changing import AnimatedBoundary
            if isinstance(m, (FullScreenRectangle, AnimatedBoundary)):
                return True
            if isinstance(m, ScreenRectangle):
                return True
            if getattr(m, "get_width", None) and m.get_num_points() and m.get_width() > 12 and m.get_height() > 6.5:
                return True  # anything wider than the frame is a plate
        except Exception:
            pass
        return False

    def _keep(m):
        if isinstance(m, Mobject) and not _backdrop(m) and all(m is not c for c in collected):
            collected.append(m)

    def add(*mobs):
        for m in mobs:
            _keep(m)
        return scene

    def play(*anims, **kwargs):
        for a in anims:
            if isinstance(a, Animation):
                try:
                    a.begin()
                    a.finish()
                except Exception:
                    pass
                _keep(a.mobject)
            elif isinstance(a, Mobject):
                _keep(a)

    scene = scene_cls.__new__(scene_cls)
    scene.add = add
    scene.play = play
    scene.wait = lambda *a, **k: None
    scene.remove = lambda *mobs: None
    scene.add_sound = lambda *a, **k: None
    scene.clear = lambda *a, **k: None
    scene.bring_to_front = lambda *m: None
    scene.bring_to_back = lambda *m: None
    scene.construct()
    return VGroup(*collected)


# --------------------------------------------------------------------------------------
# Assets
# --------------------------------------------------------------------------------------
ASSET_DIRS: list[str] = []


_VERIFIED: dict = {}


def _verify(path: str) -> str:
    """Make sure raster images decode, so a broken file fails its own clip instead of the renderer."""
    ext = os.path.splitext(path)[1].lower()
    if ext in (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tif", ".tiff"):
        key = (path, os.path.getmtime(path))
        if key not in _VERIFIED:
            from PIL import Image
            try:
                with Image.open(path) as im:
                    im.load()
            except Exception as e:
                raise ValueError(f"Cannot read image {os.path.basename(path)}: {e}")
            _VERIFIED[key] = True
    return path


def asset(name: str) -> str:
    """Resolve an asset (image / svg) path."""
    return _verify(_find_asset(name))


def _find_asset(name: str) -> str:
    if os.path.isabs(name) and os.path.exists(name):
        return name
    for d in ASSET_DIRS + [os.path.join(os.getcwd(), "assets"), os.getcwd()]:
        p = os.path.join(d, name)
        if os.path.exists(p):
            return p
    base = os.path.basename(name)
    for d in ASSET_DIRS + [os.path.join(os.getcwd(), "assets")]:
        p = os.path.join(d, base)
        if os.path.exists(p):
            return p
    raise FileNotFoundError(f"Asset not found: {name}")


# --------------------------------------------------------------------------------------
# Rate functions
# --------------------------------------------------------------------------------------
RATES = {
    "smooth": _rf.smooth,
    "linear": _rf.linear,
    "rush_into": _rf.rush_into,
    "rush_from": _rf.rush_from,
    "double_smooth": _rf.double_smooth,
    "there_and_back": _rf.there_and_back,
    "overshoot": _rf.overshoot,
    "running_start": _rf.running_start,
    "lingering": _rf.lingering,
}


def rate(name: str | None):
    return RATES.get(name or "smooth", _rf.smooth)


# --------------------------------------------------------------------------------------
# Animation catalogue
# --------------------------------------------------------------------------------------
def _is_vmob(m):
    return isinstance(m, VMobject)


def _anim_or_fade(factory):
    """Use the animation if the mobject is vectorised, otherwise fall back to a fade."""
    def build(m, **kw):
        if _is_vmob(m):
            return factory(m, **kw)
        return FadeIn(m, **kw)
    return build


class SpinInFromNothing(GrowFromCenter):
    def __init__(self, mobject, **kwargs):
        kwargs.setdefault("path_arc", PI)
        super().__init__(mobject, **kwargs)


def _typewriter(m, **kw):
    kw.pop("rate_func", None)
    if len(m.submobjects) <= 1:
        return FadeIn(m, rate_func=linear, **kw)
    return ShowIncreasingSubsets(m, rate_func=linear, **kw)


def _draw_border(m, **kw):
    if _is_vmob(m):
        kw.pop("rate_func", None)
        return DrawBorderThenFill(m, **kw)
    return FadeIn(m, **kw)


def _write(m, **kw):
    if _is_vmob(m):
        return Write(m, **kw)
    return FadeIn(m, **kw)


# name -> (label, builder)        builder(mobject, rate_func=...) -> Animation
ENTER_ANIMS = {
    "none":            ("Cut (no animation)", None),
    "FadeIn":          ("Fade In", lambda m, **kw: FadeIn(m, **kw)),
    "FadeInUp":        ("Fade In ↑", lambda m, **kw: FadeIn(m, shift=0.6 * UP, **kw)),
    "FadeInDown":      ("Fade In ↓", lambda m, **kw: FadeIn(m, shift=0.6 * DOWN, **kw)),
    "FadeInLeft":      ("Fade In ←", lambda m, **kw: FadeIn(m, shift=0.6 * LEFT, **kw)),
    "FadeInRight":     ("Fade In →", lambda m, **kw: FadeIn(m, shift=0.6 * RIGHT, **kw)),
    "FadeInSmall":     ("Zoom In (grow)", lambda m, **kw: FadeIn(m, scale=2.0, **kw)),
    "FadeInLarge":     ("Zoom In (shrink)", lambda m, **kw: FadeIn(m, scale=0.5, **kw)),
    "GrowFromCenter":  ("Grow From Center", lambda m, **kw: GrowFromCenter(m, **kw)),
    "GrowFromLeft":    ("Grow From Left", lambda m, **kw: GrowFromEdge(m, LEFT, **kw)),
    "GrowFromBottom":  ("Grow From Bottom", lambda m, **kw: GrowFromEdge(m, DOWN, **kw)),
    "SpinIn":          ("Spin In", lambda m, **kw: SpinInFromNothing(m, **kw)),
    "Write":           ("Write", _write),
    "ShowCreation":    ("Show Creation", _anim_or_fade(lambda m, **kw: ShowCreation(m, **kw))),
    "DrawBorderThenFill": ("Draw Border Then Fill", _draw_border),
    "Typewriter":      ("Typewriter", _typewriter),
}

# Exit animations. "reverse" ones play an enter animation backwards.
EXIT_ANIMS = {
    "none":            ("Cut (no animation)", None),
    "FadeOut":         ("Fade Out", lambda m, **kw: FadeOut(m, final_alpha_value=1.0, **kw)),
    "FadeOutUp":       ("Fade Out ↑", lambda m, **kw: FadeOut(m, shift=0.6 * UP, final_alpha_value=1.0, **kw)),
    "FadeOutDown":     ("Fade Out ↓", lambda m, **kw: FadeOut(m, shift=0.6 * DOWN, final_alpha_value=1.0, **kw)),
    "FadeOutLeft":     ("Fade Out ←", lambda m, **kw: FadeOut(m, shift=0.6 * LEFT, final_alpha_value=1.0, **kw)),
    "FadeOutRight":    ("Fade Out →", lambda m, **kw: FadeOut(m, shift=0.6 * RIGHT, final_alpha_value=1.0, **kw)),
    "FadeOutSmall":    ("Zoom Out (shrink)", lambda m, **kw: FadeOut(m, scale=0.5, final_alpha_value=1.0, **kw)),
    "FadeOutLarge":    ("Zoom Out (grow)", lambda m, **kw: FadeOut(m, scale=2.0, final_alpha_value=1.0, **kw)),
    "ShrinkToCenter":  ("Shrink To Center", "reverse:GrowFromCenter"),
    "SpinOut":         ("Spin Out", "reverse:SpinIn"),
    "Uncreate":        ("Uncreate", "reverse:ShowCreation"),
    "Unwrite":         ("Unwrite", "reverse:Write"),
    "TransformInto":   ("Transform Into…", "transform"),
    "TransformMatching": ("Transform Matching Parts…", "transform_matching"),
}

EFFECTS = {
    "Indicate":       ("Indicate", lambda m, **kw: Indicate(m, **kw)),
    "Wiggle":         ("Wiggle", lambda m, **kw: WiggleOutThenIn(m, **kw)),
    "Pulse":          ("Pulse", lambda m, **kw: ScaleInPlace(m, 1.25, rate_func=there_and_back)),
    "Spin":           ("Spin 360°", lambda m, **kw: Rotate(m, TAU, **kw)),
    "Flip":           ("Flip", lambda m, **kw: Rotate(m, PI, axis=UP, **kw)),
    "FlashAround":    ("Flash Around", lambda m, **kw: FlashAround(m, **kw)),
    "Flash":          ("Flash", lambda m, **kw: Flash(m.get_center(), flash_radius=max(m.get_width(), m.get_height()) / 2 + 0.3, **kw)),
    "CircleIndicate": ("Circle Indicate", lambda m, **kw: CircleIndicate(m, **kw)),
    "ApplyWave":      ("Wave", lambda m, **kw: ApplyWave(m, **kw)),
    "ColorPulse":     ("Color Pulse (yellow)", lambda m, **kw: _color_pulse(m, **kw)),
}


def _color_pulse(m, **kw):
    target = m.copy().set_color(YELLOW)
    kw.pop("rate_func", None)
    return Transform(m, target, rate_func=there_and_back)


def animation_catalogue():
    return {
        "enter": [{"id": k, "label": v[0]} for k, v in ENTER_ANIMS.items()],
        "exit": [{"id": k, "label": v[0]} for k, v in EXIT_ANIMS.items()],
        "effects": [{"id": k, "label": v[0]} for k, v in EFFECTS.items()],
        "rates": list(RATES.keys()),
    }


# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------
def multiply_opacity(mob: Mobject, factor: float):
    if factor >= 0.999:
        return
    factor = max(0.0, float(factor))
    for sm in mob.get_family():
        names = sm.data.dtype.names if sm.data is not None else ()
        changed = False
        for name in names:
            if name.endswith("rgba"):
                sm.data[name][:, 3] *= factor
                changed = True
            elif name == "opacity":
                sm.data[name][:, 0] *= factor
                changed = True
        if changed:
            sm.note_changed_data(recurse_up=False)


def apply_transform(mob: Mobject, tr: dict):
    s = tr.get("scale", 1.0)
    if abs(s - 1.0) > 1e-9:
        mob.scale(max(s, 1e-4), about_point=ORIGIN)
    r = tr.get("rotation", 0.0)
    if abs(r) > 1e-9:
        mob.rotate(r * DEG, about_point=ORIGIN)
    # 3D orientation: after spinning in its own plane, tip the clip about x, then turn it about y
    # (rx = -90 lays flat XY content on the XZ floor, readable from above, top edge away from the viewer)
    rx = tr.get("rx", 0.0) or 0.0
    if abs(rx) > 1e-9:
        mob.rotate(rx * DEG, axis=RIGHT, about_point=ORIGIN)
    ry = tr.get("ry", 0.0) or 0.0
    if abs(ry) > 1e-9:
        mob.rotate(ry * DEG, axis=UP, about_point=ORIGIN)
    x, y, z = tr.get("x", 0.0), tr.get("y", 0.0), tr.get("z", 0.0)
    if abs(x) > 1e-9 or abs(y) > 1e-9 or abs(z) > 1e-9:
        mob.shift(np.array([x, y, z]))
    multiply_opacity(mob, tr.get("opacity", 1.0))


def keep_origin(mob, point=ORIGIN):
    """Pad `mob`'s bounding box with invisible points so that it is centred on `point`.

    MathStudio centres every clip on its bounding box; use this so that, for example, the
    origin of a set of 3D axes stays exactly at the clip's position."""
    p = np.array(point, dtype=float)
    box = mob.get_bounding_box()
    ext = np.maximum(np.abs(box[0] - p), np.abs(box[2] - p))
    mob.add(VectorizedPoint(p - ext), VectorizedPoint(p + ext))
    return mob


TRANSFORM_KEYS = ("x", "y", "z", "scale", "rotation", "rx", "ry", "opacity")
DEFAULT_TRANSFORM = {"x": 0.0, "y": 0.0, "z": 0.0, "scale": 1.0, "rotation": 0.0, "rx": 0.0, "ry": 0.0, "opacity": 1.0}


def interp_keys(keys: list, u: float, base: dict, names=TRANSFORM_KEYS, defaults=DEFAULT_TRANSFORM) -> dict:
    """keys: list of dicts {t, x, y, z, scale, rotation, opacity, ease} (t relative to clip start)."""
    if not keys:
        return {k: base.get(k, defaults[k]) for k in names}
    ks = sorted(keys, key=lambda k: k["t"])
    if u <= ks[0]["t"]:
        return {k: ks[0].get(k, base.get(k, defaults[k])) for k in names}
    if u >= ks[-1]["t"]:
        return {k: ks[-1].get(k, base.get(k, defaults[k])) for k in names}
    for a, b in zip(ks, ks[1:]):
        if a["t"] <= u <= b["t"]:
            span = max(b["t"] - a["t"], 1e-9)
            alpha = rate(b.get("ease", "smooth"))((u - a["t"]) / span)
            out = {}
            for k in names:
                va = a.get(k, base.get(k, defaults[k]))
                vb = b.get(k, base.get(k, defaults[k]))
                out[k] = va + (vb - va) * alpha
            return out
    return {k: base.get(k, defaults[k]) for k in names}


# --------------------------------------------------------------------------------------
# Clip
# --------------------------------------------------------------------------------------
class Clip:
    def __init__(
        self,
        factory,
        id: str,
        start: float = 0.0,
        duration: float = 3.0,
        layer: int = 0,
        transform: dict | None = None,
        keys: list | None = None,
        enter: tuple | None = None,
        exit: tuple | None = None,
        effects: list | None = None,
        dynamic: bool = False,
        name: str = "",
        cache_key=None,
        fixed: bool = False,
        parts: dict | None = None,
    ):
        self.factory = factory
        self.id = id
        self.name = name or id
        self.start = float(start)
        self.duration = max(float(duration), 1e-3)
        self.layer = layer
        self.transform = {**DEFAULT_TRANSFORM, **(transform or {})}
        self.keys = keys or []
        # enter / exit: (type, duration, rate, target_id)
        self.enter = _norm_anim(enter)
        self.exit = _norm_anim(exit)
        self.effects = [_norm_effect(e) for e in (effects or [])]
        self.dynamic = dynamic
        # fixed = pinned to the screen: ignores the camera (titles / labels over a 3D scene)
        self.fixed = bool(fixed)
        self.cache_key = cache_key
        # per-submobject timing of a group: {path: {at, until, enter, exit}} (see set_parts)
        self.parts: dict = {}
        # per-part position offsets: {path: (dx, dy)} in the clip's own units (moved parts)
        self.offsets: dict = {}
        self._units = None
        self._units_key = None
        self._base = None
        self._raw = None
        self.set_parts(parts)
        self.error: str | None = None
        # runtime caches
        self._base_size = (0.0, 0.0)
        self._base_depth = 0.0
        # visible-content box of the base, relative to its centre: (cx, cy, w, h), or None = same as the full box
        self._vis = None
        self._display = None
        self._display_key = None
        self._anim_cache = {}

    @property
    def end(self):
        return self.start + self.duration

    # -- building -----------------------------------------------------------------
    def build_base(self, u: float = 0.0):
        if self._base is not None and not self.dynamic:
            return self._base
        if self._raw is None or self.dynamic:
            a = u / self.duration if self.duration else 0.0
            try:
                mob = self.factory(u, a) if self.dynamic else self.factory()
            except TypeError:
                mob = self.factory()
            if not isinstance(mob, Mobject):
                raise TypeError(f"factory must return a Mobject, got {type(mob).__name__}")
            mob.move_to(ORIGIN)
            if self.fixed:
                mob.fix_in_frame()
            self._raw = mob
        mob = self._raw
        if self.offsets:
            # moved parts: shifted after centring, so moving one part never moves the others
            if not self.dynamic:
                mob = mob.copy()
            apply_part_offsets(mob, self.offsets)
        self._base = mob
        self._base_size = (float(mob.get_width()), float(mob.get_height()))
        self._base_depth = float(mob.get_depth())
        self._vis = _visible_box([mob], self._base_size)
        if self._vis is None and self.offsets:
            # every leaf draws, but moved parts put the box off the clip's pivot
            c = mob.get_center()
            if abs(c[0]) > 1e-4 or abs(c[1]) > 1e-4:
                self._vis = (float(c[0]), float(c[1]), self._base_size[0], self._base_size[1])
        if self._display is None or self.dynamic:
            self._display = mob.copy()
            self._display_key = None
        return mob

    def transform_at(self, u: float) -> dict:
        return interp_keys(self.keys, u, self.transform)

    # -- timing ---------------------------------------------------------------------
    def windows(self):
        ed = self.enter[1] if self.enter[0] != "none" else 0.0
        xd = self.exit[1] if self.exit[0] != "none" else 0.0
        total = ed + xd
        if total > self.duration:
            f = self.duration / total
            ed, xd = ed * f, xd * f
        return ed, xd

    def phase(self, u: float):
        ed, xd = self.windows()
        if ed > 0 and u < ed:
            return ("enter", u / ed)
        if xd > 0 and u > self.duration - xd:
            return ("exit", min(1.0, (u - (self.duration - xd)) / xd))
        for i, eff in enumerate(self.effects):
            if eff[1] <= u < eff[1] + eff[2]:
                return (f"effect{i}", (u - eff[1]) / max(eff[2], 1e-6))
        return ("hold", 0.0)

    # -- animation instances ----------------------------------------------------------
    def _make_anim(self, kind: str, local_mob, timeline: "Timeline"):
        if kind == "enter":
            name, _, rname, _ = self.enter
            builder = ENTER_ANIMS.get(name, (None, None))[1]
            if builder is None:
                return None, False
            return builder(local_mob, rate_func=rate(rname)), False
        if kind == "exit":
            name, _, rname, target = self.exit
            spec = EXIT_ANIMS.get(name, (None, None))[1]
            if spec is None:
                return None, False
            if isinstance(spec, str) and spec.startswith("reverse:"):
                builder = ENTER_ANIMS[spec.split(":", 1)[1]][1]
                return builder(local_mob, rate_func=rate(rname)), True
            if isinstance(spec, str):  # transform kinds are handled separately
                return None, False
            return spec(local_mob, rate_func=rate(rname)), False
        if kind.startswith("effect"):
            i = int(kind[6:])
            ename, _, _, rname = self.effects[i]
            builder = EFFECTS.get(ename, (None, None))[1]
            if builder is None:
                return None, False
            kw = {}
            if ename not in ("Pulse", "ColorPulse"):
                kw["rate_func"] = rate(rname)
            return builder(local_mob, **kw), False
        return None, False

    def _anim_for(self, kind: str, alpha: float, timeline):
        """Returns (animation, reversed) prepared so it can be interpolated to alpha.
        Animations are reused while time moves forward and rebuilt when scrubbing back."""
        ent = self._anim_cache.get(kind)
        if ent is not None and not self.dynamic:
            anim, rev, last, _local = ent
            eff_alpha = 1 - alpha if rev else alpha
            # Most manim animations are only safe to interpolate forwards; reversed
            # (exit) animations are therefore rebuilt unless alpha is unchanged.
            if (not rev and eff_alpha >= last - 1e-9) or abs(eff_alpha - last) < 1e-9:
                return anim, rev
        local = self._base.copy()
        anim, rev = self._make_anim(kind, local, timeline)
        if anim is None:
            self._anim_cache.pop(kind, None)
            return None, False
        anim.begin()
        self._anim_cache[kind] = [anim, rev, 0.0, local]
        return anim, rev

    # -- per-frame evaluation -----------------------------------------------------------
    def set_fixed(self, fixed: bool):
        fixed = bool(fixed)
        if fixed == self.fixed:
            return
        self.fixed = fixed
        for m in {id(x): x for x in (self._raw, self._base, self._display) if x is not None}.values():
            if m is not None:
                (m.fix_in_frame if fixed else m.unfix_from_frame)()
        self._display_key = None
        self._anim_cache.clear()

    def mobjects_at(self, t: float, timeline: "Timeline") -> list:
        ms = self._mobjects_at(t, timeline)
        if self.fixed:
            for m in ms:
                if not m.is_fixed_in_frame():
                    m.fix_in_frame()
        return ms

    def _mobjects_at(self, t: float, timeline: "Timeline") -> list:
        if getattr(self, "_fatal", None):
            raise RuntimeError(self._fatal)
        u = t - self.start
        self.build_base(u)
        tr = self.transform_at(u)
        kind, alpha = self.phase(u)

        if kind == "exit" and self.exit[0] in ("TransformInto", "TransformMatching") and self.exit[3]:
            res = self._transform_into(alpha, timeline)
            if res is not None:
                return res

        if self.parts:
            return self._parts_mobjects(t, u, tr, kind, alpha, timeline)

        if kind != "hold":
            anim, rev = self._anim_for(kind, alpha, timeline)
            if anim is not None:
                a = 1.0 - alpha if rev else alpha
                anim.interpolate(a)
                ent = self._anim_cache[kind]
                ent[2] = a
                local = ent[3]
                if anim.mobject is local:
                    display = self._display
                    display.become(local)
                    apply_transform(display, tr)
                    self._display_key = None
                    return [display]
                # animation that brings its own mobjects (Flash, FlashAround, ...)
                extra = anim.mobject.copy()
                apply_transform(extra, tr)
                return [self._hold_display(tr), extra]
        return [self._hold_display(tr)]

    def _hold_display(self, tr):
        key = tuple(round(tr[k], 6) for k in TRANSFORM_KEYS)
        if self._display_key != key or self.dynamic:
            self._display.become(self._base)
            apply_transform(self._display, tr)
            self._display_key = key
        return self._display

    def world_state(self, u: float):
        """A copy of the clip's fully-shown mobject at local time u, in world space."""
        self.build_base(u)
        if self.parts:
            # only the parts that are on screen at u
            shown = [un._base.copy() for un in self._parts_units() if un.offset <= u + 1e-9 < un.offset + un.duration]
            m = (VGroup if all(isinstance(x, VMobject) for x in shown) else Group)(*shown)
        else:
            m = self._base.copy()
        apply_transform(m, self.transform_at(u))
        return m

    # -- parts: timing for the submobjects of a group ------------------------------------
    def set_parts(self, parts):
        """parts: {path: {at, until, enter, exit}} where path = child indices from the clip's mobject
        ("2", "1.0"...). at / until are seconds from the clip start at which that part appears /
        disappears; enter / exit are (type, duration, rate). A field a part leaves out comes from its
        nearest ancestor part that sets it, else from the clip. Parts without an entry (and
        everything when parts is empty) follow the clip."""
        norm = {}
        offsets = {}
        for path, spec in (parts or {}).items():
            path = str(path)
            if not _PATH.match(path) or not isinstance(spec, dict):
                continue
            try:
                dx, dy = float(spec.get("dx") or 0.0), float(spec.get("dy") or 0.0)
            except (TypeError, ValueError):
                dx = dy = 0.0
            if abs(dx) > 1e-9 or abs(dy) > 1e-9:
                offsets[path] = (dx, dy)
            ent = {}
            for k in ("at", "until"):
                if spec.get(k) is not None:
                    ent[k] = float(spec[k])
            for k in ("enter", "exit"):
                if spec.get(k) is not None:
                    a = _norm_anim(spec[k])
                    if k == "exit" and a[0] in ("TransformInto", "TransformMatching"):
                        a = ("none", 0.0, "smooth", None)  # a part can't morph on its own
                    ent[k] = a[:3] + (None,)
            if ent:  # position-only entries don't cut the clip into timing units
                norm[path] = ent
        if offsets != self.offsets:
            self.offsets = offsets
            self._base = None  # rebuilt from the cached raw mobject on the next frame
            self._display_key = None
            self._units = None
            self._units_key = None
            self._anim_cache = {}
        if norm != self.parts:
            self.parts = norm
            self._units = None
            self._units_key = None

    def _parts_units(self):
        """The clip's mobject cut into units that share one timing (cached per built base)."""
        base = self._base
        paths = tuple(sorted(self.parts))
        key = (id(base), paths)
        if self._units is None or self._units_key != key or self.dynamic:
            groups: dict = {}
            _split(base, "", None, self.parts, groups)
            same_paths = self._units_key is not None and self._units_key[1] == paths
            old = {un.part_key: un for un in (self._units or [])} if same_paths else {}
            units = []
            for pk, mobs in groups.items():
                un = old.get(pk) or _PartClip(self, pk)
                un.set_group(mobs)
                units.append(un)
            # draw order follows the mobject's own order (first part of the family = back)
            order = {pk: i for i, pk in enumerate(groups)}
            units.sort(key=lambda un: order[un.part_key])
            self._units = units
            self._units_key = key
        for un in self._units:
            un.sync_timing()
        return self._units

    def _parts_mobjects(self, t, u, tr, kind, alpha, timeline):
        out = []
        for un in self._parts_units():
            if un.start - 1e-9 <= t < un.end:
                out.extend(un._mobjects_at(t, timeline))
        # clip effects (Indicate, Wiggle...) act on everything that's on screen
        ek = self._effect_at(u)
        if ek is not None and out:
            kind_e, alpha_e = ek
            grp = (VGroup if all(isinstance(m, VMobject) for m in out) else Group)(*[m.copy() for m in out])
            anim, _ = self._make_anim(kind_e, grp, timeline)
            if anim is not None:
                anim.begin()
                anim.interpolate(alpha_e)
                if anim.mobject is grp:
                    return list(grp.submobjects)
                return out + [anim.mobject.copy()]
        return out

    def _effect_at(self, u):
        for i, eff in enumerate(self.effects):
            if eff[1] <= u < eff[1] + eff[2]:
                return (f"effect{i}", (u - eff[1]) / max(eff[2], 1e-6))
        return None

    def _transform_into(self, alpha, timeline):
        target = timeline.by_id.get(self.exit[3])
        if target is None:
            return None
        try:
            ed, xd = self.windows()
            key = ("tx", self.exit[3])
            ent = self._anim_cache.get(key)
            # both ends are fixed instants (source at its exit, target at its start) even for dynamic
            # clips, so the morph is built once; rebuilding it every frame cost 30-40 ms per frame
            if ent is None or alpha < ent[2] - 1e-9:
                src = self.world_state(self.duration - xd)
                dst = target.world_state(0.0)
                if self.exit[0] == "TransformMatching" and _is_string_mob(src) and _is_string_mob(dst):
                    anim = TransformMatchingStrings(src, dst, rate_func=rate(self.exit[2]))
                else:
                    anim = ReplacementTransform(src, dst, rate_func=rate(self.exit[2]))
                anim.begin()
                ent = [anim, False, 0.0, None]
                self._anim_cache[key] = ent
            anim = ent[0]
            anim.interpolate(alpha)
            ent[2] = alpha
            return [anim.mobject]
        except Exception as e:  # pragma: no cover - fall back to fade
            self.error = f"Transform failed: {e}"
            return None


_PATH = __import__("re").compile(r"^\d+(\.\d+)*$")


def part_at(mob, path: str):
    """The submobject at a child-index path ("2", "1.0"...), or None when the mobject has no such part."""
    m = mob
    for seg in path.split("."):
        i = int(seg)
        if i >= len(m.submobjects):
            return None
        m = m.submobjects[i]
    return m


def apply_part_offsets(mob, offsets: dict):
    """Shift parts of a (centred) clip mobject: offsets = {path: (dx, dy)} in the clip's own units.
    A part inside a moved group moves with it and adds its own offset."""
    for path in sorted(offsets, key=lambda p: [int(x) for x in p.split(".")]):
        m = part_at(mob, path)
        if m is not None:
            dx, dy = offsets[path]
            m.shift(np.array([dx, dy, 0.0]))
    return mob


def _split(node, path, inherited, parts, groups):
    """Cut `node` into units: every mobject goes to the timing of its nearest overridden ancestor
    (inherited = that part's path, None = the clip). A node with no override below it stays whole."""
    key = path if path in parts else inherited
    prefix = path + "." if path else ""
    if not any(p.startswith(prefix) and p != path for p in parts):
        groups.setdefault(key, []).append(node.copy())
        return
    if node.has_points():
        own = node.copy()
        own.set_submobjects([])
        groups.setdefault(key, []).append(own)
    for i, child in enumerate(node.submobjects):
        _split(child, f"{prefix}{i}", key, parts, groups)


class _PartClip(Clip):
    """One unit of a clip with part timing: the parts that share one start / end / enter / exit.
    It is played like a clip of its own, in the parent clip's coordinates and transform."""

    def __init__(self, parent: Clip, part_key):
        super().__init__(lambda: VGroup(), id=f"{parent.id}:{part_key or '*'}", dynamic=parent.dynamic)
        self.parent = parent
        self.part_key = part_key
        self.offset = 0.0
        self._timing = None

    def set_group(self, mobs):
        grp = (VGroup if all(isinstance(m, VMobject) for m in mobs) else Group)(*mobs)
        self._base = grp
        self._display = grp.copy()
        self._display_key = None
        self._base_size = (float(grp.get_width()), float(grp.get_height()))
        if self.dynamic:
            self._anim_cache.clear()

    def build_base(self, u: float = 0.0):
        return self._base

    def sync_timing(self):
        p = self.parent
        # fields a part doesn't set come from its nearest overridden ancestor, then from the clip
        spec = {}
        if self.part_key is not None:
            segs = self.part_key.split(".")
            for i in range(1, len(segs) + 1):
                spec.update(p.parts.get(".".join(segs[:i]), {}))
        at = min(max(spec.get("at", 0.0), 0.0), p.duration)
        until = min(max(spec.get("until", p.duration), at), p.duration)
        enter = spec.get("enter", p.enter)
        ex = spec.get("exit")
        if ex is None:
            # the clip's morph replaces the whole clip at its end; parts don't exit on their own then
            ex = ("none", 0.0, "smooth", None) if p.exit[0] in ("TransformInto", "TransformMatching") else p.exit
        timing = (p.start, at, until, enter, ex, p.fixed)
        if timing != self._timing:
            if self._timing is None or self._timing[3:] != timing[3:] or self._timing[2] - self._timing[1] != until - at:
                self._anim_cache.clear()
            self._timing = timing
            self.offset = at
            self.start = p.start + at
            self.duration = max(until - at, 1e-6) if until > at else 0.0
            self.enter, self.exit = enter, ex
            self.set_fixed(p.fixed)

    @property
    def end(self):
        return self.start + self.duration if self.duration > 0 else self.start - 1.0

    def transform_at(self, u: float) -> dict:
        return self.parent.transform_at(u + self.offset)


def parts_tree(mob, names: dict | None = None, max_depth: int = 4, max_children: int = 120):
    """The structure of a clip's mobject for the timeline: [{path, type, label, n, bbox, children}].
    names maps id(mobject) -> the variable it was bound to in the clip's code."""
    names = names or {}
    budget = [600]

    def label_of(m, parent, i):
        if id(m) in names:
            return names[id(m)]
        if parent is not None and isinstance(parent, StringMobject_):
            try:
                subs = parent.get_symbol_substrings()
                if len(subs) == len(parent.submobjects):
                    return subs[i]
            except Exception:
                pass
        if isinstance(m, StringMobject_):
            try:
                s = str(m.get_string()).strip()
                return s if len(s) <= 24 else s[:23] + "…"
            except Exception:
                pass
        return None

    def kind_of(m):
        n = type(m).__name__
        return {"VMobjectFromSVGPath": "glyph", "SVGPathMobject": "path"}.get(n, n)

    def walk(m, path, depth, parent, i):
        budget[0] -= 1
        lo, hi = m.get_bounding_box()[0], m.get_bounding_box()[2]
        node = {"path": path, "type": kind_of(m), "label": label_of(m, parent, i), "n": len(m.submobjects),
                "bbox": [round(float(lo[0]), 4), round(float(lo[1]), 4), round(float(hi[0]), 4), round(float(hi[1]), 4)]}
        if m.submobjects and depth < max_depth and budget[0] > 0:
            kids = []
            for j, c in enumerate(m.submobjects[:max_children]):
                if budget[0] <= 0:
                    break
                kids.append(walk(c, f"{path}.{j}" if path else str(j), depth + 1, m, j))
            node["children"] = kids
            if len(kids) < len(m.submobjects):
                node["truncated"] = True
        return node

    return walk(mob, "", 0, None, 0)


def capture_names(fn, *args):
    """Call a clip factory and remember which local variable each mobject was bound to."""
    import sys
    code = getattr(fn, "__code__", None)
    seen: dict = {}

    def prof(frame, event, arg):
        if event == "return" and frame.f_code is code:
            seen.update(frame.f_locals)
    old = sys.getprofile()
    sys.setprofile(prof)
    try:
        mob = fn(*args)
    finally:
        sys.setprofile(old)
    names: dict = {}
    for k, v in seen.items():
        if k.startswith("_") or k in ("t", "a"):
            continue
        if isinstance(v, Mobject):
            names.setdefault(id(v), k)
        elif isinstance(v, (list, tuple)) and len(v) <= 200:
            for j, x in enumerate(v):
                if isinstance(x, Mobject):
                    names.setdefault(id(x), f"{k}[{j}]")
    names.pop(id(mob), None)
    return mob, names


def _is_string_mob(m):
    from manimlib.mobject.svg.string_mobject import StringMobject
    return isinstance(m, StringMobject)


def _same_structure(a, b):
    try:
        return len(a.get_family()) == len(b.get_family()) and type(a) is type(b)
    except Exception:
        return False


def _norm_anim(spec):
    if spec is None:
        return ("none", 0.0, "smooth", None)
    if isinstance(spec, str):
        return (spec, 1.0, "smooth", None)
    spec = list(spec) + [None] * 4
    return (spec[0] or "none", float(spec[1] if spec[1] is not None else 1.0), spec[2] or "smooth", spec[3])


def _norm_effect(e):
    # (type, at, duration, rate)
    e = list(e) + [None] * 4
    return (e[0], float(e[1] or 0.0), float(e[2] or 1.0), e[3] or "smooth")


# --------------------------------------------------------------------------------------
# Timeline
# --------------------------------------------------------------------------------------
CAMERA_KEYS = ("x", "y", "z", "zoom", "theta", "phi", "gamma")
DEFAULT_CAMERA = {"x": 0.0, "y": 0.0, "z": 0.0, "zoom": 1.0, "theta": 0.0, "phi": 0.0, "gamma": 0.0}


def camera_at(keys: list, t: float) -> dict:
    """keys: [{t, x, y, z, zoom, theta, phi, gamma, ease}] in absolute scene time.

    (x, y, z) is the point the camera looks at (the centre of the frame), zoom 1 = the default
    frame, and theta / phi / gamma are ManimGL's Euler angles in degrees (frame.reorient):
    phi tilts the camera away from looking straight down the z axis, theta turns it around z.
    """
    if not keys:
        return dict(DEFAULT_CAMERA)
    cam = interp_keys(keys, t, DEFAULT_CAMERA, CAMERA_KEYS, DEFAULT_CAMERA)
    cam["zoom"] = max(cam["zoom"], 1e-3)
    return cam


def apply_camera(frame, cam: dict):
    """Point a ManimGL CameraFrame: centre (x, y, z), zoom (1 = default view) and orientation."""
    zoom = max(float(cam.get("zoom", 1.0)), 1e-3)
    frame.set_euler_angles(float(cam.get("theta", 0.0)), float(cam.get("phi", 0.0)), float(cam.get("gamma", 0.0)), units=DEG)
    frame.set_height(FRAME_HEIGHT / zoom, stretch=False)
    frame.set_width(FRAME_WIDTH / zoom, stretch=False)
    frame.move_to(np.array([float(cam.get("x", 0.0)), float(cam.get("y", 0.0)), float(cam.get("z", 0.0))]))


class Timeline:
    def __init__(self, camera: list | None = None):
        self.clips: list[Clip] = []
        self.by_id: dict[str, Clip] = {}
        self.camera = camera or []

    def add(self, clip: Clip):
        self.clips.append(clip)
        self.by_id[clip.id] = clip
        return clip

    def clip(self, factory, **kwargs):
        """Same signature as StudioScene.clip (used by mobjects made from projects)."""
        return self.add(Clip(factory, **kwargs))

    def duration(self):
        return max([c.end for c in self.clips] + [0.0])

    def frame(self, t: float, collect_info: bool = False):
        """Returns (mobjects in draw order, info dict per clip)."""
        mobs = []
        info = {}
        # higher layer value = further back. draw back-to-front
        active = [c for c in self.clips if c.start <= t < c.end]
        active.sort(key=lambda c: -c.layer)
        for c in active:
            try:
                ms = c.mobjects_at(t, self)
                c.error = None
            except Exception as e:
                c.error = f"{type(e).__name__}: {e}"
                if "took longer than" in str(e):
                    c._fatal = c.error  # don't re-run an endless factory every frame
                if os.environ.get("MATHSTUDIO_DEBUG"):
                    traceback.print_exc()
                continue
            mobs.extend(ms)
            if collect_info:
                info[c.id] = _clip_info(c, t, ms)
        return mobs, info


# --------------------------------------------------------------------------------------
# Mobjects made from projects: a whole MathStudio timeline replayed inside one mobject
# --------------------------------------------------------------------------------------
import weakref as _weakref

_PROJECT_TIMELINES: "_weakref.WeakKeyDictionary" = _weakref.WeakKeyDictionary()


def project_mobject(build, t=0.0, duration=None, bbox=None, speed=1.0, loop=False, start_at=0.0):
    """The frame of a project's timeline at time `start_at + t * speed`, as one mobject.

    `build()` returns the project's Timeline (built once and kept). After the end the last frame
    holds, or the timeline starts over with `loop`. `bbox` = (x0, y0, x1, y1): the area the
    project's content covers over its whole duration; it is padded with invisible points so the
    mobject keeps a fixed size and centre while its parts move (MathStudio centres every clip on
    its bounding box). The project's camera and background are not part of the mobject.
    """
    tl = _PROJECT_TIMELINES.get(build)
    if tl is None:
        tl = _PROJECT_TIMELINES[build] = build()
    dur = float(duration or tl.duration() or 0.0)
    tt = float(start_at) + max(float(t), 0.0) * float(speed)
    if dur > 0:
        tt = (tt % dur) if loop else min(max(tt, 0.0), dur - 1e-4)
    mobs, _ = tl.frame(tt)
    parts = []
    for m in mobs:
        c = m.copy()
        if c.is_fixed_in_frame():
            c.unfix_from_frame()
        parts.append(c)
    if bbox:
        x0, y0, x1, y1 = (float(v) for v in bbox)
        parts += [VectorizedPoint(np.array([x0, y0, 0.0])), VectorizedPoint(np.array([x1, y1, 0.0]))]
    if all(isinstance(p, VMobject) for p in parts):
        return VGroup(*parts)
    return Group(*parts)


def _is_invisible(m) -> bool:
    """A leaf that draws nothing: a VMobject with no fill and no stroke (invisible layout frames/references)."""
    if not isinstance(m, VMobject):
        return False
    try:
        return not (m.has_fill() or m.has_stroke())
    except Exception:
        return False


def _visible_bounds(ms):
    """(lo, hi) over the leaves that actually draw something; None when every leaf draws (use the full box)
    or when nothing draws at all (e.g. the very first frame of a FadeIn)."""
    leaves = [l for m in ms for l in m.family_members_with_points()]
    vis = [l for l in leaves if not _is_invisible(l)]
    if not vis or len(vis) == len(leaves):
        return None
    pts = np.vstack([l.get_points() for l in vis])
    return pts.min(axis=0), pts.max(axis=0)


def _all_drawn(ms):
    leaves = [l for m in ms for l in m.family_members_with_points()]
    return bool(leaves) and not any(_is_invisible(l) for l in leaves)


def _visible_box(ms, full_size):
    """Visible-content box relative to the base centre, if invisible parts make the full box noticeably bigger."""
    try:
        vb = _visible_bounds(ms)
    except Exception:
        return None
    if vb is None:
        return None
    lo, hi = vb
    w, h = float(hi[0] - lo[0]), float(hi[1] - lo[1])
    W, H = full_size
    cx, cy = float(lo[0] + hi[0]) / 2, float(lo[1] + hi[1]) / 2
    if W - w < 0.02 and H - h < 0.02 and abs(cx) < 0.01 and abs(cy) < 0.01:
        return None
    return (cx, cy, w, h)


def _clip_info(c: Clip, t: float, ms):
    u = t - c.start
    tr = c.transform_at(u)
    try:
        ms_pts = [m for m in ms if m.get_family()]
        boxes = [m.get_bounding_box() for m in ms_pts]
        lo = np.min([b[0] for b in boxes], axis=0)
        hi = np.max([b[2] for b in boxes], axis=0)
        full_bbox = [float(lo[0]), float(lo[1]), float(hi[0]), float(hi[1])]
        zr = [float(lo[2]), float(hi[2])]
        bbox = full_bbox
        if c._vis is not None:
            # report the drawn content, not invisible layout frames (hit boxes, fit-to-view, agent checks)
            vb = _visible_bounds(ms_pts)
            if vb is not None:
                bbox = [float(vb[0][0]), float(vb[0][1]), float(vb[1][0]), float(vb[1][1])]
            elif _all_drawn(ms_pts):
                pass  # every leaf draws (e.g. moved parts put the box off the pivot): the full box is the content
            else:  # nothing drawn yet (e.g. start of a fade): place the base's visible box inside the full one
                ox, oy, vw, vh = c._vis
                # (ox, oy) is relative to the clip's pivot; the full box is centred there unless parts were moved
                fc = c._base.get_center() if c._base is not None else (0.0, 0.0)
                ox, oy = ox - float(fc[0]), oy - float(fc[1])
                s_, r_ = tr["scale"], math.radians(tr["rotation"])
                ca, sa = math.cos(r_), math.sin(r_)
                cx = (lo[0] + hi[0]) / 2 + s_ * (ox * ca - oy * sa)
                cy = (lo[1] + hi[1]) / 2 + s_ * (ox * sa + oy * ca)
                hw = s_ * (abs(vw * ca) + abs(vh * sa)) / 2
                hh = s_ * (abs(vw * sa) + abs(vh * ca)) / 2
                bbox = [float(cx - hw), float(cy - hh), float(cx + hw), float(cy + hh)]
    except Exception:
        bbox = full_bbox = None
        zr = None
    w, h = c._base_size
    d = c._base_depth
    extra = {}
    if c._vis is not None:
        # hit box = visible content; (ox, oy) = its centre relative to the clip position, in unscaled, unrotated base units
        ox, oy, vw, vh = c._vis
        extra = {"ox": ox, "oy": oy, "full": [w * tr["scale"], h * tr["scale"]], "full_bbox": full_bbox}
        w, h = vw, vh
    return {
        **extra,
        "bbox": bbox,
        "zr": zr,
        "w": w * tr["scale"],
        "h": h * tr["scale"],
        "d": d * tr["scale"],
        "x": tr["x"],
        "y": tr["y"],
        "z": tr["z"],
        "fixed": c.fixed,
        "rotation": tr["rotation"],
        **({"rx": tr["rx"]} if abs(tr.get("rx", 0.0)) > 1e-9 else {}),
        **({"ry": tr["ry"]} if abs(tr.get("ry", 0.0)) > 1e-9 else {}),
        "scale": tr["scale"],
        "phase": c.phase(u)[0],
    }


# --------------------------------------------------------------------------------------
# Scene used by exported scripts:  manimgl scene.py MainScene -w
# --------------------------------------------------------------------------------------
class StudioScene(Scene):
    duration: float = 5.0
    background: str = "#1e1e1e"
    fps: int | None = None
    camera_keys: list = []

    def __init__(self, **kwargs):
        cam = dict(kwargs.pop("camera_config", {}) or {})
        cam["background_color"] = self.background
        fps = os.environ.get("MATHSTUDIO_FPS") or self.fps
        if fps:
            cam["fps"] = int(fps)
        super().__init__(camera_config=cam, **kwargs)
        self.timeline = Timeline(camera=list(self.camera_keys))
        self._current = None

    def clip(self, factory, **kwargs):
        return self.timeline.add(Clip(factory, **kwargs))

    def build(self):
        pass

    def construct(self):
        self.build()
        self._apply(0.0)
        self.wait(self.duration)

    def _apply(self, t):
        if self.timeline.camera:
            apply_camera(self.frame, camera_at(self.timeline.camera, t))
        mobs, _ = self.timeline.frame(t)
        ids = [id(m) for m in mobs]
        if ids != self._current:
            self.mobjects = [self.camera.frame] + list(mobs)
            self.assemble_render_groups()
            self._current = ids

    def update_mobjects(self, dt: float) -> None:
        if hasattr(self, "timeline"):
            # ManimGL advances `time` before updating, so the frame being drawn
            # represents the moment `time - dt` (frame i <-> t = i / fps).
            self._apply(max(0.0, self.time - dt))
        super().update_mobjects(dt)


# --------------------------------------------------------------------------------------
# Names that Manim Community and older manimlib code use but manimgl 1.7 does not export.
# Imported library files are converted with these in scope (see import_runner.py).
# --------------------------------------------------------------------------------------
from manimlib import ShowCreation as Create, Tex as MathTex, Animation as ContinualAnimation  # noqa: E402,F401
from manimlib import Scene as MovingCameraScene, Scene as ZoomedScene  # noqa: E402,F401
from manimlib import Scene as GraphScene, Scene as LinearTransformationScene  # noqa: E402,F401
from manimlib import Scene as SampleSpaceScene, Scene as NumberLineScene  # noqa: E402,F401
from manimlib import Scene as ComplexTransformationScene, ThreeDScene as SpecialThreeDScene  # noqa: E402,F401
from manimlib import GREY_D as DARK_GRAY, GREY_B as LIGHT_GREY  # noqa: E402,F401
DEFAULT_POINT_DENSITY_1D = 10
DEFAULT_POINT_DENSITY_2D = 25
MEDIA_DIR = ""
COLOR_MAP = {}


def override_animation(animation_cls):
    """Manim Community decorator: a no-op here (the animation is not overridden)."""
    def decorator(func):
        return func
    return decorator


def FadeInFrom(mobject, direction=None, **kwargs):
    """Manim Community FadeInFrom: fade in while moving from the given side."""
    from manimlib import FadeIn, DOWN
    direction = DOWN if direction is None else direction
    return FadeIn(mobject, shift=-np.array(direction) * 1.0, **kwargs)
