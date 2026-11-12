from manimlib import *


class DeepNetwork(VGroup):
    """A deep network with a pulse of activity sweeping through its layers as `t` grows."""

    def __init__(self, t=1.2, layers=(4, 6, 6, 6, 6, 3), h_buff=1.0, v_buff=0.32, radius=0.09, period=3.0, **kwargs):
        super().__init__(**kwargs)
        n = len(layers)
        front = (t % period) / period * (n - 1)  # layer position of the pulse
        cols = VGroup()
        for i, k in enumerate(layers):
            glow = max(0.0, 1 - abs(i - front))
            col = VGroup(*(Dot(radius=radius, fill_color=interpolate_color(GREY_D, YELLOW, glow)).set_stroke(GREY_B, 1)
                           for _ in range(k))).arrange(DOWN, buff=v_buff)
            cols.add(col.move_to(i * h_buff * RIGHT))
        edges = VGroup()
        for i, (a, b) in enumerate(zip(cols, cols[1:])):
            glow = max(0.0, 1 - abs(i + 0.5 - front) * 1.5)
            for p in a:
                for q in b:
                    edges.add(Line(p.get_center(), q.get_center(), buff=radius)
                              .set_stroke(interpolate_color(GREY_D, YELLOW, glow), 0.6 + 1.2 * glow, 0.4 + 0.5 * glow))
        self.add(edges, cols)
        self.center()
