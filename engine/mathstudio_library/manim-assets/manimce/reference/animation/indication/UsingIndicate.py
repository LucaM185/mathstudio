"""UsingIndicate

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/indication.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class UsingIndicate(Scene):
    def construct(self):
        tex = Tex("Indicate").scale(3)
        self.play(Indicate(tex))
        self.wait()
