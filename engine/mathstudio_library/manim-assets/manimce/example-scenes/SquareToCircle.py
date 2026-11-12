"""SquareToCircle

Source: https://github.com/ManimCommunity/manim/blob/e80274a/example_scenes/basic.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class SquareToCircle(Scene):
    def construct(self):
        circle = Circle()
        square = Square()
        square.flip(RIGHT)
        square.rotate(-3 * TAU / 8)
        circle.set_fill(PINK, opacity=0.5)

        self.play(Create(square))
        self.play(Transform(square, circle))
        self.play(FadeOut(square))
