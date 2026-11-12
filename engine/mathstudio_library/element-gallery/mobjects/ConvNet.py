from manimlib import *
from _common import *


DIGIT_ZERO = [
    "..####..", ".#....#.", "#......#", "#......#",
    "#......#", "#......#", ".#....#.", "..####..",
]


class ConvNet(VGroup):
    """A convolutional network on a digit: input image, four feature maps, class scores."""

    def __init__(self, image=DIGIT_ZERO, prediction=0, seed=4, **kwargs):
        super().__init__(**kwargs)
        rng = np.random.default_rng(seed)
        inp = pixel_grid(image, side=1.4)
        img = np.array([[1.0 if c == "#" else 0.0 for c in row] for row in image])
        kernels = [np.array([[1, 0, -1]] * 3), np.array([[1, 0, -1]] * 3).T, np.eye(3), np.fliplr(np.eye(3))]
        maps = VGroup()
        for k in kernels:
            out = np.zeros((6, 6))
            for i in range(6):
                for j in range(6):
                    out[i, j] = abs((img[i:i + 3, j:j + 3] * k).sum())
            out /= out.max() or 1
            maps.add(pixel_grid(out.tolist(), side=0.8, on="#5CD0B3", off="#0B2A2A", stroke=BLACK))
        maps.arrange_in_grid(2, 2, buff=0.12)
        scores = rng.random(10) * 0.35
        scores[prediction] = 1.0
        bars = VGroup(*(
            Rectangle(width=0.12, height=0.05 + 1.1 * s).set_stroke(width=0).set_fill(YELLOW if k == prediction else BLUE_C, 1)
            for k, s in enumerate(scores)
        )).arrange(RIGHT, buff=0.04, aligned_edge=DOWN)
        digits = VGroup(*(Text(str(k), font_size=12).next_to(b, DOWN, buff=0.06) for k, b in enumerate(bars)))
        stages = VGroup(inp, maps, VGroup(bars, digits)).arrange(RIGHT, buff=0.7)
        arrows = VGroup(*(arrow_line(a.get_right() + 0.1 * RIGHT, b.get_left() + 0.1 * LEFT, GREY_B, 2, 0.12)
                          for a, b in zip(stages, stages[1:])))
        self.add(stages, arrows)
