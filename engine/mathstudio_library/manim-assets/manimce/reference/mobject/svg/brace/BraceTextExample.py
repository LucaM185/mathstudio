"""BraceTextExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/svg/brace.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class BraceTextExample(Scene):
    def construct(self):
        s1 = Square().move_to(2*LEFT)
        self.add(s1)
        br1 = BraceText(s1, "Label")
        self.add(br1)

        s2 = Square().move_to(2*RIGHT)
        self.add(s2)
        br2 = BraceText(s2, "Label")

        br2.change_label("new")
        self.add(br2)
        self.wait(0.1)
