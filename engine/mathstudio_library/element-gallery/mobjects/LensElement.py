from manimlib import *


class LensElement(VGroup):
    """A converging lens bending parallel rays to its focal point."""

    def __init__(self, height=2.2, focal_length=1.8, n_rays=3, ray_color=YELLOW, lens_color="#58C4DD", **kwargs):
        super().__init__(**kwargs)
        h = height / 2
        bulge = 0.25
        lens = VMobject()
        arc_angle = 2 * np.arcsin(h / ((h * h + bulge * bulge) / (2 * bulge)))  # chord 2h, sagitta `bulge`
        left = ArcBetweenPoints(h * DOWN, h * UP, angle=-arc_angle)
        right = ArcBetweenPoints(h * UP, h * DOWN, angle=-arc_angle)
        outline = [left.pfp(a) for a in np.linspace(0, 1, 30)] + [right.pfp(a) for a in np.linspace(0, 1, 30)[1:]]
        lens.set_points_as_corners(outline)
        lens.set_fill(lens_color, 0.35).set_stroke(lens_color, 2)
        focus = focal_length * RIGHT
        rays = VGroup()
        for y in np.linspace(-0.6 * h, 0.6 * h, n_rays):
            rays.add(VMobject().set_points_as_corners([np.array([-2.5, y, 0]), np.array([0, y, 0]), focus])
                     .set_stroke(ray_color, 2))
        self.add(rays, lens, Dot(focus, radius=0.06, fill_color=ray_color))
