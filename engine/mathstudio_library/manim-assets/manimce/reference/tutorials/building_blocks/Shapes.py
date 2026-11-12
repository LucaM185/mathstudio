"""Shapes

Source: https://github.com/ManimCommunity/manim/blob/e80274a/docs/source/tutorials/building_blocks.rst
License: MIT
API: manim (Manim Community)
"""

from manim import *

class Shapes(Scene):
    def construct(self):
        circle = Circle()
        square = Square()
        triangle = Triangle()

        circle.shift(LEFT)
        square.shift(UP)
        triangle.shift(RIGHT)

        self.add(circle, square, triangle)
        self.wait(1)
