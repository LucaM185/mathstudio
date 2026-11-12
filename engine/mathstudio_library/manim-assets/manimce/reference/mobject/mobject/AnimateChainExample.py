"""AnimateChainExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class AnimateChainExample(Scene):
    def construct(self):
        s = Square()
        self.play(Create(s))
        self.play(s.animate.shift(RIGHT).scale(2).rotate(PI / 2))
        self.play(Uncreate(s))
