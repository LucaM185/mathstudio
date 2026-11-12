"""Anagram

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/transform_matching_parts.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class Anagram(Scene):
    def construct(self):
        src = Text("the morse code")
        tar = Text("here come dots")
        self.play(Write(src))
        self.wait(0.5)
        self.play(TransformMatchingShapes(src, tar, path_arc=PI/2))
        self.wait(0.5)
