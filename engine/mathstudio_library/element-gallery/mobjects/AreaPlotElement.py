from manimlib import *


class AreaPlotElement(VGroup):
    """A function graph with the area under it shaded between a and b."""

    def __init__(self, func=lambda x: 1.5 - 0.12 * (x - 2.5) ** 2, a=0.5, b=4.5, color=YELLOW, area_color=TEAL, **kwargs):
        super().__init__(**kwargs)
        axes = Axes(x_range=(0, 5, 1), y_range=(0, 2.5, 1), width=5, height=2.5,
                    axis_config={"stroke_color": GREY_B, "include_tip": True})
        graph = axes.get_graph(func, x_range=(0.1, 4.9)).set_stroke(color, 3)
        xs = np.linspace(a, b, 60)
        region = Polygon(axes.c2p(a, 0), *(axes.c2p(x, func(x)) for x in xs), axes.c2p(b, 0))
        region.set_fill(area_color, 0.55).set_stroke(width=0)
        self.add(axes, region, graph)
