"""MobjectScaleExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class MobjectScaleExample(Scene):
    def construct(self):
        f1 = Text("F")
        f2 = Text("F").scale(2)
        f3 = Text("F").scale(0.5)
        f4 = Text("F").scale(-1)

        vgroup = VGroup(f1, f2, f3, f4).arrange(6 * RIGHT)
        self.add(vgroup)
