from manimlib import *


class RightAngleElement(VGroup):
    """Two perpendicular segments with a right-angle marker."""

    def __init__(self, length=1.8, marker=0.25, color=YELLOW, **kwargs):
        super().__init__(**kwargs)
        legs = VGroup(Line(ORIGIN, length * RIGHT), Line(ORIGIN, length * UP)).set_stroke(GREY_A, 3)
        mark = VMobject().set_points_as_corners([marker * RIGHT, marker * (RIGHT + UP), marker * UP]).set_stroke(color, 3)
        self.add(legs, mark)
