"""OverrideAnimationExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/animation.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class MySquare(Square):
    @override_animation(FadeIn)
    def _fade_in_override(self, **kwargs):
        return Create(self, **kwargs)

class OverrideAnimationExample(Scene):
    def construct(self):
        self.play(FadeIn(MySquare()))
