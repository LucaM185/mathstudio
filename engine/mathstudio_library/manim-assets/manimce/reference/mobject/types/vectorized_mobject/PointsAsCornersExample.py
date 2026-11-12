"""PointsAsCornersExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/types/vectorized_mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class PointsAsCornersExample(Scene):
    def construct(self):
        corners = (
            # create square
            UR, UL,
            DL, DR,
            UR,
            # create crosses
            DL, UL,
            DR
        )
        vmob = VMobject(stroke_color=RED)
        vmob.set_points_as_corners(corners).scale(2)
        self.add(vmob)
