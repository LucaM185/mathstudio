"""NumberPlaneExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/graphing/coordinate_systems.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class NumberPlaneExample(Scene):
    def construct(self):
        number_plane = NumberPlane(
            background_line_style={
                "stroke_color": TEAL,
                "stroke_width": 4,
                "stroke_opacity": 0.6
            }
        )
        self.add(number_plane)
