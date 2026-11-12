"""HomotopyExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/movement.py
License: MIT
API: manim (Manim Community)
"""

from manim import *
import numpy as np

class HomotopyExample(Scene):
    def construct(self):
        square = Square()

        def homotopy(x, y, z, t):
            if t <= 0.25:
                progress = t / 0.25
                return (x, y + progress * 0.2 * np.sin(x), z)
            else:
                wave_progress = (t - 0.25) / 0.75
                return (x, y + 0.2 * np.sin(x + 10 * wave_progress), z)

        self.play(Homotopy(homotopy, square, rate_func= linear, run_time=2))
