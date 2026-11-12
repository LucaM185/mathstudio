"""AnimatedBoundaryExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/changing.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class AnimatedBoundaryExample(Scene):
    def construct(self):
        text = Text("So shiny!")
        boundary = AnimatedBoundary(text, colors=[RED, GREEN, BLUE],
                                    cycle_rate=3)
        self.add(text, boundary)
        self.wait(2)
