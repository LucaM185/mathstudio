from manimlib import *


class PendulumElement(VGroup):
    """A pendulum at angle `theta` with the dotted arc it swings along."""

    def __init__(self, length=2.0, theta=0.75, color=BLUE_C, **kwargs):
        super().__init__(**kwargs)
        pivot = Dot(radius=0.05, fill_color=WHITE)
        end = length * np.array([np.sin(theta), -np.cos(theta), 0])
        rod = Line(ORIGIN, end).set_stroke(WHITE, 2)
        bob = Dot(end, radius=0.15, fill_color=color)
        trail = DashedVMobject(Arc(start_angle=-PI / 2 - theta, angle=theta * 1.6, radius=length), num_dashes=14)
        trail.set_stroke(WHITE, 1.5, 0.6)
        self.add(trail, rod, pivot, bob)
