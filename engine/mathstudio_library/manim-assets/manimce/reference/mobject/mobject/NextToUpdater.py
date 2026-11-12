"""NextToUpdater

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class NextToUpdater(Scene):
    def construct(self):
        def update_label(mobject):
            mobject.set_value(dot.get_center()[0])
            mobject.next_to(dot)

        dot = Dot(RIGHT*3)
        label = DecimalNumber()
        label.add_updater(update_label)
        self.add(dot, label)

        self.play(Rotating(dot, angle=TAU, about_point=ORIGIN, run_time=TAU, rate_func=linear))
