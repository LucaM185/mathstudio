from manimlib import *


class MatrixElement(VGroup):
    """A matrix in square brackets."""

    def __init__(self, matrix=((1, 2, 0), (0, 1, 3), (4, 0, 1)), **kwargs):
        super().__init__(**kwargs)
        self.add(*Matrix([[str(v) for v in row] for row in matrix]))
