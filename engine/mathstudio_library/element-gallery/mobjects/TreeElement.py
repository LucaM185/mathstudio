from manimlib import *


class TreeElement(VGroup):
    """A fractal tree: every branch splits into two shorter branches."""

    def __init__(self, depth=8, trunk=1.4, angle=28 * DEGREES, ratio=0.72, color=GREEN_C, **kwargs):
        super().__init__(**kwargs)
        def grow(start, direction, length, level):
            end = start + length * direction
            self.add(Line(start, end).set_stroke(color, max(0.6, level * 0.6)))
            if level > 1:
                for s in (1, -1):
                    grow(end, rotate_vector(direction, s * angle), length * ratio, level - 1)
        grow(ORIGIN, UP, trunk, depth)
        self.center()
