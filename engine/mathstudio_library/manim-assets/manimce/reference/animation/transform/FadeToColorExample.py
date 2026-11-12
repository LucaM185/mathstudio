"""FadeToColorExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/transform.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class FadeToColorExample(Scene):
    def construct(self):
        self.play(FadeToColor(Text("Hello World!"), color=RED))
