from manimlib import *


class SampleSpaceElement(VGroup):
    """The 36 outcomes of two dice as a grid of dots; outcomes in the event are highlighted."""

    def __init__(self, event=lambda a, b: a >= 4 and b >= 4, spacing=0.4, color=BLUE_D, event_color=YELLOW, **kwargs):
        super().__init__(**kwargs)
        for a in range(1, 7):
            for b in range(1, 7):
                self.add(Dot([(a - 1) * spacing, (b - 1) * spacing, 0], radius=0.07,
                             fill_color=event_color if event(a, b) else color))
        self.center()
