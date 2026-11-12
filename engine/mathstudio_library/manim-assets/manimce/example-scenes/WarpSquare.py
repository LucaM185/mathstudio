"""WarpSquare

Source: https://github.com/ManimCommunity/manim/blob/e80274a/example_scenes/basic.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class WarpSquare(Scene):
    def construct(self):
        square = Square()
        self.play(
            ApplyPointwiseFunction(
                lambda point: complex_to_R3(np.exp(R3_to_complex(point))),
                square,
            ),
        )
        self.wait()
