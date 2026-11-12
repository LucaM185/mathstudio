"""NoLigaturesExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/text/text_mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class NoLigaturesExample(Scene):
    def construct(self):
        text1 = MarkupText('fl<gradient from="RED" to="GREEN">oat</gradient>ing')
        text2 = MarkupText('fl<gradient from="RED" to="GREEN">oat</gradient>ing', disable_ligatures=True)
        group = VGroup(text1, text2).arrange(DOWN)
        self.add(group)
