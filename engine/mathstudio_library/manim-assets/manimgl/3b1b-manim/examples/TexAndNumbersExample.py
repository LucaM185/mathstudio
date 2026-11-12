"""TexAndNumbersExample

Source: https://github.com/3b1b/manim/blob/fafa083/example_scenes.py
License: MIT
API: manimgl (3b1b/manim)
"""

from manimlib import *

import numpy as np

class TexAndNumbersExample(Scene):
    def construct(self):
        axes = Axes((-3, 3), (-3, 3), unit_size=1)
        axes.to_edge(DOWN)
        axes.add_coordinate_labels(font_size=16)
        circle = Circle(radius=2)
        circle.set_stroke(YELLOW, 3)
        circle.move_to(axes.get_origin())
        self.add(axes, circle)

        # When numbers show up in tex, they can be readily
        # replaced with DecimalMobjects so that methods like
        # get_value and set_value can be called on them, and
        # animations like ChangeDecimalToValue can be called
        # on them.
        tex = Tex("x^2 + y^2 = 4.00")
        tex.next_to(axes, UP, buff=0.5)
        value = tex.make_number_changeable("4.00")

        # This will tie the right hand side of our equation to
        # the square of the radius of the circle
        value.add_updater(lambda v: v.set_value(circle.get_radius()**2))
        self.add(tex)

        text = Text("""
            You can manipulate numbers
            in Tex mobjects
        """, font_size=30)
        text.next_to(tex, RIGHT, buff=1.5)
        arrow = Arrow(text, tex)
        self.add(text, arrow)

        self.play(
            circle.animate.set_height(2.0),
            run_time=4,
            rate_func=there_and_back,
        )

        # By default, tex.make_number_changeable replaces the first occurrence
        # of the number,but by passing replace_all=True it replaces all and
        # returns a group of the results
        exponents = tex.make_number_changeable("2", replace_all=True)
        self.play(
            LaggedStart(
                *(FlashAround(exp, buff=0.1, color=RED) for exp in exponents),
                lag_ratio=0.2,
            ),
            exponents.animate.set_color(RED)
        )

        def func(x, y):
            # Switch from manim coords to axes coords
            xa, ya = axes.point_to_coords(np.array([x, y, 0]))
            return xa**4 + ya**4 - 4

        new_curve = ImplicitFunction(func)
        new_curve.match_style(circle)
        circle.rotate(angle_of_vector(new_curve.get_start()))  # Align
        value.clear_updaters()

        self.play(
            *(ChangeDecimalToValue(exp, 4) for exp in exponents),
            ReplacementTransform(circle.copy(), new_curve),
            circle.animate.set_stroke(width=1, opacity=0.5),
        )
