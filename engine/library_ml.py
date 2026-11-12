"""
AI & ML library items: neural networks, transformers, attention, embeddings, training…

Imported by library.py (after its parameter helpers are defined), so the helpers can be
re-used from there.  Every template is plain ManimGL code, exactly like the other items.
"""
from __future__ import annotations

from library import (  # noqa: F401
    BLUE, TEAL, GREEN, YELLOW, GOLD, RED, MAROON, PURPLE, WHITE, GREY,
    num, integer, color, text, boolean, select,
)

CAT = "AI & ML"

# A labelled rounded box used by the architecture diagrams.
BOX = '''def box(label, col, w=3.4, h=0.62, size=22):
    rect = RoundedRectangle(width=w, height=h, corner_radius=0.12, stroke_color=col, stroke_width=2.5,
                            fill_color=col, fill_opacity=0.22)
    txt = Text(label, font="Helvetica Neue", font_size=size, fill_color=WHITE)
    if txt.get_width() > w - 0.3:
        txt.set_width(w - 0.3)
    txt.move_to(rect)
    return VGroup(rect, txt)
def up_arrow(lo, hi, col=GREY_B):
    return Arrow(lo.get_top(), hi.get_bottom(), buff=0.06, thickness=2.5, fill_color=col)
'''

ML_ITEMS = [
    dict(id="neural_network", name="Neural Network", category=CAT, enter="ShowCreation",
         params=[text("layers", "Layer sizes", "3, 5, 5, 2"), num("radius", "Neuron radius", 0.2, 0.05, 1, 0.01),
                 num("spacing", "Layer spacing", 1.8, 0.4, 5, 0.1), boolean("weights", "Color weights by sign", False),
                 color("c_in", "Input color", BLUE), color("c_hidden", "Hidden color", TEAL), color("c_out", "Output color", GOLD),
                 color("edge", "Edge color", GREY)],
         code="""sizes = [max(1, min(int(float(s)), 16)) for s in ${layers}.split(",") if s.strip()][:10] or [3, 4, 2]
rng = np.random.default_rng(7)
layers = VGroup()
for i, n in enumerate(sizes):
    col = ${c_in} if i == 0 else (${c_out} if i == len(sizes) - 1 else ${c_hidden})
    layer = VGroup(*[Circle(radius=${radius}, stroke_color=col, stroke_width=3, fill_color=col, fill_opacity=0.25)
                     for _ in range(n)])
    layer.arrange(DOWN, buff=${radius} * 1.1)
    layers.add(layer)
layers.arrange(RIGHT, buff=${spacing})
edges = VGroup()
for l1, l2 in zip(layers[:-1], layers[1:]):
    for n1 in l1:
        for n2 in l2:
            w = rng.normal()
            col = (BLUE if w > 0 else RED) if ${weights} else ${edge}
            width = 0.6 + 1.6 * min(abs(w), 1.5) if ${weights} else 1.2
            edges.add(Line(n1.get_center(), n2.get_center(), buff=${radius}, stroke_color=col,
                           stroke_width=width, stroke_opacity=0.65))
return VGroup(edges, layers)"""),

    dict(id="perceptron", name="Perceptron", category=CAT, enter="ShowCreation",
         params=[integer("inputs", "Inputs", 3, 1, 8), select("activation", "Activation", "σ", ["σ", "ReLU", "tanh", "step"]),
                 color("c_in", "Input color", BLUE), color("c_sum", "Neuron color", GOLD), color("edge", "Weight color", GREY)],
         code="""n = ${inputs}
xs = VGroup(*[VGroup(Circle(radius=0.32, stroke_color=${c_in}, fill_color=${c_in}, fill_opacity=0.2),
                     Tex(f"x_{{{i + 1}}}", font_size=30)) for i in range(n)]).arrange(DOWN, buff=0.6)
for c in xs:
    c[1].move_to(c[0])
neuron = VGroup(Circle(radius=0.55, stroke_color=${c_sum}, fill_color=${c_sum}, fill_opacity=0.2), Tex(r"\\Sigma", font_size=44))
neuron.next_to(xs, RIGHT, buff=2.6)
neuron[1].move_to(neuron[0])
act = VGroup(RoundedRectangle(width=1.3, height=0.8, corner_radius=0.12, stroke_color=TEAL, fill_color=TEAL, fill_opacity=0.2),
             Text(${activation}, font="Helvetica Neue", font_size=28))
act.next_to(neuron, RIGHT, buff=1.0)
act[1].move_to(act[0])
out = Tex(r"\\hat{y}", font_size=40).next_to(act, RIGHT, buff=1.0)
edges = VGroup()
for i, x in enumerate(xs):
    ln = Arrow(x.get_right(), neuron.get_left(), buff=0.08, thickness=2, fill_color=${edge})
    w = Tex(f"w_{{{i + 1}}}", font_size=24, fill_color=GREY_A).move_to(ln.point_from_proportion(0.3)).shift(UP * 0.22)
    edges.add(ln, w)
bias = Tex("b", font_size=30, fill_color=GREY_A).next_to(neuron, UP, buff=0.5)
edges.add(Arrow(bias.get_bottom(), neuron.get_top(), buff=0.08, thickness=2, fill_color=${edge}), bias)
edges.add(Arrow(neuron.get_right(), act.get_left(), buff=0.08, thickness=2.5, fill_color=WHITE),
          Arrow(act.get_right(), out.get_left(), buff=0.12, thickness=2.5, fill_color=WHITE))
return VGroup(edges, xs, neuron, act, out)"""),

    dict(id="transformer_block", name="Transformer Block", category=CAT, enter="FadeInUp",
         params=[select("variant", "Variant", "Encoder", ["Encoder", "Decoder"]), text("repeat", "Repeat label", "N×"),
                 color("c_attn", "Attention color", GOLD), color("c_ffn", "Feed-forward color", BLUE),
                 color("c_norm", "Add & Norm color", GREEN), color("c_emb", "Embedding color", MAROON)],
         code=BOX + """decoder = ${variant} == "Decoder"
stack = [("Feed Forward", ${c_ffn}), ("Add & Norm", ${c_norm})]
attn = [("Multi-Head Attention", ${c_attn}), ("Add & Norm", ${c_norm})]
if decoder:
    attn = [("Masked Multi-Head Attention", ${c_attn}), ("Add & Norm", ${c_norm}),
            ("Cross-Attention", ${c_attn}), ("Add & Norm", ${c_norm})]
rows = [box(lbl, col) for lbl, col in attn + stack]
layer = VGroup(*rows).arrange(UP, buff=0.42)
frame_ = SurroundingRectangle(layer, buff=0.45, stroke_color=GREY_B, stroke_width=2, fill_color=GREY_E, fill_opacity=0.35)
frame_.round_corners(0.25)
rep = Text(${repeat}, font="Helvetica Neue", font_size=28, fill_color=GREY_A).next_to(frame_, LEFT, buff=0.25)
emb = box("Output Embedding" if decoder else "Input Embedding", ${c_emb})
emb.next_to(frame_, DOWN, buff=1.0)
pe = VGroup(Circle(radius=0.2, stroke_color=WHITE, stroke_width=2), Tex("+", font_size=30)).next_to(frame_, DOWN, buff=0.35)
pe_lbl = Text("Positional\\nEncoding", font="Helvetica Neue", font_size=18, fill_color=GREY_A).next_to(pe, RIGHT, buff=0.35)
arrows = VGroup(up_arrow(emb, pe), Arrow(pe.get_top(), rows[0].get_bottom(), buff=0.06, thickness=2.5, fill_color=GREY_B))
for lo, hi in zip(rows[:-1], rows[1:]):
    arrows.add(up_arrow(lo, hi))
# residual (skip) connections around every sub-layer
skips = VGroup()
x = rows[0].get_left()[0] - 0.3
for i in range(0, len(rows), 2):
    lo, hi = rows[i], rows[i + 1]
    y0 = lo.get_bottom()[1] - 0.2
    y1 = hi.get_center()[1]
    path = VMobject(stroke_color=GREY_B, stroke_width=2)
    path.set_points_as_corners([[lo.get_center()[0], y0, 0], [x, y0, 0], [x, y1, 0], [hi.get_left()[0] - 0.05, y1, 0]])
    skips.add(path, ArrowTip(width=0.14, length=0.14).set_fill(GREY_B).move_to([hi.get_left()[0] - 0.08, y1, 0]))
out = Arrow(rows[-1].get_top(), rows[-1].get_top() + UP * 1.0, buff=0.06, thickness=2.5, fill_color=GREY_B)
return VGroup(frame_, rep, emb, pe, pe_lbl, arrows, skips, layer, out)"""),

    dict(id="multi_head_attention", name="Multi-Head Attention", category=CAT, enter="FadeIn",
         params=[integer("heads", "Heads", 4, 1, 8), color("c_proj", "Projection color", BLUE),
                 color("c_attn", "Attention color", GOLD), color("c_out", "Output color", GREEN)],
         code=BOX + """h = ${heads}
def stacked(label, col, w=1.4, hh=0.55):
    layers = VGroup()
    for k in range(h - 1, -1, -1):
        b = box(label, col, w=w, h=hh, size=20)
        if k:
            b[1].set_opacity(0)
            b[0].set_fill(opacity=0.12)
        layers.add(b.shift(np.array([0.09, 0.09, 0]) * k))
    return layers
lins = VGroup(*[stacked("Linear", ${c_proj}) for _ in range(3)]).arrange(RIGHT, buff=0.5)
qkv = VGroup(*[Tex(s, font_size=36).next_to(l, DOWN, buff=0.7) for s, l in zip("VKQ", lins)])
sdpa = box("Scaled Dot-Product Attention", ${c_attn}, w=5.2, h=0.8)
sdpa_stack = VGroup()
for k in range(h - 1, -1, -1):
    b = sdpa.copy()
    if k:
        b[1].set_opacity(0)
        b[0].set_fill(opacity=0.12)
    sdpa_stack.add(b.shift(np.array([0.09, 0.09, 0]) * k))
sdpa_stack.next_to(lins, UP, buff=0.8)
heads_lbl = Text(f"h = {h}", font="Helvetica Neue", font_size=22, fill_color=GREY_A).next_to(sdpa_stack, RIGHT, buff=0.3)
concat = box("Concat", ${c_out}, w=2.6).next_to(sdpa_stack, UP, buff=0.6)
lin_out = box("Linear", ${c_out}, w=2.6).next_to(concat, UP, buff=0.5)
arrows = VGroup()
for s, l in zip(qkv, lins):
    arrows.add(Arrow(s.get_top(), l.get_bottom(), buff=0.1, thickness=2.5, fill_color=GREY_B))
    arrows.add(Arrow(l.get_top(), [l.get_center()[0], sdpa_stack.get_bottom()[1], 0], buff=0.08, thickness=2.5, fill_color=GREY_B))
arrows.add(up_arrow(sdpa_stack, concat), up_arrow(concat, lin_out))
return VGroup(arrows, qkv, lins, sdpa_stack, heads_lbl, concat, lin_out)"""),

    dict(id="attention_heatmap", name="Attention Matrix", category=CAT, enter="FadeIn",
         params=[text("tokens", "Tokens", "The cat sat on the mat"), boolean("causal", "Causal mask", True),
                 integer("seed", "Random seed", 3, 0, 999), num("cell", "Cell size", 0.6, 0.15, 1.5, 0.05),
                 color("hot", "Weight color", GOLD), boolean("values", "Show values", False)],
         code="""toks = ${tokens}.split()[:14] or ["…"]
n = len(toks)
rng = np.random.default_rng(${seed})
scores = rng.normal(size=(n, n)) * 1.4 + np.eye(n) * 1.2
if ${causal}:
    scores = np.where(np.tril(np.ones((n, n))) > 0, scores, -np.inf)
w = np.exp(scores - scores.max(axis=1, keepdims=True))
w = w / w.sum(axis=1, keepdims=True)
s = ${cell}
grid = VGroup()
for i in range(n):
    for j in range(n):
        sq = Square(side_length=s * 0.94, stroke_width=0, fill_color=${hot}, fill_opacity=0.06 + 0.94 * w[i, j] ** 0.7)
        sq.move_to([j * s, -i * s, 0])
        grid.add(sq)
        if ${values} and w[i, j] > 0.005:
            grid.add(DecimalNumber(w[i, j], num_decimal_places=2, font_size=s * 22, fill_color=WHITE).move_to(sq))
fs = 16 + 10 * s
rows = VGroup(*[Text(tk, font="Helvetica Neue", font_size=fs, fill_color=GREY_A).next_to([-s / 2, -i * s, 0], LEFT, buff=0.15)
                for i, tk in enumerate(toks)])
cols = VGroup(*[Text(tk, font="Helvetica Neue", font_size=fs, fill_color=GREY_A).rotate(PI / 4)
                .next_to([j * s, s / 2, 0], UP, buff=0.12) for j, tk in enumerate(toks)])
for c in cols:
    c.shift(RIGHT * c.get_width() * 0.35)
return VGroup(grid, rows, cols)"""),

    dict(id="attention_arcs", name="Self-Attention Arcs", category=CAT, enter="ShowCreation",
         params=[text("tokens", "Tokens", "The animal didn't cross the street because it was tired"),
                 integer("focus", "Query token index", 7, 0, 30), integer("seed", "Random seed", 5, 0, 999),
                 color("arc", "Arc color", GOLD), color("token", "Token color", WHITE)],
         code="""toks = ${tokens}.split()[:16] or ["…"]
n = len(toks)
q = min(max(${focus}, 0), n - 1)
labels = VGroup(*[Text(tk, font="Helvetica Neue", font_size=30, fill_color=${token}) for tk in toks])
labels.arrange(RIGHT, buff=0.32, aligned_edge=DOWN)
rng = np.random.default_rng(${seed})
sc = rng.normal(size=n) * 1.3
sc[q] -= 1.0
w = np.exp(sc - sc.max()); w /= w.sum()
arcs = VGroup()
for j in range(n):
    if j == q:
        continue
    p0 = labels[q].get_top() + UP * 0.12
    p1 = labels[j].get_top() + UP * 0.12
    arcs.add(ArcBetweenPoints(p0, p1, angle=-PI * 0.75 if j > q else PI * 0.75, stroke_color=${arc},
                              stroke_width=1 + 9 * w[j] / w.max(), stroke_opacity=0.25 + 0.75 * w[j] / w.max()))
hl = SurroundingRectangle(labels[q], buff=0.08, stroke_color=${arc}, stroke_width=2, fill_color=${arc}, fill_opacity=0.15)
hl.round_corners(0.08)
return VGroup(arcs, hl, labels)"""),

    dict(id="tokenizer", name="Tokenization", category=CAT, enter="FadeIn",
         params=[text("text", "Text", "Transformers tokenize unbelievable words"), integer("max_len", "Max sub-word length", 10, 2, 20),
                 boolean("ids", "Show token ids", True), num("font_size", "Font size", 30, 8, 80, 1)],
         code="""palette = [BLUE, GREEN, GOLD, MAROON, PURPLE, TEAL, RED]
pieces = []
PRE = ("un", "re", "pre", "dis")
SUF = ("ization", "ation", "ize", "able", "ible", "ing", "ers", "er", "est", "ed", "ly", "ness", "s")
for word in ${text}.split():
    parts, w = [], word
    for p in PRE:
        if w.lower().startswith(p) and len(w) > len(p) + 3:
            parts.append(w[:len(p)]); w = w[len(p):]
            break
    tail = []
    for _ in range(2):
        for sfx in SUF:
            if w.lower().endswith(sfx) and len(w) > len(sfx) + 2:
                tail.insert(0, w[-len(sfx):]); w = w[:-len(sfx)]
                break
    k = ${max_len}
    parts += [w[i:i + k] for i in range(0, len(w), k)] + tail
    pieces += [("" if i == 0 else "##") + p for i, p in enumerate(parts)]
chips = VGroup()
for idx, p in enumerate(pieces[:24]):
    col = palette[idx % len(palette)]
    t = Text(p, font="Menlo", font_size=${font_size}, fill_color=WHITE)
    r = SurroundingRectangle(t, buff=0.1, stroke_color=col, stroke_width=2, fill_color=col, fill_opacity=0.3).round_corners(0.08)
    chip = VGroup(r, t)
    if ${ids}:
        tid = 1000 + (sum(ord(ch) * (i + 7) for i, ch in enumerate(p)) % 29000)
        chip.add(Text(str(tid), font="Menlo", font_size=${font_size} * 0.55, fill_color=col).next_to(r, DOWN, buff=0.1))
    chips.add(chip)
# flow layout: wrap into rows no wider than ~11 units
rows, row, width = VGroup(), VGroup(), 0.0
for chip in chips:
    if len(row) and width + chip.get_width() > 11:
        rows.add(row); row, width = VGroup(), 0.0
    row.add(chip); width += chip.get_width() + 0.15
if len(row):
    rows.add(row)
for r in rows:
    r.arrange(RIGHT, buff=0.15, aligned_edge=UP)
rows.arrange(DOWN, buff=0.3)
return rows"""),

    dict(id="token_embeddings", name="Token Embeddings", category=CAT, enter="FadeIn",
         params=[text("tokens", "Tokens", "I love linear algebra"), integer("dim", "Embedding size", 6, 2, 16),
                 integer("seed", "Random seed", 1, 0, 999), color("pos", "Positive color", BLUE), color("neg", "Negative color", RED)],
         code="""toks = ${tokens}.split()[:10] or ["…"]
rng = np.random.default_rng(${seed})
cols = VGroup()
for tk in toks:
    vec = rng.normal(size=${dim})
    cells = VGroup()
    for v in vec:
        c = ${pos} if v >= 0 else ${neg}
        cell = Rectangle(width=0.9, height=0.42, stroke_color=GREY_D, stroke_width=1, fill_color=c, fill_opacity=0.15 + 0.6 * min(abs(v), 1.8) / 1.8)
        cell.add(DecimalNumber(v, num_decimal_places=1, include_sign=True, font_size=18).move_to(cell))
        cells.add(cell)
    cells.arrange(DOWN, buff=0)
    word = Text(tk, font="Helvetica Neue", font_size=28).next_to(cells, UP, buff=0.5)
    arrow = Arrow(word.get_bottom(), cells.get_top(), buff=0.08, thickness=2, fill_color=GREY_B)
    cols.add(VGroup(word, arrow, cells))
cols.arrange(RIGHT, buff=0.4, aligned_edge=UP)
return cols"""),

    dict(id="embedding_space", name="Word Embedding Space", category=CAT, enter="FadeIn",
         params=[text("words", "Words (word: x, y; …)", "man: -2.5, -1.2; woman: -0.5, -1.6; king: -1.8, 1.3; queen: 0.2, 0.9; apple: 2.8, -0.4; banana: 3.2, 0.5"),
                 boolean("analogy", "Draw analogy arrows (first 4)", True), boolean("grid", "Background grid", True),
                 color("dots", "Point color", TEAL), color("arrows", "Arrow color", GOLD)],
         code="""pts = []
for chunk in ${words}.split(";"):
    if ":" not in chunk:
        continue
    w, xy = chunk.split(":", 1)
    try:
        x, y = [float(v) for v in xy.split(",")[:2]]
    except ValueError:
        continue
    pts.append((w.strip(), np.array([x, y, 0.0])))
g = VGroup()
if ${grid}:
    g.add(NumberPlane(x_range=(-4, 4, 1), y_range=(-2.5, 2.5, 1),
                      background_line_style=dict(stroke_color=BLUE_E, stroke_width=1, stroke_opacity=0.5)))
for w, p in pts:
    g.add(Dot(p, radius=0.09, fill_color=${dots}), Text(w, font="Helvetica Neue", font_size=24).next_to(p, UR, buff=0.08))
if ${analogy} and len(pts) >= 4:
    for a_, b_ in ((0, 2), (1, 3)):
        g.add(Arrow(pts[a_][1], pts[b_][1], buff=0.12, thickness=2.5, fill_color=${arrows}))
    for a_, b_ in ((0, 1), (2, 3)):
        g.add(DashedLine(pts[a_][1], pts[b_][1], buff=0.12, dash_length=0.08, stroke_color=GREY_B, stroke_width=2))
return g"""),

    dict(id="softmax_probs", name="Next-Token Probabilities", category=CAT, enter="GrowFromLeft",
         params=[text("tokens", "Candidates", "Paris, Lyon, London, Rome, banana"), text("logits", "Logits", "5.1, 2.6, 2.2, 1.4, -1.0"),
                 num("temperature", "Temperature", 1.0, 0.05, 5, 0.05), num("width", "Bar width", 5, 1, 10, 0.5),
                 color("bar", "Bar color", BLUE), color("top", "Top choice color", GOLD)],
         code="""toks = [s.strip() for s in ${tokens}.split(",") if s.strip()][:12] or ["…"]
lg = [float(v) for v in ${logits}.split(",") if v.strip()]
lg = (lg + [0.0] * len(toks))[:len(toks)]
z = np.array(lg) / max(${temperature}, 1e-3)
p = np.exp(z - z.max()); p /= p.sum()
rows = VGroup()
best = int(np.argmax(p))
for i, (tk, pi) in enumerate(zip(toks, p)):
    col = ${top} if i == best else ${bar}
    lbl = Text(tk, font="Helvetica Neue", font_size=26, fill_color=WHITE)
    bar = Rectangle(width=max(${width} * pi, 0.02), height=0.4, stroke_width=0, fill_color=col, fill_opacity=0.85)
    pct = Text(f"{pi * 100:.1f}%", font="Menlo", font_size=20, fill_color=GREY_A)
    rows.add(VGroup(lbl, bar, pct))
rows.arrange(DOWN, buff=0.2)
lw = max(r[0].get_width() for r in rows)
for r in rows:
    r[0].move_to([-lw / 2, r.get_center()[1], 0], aligned_edge=RIGHT)
    r[1].next_to([0, r.get_center()[1], 0], RIGHT, buff=0.25)
    r[2].next_to(r[1], RIGHT, buff=0.15)
return rows"""),

    dict(id="activation_fn", name="Activation Function", category=CAT, enter="ShowCreation",
         params=[select("fn", "Function", "ReLU", ["ReLU", "Sigmoid", "Tanh", "GELU", "Leaky ReLU", "SiLU / Swish", "Softplus"]),
                 boolean("label", "Show name", True), color("curve", "Curve color", YELLOW), num("width", "Width", 7, 2, 14, 0.5)],
         code="""import math
fns = {
    "ReLU": lambda x: max(x, 0.0),
    "Sigmoid": lambda x: 1 / (1 + math.exp(-x)),
    "Tanh": math.tanh,
    "GELU": lambda x: 0.5 * x * (1 + math.erf(x / math.sqrt(2))),
    "Leaky ReLU": lambda x: x if x > 0 else 0.1 * x,
    "SiLU / Swish": lambda x: x / (1 + math.exp(-x)),
    "Softplus": lambda x: math.log1p(math.exp(x)),
}
f = fns.get(${fn}, fns["ReLU"])
axes = Axes(x_range=(-4, 4, 1), y_range=(-1.5, 4, 1), width=${width}, height=${width} * 0.62)
graph = axes.get_graph(f, x_range=(-4, 4, 0.02), color=${curve}, stroke_width=5)
g = VGroup(axes, graph)
if ${label}:
    g.add(Text(${fn}, font="Helvetica Neue", font_size=32, fill_color=${curve}).next_to(axes.c2p(-4, 4), DR, buff=0.2))
return g"""),

    dict(id="gradient_descent", name="Gradient Descent", category=CAT, enter="FadeIn", dynamic=True,
         params=[num("lr", "Learning rate", 0.15, 0.01, 0.6, 0.01), num("x0", "Start x", 0.0, -3.4, 3.2, 0.1),
                 integer("steps", "Steps", 20, 1, 80), color("curve", "Loss curve color", BLUE), color("ball", "Ball color", GOLD)],
         code="""# a = progress through the clip (0 → 1): the ball takes `steps` optimisation steps
L = lambda x: 0.08 * x ** 4 - 0.9 * x ** 2 + 0.35 * x + 3.6
dL = lambda x: 0.32 * x ** 3 - 1.8 * x + 0.35
axes = Axes(x_range=(-3.5, 3.3, 1), y_range=(0, 5, 1), width=9, height=5)
curve = axes.get_graph(L, x_range=(-3.5, 3.3, 0.1), color=${curve}, stroke_width=4)
xs = [float(np.clip(${x0}, -3.5, 3.3))]
for _ in range(${steps}):
    xs.append(float(np.clip(xs[-1] - ${lr} * dL(xs[-1]), -3.5, 3.3)))
u = a * ${steps}
k = min(int(u), ${steps} - 1)
x = xs[k] + (xs[k + 1] - xs[k]) * smooth(u - k) if ${steps} else xs[0]
trail = VGroup(*[Dot(axes.c2p(xv, L(xv)), radius=0.05, fill_color=${ball}, fill_opacity=0.45) for xv in xs[:k + 1]])
ball = Dot(axes.c2p(x, L(x)), radius=0.13, fill_color=${ball})
lbl = Tex(r"\\theta \\leftarrow \\theta - \\eta \\nabla L", font_size=34).next_to(axes, UP, buff=0.1)
return VGroup(axes, curve, trail, ball, lbl)"""),

    dict(id="loss_curve", name="Training Loss Curve", category=CAT, enter="ShowCreation",
         params=[integer("epochs", "Epochs", 50, 5, 500), boolean("val", "Validation curve", True), boolean("overfit", "Show overfitting", True),
                 integer("seed", "Noise seed", 2, 0, 999), color("c_train", "Train color", BLUE), color("c_val", "Validation color", GOLD)],
         code="""E = ${epochs}
rng = np.random.default_rng(${seed})
ep = np.arange(E + 1)
train = 2.2 * np.exp(-ep / (E * 0.22)) + 0.15 + rng.normal(0, 0.03, E + 1)
val = 2.3 * np.exp(-ep / (E * 0.25)) + 0.35 + rng.normal(0, 0.04, E + 1)
if ${overfit}:
    val = val + np.maximum(ep - E * 0.45, 0) ** 2 / (E * E) * 2.2
axes = Axes(x_range=(0, E, max(1, E // 5)), y_range=(0, 2.6, 0.5), width=9, height=5)
axes.x_axis.add_numbers(font_size=18)
axes.y_axis.add_numbers(font_size=18, num_decimal_places=1)
g = VGroup(axes)
xl = Text("epoch", font="Helvetica Neue", font_size=22, fill_color=GREY_A).next_to(axes.x_axis, DOWN, buff=0.45)
yl = Text("loss", font="Helvetica Neue", font_size=22, fill_color=GREY_A).next_to(axes.y_axis, UP, buff=0.15)
g.add(xl, yl)
def poly(ys, col):
    m = VMobject(stroke_color=col, stroke_width=4)
    m.set_points_smoothly([axes.c2p(x, max(min(y, 2.6), 0)) for x, y in zip(ep, ys)])
    return m
g.add(poly(train, ${c_train}))
legend = VGroup(VGroup(Line(ORIGIN, RIGHT * 0.5, stroke_color=${c_train}, stroke_width=5), Text("train", font="Helvetica Neue", font_size=20)).arrange(RIGHT))
if ${val}:
    g.add(poly(val, ${c_val}))
    legend.add(VGroup(Line(ORIGIN, RIGHT * 0.5, stroke_color=${c_val}, stroke_width=5), Text("validation", font="Helvetica Neue", font_size=20)).arrange(RIGHT))
legend.arrange(DOWN, aligned_edge=LEFT).next_to(axes.c2p(E, 2.6), DL, buff=0.1)
g.add(legend)
return g"""),

    dict(id="convolution", name="Convolution (CNN)", category=CAT, enter="FadeIn", dynamic=True,
         params=[integer("size", "Input size", 6, 3, 10), integer("kernel", "Kernel size", 3, 1, 5),
                 color("c_in", "Input color", BLUE), color("c_k", "Kernel color", GOLD), color("c_out", "Feature map color", GREEN)],
         code="""# a = progress through the clip: the kernel slides over every position once
N, K = ${size}, min(${kernel}, ${size})
M = N - K + 1
s = 0.42
rng = np.random.default_rng(4)
vals = rng.random((N, N))
inp = VGroup(*[Square(side_length=s, stroke_color=GREY_C, stroke_width=1, fill_color=${c_in}, fill_opacity=0.15 + 0.6 * vals[i, j])
               .move_to([j * s, -i * s, 0]) for i in range(N) for j in range(N)])
out = VGroup(*[Square(side_length=s, stroke_color=GREY_C, stroke_width=1, fill_color=BLACK, fill_opacity=0)
               .move_to([j * s, -i * s, 0]) for i in range(M) for j in range(M)])
out.next_to(inp, RIGHT, buff=1.4)
pos = min(int(a * M * M), M * M - 1)
r, c = divmod(pos, M)
for k in range(pos + 1):
    i, j = divmod(k, M)
    v = vals[i:i + K, j:j + K].mean()
    out[k].set_fill(${c_out}, opacity=0.2 + 0.75 * v)
win = Square(side_length=s * K, stroke_color=${c_k}, stroke_width=4, fill_color=${c_k}, fill_opacity=0.18)
win.move_to(inp[r * N + c].get_corner(UL), aligned_edge=UL)
cur = out[pos].copy().set_stroke(${c_k}, width=4)
link = VGroup(Line(win.get_corner(UR), cur.get_corner(UL), stroke_color=${c_k}, stroke_width=1.5, stroke_opacity=0.7),
              Line(win.get_corner(DR), cur.get_corner(DL), stroke_color=${c_k}, stroke_width=1.5, stroke_opacity=0.7))
lbls = VGroup(Text("input", font="Helvetica Neue", font_size=22, fill_color=GREY_A).next_to(inp, DOWN, buff=0.25),
              Text("feature map", font="Helvetica Neue", font_size=22, fill_color=GREY_A).next_to(out, DOWN, buff=0.25))
return VGroup(inp, out, link, win, cur, lbls)"""),

    dict(id="decision_boundary", name="Classifier Boundary", category=CAT, enter="FadeIn",
         params=[integer("n", "Points per class", 24, 3, 120), num("spread", "Spread", 0.8, 0.1, 2.5, 0.05), integer("seed", "Random seed", 11, 0, 999),
                 boolean("shade", "Shade regions", True), color("c_a", "Class A", BLUE), color("c_b", "Class B", RED)],
         code="""rng = np.random.default_rng(${seed})
W, H = 8, 5
a_pts = rng.normal([-1.4, 0.9], ${spread}, (${n}, 2))
b_pts = rng.normal([1.4, -0.9], ${spread}, (${n}, 2))
g = VGroup()
border = Rectangle(width=W, height=H, stroke_color=GREY_C, stroke_width=1.5)
if ${shade}:
    left = Polygon([-W / 2, H / 2, 0], [-W / 2, -H / 2, 0], [-0.6, -H / 2, 0], [0.6, H / 2, 0], stroke_width=0, fill_color=${c_a}, fill_opacity=0.12)
    right = Polygon([0.6, H / 2, 0], [-0.6, -H / 2, 0], [W / 2, -H / 2, 0], [W / 2, H / 2, 0], stroke_width=0, fill_color=${c_b}, fill_opacity=0.12)
    g.add(left, right)
g.add(border)
clip = lambda p: np.array([np.clip(p[0], -W / 2 + 0.1, W / 2 - 0.1), np.clip(p[1], -H / 2 + 0.1, H / 2 - 0.1), 0])
g.add(*[Dot(clip(p), radius=0.08, fill_color=${c_a}) for p in a_pts])
g.add(*[Square(side_length=0.15, stroke_width=0, fill_color=${c_b}, fill_opacity=1).move_to(clip(p)) for p in b_pts])
g.add(DashedLine([-0.6, -H / 2, 0], [0.6, H / 2, 0], dash_length=0.15, stroke_color=WHITE, stroke_width=3))
return g"""),

    dict(id="rnn_unrolled", name="Recurrent Network (RNN)", category=CAT, enter="FadeIn",
         params=[integer("steps", "Time steps", 4, 1, 8), select("cell", "Cell label", "RNN", ["RNN", "LSTM", "GRU"]),
                 color("c_cell", "Cell color", PURPLE), color("c_io", "Input / output color", TEAL)],
         code=BOX + """T = ${steps}
cells = VGroup(*[box(${cell}, ${c_cell}, w=1.4, h=1.0, size=26) for _ in range(T)]).arrange(RIGHT, buff=1.0)
g = VGroup(cells)
for i, c in enumerate(cells):
    x = Tex(f"x_{{{i + 1}}}", font_size=34, fill_color=${c_io}).next_to(c, DOWN, buff=0.75)
    y = Tex(f"h_{{{i + 1}}}", font_size=34, fill_color=${c_io}).next_to(c, UP, buff=0.75)
    g.add(x, y, Arrow(x.get_top(), c.get_bottom(), buff=0.08, thickness=2.5, fill_color=GREY_B),
          Arrow(c.get_top(), y.get_bottom(), buff=0.08, thickness=2.5, fill_color=GREY_B))
for c1, c2 in zip(cells[:-1], cells[1:]):
    g.add(Arrow(c1.get_right(), c2.get_left(), buff=0.06, thickness=3, fill_color=${c_cell}))
h0 = Tex("h_0", font_size=30, fill_color=GREY_A).next_to(cells[0], LEFT, buff=0.8)
g.add(h0, Arrow(h0.get_right(), cells[0].get_left(), buff=0.08, thickness=3, fill_color=${c_cell}))
return g"""),
]
