from manimlib import *


class ChirpSpectrogram(VGroup):
    """A chirp (a tone sweeping up in pitch) and its spectrogram: frequency rises linearly with time."""

    def __init__(self, f0=1.0, sweep=2.5, duration=6.0, width=5.6, n_time=48, n_freq=18, **kwargs):
        super().__init__(**kwargs)
        sx = width / duration
        xs = np.linspace(0, width, 3000)
        ys = 0.45 * np.sin(TAU * (f0 * xs / sx + sweep * (xs / sx) ** 2))
        wave = VMobject().set_points_as_corners(np.stack([xs, ys, 0 * xs], axis=1)).set_stroke(YELLOW, 1.5)
        frame = VGroup(Line(0.5 * DOWN, 0.5 * UP), Line(ORIGIN, width * RIGHT)).set_stroke(GREY_B, 1)
        top = VGroup(frame, wave)
        cw, ch = width / n_time, 2.2 / n_freq
        f_max = f0 + 2 * sweep * duration
        cells = VGroup()
        for i in range(n_time):
            t = (i + 0.5) * duration / n_time
            f_now = f0 + 2 * sweep * t
            for j in range(n_freq):
                f = (j + 0.5) * f_max / n_freq
                level = np.exp(-((f - f_now) / (0.09 * f_max)) ** 2)
                color = interpolate_color("#00106A", YELLOW, level) if level > 0.02 else "#00106A"
                cells.add(Rectangle(width=cw, height=ch).set_stroke(width=0).set_fill(color, 1)
                          .move_to([(i + 0.5) * cw, (j + 0.5) * ch, 0]))
        cells.next_to(top, DOWN, buff=0.3).align_to(top, LEFT)
        self.add(top, cells)
        self.center()
