"""MatchPointsScene

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/opengl/opengl_mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class MatchPointsScene(Scene):
    def construct(self):
        circ = Circle(fill_color=RED, fill_opacity=0.8)
        square = Square(fill_color=BLUE, fill_opacity=0.2)
        self.add(circ)
        self.wait(0.5)
        self.play(circ.animate.match_points(square))
        self.wait(0.5)
