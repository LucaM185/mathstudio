"""GetColumnsExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/matrix.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class GetColumnsExample(Scene):
    def construct(self):
        m0 = Matrix([[r"\pi", 3], [1, 5]])
        m0.add(SurroundingRectangle(m0.get_columns()[1]))
        self.add(m0)
