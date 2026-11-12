"""FontsExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/docs/source/guides/using_text.rst
License: MIT
API: manim (Manim Community)
"""

from manim import *

class FontsExample(Scene):
    def construct(self):
        ft = Text("Noto Sans", font="Noto Sans")
        self.add(ft)
