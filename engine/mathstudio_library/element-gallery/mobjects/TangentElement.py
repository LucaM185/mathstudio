from manimlib import *


class TangentElement(VGroup):
    """A curve with its tangent line at a point."""

    def __init__(self, func=lambda x: 0.3 * x ** 2, x0=1.4, color=BLUE_C, tangent_color=YELLOW, **kwargs):
        super().__init__(**kwargs)
        axes = Axes(x_range=(-3, 3, 1), y_range=(-1, 3, 1), width=5, height=3, axis_config={"stroke_color": GREY_B})
        graph = axes.get_graph(func, x_range=(-2.6, 3)).set_stroke(color, 3)
        slope = (func(x0 + 1e-4) - func(x0 - 1e-4)) / 2e-4
        tangent = Line(axes.c2p(x0 - 1.8, func(x0) - 1.8 * slope), axes.c2p(x0 + 1.2, func(x0) + 1.2 * slope))
        tangent.set_stroke(tangent_color, 3)
        self.add(axes, graph, tangent, Dot(axes.c2p(x0, func(x0)), radius=0.06, fill_color=tangent_color))
