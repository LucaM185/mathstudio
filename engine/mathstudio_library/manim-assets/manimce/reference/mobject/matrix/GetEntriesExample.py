"""GetEntriesExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/matrix.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class GetEntriesExample(Scene):
    def construct(self):
        m0 = Matrix([[2, 3], [1, 5]])
        ent = m0.get_entries()
        colors = [BLUE, GREEN, YELLOW, RED]
        for k in range(len(colors)):
            ent[k].set_color(colors[k])
        self.add(m0)
