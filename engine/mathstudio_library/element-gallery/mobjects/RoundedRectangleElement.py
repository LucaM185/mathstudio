from manimlib import *


class RoundedRectangleElement(VGroup):
    """A filled rectangle with rounded corners."""

    def __init__(self, width=2.4, height=1.4, corner_radius=0.2, color="#7B5C9C", **kwargs):
        super().__init__(**kwargs)
        self.add(RoundedRectangle(width=width, height=height, corner_radius=corner_radius).set_fill(color, 1).set_stroke(width=0))
