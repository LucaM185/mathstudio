"""ShowUncreate

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/creation.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class ShowUncreate(Scene):
    def construct(self):
        self.play(Uncreate(Square()))
