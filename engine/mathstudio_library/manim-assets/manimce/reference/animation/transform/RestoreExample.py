"""RestoreExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/transform.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class RestoreExample(Scene):
    def construct(self):
        s = Square()
        s.save_state()
        self.play(FadeIn(s))
        self.play(s.animate.set_color(PURPLE).set_opacity(0.5).shift(2*LEFT).scale(3))
        self.play(s.animate.shift(5*DOWN).rotate(PI/4))
        self.wait()
        self.play(Restore(s), run_time=2)
