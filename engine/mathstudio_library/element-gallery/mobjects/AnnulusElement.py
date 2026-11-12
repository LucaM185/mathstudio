from manimlib import *


class AnnulusElement(VGroup):
    """A ring: the region between two concentric circles."""

    def __init__(self, inner_radius=0.5, outer_radius=1.0, color="#58C4DD", **kwargs):
        super().__init__(**kwargs)
        self.add(Annulus(inner_radius=inner_radius, outer_radius=outer_radius).set_fill(color, 1).set_stroke(width=0))
