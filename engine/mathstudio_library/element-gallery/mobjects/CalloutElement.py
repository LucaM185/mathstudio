from manimlib import *


class CalloutElement(VGroup):
    """A formula called out with a highlighted box around it."""

    def __init__(self, tex="a^2 + b^2 = c^2", color=YELLOW, **kwargs):
        super().__init__(**kwargs)
        formula = Tex(tex)
        box = SurroundingRectangle(formula, buff=0.18).set_stroke(color, 3)
        self.add(formula, box)
