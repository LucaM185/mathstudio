"""TexIndexing

Source: https://github.com/3b1b/manim/blob/fafa083/example_scenes.py
License: MIT
API: manimgl (3b1b/manim)
"""

from manimlib import *

import numpy as np

class TexIndexing(Scene):
    def construct(self):
        # You can index into Tex mobject (or other StringMobjects) by substrings
        equation = Tex(R"e^{\pi i} = -1", font_size=144)

        self.add(equation)
        self.play(FlashAround(equation["e"]))
        self.wait()
        self.play(Indicate(equation[R"\pi"]))
        self.wait()
        self.play(TransformFromCopy(
            equation[R"e^{\pi i}"].copy().set_opacity(0.5),
            equation["-1"],
            path_arc=-PI / 2,
            run_time=3
        ))
        self.play(FadeOut(equation))

        # Or regular expressions
        equation = Tex("A^2 + B^2 = C^2", font_size=144)

        self.play(Write(equation))
        for part in equation[re.compile(r"\w\^2")]:
            self.play(FlashAround(part))
        self.wait()
        self.play(FadeOut(equation))
        
        # Indexing by substrings like this may not work when
        # the order in which Latex draws symbols does not match
        # the order in which they show up in the string.
        # For example, here the infinity is drawn before the sigma
        # so we don't get the desired behavior.
        equation = Tex(R"\sum_{n = 1}^\infty \frac{1}{n^2} = \frac{\pi^2}{6}", font_size=72)
        self.play(FadeIn(equation))
        self.play(equation[R"\infty"].animate.set_color(RED))  # Doesn't hit the infinity
        self.wait()
        self.play(FadeOut(equation))

        # However you can always fix this by explicitly passing in
        # a string you might want to isolate later. Also, using
        # \over instead of \frac helps to avoid the issue for fractions
        equation = Tex(
            R"\sum_{n = 1}^\infty {1 \over n^2} = {\pi^2 \over 6}",
            # Explicitly mark "\infty" as a substring you might want to access
            isolate=[R"\infty"],
            font_size=72
        )
        self.play(FadeIn(equation))
        self.play(equation[R"\infty"].animate.set_color(RED))  # Got it!
        self.wait()
        self.play(FadeOut(equation))
