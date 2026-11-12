"""BasicMarkupExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/text/text_mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class BasicMarkupExample(Scene):
    def construct(self):
        text1 = MarkupText("<b>foo</b> <i>bar</i> <b><i>foobar</i></b>")
        text2 = MarkupText("<s>foo</s> <u>bar</u> <big>big</big> <small>small</small>")
        text3 = MarkupText("H<sub>2</sub>O and H<sub>3</sub>O<sup>+</sup>")
        text4 = MarkupText("type <tt>help</tt> for help")
        text5 = MarkupText(
            '<span underline="double">foo</span> <span underline="error">bar</span>'
        )
        group = VGroup(text1, text2, text3, text4, text5).arrange(DOWN)
        self.add(group)
