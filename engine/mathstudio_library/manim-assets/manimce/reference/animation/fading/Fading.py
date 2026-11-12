"""Fading

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/fading.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class Fading(Scene):
    def construct(self):
        tex_in = Tex("Fade", "In").scale(3)
        tex_out = Tex("Fade", "Out").scale(3)
        self.play(FadeIn(tex_in, shift=DOWN, scale=0.66))
        self.play(ReplacementTransform(tex_in, tex_out))
        self.play(FadeOut(tex_out, shift=DOWN * 2, scale=1.5))
