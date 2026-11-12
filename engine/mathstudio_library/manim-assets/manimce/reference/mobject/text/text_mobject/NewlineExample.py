"""NewlineExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/text/text_mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class NewlineExample(Scene):
    def construct(self):
        text = MarkupText('foooo<span foreground="red">oo\nbaa</span>aar')
        self.add(text)
