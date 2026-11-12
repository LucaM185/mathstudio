from manimlib import *
from _common import *


class FourierSquare(VGroup):
    """A square wave approximated by its Fourier series; one more odd harmonic every 1/`rate` seconds of `t`."""

    def __init__(self, t=4.0, rate=1.5, max_terms=25, color=YELLOW, **kwargs):
        super().__init__(**kwargs)
        n = int(np.clip(1 + t * rate, 1, max_terms))
        axes = Axes(x_range=(0, TAU, PI / 2), y_range=(-1.5, 1.5, 1), width=6, height=2.6,
                    axis_config={"stroke_color": GREY_B, "include_tip": False})
        square = VMobject().set_points_as_corners([axes.c2p(x, y) for x, y in ((0, 0), (0, 1), (PI, 1), (PI, -1), (TAU, -1), (TAU, 0))])
        square.set_stroke(GREY_C, 1.5, 0.6)
        xs = np.linspace(0, TAU, 1200)
        odd = 2 * np.arange(n) + 1
        ys = 4 / PI * (np.sin(np.outer(xs, odd)) / odd).sum(axis=1)  # partial sum of the series, vectorised
        approx = VMobject().set_points_as_corners(axes.c2p(xs, ys)).set_stroke(color, 3)
        label = Text(f"{n} harmonic{'s' if n > 1 else ''}", font_size=22).next_to(axes, UP, buff=0.15).align_to(axes, RIGHT)
        self.add(axes, square, approx, label)
