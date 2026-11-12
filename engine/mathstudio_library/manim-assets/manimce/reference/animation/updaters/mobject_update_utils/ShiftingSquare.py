"""ShiftingSquare

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/updaters/mobject_update_utils.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class ShiftingSquare(Scene):
    def construct(self):
        sq = Square().set_fill(opacity=1)
        tri = Triangle()
        VGroup(sq, tri).arrange(LEFT)

        # construct a square which is continuously
        # shifted to the right
        always_shift(sq, RIGHT, rate=5)

        self.add(sq)
        self.play(tri.animate.set_fill(opacity=1))
