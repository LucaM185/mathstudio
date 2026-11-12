"""ShowIncreasingSubsetsScene

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/creation.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class ShowIncreasingSubsetsScene(Scene):
    def construct(self):
        p = VGroup(Dot(), Square(), Triangle())
        self.add(p)
        self.play(ShowIncreasingSubsets(p))
        self.wait()
