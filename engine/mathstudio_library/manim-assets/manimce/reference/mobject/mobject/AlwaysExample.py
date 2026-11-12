"""AlwaysExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class AlwaysExample(Scene):
    def construct(self):
        sq = Square().to_edge(LEFT)
        t = Text("Hello World!")
        t.always.next_to(sq, UP)
        self.add(sq, t)
        self.play(sq.animate.to_edge(RIGHT))
