"""TransformCycle

Source: https://github.com/ManimCommunity/manim/blob/e80274a/docs/source/tutorials/quickstart.rst
License: MIT
API: manim (Manim Community)
"""

from manim import *

class TransformCycle(Scene):
    def construct(self):
        a = Circle()
        t1 = Square()
        t2 = Triangle()
        self.add(a)
        self.wait()
        for t in [t1,t2]:
            self.play(Transform(a,t))
