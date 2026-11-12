from manimlib import *
from _common import *


class MandelbrotZoom(Group):
    """A zoom into the Mandelbrot set: the window halves in width every second of `t`."""

    def __init__(self, t=3.0, center=complex(-0.743643887, 0.131825904), start_width=3.0, zoom_per_second=2.0,
                 height=3.2, aspect=16 / 9, **kwargs):
        super().__init__(**kwargs)
        w = start_width / zoom_per_second ** max(t, 0)
        h = w / aspect
        steps = int(120 + 40 * max(t, 0))  # deeper zooms need more iterations
        self.add(EscapeTimeFractal((center.real - w / 2, center.real + w / 2), (center.imag - h / 2, center.imag + h / 2),
                                   height=height, n_steps=steps))
