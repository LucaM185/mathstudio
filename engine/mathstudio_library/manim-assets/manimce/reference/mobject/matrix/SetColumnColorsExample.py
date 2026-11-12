"""SetColumnColorsExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/matrix.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class SetColumnColorsExample(Scene):
    def construct(self):
        m0 = Matrix([["\\pi", 1], [-1, 3]],
        ).set_column_colors([RED,BLUE], GREEN)
        self.add(m0)
