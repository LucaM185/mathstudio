"""ScaleInPlaceExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/transform.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class ScaleInPlaceExample(Scene):
    def construct(self):
        self.play(ScaleInPlace(Text("Hello World!"), 2))
