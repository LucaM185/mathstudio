"""SlantsExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/docs/source/guides/using_text.rst
License: MIT
API: manim (Manim Community)
"""

from manim import *

class SlantsExample(Scene):
    def construct(self):
        a = Text("Italic", slant=ITALIC)
        self.add(a)
