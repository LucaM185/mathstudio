"""GetRowsExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/matrix.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class GetRowsExample(Scene):
    def construct(self):
        m0 = Matrix([["\\pi", 3], [1, 5]])
        m0.add(SurroundingRectangle(m0.get_rows()[1]))
        self.add(m0)
