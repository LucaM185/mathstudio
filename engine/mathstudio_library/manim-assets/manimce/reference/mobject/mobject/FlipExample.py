"""FlipExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class FlipExample(Scene):
    def construct(self):
        s= Line(LEFT, RIGHT+UP).shift(4*LEFT)
        self.add(s)
        s2= s.copy().flip()
        self.add(s2)
