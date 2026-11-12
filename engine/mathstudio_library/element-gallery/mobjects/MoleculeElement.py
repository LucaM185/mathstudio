from manimlib import *


class MoleculeElement(VGroup):
    """Acetone as a ball-and-stick diagram: three carbons and a double-bonded oxygen."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        atoms = {"C1": ((-1.6, 0), "C", GREY_D), "C2": ((0, 0), "C", GREY_D), "C3": ((1.6, 0), "C", GREY_D), "O": ((0, 1.3), "O", RED_D)}
        pos = {k: np.array([x, y, 0]) for k, ((x, y), _, _) in atoms.items()}
        r = 0.24
        bonds = VGroup(Line(pos["C1"], pos["C2"], buff=r), Line(pos["C2"], pos["C3"], buff=r),
                       Line(pos["C2"], pos["O"], buff=r).shift(0.07 * LEFT), Line(pos["C2"], pos["O"], buff=r).shift(0.07 * RIGHT))
        bonds.set_stroke(WHITE, 3)
        balls = VGroup()
        for k, (_, sym, color) in atoms.items():
            balls.add(VGroup(Circle(radius=r).set_fill(color, 1).set_stroke(GREY_B, 2).move_to(pos[k]),
                             Text(sym, font_size=20).move_to(pos[k])))
        self.add(bonds, balls)
