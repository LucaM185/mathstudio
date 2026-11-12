"""ShowDrawBorderThenFill

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/creation.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class ShowDrawBorderThenFill(Scene):
    def construct(self):
        self.play(DrawBorderThenFill(Square(fill_opacity=1, fill_color=ORANGE)))
