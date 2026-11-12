from manimlib import *


class BooleanElement(VGroup):
    """The four boolean operations on two overlapping discs: union, intersection, difference, exclusion."""

    def __init__(self, radius=0.55, **kwargs):
        super().__init__(**kwargs)
        def pair():
            return Circle(radius=radius).shift(0.32 * LEFT), Circle(radius=radius).shift(0.32 * RIGHT)
        ops = [
            ("Union", Union(*pair()), ORANGE),
            ("Intersection", Intersection(*pair()), GREEN_C),
            ("Difference", Difference(*pair()), PURPLE_B),
            ("Exclusion", Exclusion(*pair()), YELLOW),
        ]
        cells = VGroup()
        for name, shape, color in ops:
            shape.set_fill(color, 1).set_stroke(width=0)
            label = Text(name, font_size=16).next_to(shape, DOWN, buff=0.15)
            box = VGroup(Circle(radius=radius).shift(0.32 * LEFT), Circle(radius=radius).shift(0.32 * RIGHT))
            shape.move_to(box)
            cells.add(VGroup(shape, label))
        cells.arrange(RIGHT, buff=0.35, aligned_edge=DOWN)
        self.add(*cells)
