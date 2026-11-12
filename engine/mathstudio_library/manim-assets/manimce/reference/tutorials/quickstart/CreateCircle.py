"""CreateCircle

Source: https://github.com/ManimCommunity/manim/blob/e80274a/docs/source/tutorials/quickstart.rst
License: MIT
API: manim (Manim Community)
"""

from manim import *

class CreateCircle(Scene):
    def construct(self):
        circle = Circle()                   # create a circle
        circle.set_fill(PINK, opacity=0.5)  # set the color and transparency
        self.play(Create(circle))     # show the circle on screen
