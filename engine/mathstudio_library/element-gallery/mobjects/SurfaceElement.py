from manimlib import *


class SurfaceElement(Group):
    """The surface z = f(x, y), tilted so it reads as 3D, with a mesh."""

    def __init__(self, func=lambda x, y: 0.6 * np.sin(1.2 * x) * np.cos(1.2 * y), size=3.0, color=BLUE_D, **kwargs):
        super().__init__(**kwargs)
        surface = ParametricSurface(lambda u, v: np.array([u, v, func(u, v)]),
                                    u_range=(-size / 2 * 1.4, size / 2 * 1.4), v_range=(-size / 2, size / 2), resolution=(48, 32))
        surface.set_color(color).set_shading(0.15, 0.25, 0.35)
        mesh = SurfaceMesh(surface, resolution=(24, 16)).set_stroke(TEAL_A, 1, 0.5)
        # the classic 3D view (camera theta = -30 deg, phi = 70 deg), applied to the object instead
        tilted = Group(surface, mesh).rotate(30 * DEGREES, OUT).rotate(-70 * DEGREES, RIGHT)
        tilted.stretch(0.25, 2)  # flatten depth: an even, near-orthographic look whatever the camera distance
        tilted.apply_depth_test()
        self.add(tilted)
