"""SomeAnimations

Source: https://github.com/ManimCommunity/manim/blob/e80274a/docs/source/tutorials/building_blocks.rst
License: MIT
API: manim (Manim Community)
"""

from manim import *

class SomeAnimations(Scene):
    def construct(self):
        square = Square()

        # some animations display mobjects, ...
        self.play(FadeIn(square))

        # ... some move or rotate mobjects around...
        self.play(Rotate(square, PI/4))

        # some animations remove mobjects from the screen
        self.play(FadeOut(square))

        self.wait(1)
