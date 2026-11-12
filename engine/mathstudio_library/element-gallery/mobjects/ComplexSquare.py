from manimlib import *
from _common import *


class ComplexSquare(VGroup):
    """The map z -> z^2 bending a grid of the complex plane; `t` (seconds) runs the morph, done at 3 s."""

    def __init__(self, t=3.0, extent=1.2, step=0.2, duration=3.0, color=BLUE_C, **kwargs):
        super().__init__(**kwargs)
        alpha = smooth(np.clip(t / duration, 0, 1))
        f = lambda z: (1 - alpha) * z + alpha * z * z
        top = max(extent, extent * extent * 2)
        self.add(fixed_bounds(2 * top, 2 * top))
        grid = VGroup()
        vals = np.arange(-extent, extent + 1e-6, step)
        s = np.linspace(-extent, extent, 81)
        for v in vals:
            for line in ([complex(x, v) for x in s], [complex(v, y) for y in s]):
                w = [f(z) for z in line]
                axis = abs(v) < 1e-9
                grid.add(VMobject().set_points_smoothly([np.array([z.real, z.imag, 0]) for z in w])
                         .set_stroke(WHITE if axis else color, 2 if axis else 1, 1 if axis else 0.6))
        self.add(grid)
