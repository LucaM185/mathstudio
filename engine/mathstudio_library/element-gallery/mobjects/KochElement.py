from manimlib import *


class KochElement(VMobject):
    """The Koch curve: each segment replaced by four segments a third as long, `order` times."""

    def __init__(self, order=5, length=5.0, color="#5CD0B3", **kwargs):
        super().__init__(**kwargs)
        pts = [np.array([-length / 2, 0, 0]), np.array([length / 2, 0, 0])]
        for _ in range(order):
            new = []
            for a, b in zip(pts, pts[1:]):
                d = (b - a) / 3
                new += [a, a + d, a + d + rotate_vector(d, PI / 3), a + 2 * d]
            pts = new + [pts[-1]]
        self.set_points_as_corners(pts)
        self.set_stroke(color, 2)
