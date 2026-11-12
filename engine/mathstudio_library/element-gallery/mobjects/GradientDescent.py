from manimlib import *


def loss(x, y):
    return 0.12 * (x * x + y * y) + 0.5 * np.sin(1.3 * x) * np.cos(1.1 * y)


def loss_grad(x, y, h=1e-4):
    return np.array([(loss(x + h, y) - loss(x - h, y)) / (2 * h), (loss(x, y + h) - loss(x, y - h)) / (2 * h)])


_SURFACES = {}


class GradientDescent(Group):
    """Gradient descent on a bumpy loss surface: a ball rolls downhill, one step every 1/`steps_per_second` s of `t`."""

    def __init__(self, t=4.0, start=(2.4, 1.9), learning_rate=0.35, steps_per_second=6, color=BLUE_D, **kwargs):
        super().__init__(**kwargs)
        key = color
        if key not in _SURFACES:  # the surface does not change with t: build it once
            surface = ParametricSurface(lambda u, v: np.array([u, v, loss(u, v)]), u_range=(-3, 3), v_range=(-3, 3), resolution=(40, 40))
            surface.set_color(color).set_shading(0.2, 0.3, 0.3).set_opacity(0.9)
            mesh = SurfaceMesh(surface, resolution=(16, 16)).set_stroke(BLUE_A, 1, 0.4)
            _SURFACES[key] = Group(surface, mesh)
        scene3d = _SURFACES[key].copy()
        p = np.array(start, dtype=float)
        path = [p.copy()]
        for _ in range(int(max(t, 0) * steps_per_second)):
            p = p - learning_rate * loss_grad(*p)
            path.append(p.copy())
        lift = 0.06
        pts = [np.array([x, y, loss(x, y) + lift]) for x, y in path]
        if len(pts) > 1:
            scene3d.add(VMobject().set_points_as_corners(pts).set_stroke(RED, 3))
        scene3d.add(Sphere(radius=0.12, resolution=(16, 8)).set_color(RED).move_to(pts[-1] + 0.08 * OUT))
        scene3d.rotate(30 * DEGREES, OUT).rotate(-65 * DEGREES, RIGHT).stretch(0.3, 2)
        scene3d.apply_depth_test()
        self.add(scene3d)
