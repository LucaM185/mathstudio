"""UnderLine

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/geometry/shape_matchers.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class UnderLine(Scene):
    def construct(self):
        man = Tex("Manim")  # Full Word
        ul = Underline(man)  # Underlining the word
        self.add(man, ul)
