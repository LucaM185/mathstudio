"""WarpSquare

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/transform.py
License: MIT
API: manim (Manim Community)
"""

from manim import *
import numpy as np

class WarpSquare(Scene):
    def construct(self):
        square = Square()
        self.play(
            ApplyPointwiseFunction(
                lambda point: complex_to_R3(np.exp(R3_to_complex(point))), square
            )
        )
        self.wait()
