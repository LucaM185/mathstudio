"""Shared helpers for the element-gallery mobjects (spliced into each item that imports them)."""
from manimlib import *
import numpy as np


def fixed_bounds(width, height):
    """An invisible rectangle. Animated (t-driven) mobjects include one so their size, and therefore
    their placement, stays the same from frame to frame."""
    return Rectangle(width=width, height=height).set_stroke(opacity=0).set_fill(opacity=0)


def arrow_line(start, end, color=WHITE, width=3, tip=0.16):
    line = Line(start, end).set_stroke(color, width)
    line.add_tip(length=tip, width=tip)
    return line.set_fill(color, 1)


FRACTAL_COLORS = ("#000020", "#001060", "#0038A0", "#1C6FD8", "#3FA8F5", "#8BE3FF", "#FFE066", "#FF8C1A", "#B22200")


class EscapeTimeFractal(Mobject):
    """Mandelbrot / Julia set rendered on the GPU with manimlib's `mandelbrot_fractal` shader.

    `x_range` / `y_range` are the window of the complex plane. With `julia_c=None` it is the
    Mandelbrot set, otherwise the Julia set of z -> z^2 + c.
    """

    shader_folder = "mandelbrot_fractal"
    data_dtype = np.dtype([("point", np.float32, (3,))])

    def __init__(self, x_range=(-2.4, 1.0), y_range=(-1.2, 1.2), height=3.6, julia_c=None,
                 n_steps=120, colors=FRACTAL_COLORS, **kwargs):
        self.x_range, self.y_range = tuple(x_range), tuple(y_range)
        self.julia_c = julia_c
        self.n_steps = n_steps
        self.colors = colors
        self._opacity = 1.0
        super().__init__(**kwargs)
        self.set_points([UL, DL, UR, DR])
        self.stretch_to_fit_height(height)
        self.stretch_to_fit_width(height * (x_range[1] - x_range[0]) / (y_range[1] - y_range[0]))

    def init_uniforms(self):
        super().init_uniforms()
        c = complex(self.julia_c or 0)
        self.uniforms.update({
            "scale_factor": 1.0, "offset": np.zeros(3), "opacity": 1.0,
            "n_steps": float(self.n_steps), "mandelbrot": float(self.julia_c is None),
            "parameter": np.array([c.real, c.imag]),
        })
        for n in range(9):
            self.uniforms[f"color{n}"] = np.array(color_to_rgb(self.colors[n % len(self.colors)]))

    def init_colors(self):
        pass

    def set_color(self, color=None, opacity=None, recurse=True):
        if opacity is not None:
            self.set_opacity(opacity)
        return self

    def set_opacity(self, opacity, recurse=True):
        self.uniforms["opacity"] = float(opacity)
        return self

    def get_shader_data(self):
        # keep the complex-plane window glued to the (possibly moved / scaled) rectangle
        ul, dl, ur = self.get_points()[:3]
        scale = (ur[0] - ul[0]) / (self.x_range[1] - self.x_range[0])
        self.uniforms["scale_factor"] = float(scale)
        self.uniforms["offset"] = ul - scale * np.array([self.x_range[0], self.y_range[1], 0])
        return super().get_shader_data()


def pixel_grid(rows, side=2.0, on=WHITE, off="#1C1C1C", stroke=GREY_D):
    """Strings of '#' / '.' (or floats 0..1) as a grid of squares."""
    n = len(rows)
    s = side / n
    grid = VGroup()
    for i, row in enumerate(rows):
        for j, v in enumerate(row):
            level = (1.0 if v == "#" else 0.0) if isinstance(v, str) else float(v)
            grid.add(Square(s).set_stroke(stroke, 1).set_fill(interpolate_color(off, on, level), 1).move_to([j * s, -i * s, 0]))
    return grid.center()
