from manimlib import *


class AttentionHead(VGroup):
    """One attention head: a sentence, the attention pattern between its words, and the strongest link."""

    def __init__(self, words=("Fourier", "transform", "maps", "time", "into", "frequency"), seed=3, cell=0.32, **kwargs):
        super().__init__(**kwargs)
        n = len(words)
        rng = np.random.default_rng(seed)
        weights = rng.random((n, n)) ** 3
        weights = np.tril(weights) + 1e-3  # causal: a word attends only to earlier words
        weights /= weights.sum(axis=1, keepdims=True)
        tokens = VGroup(*(Text(w, font_size=18) for w in words)).arrange(RIGHT, buff=0.25)
        grid = VGroup()
        for i in range(n):
            for j in range(n):
                sq = Square(cell).set_stroke(BLACK, 1).set_fill(interpolate_color("#202010", YELLOW, weights[i, j] ** 0.6), 1)
                grid.add(sq.move_to([j * cell, -i * cell, 0]))
        grid.next_to(tokens, DOWN, buff=0.5)
        i, j = np.unravel_index(np.argmax(weights - np.eye(n)), weights.shape)
        link = ArcBetweenPoints(tokens[j].get_top() + 0.08 * UP, tokens[i].get_top() + 0.08 * UP, angle=-PI / 2)
        link.set_stroke(ORANGE, 3)
        self.add(tokens, grid, link)
