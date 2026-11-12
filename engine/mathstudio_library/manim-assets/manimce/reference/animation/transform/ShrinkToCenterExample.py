"""ShrinkToCenterExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/transform.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class ShrinkToCenterExample(Scene):
    def construct(self):
        self.play(ShrinkToCenter(Text("Hello World!")))
