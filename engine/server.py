"""
MathStudio render server.

HTTP API (localhost only).  All OpenGL work happens on the main thread; HTTP handlers
run in worker threads and hand jobs over through a priority queue.

  GET  /health
  GET  /library                      -> items, categories, animation catalogue
  GET  /search?q=...                 -> hybrid semantic + keyword search over the library
  POST /frame   {project,t,w,h,thumb?} -> raw RGBA bytes, X-Meta header (JSON, uri-encoded)
                                   thumb: true renders after the live preview (timeline key previews)
  POST /code    {project}            -> {code}
  POST /project-gif {project,w?,h?,frames?,poster_t?} -> {gif, png} data URLs (a saved version's preview)
  GET  /thumb/<item>.png|gif         -> thumbnail (rendered lazily, cached on disk)
  POST /export  {project,out,...}    -> {job}
  GET  /export/<job>                 -> {status, progress, log, file}
  POST /export/<job>/cancel
  GET  /file?path=...                -> serve an asset file (images inside the asset store)
  POST /user-mobjects {project,name,desc?,visibility?,mode?,at?,thumb_t?,replace?,source_path?}
                                   -> {item}  make a library mobject from a whole project
  POST /user-mobjects/update {id,name?,desc?,visibility?} -> {item}
  POST /user-mobjects/delete {id}    -> {ok}
  GET  /account                      -> {plan}  (free: every user mobject is public)
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import inspect
import io
import itertools
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse
import warnings
from concurrent.futures import Future
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

warnings.filterwarnings("ignore")

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

_parser = argparse.ArgumentParser()
_parser.add_argument("--port", type=int, default=0)
_parser.add_argument("--data", default=os.path.join(HERE, "data"))
_parser.add_argument("--warm", action="store_true")
ARGS = _parser.parse_args()
sys.argv = [sys.argv[0]]  # manimlib parses sys.argv on import

DATA_DIR = os.path.abspath(ARGS.data)
ASSET_DIR = os.path.join(DATA_DIR, "assets")
THUMB_DIR = os.path.join(DATA_DIR, "thumbs")
for d in (DATA_DIR, ASSET_DIR, THUMB_DIR):
    os.makedirs(d, exist_ok=True)

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import manimlib  # noqa: E402,F401
from manimlib.camera.camera import Camera  # noqa: E402
from manimlib.constants import FRAME_WIDTH, FRAME_HEIGHT  # noqa: E402

import studio_runtime as rt  # noqa: E402
import codegen  # noqa: E402
import code_knobs  # noqa: E402
import library  # noqa: E402
import library_imported  # noqa: E402
import search  # noqa: E402

rt.ASSET_DIRS.insert(0, ASSET_DIR)
library.load_user(DATA_DIR)  # "My mobjects" (made from projects) live in the data dir

RUNTIME_VERSION = hashlib.sha1(
    (open(os.path.join(HERE, "studio_runtime.py")).read() + "v3").encode()
).hexdigest()[:10]


def log(*a):
    print("[engine]", *a, file=sys.stderr, flush=True)


GL_INFO: dict = {}
SOFTWARE_GL = ("llvmpipe", "softpipe", "swiftshader", "software rasterizer", "swrast", "lavapipe", "microsoft basic render")


def gl_info(ctx):
    """Which OpenGL implementation renders: the Settings tab uses it to pick the preview quality."""
    try:
        info = ctx.info
        renderer = str(info.get("GL_RENDERER", ""))
        out = {
            "renderer": renderer,
            "vendor": str(info.get("GL_VENDOR", "")),
            "version": str(info.get("GL_VERSION", "")),
        }
    except Exception as e:  # pragma: no cover - depends on the driver
        return {"renderer": "", "vendor": "", "version": "", "error": str(e), "software": None}
    out["software"] = any(k in renderer.lower() for k in SOFTWARE_GL)
    return out


# --------------------------------------------------------------------------------------
# Renderer (main thread only)
# --------------------------------------------------------------------------------------
class Renderer:
    def __init__(self):
        self.camera = Camera(resolution=(1280, 720), background_color="#1e1e1e")
        # moderngl's default (gc_mode None) never frees a buffer / vertex array / texture whose
        # Python object dies: every rebuilt mobject leaked its GPU buffers (GBs after a long
        # session). "context_gc" queues them and collect_gl() releases them on this (the GL) thread.
        self.camera.ctx.gc_mode = "context_gc"
        self.fbos = {}
        self.res = (1280, 720)
        self.bg = None
        self.preview = codegen.PreviewState()
        # one preview state per open project (key from the client), so the live view and agents
        # working on other projects in the background don't keep throwing away each other's mobjects
        self.previews = {}
        self.thumb_state = codegen.PreviewState()
        self.clip_thumb_state = codegen.PreviewState()
        self.clip_strip_state = codegen.PreviewState()
        self.clip_parts_state = codegen.PreviewState()
        GL_INFO.update(gl_info(self.camera.ctx))

    def collect_gl(self):
        """Release GL objects whose Python wrappers were garbage-collected (main thread only).

        Not ctx.gc(): a buffer manimgl already released by hand (ShaderWrapper.release on a resize,
        our fbo eviction) leaves an InvalidObject placeholder that is queued too when its wrapper
        dies, and ctx.gc() raises on it — aborting the pass with everything behind it still queued."""
        objs = self.camera.ctx.objects
        n = 0
        while objs:
            obj = objs.popleft()
            release = getattr(obj, "release", None)
            if release is None:
                continue  # already released explicitly
            try:
                release()
                n += 1
            except Exception as e:  # never let cleanup break rendering, but say why
                log("GL cleanup failed:", type(e).__name__, e)
        return n

    def use_resolution(self, w, h):
        w = int(max(16, min(3840, w)))
        h = int(max(16, min(2160, h)))
        if (w, h) == self.res:
            return
        cam = self.camera
        if (w, h) not in self.fbos:
            cam.default_pixel_shape = (w, h)
            self.fbos[(w, h)] = (cam.get_fbo(cam.samples), cam.get_fbo(0))
            if len(self.fbos) > 8:
                # drop the oldest
                k = next(iter(self.fbos))
                if k != (w, h):
                    f1, f2 = self.fbos.pop(k)
                    for f in (f1, f2):
                        try:
                            f.release()
                        except Exception:
                            pass
        fbo, draw = self.fbos[(w, h)]
        cam.default_pixel_shape = (w, h)
        cam.fbo_for_files = fbo
        cam.fbo = fbo
        cam.draw_fbo = draw
        fbo.use()
        self.res = (w, h)

    def set_background(self, color):
        if color != self.bg:
            from manimlib.utils.color import color_to_rgba
            try:
                self.camera.background_rgba = list(color_to_rgba(color, 1.0))
            except Exception:
                self.camera.background_rgba = list(color_to_rgba("#1e1e1e", 1.0))
            self.bg = color

    def render(self, mobs):
        self.camera.capture(*mobs)
        w, h = self.res
        raw = self.camera.get_raw_fbo_data()
        arr = np.frombuffer(raw, dtype=np.uint8).reshape(h, w, 4)[::-1]
        return arr

    MAX_PREVIEWS = 6

    def preview_for(self, key):
        if not key:
            return self.preview
        key = str(key)[:64]
        st = self.previews.pop(key, None)
        if st is None:
            st = codegen.PreviewState()
            if len(self.previews) >= self.MAX_PREVIEWS:
                self.previews.pop(next(iter(self.previews)))  # least recently used
        self.previews[key] = st
        return st

    def frame(self, project, t, w, h, view=None, state=None):
        t0 = time.perf_counter()
        settings = project.get("settings") or {}
        self.use_resolution(w, h)
        self.set_background(settings.get("background") or "#1e1e1e")
        preview = self.preview_for(state)
        timeline = preview.sync(project)
        cam = rt.camera_at(timeline.camera, float(t))
        # `view` overrides the camera for the editor's full-scene overview; meta still reports the real camera
        shown = cam
        grid = False
        if view:
            shown = {k: float(view.get(k, d) or 0.0) for k, d in rt.DEFAULT_CAMERA.items()}
            shown["zoom"] = max(shown["zoom"], 1e-3)
            grid = bool(view.get("grid"))
        rt.apply_camera(self.camera.frame, shown)
        mobs, info = timeline.frame(float(t), collect_info=True)
        if grid:
            mobs = [self.ground_grid()] + mobs
        arr = self.render(mobs)
        errors = dict(preview.errors)
        for c in timeline.clips:
            if c.error:
                errors[c.id] = c.error
        meta = {
            "t": t,
            "w": self.res[0],
            "h": self.res[1],
            "frame": [FRAME_WIDTH, FRAME_HEIGHT],
            "clips": info,
            "camera": cam,
            "view": shown,
            "errors": errors,
            "global_errors": dict(preview.global_errors),
            "ms": round((time.perf_counter() - t0) * 1000, 1),
        }
        return np.ascontiguousarray(arr).tobytes(), meta

    _grid = None

    def ground_grid(self):
        """Editor-only reference grid on the z = 0 plane (never exported)."""
        if self._grid is None:
            from manimlib import VGroup, Line, GREY_B, BLUE_D, RED_D, GREEN_D
            n = 10
            lines = VGroup()
            for i in range(-n, n + 1):
                if i == 0:
                    continue
                lines.add(Line([i, -n, 0], [i, n, 0]), Line([-n, i, 0], [n, i, 0]))
            lines.set_stroke(GREY_B, 1, 0.22)
            axes = VGroup(Line([-n, 0, 0], [n, 0, 0]).set_stroke(RED_D, 2, 0.6),
                          Line([0, -n, 0], [0, n, 0]).set_stroke(GREEN_D, 2, 0.6),
                          Line([0, 0, 0], [0, 0, 3]).set_stroke(BLUE_D, 2, 0.6))
            g = VGroup(lines, axes)
            g.apply_depth_test()
            self._grid = g
        return self._grid

    def _fit_camera(self, mobs, pad=0.92, max_zoom=12.0, view=None):
        boxes = [m.get_bounding_box() for m in mobs if m.get_family()]
        lo = np.min([b[0] for b in boxes], axis=0)
        hi = np.max([b[2] for b in boxes], axis=0)
        w, h = max(hi[0] - lo[0], 1e-3), max(hi[1] - lo[1], 1e-3)
        zoom = min(FRAME_WIDTH * pad / w, FRAME_HEIGHT * pad / h, max_zoom)
        cx, cy = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
        if view:
            # 3D object: look at it from an angle, fit its bounding sphere
            r = max(float(np.linalg.norm(hi - lo)) / 2, 1e-3)
            zoom = min(FRAME_HEIGHT * pad / (2 * r), max_zoom)
            cz = (lo[2] + hi[2]) / 2
            self.fit_cam = {"x": cx, "y": cy, "z": cz, "zoom": zoom, "theta": view[0], "phi": view[1]}
            rt.apply_camera(self.camera.frame, self.fit_cam)
            return zoom, 2 * r * FRAME_WIDTH / FRAME_HEIGHT, 2 * r
        self.fit_cam = {"x": cx, "y": cy, "zoom": zoom}
        rt.apply_camera(self.camera.frame, self.fit_cam)
        return zoom, w, h

    def clip_thumb(self, clip, globals_=None):
        """Tightly cropped, transparent PNG of a clip's mobject (for the timeline / inspector)."""
        item = library.BY_ID.get(clip.get("item")) or {}
        c = {**clip, "id": "thumb", "track": "t", "start": 0, "duration": 2, "fixed": False, "parts": None,
             "enter": {"type": "none"}, "exit": {"type": "none"}, "effects": [], "keys": [],
             "transform": {"x": 0, "y": 0, "scale": 1, "rotation": 0, "opacity": 1}}
        timeline = self.clip_thumb_state.sync({"tracks": [{"id": "t"}], "clips": [c], "globals": globals_ or []})
        if self.clip_thumb_state.errors:
            raise RuntimeError(next(iter(self.clip_thumb_state.errors.values())))
        mobs, _ = timeline.frame(1.0)
        clip_obj = timeline.clips[0]
        if clip_obj.error:
            raise RuntimeError(clip_obj.error)
        W, H = 768, 432
        self.use_resolution(W, H)
        self.camera.background_rgba = [0.0, 0.0, 0.0, 0.0]
        self.bg = None  # force the scene background back on the next frame
        zoom, w, h = self._fit_camera(mobs, view=item.get("view"))
        import moderngl
        ctx = self.camera.ctx
        # separate alpha blending -> premultiplied colour + correct coverage on a transparent background
        ctx.blend_func = (moderngl.SRC_ALPHA, moderngl.ONE_MINUS_SRC_ALPHA, moderngl.ONE, moderngl.ONE_MINUS_SRC_ALPHA)
        try:
            arr = self.render(mobs).astype(np.float32)
        finally:
            ctx.blend_func = (moderngl.SRC_ALPHA, moderngl.ONE_MINUS_SRC_ALPHA)
        a = arr[:, :, 3:4]
        arr[:, :, :3] = np.where(a > 0, arr[:, :, :3] * 255.0 / np.maximum(a, 1), 0)
        arr = np.clip(arr, 0, 255).astype(np.uint8)
        # crop to the object's box (plus a little margin)
        pw = w * zoom / FRAME_WIDTH * W
        ph = h * zoom / FRAME_HEIGHT * H
        x0 = int(max(0, (W - pw) / 2 - 6)); x1 = int(min(W, (W + pw) / 2 + 6))
        y0 = int(max(0, (H - ph) / 2 - 6)); y1 = int(min(H, (H + ph) / 2 + 6))
        if item.get("view"):
            # perspective: crop to what was actually drawn
            ys, xs = np.nonzero(arr[:, :, 3] > 8)
            if len(xs):
                x0, x1 = int(max(0, xs.min() - 6)), int(min(W, xs.max() + 7))
                y0, y1 = int(max(0, ys.min() - 6)), int(min(H, ys.max() + 7))
        img = Image.fromarray(arr[y0:y1, x0:x1].copy(), "RGBA")
        th = 72
        tw = int(max(8, min(360, img.width * th / max(img.height, 1))))
        if img.height > th or img.width > tw:
            img.thumbnail((tw, th), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return buf.getvalue()

    def clip_parts(self, clip, globals_=None):
        """Structure of a clip's mobject (its submobjects, nested) for the timeline's part rows."""
        c = {**clip, "id": "parts", "track": "t", "start": 0, "duration": 2, "fixed": False, "parts": None,
             "enter": {"type": "none"}, "exit": {"type": "none"}, "effects": [], "keys": [],
             "transform": {"x": 0, "y": 0, "scale": 1, "rotation": 0, "opacity": 1}}
        timeline = self.clip_parts_state.sync({"tracks": [{"id": "t"}], "clips": [c], "globals": globals_ or []})
        if self.clip_parts_state.errors:
            raise RuntimeError(next(iter(self.clip_parts_state.errors.values())))
        fn = timeline.clips[0].factory
        args = (0.0, 0.0) if codegen.is_dynamic(c) else ()
        try:
            mob, names = rt.capture_names(fn, *args)
        except TypeError:
            mob, names = rt.capture_names(fn)
        if not isinstance(mob, rt.Mobject):
            raise TypeError(f"factory must return a Mobject, got {type(mob).__name__}")
        mob.move_to(rt.ORIGIN)
        return rt.parts_tree(mob, names)

    STRIP_H = 72

    def clip_strip(self, clip, times, target=None, globals_=None):
        """Filmstrip of a clip whose look changes over time (dynamic code, or a morph into
        another clip): one frame per local time in `times`, all framed by the same camera so
        size / shape changes read correctly. Returns a horizontal PNG sprite of equal-size frames."""
        steps = self.clip_strip_steps(clip, times, target, globals_)
        while True:
            try:
                next(steps)
            except StopIteration as stop:
                return stop.value

    def clip_strip_steps(self, clip, times, target=None, globals_=None):
        """clip_strip as a generator job: yields between frames so live preview frames can run in
        between. Every step re-applies its own resolution / camera / blending (a live frame in
        between changes them all)."""
        item = library.BY_ID.get(clip.get("item")) or {}
        ident_tr = {"x": 0, "y": 0, "z": 0, "scale": 1, "rotation": 0, "opacity": 1}
        dur = max(float(clip.get("duration") or 1.0), 1e-3)
        ex = clip.get("exit") or {}
        morph = target is not None and ex.get("type") in ("TransformInto", "TransformMatching")
        a = {**clip, "id": "a", "track": "t", "start": 0, "duration": dur, "fixed": False, "parts": None,
             "enter": {"type": "none"}, "effects": [], "keys": [], "transform": ident_tr,
             "exit": ({"type": ex["type"], "duration": float(ex.get("duration") or 1.0), "rate": ex.get("rate") or "smooth", "target": "b"}
                      if morph else {"type": "none"})}
        clips = [a]
        if morph:
            clips.append({**target, "id": "b", "track": "t", "start": dur, "duration": 1.0, "fixed": False,
                          "enter": {"type": "none"}, "exit": {"type": "none"}, "effects": [], "keys": [], "transform": ident_tr})
        timeline = self.clip_strip_state.sync({"tracks": [{"id": "t"}], "clips": clips, "globals": globals_ or []})
        if self.clip_strip_state.errors:
            raise RuntimeError(next(iter(self.clip_strip_state.errors.values())))
        frames = []
        for u in times:
            u = min(max(float(u), 0.0), dur - 1e-4)
            mobs, _ = timeline.frame(u)
            frames.append([m.copy() for m in mobs if m.get_family()])
            yield
        err = next((c.error for c in timeline.clips if c.error), None)
        if err and not any(frames):
            raise RuntimeError(err)
        W, H = 640, 360
        everything = [m for f in frames for m in f]
        fit = None
        if everything:
            self._fit_camera(everything, view=item.get("view"))
            fit = self.fit_cam
        import moderngl
        ctx = self.camera.ctx
        arrs = []
        for f in frames:
            if not f:
                arrs.append(np.zeros((H, W, 4), np.uint8))
                continue
            self.use_resolution(W, H)
            self.camera.background_rgba = [0.0, 0.0, 0.0, 0.0]
            self.bg = None  # force the scene background back on the next live frame
            if fit is not None:
                rt.apply_camera(self.camera.frame, fit)
            ctx.blend_func = (moderngl.SRC_ALPHA, moderngl.ONE_MINUS_SRC_ALPHA, moderngl.ONE, moderngl.ONE_MINUS_SRC_ALPHA)
            try:
                arr = self.render(f).astype(np.float32)
            finally:
                ctx.blend_func = (moderngl.SRC_ALPHA, moderngl.ONE_MINUS_SRC_ALPHA)
            a_ = arr[:, :, 3:4]
            arr[:, :, :3] = np.where(a_ > 0, arr[:, :, :3] * 255.0 / np.maximum(a_, 1), 0)
            arrs.append(np.clip(arr, 0, 255).astype(np.uint8))
            yield
        # one crop for every frame: the union of what was drawn
        cover = np.zeros((H, W), bool)
        for arr in arrs:
            cover |= arr[:, :, 3] > 8
        ys, xs = np.nonzero(cover)
        if len(xs):
            x0, x1 = int(max(0, xs.min() - 4)), int(min(W, xs.max() + 5))
            y0, y1 = int(max(0, ys.min() - 4)), int(min(H, ys.max() + 5))
        else:
            x0, x1, y0, y1 = 0, W, 0, H
        th = self.STRIP_H
        cw, ch = x1 - x0, y1 - y0
        tw = int(max(6, min(4 * th, round(cw * th / max(ch, 1)))))
        sprite = Image.new("RGBA", (tw * len(arrs), th), (0, 0, 0, 0))
        for i, arr in enumerate(arrs):
            img = Image.fromarray(arr[y0:y1, x0:x1].copy(), "RGBA").resize((tw, th), Image.LANCZOS)
            sprite.paste(img, (i * tw, 0))
        buf = io.BytesIO()
        sprite.save(buf, "PNG")
        return buf.getvalue()

    def project_gif(self, project, w=288, h=162, n=18, poster_t=None):
        """A small looping GIF of a whole project (a saved version's preview) + a PNG poster frame.
        Uses its own PreviewState so it never evicts the live preview's cached clips."""
        settings = project.get("settings") or {}
        dur = max(float(settings.get("duration") or 1.0), 0.1)
        n = max(2, min(int(n), 40))
        self.use_resolution(int(w), int(h))
        self.set_background(settings.get("background") or "#1e1e1e")
        timeline = self.preview_for("__version_gif__").sync(project)
        times = [dur * (i + 0.5) / n for i in range(n)]
        frames = []
        for t in times:
            rt.apply_camera(self.camera.frame, rt.camera_at(timeline.camera, t))
            mobs, _ = timeline.frame(t)
            frames.append(Image.fromarray(self.render(mobs)[:, :, :3].copy()))
        pt = float(poster_t) if poster_t is not None else dur / 2
        rt.apply_camera(self.camera.frame, rt.camera_at(timeline.camera, pt))
        mobs, _ = timeline.frame(pt)
        poster = Image.fromarray(self.render(mobs)[:, :, :3].copy())
        # ~3s loop whatever the project's length; hold the last frame a moment
        step = int(max(90, min(220, 3200 / n)))
        durations = [step] * n
        durations[-1] = 700
        pal = [f.convert("P", palette=Image.ADAPTIVE, colors=96) for f in frames]
        gbuf = io.BytesIO()
        pal[0].save(gbuf, "GIF", save_all=True, append_images=pal[1:], duration=durations, loop=0, optimize=False, disposal=1)
        pbuf = io.BytesIO()
        poster.save(pbuf, "PNG", optimize=True)
        return gbuf.getvalue(), pbuf.getvalue()

    def anim_thumb(self, kind, anim_id):
        """Animated GIF demonstrating one enter / exit / effect animation on a sample object."""
        sample = {"item": "custom", "params": {}, "code":
                  'star = Polygon(*[(1.0 if i % 2 == 0 else 0.45) * np.array([np.cos(PI / 2 + i * PI / 5), np.sin(PI / 2 + i * PI / 5), 0]) for i in range(10)], fill_color=GOLD, fill_opacity=0.9, stroke_color=GOLD)\n'
                  'label = Text("Abc", font="Helvetica Neue", font_size=60)\n'
                  'return VGroup(star, label).arrange(RIGHT, buff=0.5)'}
        a = {**sample, "id": "a", "track": "t", "start": 0, "duration": 3, "enter": {"type": "none"}, "exit": {"type": "none"}}
        clips = [a]
        if kind == "enter":
            a["enter"] = {"type": anim_id, "duration": 1.2}
            a["duration"] = 2.0
            t0, t1 = 0.0, 2.0
        elif kind == "exit":
            a["exit"] = {"type": anim_id, "duration": 1.2}
            a["duration"] = 1.8
            t0, t1 = 0.0, 2.3
            if anim_id in ("TransformInto", "TransformMatching"):
                if anim_id == "TransformMatching":
                    a.update(item="tex", code=None, params={**library.default_params("tex"), "tex": "a + b", "font_size": 110})
                    b = {"item": "tex", "params": {**library.default_params("tex"), "tex": "a + b = c", "font_size": 110}}
                else:
                    b = {"item": "circle", "params": {**library.default_params("circle"), "radius": 1.3, "fill_opacity": 0.6}}
                a["exit"]["target"] = "b"
                clips.append({**b, "id": "b", "track": "t", "start": 1.8, "duration": 1.0, "enter": {"type": "none"}, "exit": {"type": "none"}})
                t1 = 2.8
        else:
            a["effects"] = [{"type": anim_id, "at": 0.3, "duration": 1.4}]
            a["duration"] = 2.2
            t0, t1 = 0.0, 2.2
        self.use_resolution(320, 180)
        self.set_background("#1b1d23")
        timeline = self.thumb_state.sync({"tracks": [{"id": "t"}], "clips": clips})
        rt.apply_camera(self.camera.frame, {"x": 0.0, "y": 0.0, "zoom": 1.55})
        frames = []
        fps = 15
        for i in range(int((t1 - t0) * fps)):
            mobs, _ = timeline.frame(t0 + i / fps)
            frames.append(Image.fromarray(self.render(mobs)[:, :, :3].copy()))
        for c in timeline.clips:
            if c.error:
                raise RuntimeError(c.error)
        return frames, fps

    def thumb(self, item_id):
        item = library.BY_ID[item_id]
        enter = item.get("enter") or "FadeIn"
        # e.g. a mobject made from a project starts its preview where something is on screen
        params = {**library.default_params(item_id), **(item.get("thumb_params") or {})}
        enter_dur = 1.4 if enter in ("Write", "DrawBorderThenFill", "Typewriter") else 1.0
        hold = 0.8
        project = {
            "settings": {"background": "#1b1d23"},
            "tracks": [{"id": "t"}],
            "clips": [{
                "id": "thumb", "item": item_id, "track": "t", "start": 0, "duration": enter_dur + hold + 0.01,
                "params": params,
                "enter": {"type": enter, "duration": enter_dur},
            }],
        }
        if item_id == "image" or item_id == "svg":
            return None
        self.use_resolution(320, 180)
        self.set_background("#1b1d23")
        view = item.get("view")
        rt.apply_camera(self.camera.frame, {"x": 0.0, "y": 0.0, "zoom": 1.0, **({"theta": view[0], "phi": view[1]} if view else {})})
        timeline = self.thumb_state.sync(project)
        clip = timeline.clips[0]
        # Fit the object inside the thumbnail
        clip.build_base(0.0)
        bw, bh = clip._base_size
        if view:
            # 3D: fit the bounding sphere, whichever way the camera looks at it
            r = max(float(np.linalg.norm([bw, bh, clip._base_depth])) / 2, 1e-3)
            bw = bh = 2 * r * 0.82
        fit = min((FRAME_WIDTH * 0.78) / max(bw, 1e-3), (FRAME_HEIGHT * 0.72) / max(bh, 1e-3), 4.0)
        clip.transform = {**clip.transform, "scale": fit}
        frames = []
        fps = 15
        n = int((enter_dur + hold) * fps)
        for i in range(n):
            mobs, _ = timeline.frame(i / fps)
            frames.append(Image.fromarray(self.render(mobs)[:, :, :3].copy()))
        if clip.error:
            raise RuntimeError(clip.error)
        still = frames[-1]
        return still, frames, fps


# --------------------------------------------------------------------------------------
# Job queue
# --------------------------------------------------------------------------------------
_jobs: "queue.PriorityQueue" = queue.PriorityQueue()
_counter = itertools.count()
_latest_frame_seq = {"v": 0}


# Priority 0 = the live preview (/frame). Jobs at BACKGROUND priority or below (clip thumbnails,
# filmstrips, library thumbnails, version GIFs...) step aside while the preview is streaming
# (playing, scrubbing, dragging): they only start once no live frame has finished for
# LIVE_WINDOW seconds, or after waiting MAX_DEFER (so their HTTP requests never time out).
# A job may also be a generator: it then runs one `yield` step at a time, so a frame that
# arrives in the middle of a long job (a 48-frame filmstrip) waits for one step, not all of it.
BACKGROUND = 2
LIVE_WINDOW = 0.15
MAX_DEFER = 20.0
_live = {"at": 0.0}
_wake = threading.Event()
_deferred_since: dict = {}
_STEP = object()  # marks the continuation of a generator job


def submit(priority, fn, *args):
    fut = Future()
    _jobs.put((priority, next(_counter), fn, args, fut))
    if priority < BACKGROUND:
        _wake.set()
    return fut


def next_job():
    """The next job to run, holding background jobs back while the live preview streams."""
    while True:
        job = _jobs.get()
        prio, count = job[0], job[1]
        if prio >= BACKGROUND:
            now = time.monotonic()
            wait = _live["at"] + LIVE_WINDOW - now
            since = _deferred_since.setdefault(count, now)
            if wait > 0 and now - since < MAX_DEFER:
                _jobs.put(job)  # same (priority, counter): keeps its place in line
                _wake.clear()
                _wake.wait(min(wait, MAX_DEFER - (now - since)))
                continue
            _deferred_since.pop(count, None)
        return job


def run_job(renderer, job):
    """Run a job (or one step of a generator job). Returns the continuation to queue, or None."""
    prio, count, fn, args, fut = job
    gen = args[0] if fn is _STEP else None
    if gen is None and not fut.set_running_or_notify_cancel():
        return None
    try:
        if gen is None:
            res = fn(renderer, *args)
            if inspect.isgenerator(res):
                gen = res
        if gen is not None:
            try:
                next(gen)
            except StopIteration as stop:
                res, gen = stop.value, None
        if gen is not None:
            return (prio, count, _STEP, (gen,), fut)
        fut.set_result(res)
    except Exception as e:
        if os.environ.get("MATHSTUDIO_DEBUG"):
            traceback.print_exc()
        log("job failed:", type(e).__name__, e)
        fut.set_exception(e)
    finally:
        if prio == 0:
            _live["at"] = time.monotonic()
    return None


# Bump by hand when the thumbnail renderer itself changes.  Deliberately NOT tied to the
# runtime source: hashing studio_runtime.py threw away every cached thumbnail on any edit.
THUMB_VERSION = "t2"


def thumb_paths(item_id):
    item = library.BY_ID[item_id]
    if item.get("user"):
        item = library.user.thumb_key(item)
    key = hashlib.sha1((json.dumps(item, sort_keys=True) + THUMB_VERSION).encode()).hexdigest()[:12]
    return os.path.join(THUMB_DIR, f"{item_id}-{key}.png"), os.path.join(THUMB_DIR, f"{item_id}-{key}.gif")


def _index_stale_thumbs():
    """item id -> {".png": path, ".gif": path}: the newest thumbnail on disk under any key.
    Served instantly while the up-to-date one is (re)rendered in the background."""
    out: dict = {}
    try:
        names = os.listdir(THUMB_DIR)
    except OSError:
        return out
    entries = []
    for n in names:
        stem, ext = os.path.splitext(n)
        if ext not in (".png", ".gif") or "-" not in stem:
            continue
        item_id = stem.rsplit("-", 1)[0]
        if item_id in library.BY_ID:
            full = os.path.join(THUMB_DIR, n)
            entries.append((os.path.getmtime(full), item_id, ext, full))
    for _, item_id, ext, full in sorted(entries):
        out.setdefault(item_id, {})[ext] = full
    return out


STALE_THUMBS = _index_stale_thumbs()


def make_thumb(renderer, item_id):
    png, gif = thumb_paths(item_id)
    if os.path.exists(png) and os.path.exists(gif):
        return png, gif
    failed = os.path.splitext(png)[0] + ".failed"
    if os.path.exists(failed):
        return None  # known not to render: don't retry on every launch
    try:
        res = renderer.thumb(item_id)
    except Exception:
        open(failed, "w").close()
        raise
    if res is None:
        return None
    still, frames, fps = res
    still.save(png)
    # hold the last frame a little longer
    durations = [int(1000 / fps)] * len(frames)
    durations[-1] = 900
    pal_frames = [f.convert("P", palette=Image.ADAPTIVE, colors=128) for f in frames]
    pal_frames[0].save(gif, save_all=True, append_images=pal_frames[1:], duration=durations, loop=0, optimize=False, disposal=1)
    return png, gif


# --------------------------------------------------------------------------------------
# Exports
# --------------------------------------------------------------------------------------
EXPORTS: dict[str, dict] = {}
# run manimgl as a module: the `manimgl` launcher script hard-codes the interpreter path, which
# breaks once a bundled Python is moved into an install dir
MANIMGL = [sys.executable, "-m", "manimlib"]


def collect_assets(project):
    names = set()
    for c in project.get("clips") or []:
        item = library.BY_ID.get(c.get("item"))
        if not item:
            continue
        names.update(item.get("assets") or [])  # images used inside a mobject made from a project
        for p in item["params"]:
            if p["type"] == "asset":
                v = (c.get("params") or {}).get(p["id"])
                if v:
                    names.add(v)
    return names


def write_export_dir(project, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    code = codegen.generate_script(project)
    with open(os.path.join(out_dir, "scene.py"), "w") as f:
        f.write(code)
    shutil.copy(os.path.join(HERE, "studio_runtime.py"), os.path.join(out_dir, "studio_runtime.py"))
    # imported mobjects may read files of the mathstudio library (pi creature SVGs...) relative to
    # studio_runtime.py: link the library next to the copied runtime
    lib, link = os.path.join(HERE, "mathstudio_library"), os.path.join(out_dir, "mathstudio_library")
    if os.path.isdir(lib) and not os.path.lexists(link):
        try:
            os.symlink(lib, link)
        except OSError as e:
            log("library link failed", e)
    assets = collect_assets(project)
    if assets:
        os.makedirs(os.path.join(out_dir, "assets"), exist_ok=True)
        for a in assets:
            try:
                src = rt.asset(a)
                shutil.copy(src, os.path.join(out_dir, "assets", os.path.basename(a)))
            except Exception as e:
                log("asset copy failed", a, e)
    return code


def start_export(body):
    project = body["project"]
    out_file = body.get("out") or os.path.join(DATA_DIR, "exports", "video.mp4")
    fmt = body.get("format", "mp4")
    res = body.get("resolution") or (project.get("settings") or {}).get("resolution") or [1920, 1080]
    fps = int(body.get("fps") or (project.get("settings") or {}).get("fps") or 30)
    job_id = hashlib.sha1(f"{time.time()}{out_file}".encode()).hexdigest()[:10]
    work = os.path.join(DATA_DIR, "exports", job_id)
    write_export_dir(project, work)
    duration = codegen.project_duration(project)
    total_frames = max(1, int(round(duration * fps)))
    cmd = [*MANIMGL, "scene.py", "MainScene", "-w", "-r", f"{int(res[0])}x{int(res[1])}",
           "--video_dir", os.path.join(work, "out"), "--file_name", "render"]
    if fmt == "gif":
        cmd.append("-i")
    elif fmt == "mov":
        cmd.append("-t")
    job = dict(id=job_id, status="running", progress=0.0, log="", file=None, out=out_file, cmd=cmd,
               total=total_frames, started=time.time(), work=work)
    env = dict(os.environ)
    env["PYTHONPATH"] = work + os.pathsep + env.get("PYTHONPATH", "")
    env["PYTHONUNBUFFERED"] = "1"
    env["MATHSTUDIO_FPS"] = str(fps)
    proc = subprocess.Popen(cmd, cwd=work, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, bufsize=0)
    job["proc"] = proc
    EXPORTS[job_id] = job

    def pump():
        buf = b""
        import re
        pat = re.compile(rb"(\d+)/(\d+)")
        while True:
            ch = proc.stdout.read(256)
            if not ch:
                break
            buf += ch
            text = buf.decode("utf8", "replace")
            job["log"] = text[-6000:]
            ms = pat.findall(buf[-400:])
            if ms:
                a, b = ms[-1]
                try:
                    job["progress"] = min(0.99, int(a) / max(1, int(b)))
                except ZeroDivisionError:
                    pass
        proc.wait()
        if job["status"] == "cancelled":
            return
        ext = {"gif": ".gif", "mov": ".mov"}.get(fmt, ".mp4")
        produced = os.path.join(work, "out", "render" + ext)
        if proc.returncode == 0 and os.path.exists(produced):
            try:
                os.makedirs(os.path.dirname(os.path.abspath(out_file)), exist_ok=True)
                shutil.copy(produced, out_file)
                job["file"] = out_file
                job["status"] = "done"
                job["progress"] = 1.0
            except Exception as e:
                job["status"] = "error"
                job["log"] += f"\nCould not copy output: {e}"
        else:
            job["status"] = "error"
        job["elapsed"] = time.time() - job["started"]

    threading.Thread(target=pump, daemon=True).start()
    return job_id


def export_status(job_id):
    j = EXPORTS.get(job_id)
    if not j:
        return None
    return {k: v for k, v in j.items() if k not in ("proc",)}


# --------------------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "X-Meta")

    def _send(self, code, body: bytes, ctype="application/json", headers=None):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj).encode())

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_OPTIONS(self):
        self._send(204, b"")

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path
        try:
            if path == "/health":
                return self._json({"ok": True, "runtime": RUNTIME_VERSION, "assets": ASSET_DIR, "gl": GL_INFO})
            if path == "/library":
                return self._json({
                    "items": library.public_items(),
                    "categories": library.CATEGORY_ORDER,
                    "animations": rt.animation_catalogue(),
                    "frame": [FRAME_WIDTH, FRAME_HEIGHT],
                    "import_failures": library_imported.failures(),
                })
            if path == "/search":
                qs = urllib.parse.parse_qs(url.query)
                return self._json(search.get(DATA_DIR).search(qs.get("q", [""])[0]))
            if path.startswith("/thumb/"):
                name = path[len("/thumb/"):]
                item_id, ext = os.path.splitext(name)
                if item_id not in library.BY_ID:
                    return self._json({"error": "unknown item"}, 404)
                png, gif = thumb_paths(item_id)
                target = gif if ext == ".gif" else png
                stale = STALE_THUMBS.get(item_id, {}).get(ext)
                if not os.path.exists(target) and stale and os.path.exists(stale):
                    # an older render: show it now, refresh it in the background
                    submit(9, lambda r: make_thumb(r, item_id))
                    target = stale
                elif not os.path.exists(target):
                    # a hovered card (gif) is more urgent than the bulk of still thumbnails
                    fut = submit(3 if ext == ".gif" else 5, lambda r: make_thumb(r, item_id))
                    res = fut.result(timeout=120)
                    if res is None:
                        return self._json({"error": "no thumbnail"}, 404)
                with open(target, "rb") as f:
                    data = f.read()
                return self._send(200, data, "image/gif" if ext == ".gif" else "image/png",
                                  {"Cache-Control": "max-age=86400"})
            if path.startswith("/anim-thumb/"):
                _, _, kind, name = path.split("/", 3)
                anim_id = os.path.splitext(name)[0]
                valid = {"enter": rt.ENTER_ANIMS, "exit": rt.EXIT_ANIMS, "effect": rt.EFFECTS}.get(kind, {})
                if anim_id not in valid or anim_id == "none":
                    return self._json({"error": "unknown animation"}, 404)
                target = os.path.join(THUMB_DIR, f"anim-{kind}-{anim_id}-{RUNTIME_VERSION}.gif")
                if not os.path.exists(target):
                    def job(r):
                        frames, fps = r.anim_thumb(kind, anim_id)
                        durations = [int(1000 / fps)] * len(frames)
                        durations[-1] = 700
                        pal = [f.convert("P", palette=Image.ADAPTIVE, colors=96) for f in frames]
                        pal[0].save(target, save_all=True, append_images=pal[1:], duration=durations, loop=0, disposal=1)
                    submit(4, job).result(timeout=120)
                with open(target, "rb") as f:
                    return self._send(200, f.read(), "image/gif", {"Cache-Control": "max-age=86400"})
            if path == "/account":
                return self._json({"plan": library.user.plan()})
            if path.startswith("/export/"):
                st = export_status(path.split("/")[2])
                return self._json(st or {"error": "unknown job"}, 200 if st else 404)
            if path == "/file":
                q = urllib.parse.parse_qs(url.query)
                p = q.get("path", [""])[0]
                try:
                    p = rt.asset(p)
                except FileNotFoundError:
                    return self._json({"error": "not found"}, 404)
                ext = os.path.splitext(p)[1].lower()
                ctype = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
                         ".svg": "image/svg+xml", ".webp": "image/webp", ".mp4": "video/mp4"}.get(ext, "application/octet-stream")
                with open(p, "rb") as f:
                    return self._send(200, f.read(), ctype)
            return self._json({"error": "not found"}, 404)
        except Exception as e:
            traceback.print_exc()
            return self._json({"error": str(e)}, 500)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            body = self._body()
            if path == "/frame":
                seq = int(body.get("seq") or 0)
                # timeline key previews share this endpoint but must not cut in front of the live preview
                prio = 3 if body.get("thumb") else 0
                fut = submit(prio, lambda r: r.frame(body["project"], body.get("t", 0), body.get("w", 1280), body.get("h", 720), body.get("view"), body.get("state")))
                data, meta = fut.result(timeout=120)
                meta["seq"] = seq
                return self._send(200, data, "application/octet-stream",
                                  {"X-Meta": urllib.parse.quote(json.dumps(meta))})
            if path == "/clip-thumb":
                c = body["clip"]
                src = codegen.factory_source(c, "f")
                # only the globals this clip reads are part of its look
                gl = [g for g in body.get("globals") or [] if re.search(r"\b%s\b" % re.escape(str(g.get("name") or "")), src)]
                key = hashlib.sha1((src + str(codegen.is_dynamic(c)) + RUNTIME_VERSION + codegen.globals_source({"globals": gl})).encode()).hexdigest()[:16]
                target = os.path.join(THUMB_DIR, f"clip-{key}.png")
                if not os.path.exists(target):
                    try:
                        data = submit(2, lambda r: r.clip_thumb(c, gl)).result(timeout=60)
                    except Exception as e:
                        return self._json({"error": f"{type(e).__name__}: {e}"}, 422)
                    with open(target, "wb") as f:
                        f.write(data)
                with open(target, "rb") as f:
                    return self._send(200, f.read(), "image/png")
            if path == "/clip-strip":
                c = body["clip"]
                tg = body.get("target") or None
                times = [round(float(u), 4) for u in (body.get("times") or [])][:64]
                if not times:
                    return self._json({"error": "no times"}, 400)
                src = codegen.factory_source(c, "f") + (codegen.factory_source(tg, "g") if tg else "")
                gl = [g for g in body.get("globals") or [] if re.search(r"\b%s\b" % re.escape(str(g.get("name") or "")), src)]
                ex = c.get("exit") or {}
                sig = json.dumps([codegen.is_dynamic(c), bool(tg and codegen.is_dynamic(tg)), c.get("duration"), times,
                                  [ex.get("type"), ex.get("duration"), ex.get("rate")] if tg else None])
                key = hashlib.sha1((src + sig + RUNTIME_VERSION + "s1" + codegen.globals_source({"globals": gl})).encode()).hexdigest()[:16]
                out = os.path.join(THUMB_DIR, f"strip-{key}.png")
                if not os.path.exists(out):
                    try:
                        data = submit(2, lambda r: r.clip_strip_steps(c, times, tg, gl)).result(timeout=120)
                    except Exception as e:
                        return self._json({"error": f"{type(e).__name__}: {e}"}, 422)
                    with open(out, "wb") as f:
                        f.write(data)
                with open(out, "rb") as f:
                    return self._send(200, f.read(), "image/png", {"X-Frames": str(len(times))})
            if path == "/clip-parts":
                c = body["clip"]
                src = codegen.factory_source(c, "f")
                gl = [g for g in body.get("globals") or [] if re.search(r"\b%s\b" % re.escape(str(g.get("name") or "")), src)]
                key = hashlib.sha1((src + str(codegen.is_dynamic(c)) + codegen.globals_source({"globals": gl})).encode()).hexdigest()
                tree = PARTS_CACHE.get(key)
                if tree is None:
                    try:
                        tree = submit(2, lambda r: r.clip_parts(c, gl)).result(timeout=60)
                    except Exception as e:
                        return self._json({"error": f"{type(e).__name__}: {e}"}, 422)
                    if len(PARTS_CACHE) > 300:
                        PARTS_CACHE.pop(next(iter(PARTS_CACHE)))
                    PARTS_CACHE[key] = tree
                return self._json({"tree": tree})
            if path == "/code-knobs":
                # no-code fields for a clip's custom code (font, size, colours, constants...)
                return self._json(code_knobs.analyze(body.get("code") or "", body.get("globals") or []))
            if path == "/clip-source":
                c = body["clip"]
                return self._json({"code": codegen.clip_body({**c, "code": None}) if body.get("template") else codegen.clip_body(c),
                                   "dynamic": codegen.is_dynamic(c)})
            if path == "/project-gif":
                # preview of a saved version: below the live preview and thumbnails in priority
                try:
                    gif, png = submit(6, lambda r: r.project_gif(body["project"], body.get("w", 288), body.get("h", 162),
                                                               body.get("frames", 18), body.get("poster_t"))).result(timeout=180)
                except Exception as e:
                    return self._json({"error": f"{type(e).__name__}: {e}"}, 422)
                return self._json({"gif": "data:image/gif;base64," + base64.b64encode(gif).decode(),
                                   "png": "data:image/png;base64," + base64.b64encode(png).decode()})
            if path == "/code":
                return self._json({"code": codegen.generate_script(body["project"])})
            if path == "/user-mobjects":
                def job(r):
                    return library.user.build(
                        body["project"], body.get("name") or "", body.get("desc") or "", body.get("visibility") or "public",
                        body.get("mode") or "animated", body.get("at"), body.get("thumb_t"), body.get("replace"),
                        body.get("source_path"))
                try:
                    item = submit(1, job).result(timeout=120)
                except ValueError as e:
                    return self._json({"error": str(e)}, 422)
                except Exception as e:  # noqa: BLE001 - user code in the project
                    return self._json({"error": f"{type(e).__name__}: {e}"}, 422)
                library.sync_user()
                submit(9, lambda r, i=item["id"]: make_thumb(r, i))
                return self._json({"item": library.user.public_item(item), "plan": library.user.plan()})
            if path == "/user-mobjects/update":
                try:
                    item = library.user.update_meta(body.get("id"), body.get("name"), body.get("desc"), body.get("visibility"))
                except ValueError as e:
                    return self._json({"error": str(e)}, 422)
                library.sync_user()
                return self._json({"item": library.user.public_item(item)})
            if path == "/user-mobjects/delete":
                ok = library.user.delete(str(body.get("id") or ""))
                library.sync_user()
                return self._json({"ok": ok})
            if path == "/export":
                return self._json({"job": start_export(body)})
            if path.startswith("/export/") and path.endswith("/cancel"):
                j = EXPORTS.get(path.split("/")[2])
                if j and j.get("proc") and j["status"] == "running":
                    j["status"] = "cancelled"
                    j["proc"].kill()
                return self._json({"ok": True})
            if path == "/export-code":
                out = body["out"]
                write_export_dir(body["project"], out)
                return self._json({"ok": True, "dir": out})
            if path == "/import-asset":
                src = body["path"]
                with open(src, "rb") as f:
                    data = f.read()
                h = hashlib.sha1(data).hexdigest()[:10]
                base = os.path.splitext(os.path.basename(src))[0]
                base = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in base)[:40] or "asset"
                ext = os.path.splitext(src)[1].lower()
                if ext == ".svg":
                    text = data.decode("utf8", "replace")
                    if "<svg" not in text[:4000].lower():
                        raise ValueError("not a valid SVG file")
                    name = f"{base}-{h}.svg"
                    dst = os.path.join(ASSET_DIR, name)
                    if not os.path.exists(dst):
                        with open(dst, "wb") as f:
                            f.write(data)
                else:
                    try:
                        img = Image.open(io.BytesIO(data))
                        img.load()
                    except Exception:
                        raise ValueError("not a readable image")
                    # normalise everything to RGBA png for the GPU texture loader
                    name = f"{base}-{h}.png"
                    dst = os.path.join(ASSET_DIR, name)
                    if not os.path.exists(dst):
                        img.convert("RGBA").save(dst)
                w = h_ = None
                if ext != ".svg":
                    try:
                        with Image.open(os.path.join(ASSET_DIR, name)) as im:
                            w, h_ = im.size
                    except Exception:
                        pass
                return self._json({"name": name, "kind": "svg" if ext == ".svg" else "image", "width": w, "height": h_})
            return self._json({"error": "not found"}, 404)
        except Exception as e:
            traceback.print_exc()
            return self._json({"error": f"{type(e).__name__}: {e}"}, 500)


PARTS_CACHE: dict = {}

JOB_TIMEOUT = float(os.environ.get("MATHSTUDIO_JOB_TIMEOUT", "20"))


def main():
    renderer = Renderer()
    # ~200k long-lived objects (manimlib, numpy, the library) exist by now; every full (gen-2)
    # collection used to walk them all — 60-170 ms stalls in the middle of preview frames.
    # Freezing them leaves only the scene's own objects to scan. Nothing scene-related exists
    # yet, so no mobject cycle can end up frozen (= leaked).
    import gc
    gc.collect()
    gc.freeze()
    server = ThreadingHTTPServer(("127.0.0.1", ARGS.port), Handler)
    server.daemon_threads = True
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()

    # pre-render thumbnails in the background (lowest priority)
    def warm():
        for it in library.ITEMS:
            if not it.get("hidden"):
                submit(10, lambda r, i=it["id"]: make_thumb(r, i))
        # the mathstudio library too: renders once, then comes from disk on every launch
        for it in library.IMPORTED:
            submit(11, lambda r, i=it["id"]: make_thumb(r, i))
        for it in library.user.ITEMS:
            submit(10, lambda r, i=it["id"]: make_thumb(r, i))
    warm()
    if not os.environ.get("MATHSTUDIO_NO_SEMANTIC"):
        # load the embedding model once the first thumbnails are out of the way (or on first search)
        search.get(DATA_DIR).start(delay=4.0)
    print(f"READY {port}", flush=True)
    log(f"listening on {port}, data={DATA_DIR}")

    import signal

    class JobTimeout(Exception):
        pass

    def on_alarm(signum, frame):
        raise JobTimeout(f"render took longer than {JOB_TIMEOUT:.0f}s (infinite loop in custom code?)")

    signal.signal(signal.SIGALRM, on_alarm)

    while True:
        job = next_job()
        signal.setitimer(signal.ITIMER_REAL, JOB_TIMEOUT)
        try:
            cont = run_job(renderer, job)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            renderer.collect_gl()
        if cont is not None:
            _jobs.put(cont)


if __name__ == "__main__":
    main()
