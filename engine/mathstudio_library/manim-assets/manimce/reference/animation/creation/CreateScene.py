"""CreateScene

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/creation.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class CreateScene(Scene):
    def construct(self):
        self.play(Create(Square()))
