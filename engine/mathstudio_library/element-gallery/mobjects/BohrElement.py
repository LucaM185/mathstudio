from manimlib import *


class BohrElement(VGroup):
    """The Bohr model of an atom: a nucleus with electrons on circular shells."""

    def __init__(self, shells=(2, 3), radius=0.6, nucleus_color=RED, electron_color=YELLOW, **kwargs):
        super().__init__(**kwargs)
        self.add(Dot(radius=0.12, fill_color=nucleus_color))
        for k, n in enumerate(shells, 1):
            r = radius * k
            self.add(Circle(radius=r).set_stroke(BLUE_E, 2))
            for j in range(n):
                a = TAU * j / n + 0.4 * k
                self.add(Dot(r * np.array([np.cos(a), np.sin(a), 0]), radius=0.06, fill_color=electron_color))
