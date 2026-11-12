"""ApplyMatrixExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/transform.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class ApplyMatrixExample(Scene):
    def construct(self):
        matrix = [[1, 1], [0, 2/3]]
        self.play(ApplyMatrix(matrix, Text("Hello World!")), ApplyMatrix(matrix, NumberPlane()))
