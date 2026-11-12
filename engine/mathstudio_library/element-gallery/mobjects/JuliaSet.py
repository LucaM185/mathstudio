from manimlib import *
from _common import *


class JuliaSet(Group):
    """The Julia set of z -> z^2 + c, computed per pixel on the GPU."""

    def __init__(self, c=complex(-0.8, 0.156), x_range=(-1.8, 1.8), y_range=(-1.0, 1.0), height=3.2, n_steps=160, **kwargs):
        super().__init__(**kwargs)
        self.add(EscapeTimeFractal(x_range, y_range, height=height, julia_c=c, n_steps=n_steps))
