"""Example1Text

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/text/text_mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class Example1Text(Scene):
    def construct(self):
        text = Text('Hello world').scale(3)
        self.add(text)
