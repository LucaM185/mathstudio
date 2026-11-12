"""GetBracketsExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/matrix.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class GetBracketsExample(Scene):
    def construct(self):
        m0 = Matrix([["\\pi", 3], [1, 5]])
        bra = m0.get_brackets()
        colors = [BLUE, GREEN]
        for k in range(len(colors)):
            bra[k].set_color(colors[k])
        self.add(m0)
