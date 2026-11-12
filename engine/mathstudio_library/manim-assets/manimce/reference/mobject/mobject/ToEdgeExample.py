"""ToEdgeExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class ToEdgeExample(Scene):
    def construct(self):
        tex_top = Tex("I am at the top!")
        tex_top.to_edge(UP)
        tex_side = Tex("I am moving to the side!")
        c = Circle().shift(2*DOWN)
        self.add(tex_top, tex_side, c)
        tex_side.to_edge(LEFT)
        c.to_edge(RIGHT, buff=0)
