"""ArcExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/geometry/arc.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class ArcExample(Scene):
    def construct(self):
        self.add(Arc(angle=PI))
