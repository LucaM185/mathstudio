from manimlib import *


class BarChartElement(VGroup):
    """A labelled bar chart."""

    def __init__(self, values=(3, 5, 2, 6, 4), names=("a", "b", "c", "d", "e"),
                 colors=("#1D4E6E", "#4B3F8C", "#8C3F73", "#C0464B", "#C98A1B"), **kwargs):
        super().__init__(**kwargs)
        top = 8
        axes = Axes(x_range=(0, len(values), 1), y_range=(0, top, 2), width=4.5, height=2.6,
                    axis_config={"stroke_color": GREY_B, "include_tip": False})
        y_labels = VGroup(*(Text(str(y), font_size=18).next_to(axes.c2p(0, y), LEFT, buff=0.15) for y in range(2, top + 1, 2)))
        bars = VGroup()
        for i, (v, c) in enumerate(zip(values, colors)):
            bar = Rectangle(width=axes.x_axis.get_unit_size() * 0.6, height=axes.y_axis.get_unit_size() * v)
            bar.set_fill(c, 0.85).set_stroke(interpolate_color(c, WHITE, 0.3), 1)
            bar.move_to(axes.c2p(i + 0.5, 0), DOWN)
            bars.add(bar)
        labels = VGroup(*(Text(n, font_size=18).next_to(axes.c2p(i + 0.5, 0), DOWN, buff=0.15) for i, n in enumerate(names)))
        self.add(axes, y_labels, bars, labels)
