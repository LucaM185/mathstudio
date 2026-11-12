from manimlib import *


class AngleElement(VGroup):
    """An angle between two rays, marked with an arc and its label."""

    def __init__(self, angle=40 * DEGREES, length=2.4, label=r"\theta", color=YELLOW, **kwargs):
        super().__init__(**kwargs)
        r1 = Line(ORIGIN, length * RIGHT)
        r2 = Line(ORIGIN, length * rotate_vector(RIGHT, angle))
        rays = VGroup(r1, r2).set_stroke(WHITE, 3)
        arc = Arc(start_angle=0, angle=angle, radius=0.5).set_stroke(color, 3)
        tex = Tex(label).set_color(color).scale(0.8).move_to(0.8 * rotate_vector(RIGHT, angle / 2))
        self.add(rays, arc, tex)
