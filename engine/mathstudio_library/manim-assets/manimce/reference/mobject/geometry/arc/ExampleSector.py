"""ExampleSector

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/geometry/arc.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class ExampleSector(Scene):
    def construct(self):
        sector = Sector(radius=2)
        sector2 = Sector(radius=2.5, angle=60*DEGREES).move_to([-3, 0, 0])
        sector.set_color(RED)
        sector2.set_color(PINK)
        self.add(sector, sector2)
