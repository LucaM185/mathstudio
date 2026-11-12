"""PangoRender

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/text/text_mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class PangoRender(Scene):
    def construct(self):
        morning = Text("வணக்கம்", font="sans-serif")
        self.play(Write(morning))
        self.wait(2)
