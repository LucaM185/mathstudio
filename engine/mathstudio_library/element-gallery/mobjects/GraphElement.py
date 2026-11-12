from manimlib import *


class GraphElement(VGroup):
    """A small graph: labelled vertices joined by edges."""

    def __init__(self, vertices=None, edges=(("A", "B"), ("A", "C"), ("C", "D"), ("C", "E"), ("D", "E"), ("B", "C")),
                 color="#58C4DD", **kwargs):
        super().__init__(**kwargs)
        vertices = vertices or {"A": (-1.8, 0.9), "B": (-1.8, -0.9), "C": (0, 0), "D": (1.8, 0.9), "E": (1.8, -0.9)}
        pos = {k: np.array([x, y, 0]) for k, (x, y) in vertices.items()}
        lines = VGroup(*(Line(pos[a], pos[b], buff=0.18).set_stroke(GREY_B, 2) for a, b in edges))
        nodes = VGroup()
        for k, p in pos.items():
            nodes.add(VGroup(Circle(radius=0.18).set_fill(color, 1).set_stroke(WHITE, 1).move_to(p),
                             Text(k, font_size=18).set_fill(BLACK, 1).move_to(p)))
        self.add(lines, nodes)
