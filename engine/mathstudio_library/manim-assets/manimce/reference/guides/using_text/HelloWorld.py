"""HelloWorld

Source: https://github.com/ManimCommunity/manim/blob/e80274a/docs/source/guides/using_text.rst
License: MIT
API: manim (Manim Community)
"""

from manim import *

class HelloWorld(Scene):
    def construct(self):
        text = Text("Hello world", font_size=144)
        self.add(text)
