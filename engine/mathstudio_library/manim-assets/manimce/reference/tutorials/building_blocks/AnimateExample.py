"""AnimateExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/docs/source/tutorials/building_blocks.rst
License: MIT
API: manim (Manim Community)
"""

from manim import *

class AnimateExample(Scene):
    def construct(self):
        square = Square().set_fill(RED, opacity=1.0)
        self.add(square)

        # animate the change of color
        self.play(square.animate.set_fill(WHITE))
        self.wait(1)

        # animate the change of position and the rotation at the same time
        self.play(square.animate.shift(UP).rotate(PI / 3))
        self.wait(1)
