from manimlib import *


class ElectricField(VGroup):
    """Field lines of point charges (red positive, blue negative), traced along E from each positive charge."""

    def __init__(self, charges=((-1.2, -0.3, 1.0), (0.6, 0.8, 1.0), (1.8, -0.6, -1.0)), lines_per_charge=14,
                 bounds=(3.6, 2.2), step=0.03, color=GREY_B, **kwargs):
        super().__init__(**kwargs)
        qs = [(np.array([x, y]), q) for x, y, q in charges]

        def field(p):
            e = np.zeros(2)
            for c, q in qs:
                d = p - c
                r = max(np.linalg.norm(d), 0.05)
                e += q * d / r ** 3
            return e

        lines = VGroup()
        for c, q in qs:
            if q <= 0:
                continue
            for k in range(lines_per_charge):
                a = TAU * (k + 0.5) / lines_per_charge
                p = c + 0.12 * np.array([np.cos(a), np.sin(a)])
                pts = [p.copy()]
                for _ in range(600):
                    e = field(p)
                    n = np.linalg.norm(e)
                    if n < 1e-9:
                        break
                    p = p + step * e / n
                    pts.append(p.copy())
                    if abs(p[0]) > bounds[0] or abs(p[1]) > bounds[1]:
                        break
                    if any(qq < 0 and np.linalg.norm(p - cc) < 0.1 for cc, qq in qs):
                        break
                if len(pts) > 2:
                    lines.add(VMobject().set_points_smoothly([np.array([x, y, 0]) for x, y in pts[::3] + [pts[-1]]]))
        lines.set_stroke(color, 1.2, 0.8)
        dots = VGroup(*(Dot(np.array([*c, 0]), radius=0.1, fill_color=RED if q > 0 else BLUE_C) for c, q in qs))
        self.add(lines, dots)
