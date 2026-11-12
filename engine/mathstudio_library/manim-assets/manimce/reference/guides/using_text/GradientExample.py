"""GradientExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/docs/source/guides/using_text.rst
License: MIT
API: manim (Manim Community)
"""

from manim import *

class GradientExample(Scene):
    def construct(self):
        t = Text("Hello", gradient=(RED, BLUE, GREEN), font_size=96)
        self.add(t)
