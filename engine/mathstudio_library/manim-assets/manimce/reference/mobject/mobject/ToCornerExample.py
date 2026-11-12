"""ToCornerExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class ToCornerExample(Scene):
    def construct(self):
        c = Circle()
        c.to_corner(UR)
        t = Tex("To the corner!")
        t2 = MathTex("x^3").shift(DOWN)
        self.add(c,t,t2)
        t.to_corner(DL, buff=0)
        t2.to_corner(UL, buff=1.5)
