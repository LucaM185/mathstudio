from manimlib import *


class NeuralNetElement(VGroup):
    """A feed-forward neural network: layers of neurons, all-to-all connections."""

    def __init__(self, layers=(3, 5, 4, 2), colors=(BLUE_C, TEAL, GREEN_C, YELLOW), h_buff=1.4, v_buff=0.35, radius=0.14, **kwargs):
        super().__init__(**kwargs)
        cols = VGroup()
        for i, (n, c) in enumerate(zip(layers, colors)):
            col = VGroup(*(Dot(radius=radius, fill_color=c) for _ in range(n))).arrange(DOWN, buff=v_buff)
            cols.add(col.move_to(i * h_buff * RIGHT))
        edges = VGroup(*(
            Line(a.get_center(), b.get_center(), buff=radius).set_stroke(GREY_B, 0.8, 0.5)
            for c1, c2 in zip(cols, cols[1:]) for a in c1 for b in c2
        ))
        self.add(edges, cols)
        self.center()
