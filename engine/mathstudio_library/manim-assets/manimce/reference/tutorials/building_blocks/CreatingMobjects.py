"""CreatingMobjects

Source: https://github.com/ManimCommunity/manim/blob/e80274a/docs/source/tutorials/building_blocks.rst
License: MIT
API: manim (Manim Community)
"""

from manim import *

class CreatingMobjects(Scene):
    def construct(self):
        circle = Circle()
        self.add(circle)
        self.wait(1)
        self.remove(circle)
        self.wait(1)
