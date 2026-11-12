from manimlib import *


class ButterflyElement(VMobject):
    """Temple Fay's butterfly curve r = e^sin(t) - 2 cos(4t) + sin^5((2t - pi) / 24)."""

    def __init__(self, scale=0.8, turns=12, color=ORANGE, **kwargs):
        super().__init__(**kwargs)
        ts = np.linspace(0, turns * PI, 2400)
        r = np.exp(np.sin(ts)) - 2 * np.cos(4 * ts) + np.sin((2 * ts - PI) / 24) ** 5
        self.set_points_smoothly([scale * np.array([np.sin(t) * k, np.cos(t) * k, 0]) for t, k in zip(ts, r)])
        self.set_stroke(color, 1.5)
