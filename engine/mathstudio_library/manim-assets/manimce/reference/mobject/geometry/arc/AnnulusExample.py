"""AnnulusExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/geometry/arc.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class AnnulusExample(Scene):
    def construct(self):
        annulus_1 = Annulus(inner_radius=0.5, outer_radius=1).shift(UP)
        annulus_2 = Annulus(inner_radius=0.3, outer_radius=0.6, color=RED).next_to(annulus_1, DOWN)
        self.add(annulus_1, annulus_2)
