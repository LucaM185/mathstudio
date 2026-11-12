from manimlib import *
from _common import *


def heart(s):
    """The heart curve, s in [0, 1)."""
    a = TAU * s
    return complex(16 * np.sin(a) ** 3, 13 * np.cos(a) - 5 * np.cos(2 * a) - 2 * np.cos(3 * a) - np.cos(4 * a)) / 9


class FourierHeart(VGroup):
    """Epicycles (a Fourier series) drawing a heart. `t` runs the drawing; one full loop takes `period` seconds."""

    def __init__(self, t=6.0, n_vectors=25, period=6.0, color=RED, circle_color=GREY_B, **kwargs):
        super().__init__(**kwargs)
        n_samples = 512
        samples = np.array([heart(k / n_samples) for k in range(n_samples)])
        coefs = np.fft.fft(samples) / n_samples
        freqs = np.fft.fftfreq(n_samples, 1 / n_samples)
        order = np.argsort(-np.abs(coefs))[:n_vectors]
        order = sorted(order, key=lambda k: (abs(freqs[k]), freqs[k] < 0))  # constant term first, then by speed
        def point(s, upto=None):
            return sum(coefs[k] * np.exp(1j * TAU * freqs[k] * s) for k in order[:upto])
        s_now = np.clip(t / period, 0, 1)
        # bounds of everything drawn over the whole loop (curve and circle chain), so the clip never moves
        reach = []
        for s in np.linspace(0, 1, 120):
            z = 0j
            for k in order:
                c = coefs[k] * np.exp(1j * TAU * freqs[k] * s)
                reach += [z + abs(c) * (1 + 0j), z - abs(c) * (1 + 0j), z + abs(c) * 1j, z - abs(c) * 1j]
                z += c
        xs, ys = [z.real for z in reach], [z.imag for z in reach]
        self.add(fixed_bounds(max(xs) - min(xs), max(ys) - min(ys)).move_to([(max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, 0]))
        if s_now > 0:
            drawn = [point(s) for s in np.linspace(0, s_now, max(2, int(400 * s_now)))]
            self.add(VMobject().set_points_smoothly([np.array([z.real, z.imag, 0]) for z in drawn]).set_stroke(color, 4))
        z = 0j
        chain = VGroup()
        for k in order:
            c = coefs[k] * np.exp(1j * TAU * freqs[k] * s_now)
            if abs(c) > 0.02:
                chain.add(Circle(radius=abs(c)).move_to([z.real, z.imag, 0]).set_stroke(circle_color, 1, 0.5))
                chain.add(Line([z.real, z.imag, 0], [(z + c).real, (z + c).imag, 0]).set_stroke(WHITE, 1.5, 0.8))
            z += c
        self.add(chain, Dot([z.real, z.imag, 0], radius=0.05, fill_color=YELLOW))
