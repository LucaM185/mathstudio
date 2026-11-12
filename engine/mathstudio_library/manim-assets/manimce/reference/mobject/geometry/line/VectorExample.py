"""VectorExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/geometry/line.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class VectorExample(Scene):
    def construct(self):
        plane = NumberPlane()
        vector_1 = Vector([1,2])
        vector_2 = Vector([-5,-2])
        self.add(plane, vector_1, vector_2)
