from manimlib import *
from _common import *


_PATHS = {}


def double_pendulum_trajectory(theta1, theta2, length, t_max=30.0, dt=0.004, g=9.8):
    """Bob positions of an equal-mass double pendulum, integrated once with RK4 and cached."""
    key = (theta1, theta2, length, t_max, dt)
    if key not in _PATHS:
        def deriv(s):
            t1, w1, t2, w2 = s
            d = t1 - t2
            den = 3 - np.cos(2 * d)
            a1 = (-3 * g * np.sin(t1) - g * np.sin(t1 - 2 * t2) - 2 * np.sin(d) * (w2 ** 2 + w1 ** 2 * np.cos(d)) * length) / (length * den)
            a2 = (2 * np.sin(d) * (2 * w1 ** 2 * length + 2 * g * np.cos(t1) + w2 ** 2 * length * np.cos(d))) / (length * den)
            return np.array([w1, a1, w2, a2])
        s = np.array([theta1, 0.0, theta2, 0.0])
        out = []
        for _ in range(int(t_max / dt) + 1):
            p1 = length * np.array([np.sin(s[0]), -np.cos(s[0]), 0])
            out.append((p1, p1 + length * np.array([np.sin(s[2]), -np.cos(s[2]), 0])))
            k1 = deriv(s); k2 = deriv(s + dt / 2 * k1); k3 = deriv(s + dt / 2 * k2); k4 = deriv(s + dt * k3)
            s = s + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
        _PATHS[key] = (np.array(out), dt)
    return _PATHS[key]


class AnimatedDoublePendulum(VGroup):
    """A chaotic double pendulum at time `t` (seconds), trailing the last `trail` seconds of its lower bob."""

    def __init__(self, t=8.0, theta1=2.2, theta2=2.6, length=1.0, trail=4.0, color=BLUE_C, trail_color=YELLOW, **kwargs):
        super().__init__(**kwargs)
        path, dt = double_pendulum_trajectory(theta1, theta2, length)
        n = int(np.clip(t, 0, 30) / dt)
        self.add(fixed_bounds(4.2 * length, 4.2 * length))
        start = max(0, n - int(trail / dt))
        if n - start > 2:
            tail = VMobject().set_points_as_corners(list(path[start:n + 1:5, 1]))
            tail.set_stroke(trail_color, 1.5, 0.8)
            self.add(tail)
        p1, p2 = path[n]
        self.add(Line(ORIGIN, p1).set_stroke(WHITE, 3), Line(p1, p2).set_stroke(WHITE, 3),
                 Dot(ORIGIN, radius=0.04, fill_color=GREY_B), Dot(p1, radius=0.08, fill_color=color), Dot(p2, radius=0.08, fill_color=color))
