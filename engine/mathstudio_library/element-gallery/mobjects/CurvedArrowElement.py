from manimlib import *


class CurvedArrowElement(VGroup):
    """An arrow along a circular arc."""

    def __init__(self, start=(-1.2, 0, 0), end=(1.2, 0.3, 0), angle=PI / 2.5, color=YELLOW, **kwargs):
        super().__init__(**kwargs)
        arrow = CurvedArrow(np.array(start), np.array(end), angle=angle)
        self.add(arrow.set_color(color))
