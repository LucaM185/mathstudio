"""MobjectStyling

Source: https://github.com/ManimCommunity/manim/blob/e80274a/docs/source/tutorials/building_blocks.rst
License: MIT
API: manim (Manim Community)
"""

from manim import *

class MobjectStyling(Scene):
    def construct(self):
        circle = Circle().shift(LEFT)
        square = Square().shift(UP)
        triangle = Triangle().shift(RIGHT)

        circle.set_stroke(color=GREEN, width=20)
        square.set_fill(YELLOW, opacity=1.0)
        triangle.set_fill(PINK, opacity=0.5)

        self.add(circle, square, triangle)
        self.wait(1)
