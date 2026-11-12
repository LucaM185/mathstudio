"""UpdatersExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/example_scenes/basic.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class UpdatersExample(Scene):
    def construct(self):
        decimal = DecimalNumber(
            0,
            show_ellipsis=True,
            num_decimal_places=3,
            include_sign=True,
        )
        square = Square().to_edge(UP)

        decimal.add_updater(lambda d: d.next_to(square, RIGHT))
        decimal.add_updater(lambda d: d.set_value(square.get_center()[1]))
        self.add(square, decimal)
        self.play(
            square.animate.to_edge(DOWN),
            rate_func=there_and_back,
            run_time=5,
        )
        self.wait()
