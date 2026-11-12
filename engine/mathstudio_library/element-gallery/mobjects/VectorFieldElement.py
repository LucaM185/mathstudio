from manimlib import *


class VectorFieldElement(VGroup):
    """A vector field drawn as a grid of arrows (a rotation by default), coloured by length."""

    def __init__(self, func=lambda p: np.array([-p[1], p[0], 0]) * 0.35, x_range=(-3, 3), y_range=(-2, 2), step=0.75,
                 colors=(BLUE_C, GREEN, YELLOW), **kwargs):
        super().__init__(**kwargs)
        pts = [np.array([x, y, 0]) for x in np.arange(x_range[0], x_range[1] + 1e-6, step)
               for y in np.arange(y_range[0], y_range[1] + 1e-6, step)]
        top = max(np.linalg.norm(func(p)) for p in pts) or 1
        for p in pts:
            v = func(p)
            n = np.linalg.norm(v)
            if n < 1e-6:
                continue
            v = v * min(1, 0.6 * step / n) if n > 0.6 * step else v
            alpha = n / top
            color = interpolate_color(colors[0], colors[1], 2 * alpha) if alpha < 0.5 else interpolate_color(colors[1], colors[2], 2 * alpha - 1)
            arrow = Line(p - v / 2, p + v / 2).set_stroke(color, 2)
            arrow.add_tip(length=0.1, width=0.1)
            self.add(arrow.set_fill(color, 1))
