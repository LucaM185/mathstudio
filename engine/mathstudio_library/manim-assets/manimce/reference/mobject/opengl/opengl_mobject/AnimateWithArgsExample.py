"""AnimateWithArgsExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/opengl/opengl_mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class AnimateWithArgsExample(Scene):
    def construct(self):
        s = Square()
        c = Circle()

        VGroup(s, c).arrange(RIGHT, buff=2)
        self.add(s, c)

        self.play(
            s.animate(run_time=2).rotate(PI / 2),
            c.animate(rate_func=there_and_back).shift(RIGHT),
        )
