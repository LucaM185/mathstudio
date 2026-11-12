"""LaTeXAlignEnvironment

Source: https://github.com/ManimCommunity/manim/blob/e80274a/docs/source/guides/using_text.rst
License: MIT
API: manim (Manim Community)
"""

from manim import *

class LaTeXAlignEnvironment(Scene):
    def construct(self):
        tex = MathTex(r'f(x) &= 3 + 2 + 1\\ &= 5 + 1 \\ &= 6', font_size=96)
        self.add(tex)
