from manimlib import *


class RiemannElement(VGroup):
    """A Riemann sum: rectangles approximating the area under a curve."""

    def __init__(self, func=lambda x: 1.2 + 0.4 * np.sin(1.3 * x) + 0.08 * x * x, a=0.5, b=4.5, n=7,
                 color=YELLOW, rect_color=GREEN_D, **kwargs):
        super().__init__(**kwargs)
        axes = Axes(x_range=(0, 5, 1), y_range=(0, 3, 1), width=5, height=2.6,
                    axis_config={"stroke_color": GREY_B, "include_tip": False})
        dx = (b - a) / n
        rects = VGroup()
        for k in range(n):
            x0 = a + k * dx
            h = func(x0 + dx / 2)
            rect = Polygon(axes.c2p(x0, 0), axes.c2p(x0 + dx, 0), axes.c2p(x0 + dx, h), axes.c2p(x0, h))
            rects.add(rect.set_fill(rect_color, 0.9).set_stroke(BLACK, 1))
        graph = axes.get_graph(func, x_range=(0.3, 4.8)).set_stroke(color, 3)
        self.add(axes, rects, graph)
