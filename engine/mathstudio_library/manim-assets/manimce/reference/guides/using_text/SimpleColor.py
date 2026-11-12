"""SimpleColor

Source: https://github.com/ManimCommunity/manim/blob/e80274a/docs/source/guides/using_text.rst
License: MIT
API: manim (Manim Community)
"""

from manim import *

class SimpleColor(Scene):
    def construct(self):
        col = Text("RED COLOR", color=RED)
        self.add(col)
