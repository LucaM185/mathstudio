from manimlib import *


class NumberLineElement(VGroup):
    """A number line with a highlighted value."""

    def __init__(self, x_range=(-4, 3, 1), value=1.5, color=YELLOW, **kwargs):
        super().__init__(**kwargs)
        line = NumberLine(x_range, include_numbers=True, include_tip=True, width=6,
                          decimal_number_config={"num_decimal_places": 0, "font_size": 24})
        dot = Dot(line.n2p(value), radius=0.07, fill_color=color)
        label = DecimalNumber(value, num_decimal_places=1, font_size=24).set_color(color).next_to(dot, UP, buff=0.15)
        self.add(line, dot, label)
