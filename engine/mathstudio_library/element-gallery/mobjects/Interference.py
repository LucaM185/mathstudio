from manimlib import *
from _common import *


class Interference(VGroup):
    """Two-source interference: circular wavefronts from two sources; the moire shows where they reinforce.
    Animated: the fronts travel outwards at `speed` as `t` grows."""

    def __init__(self, t=0.0, separation=1.4, wavelength=0.28, max_radius=3.2, speed=0.4, color="#3FA8F5", **kwargs):
        super().__init__(**kwargs)
        self.add(fixed_bounds(2 * max_radius + separation, 2 * max_radius))
        phase = (speed * t) % wavelength
        for x in (-separation / 2, separation / 2):
            for k in range(int(max_radius / wavelength) + 1):
                r = k * wavelength + phase
                if 0.02 < r <= max_radius:
                    self.add(Circle(radius=r).move_to([x, 0, 0]).set_stroke(color, 2, opacity=1 - 0.6 * r / max_radius))
            self.add(Dot([x, 0, 0], radius=0.06, fill_color=WHITE))
