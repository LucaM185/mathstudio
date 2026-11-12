from manimlib import *


class SphereElement(Group):
    """A shaded 3D sphere with a latitude / longitude mesh."""

    def __init__(self, radius=1.3, color=BLUE_D, mesh_color=BLUE_A, **kwargs):
        super().__init__(**kwargs)
        sphere = Sphere(radius=radius, resolution=(48, 24)).set_color(color)
        sphere.set_shading(0.4, 0.4, 0.2)
        mesh = SurfaceMesh(sphere, resolution=(16, 9)).set_stroke(mesh_color, 1.5, 0.8)
        ball = Group(sphere, mesh).rotate(-70 * DEGREES, RIGHT).rotate(20 * DEGREES, OUT)
        ball.apply_depth_test()
        self.add(ball)
