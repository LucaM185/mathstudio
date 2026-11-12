"""Formula

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/text/tex_mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class Formula(Scene):
    def construct(self):
        t = MathTex(r"\int_a^b f'(x) dx = f(b)- f(a)")
        self.add(t)
