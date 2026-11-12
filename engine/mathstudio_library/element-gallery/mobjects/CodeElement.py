from manimlib import *


class CodeElement(VGroup):
    """Syntax-highlighted source code on a dark panel."""

    def __init__(self, code="def sigmoid(x):\n    return 1 / (1 + exp(-x))", language="python", font_size=22, **kwargs):
        super().__init__(**kwargs)
        try:
            text = Code(code, language=language, font_size=font_size)
        except Exception:
            text = Text(code, font="Menlo", font_size=font_size)
        panel = RoundedRectangle(width=text.get_width() + 0.5, height=text.get_height() + 0.4, corner_radius=0.1)
        panel.set_fill("#272822", 1).set_stroke(GREY_D, 1).move_to(text)
        self.add(panel, text)
