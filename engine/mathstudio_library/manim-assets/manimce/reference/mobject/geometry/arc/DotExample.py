"""DotExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/geometry/arc.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class DotExample(Scene):
    def construct(self):
        dot1 = Dot(point=LEFT, radius=0.08)
        dot2 = Dot(point=ORIGIN)
        dot3 = Dot(point=RIGHT)
        self.add(dot1,dot2,dot3)
