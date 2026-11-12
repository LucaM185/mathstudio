"""PointAtAngleExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/geometry/arc.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class PointAtAngleExample(Scene):
    def construct(self):
        circle = Circle(radius=2.0)
        p1 = circle.point_at_angle(PI/2)
        p2 = circle.point_at_angle(270*DEGREES)

        s1 = Square(side_length=0.25).move_to(p1)
        s2 = Square(side_length=0.25).move_to(p2)
        self.add(circle, s1, s2)
