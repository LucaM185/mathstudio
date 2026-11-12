"""GeometricShapes

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class GeometricShapes(Scene):
    def construct(self):
        d = Dot()
        c = Circle()
        s = Square()
        t = Triangle()
        d.next_to(c, RIGHT)
        s.next_to(c, LEFT)
        t.next_to(c, DOWN)
        self.add(d, c, s, t)
