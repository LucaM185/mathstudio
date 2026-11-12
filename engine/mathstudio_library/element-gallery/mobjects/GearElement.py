from manimlib import *


class GearElement(VMobject):
    """A spur gear with square teeth and a centre hole."""

    def __init__(self, n_teeth=12, radius=1.0, tooth_depth=0.22, hole_radius=0.3, color="#29ABCA", **kwargs):
        super().__init__(**kwargs)
        pts = []
        step = TAU / n_teeth
        for k in range(n_teeth):
            a = k * step
            for frac, r in ((0.0, radius), (0.15, radius + tooth_depth), (0.45, radius + tooth_depth), (0.6, radius), (1.0, radius)):
                ang = a + frac * step
                pts.append(r * np.array([np.cos(ang), np.sin(ang), 0]))
        self.set_points_as_corners([*pts, pts[0]])
        hole = Circle(radius=hole_radius).reverse_points()
        self.add_subpath(hole.get_points())
        self.set_fill(color, 1).set_stroke(width=0)
