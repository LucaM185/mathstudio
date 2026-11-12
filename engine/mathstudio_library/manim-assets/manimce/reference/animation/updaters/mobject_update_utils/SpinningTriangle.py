"""SpinningTriangle

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/updaters/mobject_update_utils.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class SpinningTriangle(Scene):
    def construct(self):
        tri = Triangle().set_fill(opacity=1).set_z_index(2)
        sq = Square().to_edge(LEFT)

        # will keep spinning while there is an animation going on
        always_rotate(tri, rate=2*PI, about_point=ORIGIN)

        self.add(tri, sq)
        self.play(sq.animate.to_edge(RIGHT), rate_func=linear, run_time=1)
