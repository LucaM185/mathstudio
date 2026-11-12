"""ChangeDecimalToValueExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/numbers.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class ChangeDecimalToValueExample(Scene):
    def construct(self):
        number = DecimalNumber(0)
        self.add(number)
        self.play(ChangeDecimalToValue(number, 10, run_time=3))
        self.wait()
