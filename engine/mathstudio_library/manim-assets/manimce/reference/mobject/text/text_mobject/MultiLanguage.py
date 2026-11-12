"""MultiLanguage

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/text/text_mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class MultiLanguage(Scene):
    def construct(self):
        morning = MarkupText("வணக்கம்", font="sans-serif")
        japanese = MarkupText(
            '<span fgcolor="blue">日本</span>へようこそ'
        )  # works as in ``Text``.
        mess = MarkupText("Multi-Language", weight=BOLD)
        russ = MarkupText("Здравствуйте मस नम म ", font="sans-serif")
        hin = MarkupText("नमस्ते", font="sans-serif")
        chinese = MarkupText("臂猿「黛比」帶著孩子", font="sans-serif")
        group = VGroup(morning, japanese, mess, russ, hin, chinese).arrange(DOWN)
        self.add(group)
