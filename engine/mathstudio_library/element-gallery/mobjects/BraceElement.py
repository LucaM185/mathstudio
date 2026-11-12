from manimlib import *


class BraceElement(VGroup):
    """A segment with a brace under it and a label for its length."""

    def __init__(self, length=4.0, label="6", color="#58C4DD", **kwargs):
        super().__init__(**kwargs)
        seg = Line(length / 2 * LEFT, length / 2 * RIGHT).set_stroke(color, 4)
        brace = Brace(seg, DOWN, buff=0.1)
        text = Tex(label).next_to(brace, DOWN, buff=0.12)
        self.add(seg, brace, text)
