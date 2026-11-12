from manimlib import *


class PolygonElement(VGroup):
    """An irregular filled polygon."""

    def __init__(self, vertices=((-1.2, 0.2), (0.4, 0.8), (1.4, -0.3), (0.2, -1.0), (-1.0, -0.6)), color=GREEN_C, **kwargs):
        super().__init__(**kwargs)
        self.add(Polygon(*(np.array([x, y, 0]) for x, y in vertices)).set_fill(color, 1).set_stroke(width=0))
