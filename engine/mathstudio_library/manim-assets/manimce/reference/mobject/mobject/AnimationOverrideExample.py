"""AnimationOverrideExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/mobject/mobject.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class CircleWithContent(VGroup):
    def __init__(self, content):
        super().__init__()
        self.circle = Circle()
        self.content = content
        self.add(self.circle, content)
        content.move_to(self.circle.get_center())

    def clear_content(self):
        self.remove(self.content)
        self.content = None

    @override_animate(clear_content)
    def _clear_content_animation(self, anim_args=None):
        if anim_args is None:
            anim_args = {}
        anim = Uncreate(self.content, **anim_args)
        self.clear_content()
        return anim

class AnimationOverrideExample(Scene):
    def construct(self):
        t = Text("hello!")
        my_mobject = CircleWithContent(t)
        self.play(Create(my_mobject))
        self.play(my_mobject.animate.clear_content())
        self.wait()
