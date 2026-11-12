from manimlib import *


class TableElement(VGroup):
    """A small table with a header row (x and x^2 by default)."""

    def __init__(self, header=("x", "x^2"), rows=((1, 1), (2, 4), (3, 9)), cell_width=0.9, cell_height=0.6, **kwargs):
        super().__init__(**kwargs)
        data = [list(header)] + [[str(v) for v in r] for r in rows]
        for i, row in enumerate(data):
            for j, v in enumerate(row):
                pos = np.array([j * cell_width, -i * cell_height, 0])
                self.add(Rectangle(width=cell_width, height=cell_height).set_stroke(WHITE, 2).move_to(pos))
                self.add(Tex(v).scale(0.6).move_to(pos))
        self.center()
