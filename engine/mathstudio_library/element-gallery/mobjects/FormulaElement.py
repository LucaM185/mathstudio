from manimlib import *


class FormulaElement(VGroup):
    """A typeset formula (Euler's identity by default)."""

    def __init__(self, tex=r"e^{i\pi} + 1 = 0", **kwargs):
        super().__init__(**kwargs)
        self.add(*Tex(tex).scale(1.2))
