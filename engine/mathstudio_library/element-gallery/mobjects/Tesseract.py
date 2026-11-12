from manimlib import *
import itertools as it
from _common import *


_BOUNDS = {}


class Tesseract(VGroup):
    """A tesseract (4D cube) turning in the xw and yz planes, in perspective; `t` drives the rotation."""

    def __init__(self, t=0.6, size=1.4, speed=0.6, color=YELLOW_E, edge_color=GREEN_B, **kwargs):
        super().__init__(**kwargs)
        cube = np.array(list(it.product((-1, 1), repeat=4)), dtype=float)

        def rotated(time):
            a, b = speed * time, 0.5 * speed * time
            rot = np.eye(4)
            rot[np.ix_([0, 3], [0, 3])] = [[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]]
            rot2 = np.eye(4)
            rot2[np.ix_([1, 2], [1, 2])] = [[np.cos(b), -np.sin(b)], [np.sin(b), np.cos(b)]]
            return cube @ (rot @ rot2).T

        def project(v):
            k = 1.0 / (3.0 - v[3])
            x, y, z = v[:3] * k
            return np.array([x + 0.3 * z, y + 0.2 * z, 0]) * size * 2.2

        pts = [project(v) for v in rotated(t)]
        # bounds over a whole period of both rotations, so the clip never moves (computed once)
        key = (size, speed)
        if key not in _BOUNDS:
            every = np.array([project(v) for time in np.linspace(0, 4 * PI / speed, 90) for v in rotated(time)])
            _BOUNDS[key] = (every.min(axis=0), every.max(axis=0))
        lo, hi = _BOUNDS[key]
        pad = 0.06 * (hi - lo) + 0.05  # vertex dots, and extremes between the sampled angles
        self.add(fixed_bounds(hi[0] - lo[0] + 2 * pad[0], hi[1] - lo[1] + 2 * pad[1]).move_to((lo + hi) / 2))
        self.add(VGroup(*(Line(pts[i], pts[j]) for i, j in it.combinations(range(16), 2)
                          if np.sum(cube[i] != cube[j]) == 1)).set_stroke(edge_color, 1.5, 0.9))
        self.add(VGroup(*(Dot(p, radius=0.035, fill_color=color) for p in pts)))
