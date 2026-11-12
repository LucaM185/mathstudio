"""RotateMethodExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class RotateMethodExample(Scene):
    def construct(self):
        circle = Circle(radius=1, color=BLUE)
        line = Line(start=ORIGIN, end=RIGHT)
        arrow1 = Arrow(start=ORIGIN, end=RIGHT, buff=0, color=GOLD)
        group1 = VGroup(circle, line, arrow1)

        group2 = group1.copy()
        arrow2 = group2[2]
        arrow2.rotate(angle=PI / 4, about_point=arrow2.get_start())

        group3 = group1.copy()
        arrow3 = group3[2]
        arrow3.rotate(angle=120 * DEGREES, about_point=arrow3.get_start())

        self.add(VGroup(group1, group2, group3).arrange(RIGHT, buff=1))
