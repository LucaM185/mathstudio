from manimlib import *
from _common import *


class MandelbrotSet(Group):
    """The Mandelbrot set, computed per pixel on the GPU (zoom freely: it stays sharp)."""

    def __init__(self, x_range=(-2.5, 1.0), y_range=(-1.2, 1.2), height=3.6, n_steps=120, **kwargs):
        super().__init__(**kwargs)
        self.add(EscapeTimeFractal(x_range, y_range, height=height, n_steps=n_steps))
