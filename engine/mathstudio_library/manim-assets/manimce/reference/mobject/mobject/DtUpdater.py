"""DtUpdater

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class DtUpdater(Scene):
    def construct(self):
        square = Square()

        #Let the square rotate 90° per second
        square.add_updater(lambda mobject, dt: mobject.rotate(dt*90*DEGREES))
        self.add(square)
        self.wait(2)
