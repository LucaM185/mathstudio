"""BroadcastExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/specialized.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class BroadcastExample(Scene):
    def construct(self):
        mob = Circle(radius=4, color=TEAL_A)
        self.play(Broadcast(mob))
