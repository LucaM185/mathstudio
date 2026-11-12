"""IntegerExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/text/numbers.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class IntegerExample(Scene):
    def construct(self):
        self.add(Integer(number=2.5).set_color(ORANGE).scale(2.5).set_x(-0.5).set_y(0.8))
        self.add(Integer(number=3.14159, show_ellipsis=True).set_x(3).set_y(3.3).scale(3.14159))
        self.add(Integer(number=42).set_x(2.5).set_y(-2.3).set_color_by_gradient(BLUE, TEAL).scale(1.7))
        self.add(Integer(number=6.28).set_x(-1.5).set_y(-2).set_color(YELLOW).scale(1.4))
