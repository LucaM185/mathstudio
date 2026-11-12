"""IntersectionExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/geometry/boolean_ops.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class IntersectionExample(Scene):
    def construct(self):
        sq = Square(color=RED, fill_opacity=1)
        sq.move_to([-2, 0, 0])
        cr = Circle(color=BLUE, fill_opacity=1)
        cr.move_to([-1.3, 0.7, 0])
        un = Intersection(sq, cr, color=GREEN, fill_opacity=1)
        un.move_to([1.5, 0, 0])
        self.add(sq, cr, un)
