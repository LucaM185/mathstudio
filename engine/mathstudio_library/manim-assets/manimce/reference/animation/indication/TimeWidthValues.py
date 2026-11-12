"""TimeWidthValues

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/animation/indication.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class TimeWidthValues(Scene):
    def construct(self):
        p = RegularPolygon(5, color=DARK_GRAY, stroke_width=6).scale(3)
        lbl = VMobject()
        self.add(p, lbl)
        p = p.copy().set_color(BLUE)
        for time_width in [0.2, 0.5, 1, 2]:
            lbl.become(Tex(r"\texttt{time\_width={{%.1f}}}"%time_width))
            self.play(ShowPassingFlash(
                p.copy().set_color(BLUE),
                run_time=2,
                time_width=time_width
            ))
