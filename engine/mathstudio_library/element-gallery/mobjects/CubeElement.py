from manimlib import *


class CubeElement(Group):
    """A shaded 3D cube, turned so three faces show."""

    def __init__(self, side=1.6, color=TEAL, **kwargs):
        super().__init__(**kwargs)
        cube = Cube(color=color, side_length=side, shading=(0.3, 0.6, 0.2))
        cube.rotate(35 * DEGREES, UP).rotate(-25 * DEGREES, RIGHT)
        cube.apply_depth_test()
        self.add(cube)
