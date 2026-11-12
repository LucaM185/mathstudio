"""SquareToCircle3

Source: https://github.com/ManimCommunity/manim/blob/e80274a/docs/source/tutorials/output_and_config.rst
License: MIT
API: manim (Manim Community)
"""

from manim import *

class SquareToCircle3(Scene):
    def construct(self):
        circle = Circle()                    # create a circle
        circle.set_fill(PINK, opacity=0.5)   # set color and transparency

        square = Square()                    # create a square
        square.flip(RIGHT)                   # flip horizontally
        square.rotate(-3 * TAU / 8)          # rotate a certain amount

        self.play(Create(square))      # animate the creation of the square
        self.play(Transform(square, circle)) # interpolate the square into the circle
        self.play(FadeOut(square))           # fade out animation
