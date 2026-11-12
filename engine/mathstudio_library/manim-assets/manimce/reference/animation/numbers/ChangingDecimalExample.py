"""ChangingDecimalExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/numbers.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class ChangingDecimalExample(Scene):
    def construct(self):
        number = DecimalNumber(0)
        self.add(number)
        self.play(
            ChangingDecimal(
                number,
                lambda a: 5 * a,
                run_time=3
            )
        )
        self.wait()
