from manimlib import *


class LinearMapElement(VGroup):
    """A linear map on the plane: the unit square and its image under the matrix."""

    def __init__(self, matrix=((1.5, 0.8), (0.0, 1.0)), color=YELLOW, image_color=GREEN, **kwargs):
        super().__init__(**kwargs)
        plane = NumberPlane(x_range=(-3, 4), y_range=(-2, 3), faded_line_ratio=0,
                            background_line_style={"stroke_color": BLUE_D, "stroke_width": 1, "stroke_opacity": 0.6})
        m = np.array(matrix)
        square = Polygon(*(plane.c2p(*p) for p in ((0, 0), (1, 0), (1, 1), (0, 1))))
        square.set_fill(color, 0.5).set_stroke(color, 2)
        image = Polygon(*(plane.c2p(*(m @ np.array(p))) for p in ((0, 0), (1, 0), (1, 1), (0, 1))))
        image.set_fill(image_color, 0.4).set_stroke(image_color, 2)
        self.add(plane, square, image)
