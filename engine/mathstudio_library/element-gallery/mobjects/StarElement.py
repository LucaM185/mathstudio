from manimlib import *


class StarElement(VGroup):
    """A five-pointed star."""

    def __init__(self, n=5, outer_radius=1.3, inner_ratio=0.38, color=YELLOW, **kwargs):
        super().__init__(**kwargs)
        corners = [
            (outer_radius if k % 2 == 0 else outer_radius * inner_ratio) * rotate_vector(UP, k * PI / n)
            for k in range(2 * n)
        ]
        self.add(Polygon(*corners).set_fill(color, 1).set_stroke(width=0))
