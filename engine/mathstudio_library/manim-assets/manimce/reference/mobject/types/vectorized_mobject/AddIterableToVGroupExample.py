"""AddIterableToVGroupExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/types/vectorized_mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class AddIterableToVGroupExample(Scene):
    def construct(self):
        v = VGroup(
            Square(),               # Singular VMobject instance
            [Circle(), Triangle()], # List of VMobject instances
            Dot(),
            (Dot() for _ in range(2)), # Iterable that generates VMobjects
        )
        v.arrange()
        self.add(v)
