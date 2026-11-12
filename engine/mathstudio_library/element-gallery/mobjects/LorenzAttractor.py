from manimlib import *
from _common import *


_TRAJ = {}


def lorenz(t_max=20.0, dt=0.005, sigma=10.0, rho=28.0, beta=8 / 3, start=(-8.0, 8.0, 27.0)):
    key = (t_max, dt, sigma, rho, beta, start)
    if key not in _TRAJ:
        s = np.array(start)
        out = [s]
        f = lambda s: np.array([sigma * (s[1] - s[0]), s[0] * (rho - s[2]) - s[1], s[0] * s[1] - beta * s[2]])
        for _ in range(int(t_max / dt)):
            k1 = f(s); k2 = f(s + dt / 2 * k1); k3 = f(s + dt / 2 * k2); k4 = f(s + dt * k3)
            s = s + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
            out.append(s)
        _TRAJ[key] = np.array(out)
    return _TRAJ[key]


class LorenzAttractor(VGroup):
    """The Lorenz attractor traced out over time: the (x, z) projection of the first `t` * `speed` time units."""

    def __init__(self, t=10.0, speed=2.0, scale=0.09, colors=(BLUE_C, TEAL, YELLOW, RED), **kwargs):
        super().__init__(**kwargs)
        traj = lorenz()
        n = int(np.clip(t * speed / 0.005, 2, len(traj) - 1))
        self.add(fixed_bounds(42 * scale, 50 * scale).move_to([0, 25 * scale, 0]))
        pts = [np.array([x * scale, z * scale, 0]) for x, y, z in traj[:n:3]]
        if len(pts) > 1:
            curve = VMobject().set_points_as_corners(pts)
            curve.set_stroke(list(colors), 1.2)
            self.add(curve)
        x, y, z = traj[n]
        self.add(Dot([x * scale, z * scale, 0], radius=0.05, fill_color=WHITE))
