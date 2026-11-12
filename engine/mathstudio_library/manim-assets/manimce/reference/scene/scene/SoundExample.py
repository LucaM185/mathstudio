"""SoundExample

Source: https://github.com/ManimCommunity/manim/blob/e80274a/manim/scene/scene.py
License: MIT
API: manim (Manim Community)
"""

from manim import *

class SoundExample(Scene):
    # Source of sound under Creative Commons 0 License. https://freesound.org/people/Druminfected/sounds/250551/
    def construct(self):
        dot = Dot().set_color(GREEN)
        self.add_sound("click.wav")
        self.add(dot)
        self.wait()
        self.add_sound("click.wav")
        dot.set_color(BLUE)
        self.wait()
        self.add_sound("click.wav")
        dot.set_color(RED)
        self.wait()
