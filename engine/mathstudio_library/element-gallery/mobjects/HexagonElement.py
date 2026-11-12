from manimlib import *


class HexagonElement(VGroup):
    """A regular hexagon."""

    def __init__(self, radius=1.2, color="#5CD0B3", **kwargs):
        super().__init__(**kwargs)
        self.add(RegularPolygon(6, radius=radius).set_fill(color, 1).set_stroke(width=0))
