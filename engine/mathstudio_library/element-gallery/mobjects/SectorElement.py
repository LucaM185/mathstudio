from manimlib import *


class SectorElement(VGroup):
    """A circular sector (a slice of pie)."""

    def __init__(self, radius=1.6, start_angle=40 * DEGREES, angle=100 * DEGREES, color=ORANGE, **kwargs):
        super().__init__(**kwargs)
        self.add(Sector(radius=radius, start_angle=start_angle, angle=angle).set_fill(color, 1).set_stroke(width=0))
