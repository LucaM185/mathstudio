"""
Library of pre-made mobjects.

Every item is a small ManimGL code template.  `${param}` placeholders are replaced by
Python literals of the clip's parameter values; the resulting body becomes a factory
function in the generated scene.  The very same code is executed by the live preview.
"""
from __future__ import annotations

BLUE = "#58C4DD"
TEAL = "#5CD0B3"
GREEN = "#83C167"
YELLOW = "#FFFF00"
GOLD = "#F0AC5F"
RED = "#FC6255"
MAROON = "#C55F73"
PURPLE = "#9A72AC"
WHITE = "#FFFFFF"
GREY = "#888888"


def num(id, label, default, min=None, max=None, step=0.1):
    return dict(id=id, label=label, type="number", default=default, min=min, max=max, step=step)


def integer(id, label, default, min=None, max=None):
    return dict(id=id, label=label, type="int", default=default, min=min, max=max, step=1)


def color(id, label, default):
    return dict(id=id, label=label, type="color", default=default)


def text(id, label, default, multiline=False):
    return dict(id=id, label=label, type="text", default=default, multiline=multiline)


def latex(id, label, default):
    return dict(id=id, label=label, type="latex", default=default)


def expr(id, label, default, hint=""):
    return dict(id=id, label=label, type="expr", default=default, hint=hint)


def boolean(id, label, default):
    return dict(id=id, label=label, type="bool", default=default)


def select(id, label, default, options, raw=False):
    return dict(id=id, label=label, type="select", default=default, options=options, raw=raw)


def asset_param(id, label, accept):
    return dict(id=id, label=label, type="asset", default="", accept=accept)


FONTS = ["Helvetica Neue", "Avenir Next", "Georgia", "Menlo", "Futura", "Gill Sans", "Times New Roman", "Courier New"]


def shape_style(stroke=BLUE, fill=BLUE, fill_opacity=0.0, stroke_width=4.0):
    return [
        color("stroke", "Stroke", stroke),
        num("stroke_width", "Stroke width", stroke_width, 0, 20, 0.5),
        color("fill", "Fill", fill),
        num("fill_opacity", "Fill opacity", fill_opacity, 0, 1, 0.05),
    ]


STYLE = "stroke_color=${stroke}, stroke_width=${stroke_width}, fill_color=${fill}, fill_opacity=${fill_opacity}"

from library_ml import ML_ITEMS  # noqa: E402  (AI & ML diagrams live in their own module)

ITEMS = [
    # ------------------------------------------------------------------ Shapes
    dict(id="circle", name="Circle", category="Shapes", enter="ShowCreation",
         params=[num("radius", "Radius", 1.0, 0.05, 8, 0.05), *shape_style(BLUE, BLUE, 0.3)],
         code="return Circle(radius=${radius}, " + STYLE + ")"),
    dict(id="square", name="Square", category="Shapes", enter="ShowCreation",
         params=[num("side", "Side length", 2.0, 0.05, 14, 0.1), *shape_style(GREEN, GREEN, 0.3)],
         code="return Square(side_length=${side}, " + STYLE + ")"),
    dict(id="rectangle", name="Rectangle", category="Shapes", enter="ShowCreation",
         params=[num("width", "Width", 4.0, 0.05, 14, 0.1), num("height", "Height", 2.0, 0.05, 8, 0.1),
                 *shape_style(YELLOW, YELLOW, 0.15)],
         code="return Rectangle(width=${width}, height=${height}, " + STYLE + ")"),
    dict(id="rounded_rectangle", name="Rounded Rect", category="Shapes", enter="ShowCreation",
         params=[num("width", "Width", 4.0, 0.05, 14, 0.1), num("height", "Height", 2.0, 0.05, 8, 0.1),
                 num("corner", "Corner radius", 0.4, 0, 4, 0.05), *shape_style(TEAL, TEAL, 0.2)],
         code="return RoundedRectangle(width=${width}, height=${height}, corner_radius=${corner}, " + STYLE + ")"),
    dict(id="triangle", name="Triangle", category="Shapes", enter="ShowCreation",
         params=[num("size", "Size", 2.0, 0.1, 8, 0.1), *shape_style(RED, RED, 0.3)],
         code="return Triangle(" + STYLE + ").set_height(${size})"),
    dict(id="polygon", name="Regular Polygon", category="Shapes", enter="ShowCreation",
         params=[integer("n", "Sides", 6, 3, 24), num("size", "Size", 2.0, 0.1, 8, 0.1), *shape_style(PURPLE, PURPLE, 0.3)],
         code="return RegularPolygon(${n}, " + STYLE + ").set_height(${size})"),
    dict(id="star", name="Star", category="Shapes", enter="DrawBorderThenFill",
         params=[integer("points", "Points", 5, 3, 16), num("outer", "Outer radius", 1.2, 0.1, 6, 0.05),
                 num("inner_ratio", "Inner ratio", 0.45, 0.1, 0.95, 0.05), *shape_style(GOLD, GOLD, 0.8)],
         code="""n = ${points}
angles = [PI / 2 + i * PI / n for i in range(2 * n)]
radii = [${outer} if i % 2 == 0 else ${outer} * ${inner_ratio} for i in range(2 * n)]
verts = [r * np.array([np.cos(a), np.sin(a), 0]) for r, a in zip(radii, angles)]
return Polygon(*verts, """ + STYLE + ")"),
    dict(id="ellipse", name="Ellipse", category="Shapes", enter="ShowCreation",
         params=[num("width", "Width", 3.0, 0.1, 14, 0.1), num("height", "Height", 1.6, 0.1, 8, 0.1), *shape_style(MAROON, MAROON, 0.3)],
         code="return Ellipse(width=${width}, height=${height}, " + STYLE + ")"),
    dict(id="annulus", name="Annulus", category="Shapes", enter="GrowFromCenter",
         params=[num("inner", "Inner radius", 0.6, 0.05, 6, 0.05), num("outer", "Outer radius", 1.2, 0.1, 8, 0.05),
                 color("fill", "Color", BLUE), num("fill_opacity", "Opacity", 0.8, 0, 1, 0.05)],
         code="return Annulus(inner_radius=${inner}, outer_radius=${outer}, fill_color=${fill}, fill_opacity=${fill_opacity}, stroke_width=0)"),
    dict(id="sector", name="Pie Sector", category="Shapes", enter="GrowFromCenter",
         params=[num("radius", "Radius", 1.5, 0.1, 6, 0.05), num("angle", "Angle (deg)", 120, 1, 360, 1),
                 color("fill", "Color", YELLOW), num("fill_opacity", "Opacity", 0.8, 0, 1, 0.05)],
         code="return Sector(radius=${radius}, angle=${angle} * DEG, fill_color=${fill}, fill_opacity=${fill_opacity}, stroke_width=0)"),
    dict(id="dot", name="Dot", category="Shapes", enter="GrowFromCenter",
         params=[num("radius", "Radius", 0.16, 0.01, 2, 0.01), color("fill", "Color", WHITE)],
         code="return Dot(radius=${radius}, fill_color=${fill})"),
    dict(id="arc", name="Arc", category="Shapes", enter="ShowCreation",
         params=[num("radius", "Radius", 1.5, 0.1, 6, 0.05), num("angle", "Angle (deg)", 270, 1, 360, 1),
                 color("stroke", "Stroke", RED), num("stroke_width", "Stroke width", 6, 0, 20, 0.5)],
         code="return Arc(radius=${radius}, angle=${angle} * DEG, stroke_color=${stroke}, stroke_width=${stroke_width})"),

    # ------------------------------------------------------------------ Lines & arrows
    dict(id="line", name="Line", category="Lines & Arrows", enter="ShowCreation",
         params=[num("length", "Length", 4.0, 0.1, 14, 0.1), color("stroke", "Color", WHITE), num("stroke_width", "Stroke width", 4, 0, 20, 0.5)],
         code="return Line(LEFT * ${length} / 2, RIGHT * ${length} / 2, stroke_color=${stroke}, stroke_width=${stroke_width})"),
    dict(id="dashed_line", name="Dashed Line", category="Lines & Arrows", enter="ShowCreation",
         params=[num("length", "Length", 4.0, 0.1, 14, 0.1), color("stroke", "Color", GREY), num("dash", "Dash length", 0.15, 0.02, 1, 0.01)],
         code="return DashedLine(LEFT * ${length} / 2, RIGHT * ${length} / 2, dash_length=${dash}, stroke_color=${stroke})"),
    dict(id="arrow", name="Arrow", category="Lines & Arrows", enter="GrowFromLeft",
         params=[num("length", "Length", 3.0, 0.2, 14, 0.1), color("fill", "Color", YELLOW), num("thickness", "Thickness", 3.0, 0.5, 12, 0.5)],
         code="return Arrow(LEFT * ${length} / 2, RIGHT * ${length} / 2, buff=0, thickness=${thickness}, fill_color=${fill})"),
    dict(id="vector", name="Vector", category="Lines & Arrows", enter="GrowFromLeft",
         params=[num("dx", "Δx", 2.0, -8, 8, 0.1), num("dy", "Δy", 1.0, -8, 8, 0.1), color("fill", "Color", GREEN)],
         code="return Vector([${dx}, ${dy}, 0], fill_color=${fill})"),
    dict(id="curved_arrow", name="Curved Arrow", category="Lines & Arrows", enter="ShowCreation",
         params=[num("length", "Width", 3.0, 0.2, 14, 0.1), num("angle", "Bend (deg)", 90, -180, 180, 5), color("stroke", "Color", TEAL)],
         code="return CurvedArrow(LEFT * ${length} / 2, RIGHT * ${length} / 2, angle=${angle} * DEG, stroke_color=${stroke}, fill_color=${stroke})"),
    dict(id="brace", name="Brace + Label", category="Lines & Arrows", enter="GrowFromCenter",
         params=[num("width", "Width", 4.0, 0.2, 14, 0.1), latex("label", "Label (LaTeX)", r"x"), color("stroke", "Color", WHITE)],
         code="""brace = Brace(Line(LEFT * ${width} / 2, RIGHT * ${width} / 2), DOWN).set_color(${stroke})
label = brace.get_tex(${label}).set_color(${stroke})
return VGroup(brace, label)"""),

    # ------------------------------------------------------------------ Text & math
    dict(id="text", name="Text", category="Text & Math", enter="Write",
         params=[text("text", "Text", "Hello, Manim!"), num("font_size", "Font size", 48, 6, 200, 1),
                 select("font", "Font", "Helvetica Neue", FONTS), color("fill", "Color", WHITE),
                 select("weight", "Weight", "NORMAL", ["NORMAL", "BOLD"]), boolean("italic", "Italic", False)],
         code='return Text(${text}, font=${font}, font_size=${font_size}, weight=${weight}, slant=ITALIC if ${italic} else NORMAL, fill_color=${fill})'),
    dict(id="title", name="Title", category="Text & Math", enter="FadeInUp",
         params=[text("text", "Text", "Chapter 1"), num("font_size", "Font size", 72, 6, 200, 1),
                 select("font", "Font", "Avenir Next", FONTS), color("fill", "Color", WHITE),
                 boolean("underline", "Underline", True), color("accent", "Underline color", BLUE)],
         code="""title = Text(${text}, font=${font}, font_size=${font_size}, weight=BOLD, fill_color=${fill})
if ${underline}:
    line = Line(LEFT, RIGHT, stroke_color=${accent}, stroke_width=4).set_width(title.get_width() * 1.1)
    line.next_to(title, DOWN, buff=0.2)
    return VGroup(title, line)
return title"""),
    dict(id="paragraph", name="Paragraph", category="Text & Math", enter="FadeIn",
         params=[text("text", "Text", "Multiple lines of text\nare supported too.", multiline=True),
                 num("font_size", "Font size", 36, 6, 200, 1), select("font", "Font", "Helvetica Neue", FONTS),
                 color("fill", "Color", WHITE), select("alignment", "Alignment", "LEFT", ["LEFT", "CENTER", "RIGHT"])],
         code="return Text(${text}, font=${font}, font_size=${font_size}, fill_color=${fill}, alignment=${alignment})"),
    dict(id="tex", name="Equation", category="Text & Math", enter="Write",
         params=[latex("tex", "LaTeX", r"e^{i\pi} + 1 = 0"), num("font_size", "Font size", 72, 6, 200, 1), color("fill", "Color", WHITE)],
         code="return Tex(${tex}, font_size=${font_size}, fill_color=${fill})"),
    dict(id="tex_formula", name="Quadratic Formula", category="Text & Math", enter="Write",
         params=[latex("tex", "LaTeX", r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"), num("font_size", "Font size", 60, 6, 200, 1), color("fill", "Color", WHITE)],
         code="return Tex(${tex}, font_size=${font_size}, fill_color=${fill})"),
    dict(id="tex_colored", name="Colored Equation", category="Text & Math", enter="Write",
         params=[latex("tex", "LaTeX", r"E = m c^2"), num("font_size", "Font size", 80, 6, 200, 1),
                 text("part", "Highlight part", "c^2"), color("highlight", "Highlight color", YELLOW), color("fill", "Color", WHITE)],
         code="""eq = Tex(${tex}, font_size=${font_size}, fill_color=${fill})
if ${part}:
    eq.set_color_by_tex(${part}, ${highlight})
return eq"""),
    dict(id="textex", name="LaTeX Text", category="Text & Math", enter="Write",
         params=[latex("tex", "LaTeX text", r"The area is $\pi r^2$"), num("font_size", "Font size", 48, 6, 200, 1), color("fill", "Color", WHITE)],
         code="return TexText(${tex}, font_size=${font_size}, fill_color=${fill})"),
    dict(id="bullets", name="Bullet List", category="Text & Math", enter="Typewriter",
         params=[text("items", "Items (one per line)", "First idea\nSecond idea\nThird idea", multiline=True),
                 num("font_size", "Font size", 40, 6, 120, 1), select("font", "Font", "Helvetica Neue", FONTS), color("fill", "Color", WHITE), color("bullet", "Bullet color", BLUE)],
         code="""rows = VGroup()
for line in ${items}.split("\\n"):
    if not line.strip():
        continue
    dot = Dot(radius=0.07, fill_color=${bullet})
    label = Text(line.strip(), font=${font}, font_size=${font_size}, fill_color=${fill})
    rows.add(VGroup(dot, label).arrange(RIGHT, buff=0.25))
rows.arrange(DOWN, aligned_edge=LEFT, buff=0.35)
return rows"""),
    dict(id="counter", name="Counter", category="Text & Math", enter="FadeIn", dynamic=True,
         params=[num("start", "From", 0, None, None, 1), num("end", "To", 100, None, None, 1),
                 integer("decimals", "Decimals", 0, 0, 6), num("font_size", "Font size", 96, 6, 300, 1), color("fill", "Color", WHITE),
                 select("rate", "Easing", "smooth", ["smooth", "linear", "rush_into", "rush_from"])],
         code="""# t = seconds since the clip started, a = progress through the clip (0 → 1)
value = ${start} + (${end} - ${start}) * RATES[${rate}](a)
return DecimalNumber(value, num_decimal_places=${decimals}, font_size=${font_size}, fill_color=${fill})"""),
    dict(id="matrix", name="Matrix", category="Text & Math", enter="FadeIn",
         params=[text("rows", "Rows (; separated)", "1, 2; 3, 4"), color("fill", "Color", WHITE), color("bracket", "Bracket color", BLUE)],
         code="""data = [[cell.strip() for cell in row.split(",")] for row in ${rows}.split(";")]
m = Matrix(data)
m.get_brackets().set_color(${bracket})
m.get_entries().set_color(${fill})
return m"""),
    dict(id="code", name="Code Block", category="Text & Math", enter="FadeIn",
         params=[text("code", "Code", "def square(x):\n    return x * x", multiline=True), select("language", "Language", "python", ["python", "javascript", "c", "cpp", "rust", "go", "java"]),
                 num("font_size", "Font size", 28, 6, 80, 1), boolean("background", "Background", True)],
         code="""code = Code(${code}, language=${language}, font="Menlo", font_size=${font_size})
if ${background}:
    bg = SurroundingRectangle(code, buff=0.3, fill_color="#272822", fill_opacity=1, stroke_color=GREY_D, stroke_width=1)
    return VGroup(bg, code)
return code"""),

    # ------------------------------------------------------------------ Graphs
    dict(id="axes_graph", name="Function Plot", category="Graphs", enter="ShowCreation",
         params=[expr("f", "f(x) =", "np.sin(x)", "Python expression in x (numpy as np)"),
                 num("xmin", "x min", -6.0, None, None, 0.5), num("xmax", "x max", 6.0, None, None, 0.5),
                 num("ymin", "y min", -2.0, None, None, 0.5), num("ymax", "y max", 2.0, None, None, 0.5),
                 num("width", "Width", 10.0, 1, 14, 0.5), num("height", "Height", 4.0, 1, 8, 0.5),
                 color("curve", "Curve color", BLUE), boolean("labels", "Axis numbers", True)],
         code="""axes = Axes(x_range=(${xmin}, ${xmax}, 1), y_range=(${ymin}, ${ymax}, 1), width=${width}, height=${height})
if ${labels}:
    axes.add_coordinate_labels(font_size=18)
graph = axes.get_graph(lambda x: ${f}, color=${curve})
return VGroup(axes, graph)"""),
    dict(id="graph_only", name="Curve", category="Graphs", enter="ShowCreation",
         params=[expr("f", "f(x) =", "0.5 * x**2 - 1", "Python expression in x"), num("xmin", "x min", -3.0, None, None, 0.5),
                 num("xmax", "x max", 3.0, None, None, 0.5), color("stroke", "Color", YELLOW), num("stroke_width", "Stroke width", 5, 0.5, 20, 0.5)],
         code="return FunctionGraph(lambda x: ${f}, x_range=(${xmin}, ${xmax}, 0.05), stroke_color=${stroke}, stroke_width=${stroke_width})"),
    dict(id="wave", name="Moving Wave", category="Graphs", enter="ShowCreation", dynamic=True,
         params=[num("amplitude", "Amplitude", 1.0, 0, 4, 0.1), num("frequency", "Frequency", 1.0, 0.1, 8, 0.1),
                 num("speed", "Speed", 2.0, -10, 10, 0.1), num("width", "Width", 10.0, 1, 14, 0.5), color("stroke", "Color", TEAL)],
         code="""# t = seconds since the clip started
return FunctionGraph(
    lambda x: ${amplitude} * np.sin(${frequency} * x - ${speed} * t),
    x_range=(-${width} / 2, ${width} / 2, 0.05), stroke_color=${stroke}, stroke_width=5,
)"""),
    dict(id="parametric", name="Parametric Curve", category="Graphs", enter="ShowCreation",
         params=[expr("fx", "x(s) =", "2 * np.sin(3 * s)"), expr("fy", "y(s) =", "2 * np.sin(2 * s)"),
                 num("smax", "s max", 6.2832, 0.1, 50, 0.1), color("stroke", "Color", PURPLE), num("stroke_width", "Stroke width", 5, 0.5, 20, 0.5)],
         code="return ParametricCurve(lambda s: np.array([${fx}, ${fy}, 0]), t_range=(0, ${smax}, 0.01), color=${stroke}, stroke_width=${stroke_width})"),
    dict(id="number_plane", name="Number Plane", category="Graphs", enter="ShowCreation",
         params=[num("width", "Width", 14.2, 1, 30, 0.2), num("height", "Height", 8, 1, 20, 0.2), color("line", "Line color", BLUE),
                 num("opacity", "Line opacity", 0.6, 0, 1, 0.05)],
         code="""plane = NumberPlane(x_range=(-${width} / 2, ${width} / 2, 1), y_range=(-${height} / 2, ${height} / 2, 1),
                    background_line_style=dict(stroke_color=${line}, stroke_width=2, stroke_opacity=${opacity}))
return plane"""),
    dict(id="number_line", name="Number Line", category="Graphs", enter="ShowCreation",
         params=[num("xmin", "Min", -5, None, None, 1), num("xmax", "Max", 5, None, None, 1), num("width", "Width", 10, 1, 14, 0.5),
                 boolean("numbers", "Show numbers", True), color("stroke", "Color", WHITE)],
         code="""line = NumberLine(x_range=(${xmin}, ${xmax}, 1), width=${width}, color=${stroke})
if ${numbers}:
    line.add_numbers(font_size=24)
return line"""),
    dict(id="bar_chart", name="Bar Chart", category="Graphs", enter="GrowFromBottom",
         params=[text("values", "Values (comma separated)", "3, 5, 2, 7, 4"), num("max", "Max value", 8, 1, 1000, 1),
                 num("width", "Width", 8, 1, 14, 0.5), num("height", "Height", 4, 1, 8, 0.5), color("c1", "Color A", BLUE), color("c2", "Color B", GREEN)],
         code="""values = [float(v) for v in ${values}.split(",") if v.strip()]
chart = BarChart(values, max_value=${max}, width=${width}, height=${height}, bar_colors=[${c1}, ${c2}])
return chart"""),
    dict(id="vector_field", name="Vector Field", category="Graphs", enter="FadeIn",
         params=[expr("fx", "Fx(x, y) =", "-y"), expr("fy", "Fy(x, y) =", "x"), num("width", "Width", 12, 2, 16, 0.5), num("height", "Height", 7, 2, 9, 0.5)],
         code="""def field(points):
    x, y = points[:, 0], points[:, 1]
    return np.stack([${fx} + 0 * x, ${fy} + 0 * y, 0 * x], axis=1)
plane = NumberPlane(x_range=(-${width} / 2, ${width} / 2), y_range=(-${height} / 2, ${height} / 2))
return VectorField(field, plane, density=1.5)"""),

    # ------------------------------------------------------------------ 3D
    dict(id="axes3d", name="3D Axes", category="3D", enter="ShowCreation", view=(-30, 70),
         params=[num("xr", "x extent (±)", 5, 0.5, 20, 0.5), num("yr", "y extent (±)", 4, 0.5, 20, 0.5), num("zr", "z extent (±)", 3, 0.5, 20, 0.5),
                 boolean("labels", "Axis labels", True), color("stroke", "Color", "#BBBBBB")],
         code="""axes = ThreeDAxes(x_range=(-${xr}, ${xr}, 1), y_range=(-${yr}, ${yr}, 1), z_range=(-${zr}, ${zr}, 1))
axes.set_color(${stroke})
if ${labels}:
    axes.add_axis_labels(font_size=30)
axes.apply_depth_test()
return keep_origin(axes, axes.get_origin())"""),
    dict(id="surface_plot", name="Surface Plot", category="3D", enter="ShowCreation", view=(-30, 70),
         params=[expr("f", "z = f(x, y) =", "np.sin(x) * np.cos(y)", "Python expression in x and y (numpy as np)"),
                 num("r", "x / y extent (±)", 3.0, 0.5, 12, 0.5), num("zmin", "z min", -2.0, None, None, 0.5), num("zmax", "z max", 2.0, None, None, 0.5),
                 color("fill", "Surface color", BLUE), num("opacity", "Opacity", 0.85, 0, 1, 0.05),
                 boolean("mesh", "Mesh lines", True), boolean("axes", "Axes", True)],
         code="""axes = ThreeDAxes(x_range=(-${r}, ${r}, 1), y_range=(-${r}, ${r}, 1), z_range=(${zmin}, ${zmax}, 1))
surface = axes.get_graph(lambda x, y: ${f}, color=${fill}, opacity=${opacity})
group = Group(surface)
if ${mesh}:
    group.add(SurfaceMesh(surface, resolution=(17, 17), stroke_color=WHITE, stroke_width=1).set_stroke(opacity=0.35))
if ${axes}:
    axes.apply_depth_test()
    group.add(axes)
return keep_origin(group, axes.get_origin())"""),
    dict(id="param_surface", name="Parametric Surface", category="3D", enter="ShowCreation", view=(-30, 70),
         params=[expr("fx", "x(u, v) =", "(2 + 0.7 * np.cos(v)) * np.cos(u)"), expr("fy", "y(u, v) =", "(2 + 0.7 * np.cos(v)) * np.sin(u)"),
                 expr("fz", "z(u, v) =", "0.7 * np.sin(v) + 0.25 * np.sin(3 * u)"),
                 num("umax", "u max", 6.2832, 0.1, 50, 0.1), num("vmax", "v max", 6.2832, 0.1, 50, 0.1),
                 color("fill", "Color", PURPLE), num("opacity", "Opacity", 1.0, 0, 1, 0.05)],
         code="""return ParametricSurface(
    lambda u, v: np.array([${fx}, ${fy}, ${fz}]),
    u_range=(0, ${umax}), v_range=(0, ${vmax}), resolution=(81, 41), color=${fill}, opacity=${opacity},
)"""),
    dict(id="sphere", name="Sphere", category="3D", enter="FadeIn", view=(-30, 70),
         params=[num("radius", "Radius", 1.5, 0.05, 8, 0.05), color("fill", "Color", BLUE), num("opacity", "Opacity", 1.0, 0, 1, 0.05),
                 boolean("mesh", "Mesh lines", False)],
         code="""sphere = Sphere(radius=${radius}, color=${fill}, opacity=${opacity})
if ${mesh}:
    return Group(sphere, SurfaceMesh(sphere, stroke_color=WHITE, stroke_width=1).set_stroke(opacity=0.4))
return sphere"""),
    dict(id="cube", name="Cube", category="3D", enter="FadeIn", view=(-30, 70),
         params=[num("side", "Side length", 2.0, 0.05, 10, 0.05), color("fill", "Color", RED), num("opacity", "Opacity", 1.0, 0, 1, 0.05)],
         code="return Cube(side_length=${side}, color=${fill}, opacity=${opacity})"),
    dict(id="box3d", name="Box", category="3D", enter="FadeIn", view=(-30, 70),
         params=[num("width", "Width (x)", 3.0, 0.05, 14, 0.05), num("depth", "Depth (y)", 2.0, 0.05, 14, 0.05), num("height", "Height (z)", 1.0, 0.05, 14, 0.05),
                 color("fill", "Color", GOLD), num("opacity", "Opacity", 1.0, 0, 1, 0.05)],
         code="return Prism(width=${width}, height=${depth}, depth=${height}, color=${fill}, opacity=${opacity})"),
    dict(id="cylinder", name="Cylinder", category="3D", enter="FadeIn", view=(-30, 70),
         params=[num("radius", "Radius", 1.0, 0.05, 8, 0.05), num("height", "Height", 2.5, 0.05, 14, 0.05), color("fill", "Color", TEAL), num("opacity", "Opacity", 1.0, 0, 1, 0.05)],
         code="return Cylinder(radius=${radius}, height=${height}, color=${fill}, opacity=${opacity})"),
    dict(id="cone", name="Cone", category="3D", enter="FadeIn", view=(-30, 70),
         params=[num("radius", "Base radius", 1.2, 0.05, 8, 0.05), num("height", "Height", 2.5, 0.05, 14, 0.05), color("fill", "Color", GREEN), num("opacity", "Opacity", 1.0, 0, 1, 0.05)],
         code="return Cone(radius=${radius}, height=${height}, color=${fill}, opacity=${opacity})"),
    dict(id="torus", name="Torus", category="3D", enter="FadeIn", view=(-30, 70),
         params=[num("r1", "Major radius", 2.0, 0.1, 8, 0.05), num("r2", "Tube radius", 0.6, 0.02, 4, 0.02), color("fill", "Color", MAROON), num("opacity", "Opacity", 1.0, 0, 1, 0.05)],
         code="return Torus(r1=${r1}, r2=${r2}, color=${fill}, opacity=${opacity})"),
    dict(id="dodecahedron", name="Dodecahedron", category="3D", enter="FadeIn", view=(-30, 70),
         params=[num("size", "Size", 2.5, 0.1, 10, 0.1), color("fill", "Color", TEAL), color("stroke", "Edges", WHITE)],
         code="return Dodecahedron(fill_color=${fill}, stroke_color=${stroke}, stroke_width=2).set_height(${size})"),
    dict(id="curve3d", name="3D Curve", category="3D", enter="ShowCreation", view=(-30, 70),
         params=[expr("fx", "x(s) =", "1.5 * np.cos(s)"), expr("fy", "y(s) =", "1.5 * np.sin(s)"), expr("fz", "z(s) =", "0.15 * s - 1.4"),
                 num("smax", "s max", 18.85, 0.1, 100, 0.1), color("stroke", "Color", YELLOW), num("stroke_width", "Stroke width", 4, 0.5, 20, 0.5)],
         code="""curve = ParametricCurve(lambda s: np.array([${fx}, ${fy}, ${fz}]), t_range=(0, ${smax}, 0.02), color=${stroke}, stroke_width=${stroke_width})
curve.apply_depth_test()
return curve"""),
    dict(id="vector3d", name="3D Vector", category="3D", enter="GrowFromCenter", view=(-30, 70),
         params=[num("vx", "x", 2.0, None, None, 0.1), num("vy", "y", 1.0, None, None, 0.1), num("vz", "z", 1.5, None, None, 0.1),
                 color("fill", "Color", YELLOW), num("width", "Thickness", 0.04, 0.005, 0.5, 0.005)],
         code="""v = np.array([${vx}, ${vy}, ${vz}], dtype=float)
length = max(np.linalg.norm(v), 1e-6)
tip_len = min(0.35, 0.4 * length)
# built along +z, then turned towards v
shaft = Line3D(ORIGIN, (length - tip_len) * OUT, width=${width}, color=${fill})
tip = Cone(radius=max(2.5 * ${width}, 0.07), height=tip_len, color=${fill})
tip.shift((length - tip_len) * OUT - tip.get_edge_center(IN))
arrow = Group(shaft, tip)
arrow.apply_matrix(rotation_between_vectors(OUT, v / length), about_point=ORIGIN)
# the vector starts at the clip's position
return keep_origin(arrow)"""),

    # ------------------------------------------------------------------ Drawings
    dict(id="clock", name="Clock", category="Drawings", enter="ShowCreation",
         params=[num("size", "Size", 3, 0.5, 8, 0.1), color("stroke", "Color", WHITE)],
         code="return Clock().set_height(${size}).set_stroke(${stroke})"),
    dict(id="checkmark", name="Checkmark", category="Drawings", enter="GrowFromCenter",
         params=[num("size", "Size", 1.5, 0.2, 6, 0.1), color("fill", "Color", GREEN)],
         code="return Checkmark().set_height(${size}).set_color(${fill})"),
    dict(id="exmark", name="Cross mark", category="Drawings", enter="GrowFromCenter",
         params=[num("size", "Size", 1.5, 0.2, 6, 0.1), color("fill", "Color", RED)],
         code="return Exmark().set_height(${size}).set_color(${fill})"),
    dict(id="die", name="Die Face", category="Drawings", enter="FadeIn",
         params=[integer("value", "Value", 5, 1, 6), num("size", "Size", 1.6, 0.3, 6, 0.1), color("fill", "Face", WHITE), color("dot", "Dots", "#222222")],
         code="return DieFace(${value}, fill_color=${fill}, dot_color=${dot}).set_height(${size})"),
    dict(id="piano", name="Piano", category="Drawings", enter="FadeIn",
         params=[num("width", "Width", 8, 1, 14, 0.5)],
         code="return Piano().set_width(${width})"),
    dict(id="glow_dot", name="Glow Dot", category="Drawings", enter="FadeIn",
         params=[num("radius", "Glow radius", 0.6, 0.05, 4, 0.05), color("fill", "Color", YELLOW)],
         code="return GlowDot(ORIGIN, radius=${radius}, color=${fill})"),

    # ------------------------------------------------------------------ AI & ML
    *ML_ITEMS,

    # ------------------------------------------------------------------ Media
    dict(id="image", name="Image", category="Media", enter="FadeIn", hidden=True,
         params=[asset_param("path", "Image file", "image"), num("height", "Height", 4.0, 0.1, 8, 0.1)],
         code="return ImageMobject(asset(${path}), height=${height})"),
    dict(id="svg", name="SVG", category="Media", enter="DrawBorderThenFill", hidden=True,
         params=[asset_param("path", "SVG file", "svg"), num("height", "Height", 3.0, 0.1, 8, 0.1),
                 boolean("recolor", "Recolor", False), color("fill", "Color", WHITE)],
         code="""svg = SVGMobject(asset(${path}), height=${height})
if ${recolor}:
    svg.set_fill(${fill}).set_stroke(${fill})
return svg"""),

    # ------------------------------------------------------------------ Custom
    dict(id="custom", name="Custom Code", category="Custom", enter="FadeIn",
         params=[],
         code="""# Any ManimGL code. Return the mobject to place on the timeline.
group = VGroup(*[
    Square(side_length=0.6, fill_color=interpolate_color(BLUE, RED, i / 7), fill_opacity=1, stroke_width=0)
    for i in range(8)
]).arrange(RIGHT, buff=0.15)
return group"""),
    dict(id="custom_dynamic", name="Custom Animated", category="Custom", enter="FadeIn", dynamic=True,
         params=[],
         code="""# Rebuilt every frame.  t = seconds since clip start, a = 0 → 1 over the clip
dots = VGroup(*[
    Dot(radius=0.12, fill_color=interpolate_color(TEAL, YELLOW, i / 11)).move_to(
        1.8 * np.array([np.cos(i * TAU / 12 + t), np.sin(i * TAU / 12 + t), 0])
    )
    for i in range(12)
])
return VGroup(Circle(radius=1.8, stroke_color=GREY_C, stroke_width=2), dots)"""),
]

BY_ID = {it["id"]: it for it in ITEMS}

# The second library (mathstudio library): every converted file is a library item too, so a
# clip can use it by id. They are kept out of ITEMS (the built-in list and built-in search).
import library_imported as _imported  # noqa: E402

IMPORTED = _imported.library_items()
for _it in IMPORTED:
    BY_ID[_it["id"]] = _it
# gallery pictures were items before their classes replaced them: old project clips still resolve
for _old, _it in _imported.aliases().items():
    BY_ID.setdefault(_old, _it)

# Mobjects made from projects ("My mobjects", library_user.py): registered by the server once it
# knows its data directory (load_user), and again whenever one is made, changed or deleted.
import library_user as user  # noqa: E402

_user_ids: set = set()


def load_user(data_dir: str):
    user.load(data_dir)
    sync_user()


def sync_user():
    for i in _user_ids:
        BY_ID.pop(i, None)
    _user_ids.clear()
    for it in user.ITEMS:
        BY_ID[it["id"]] = it
        _user_ids.add(it["id"])


CATEGORY_ORDER = ["Shapes", "Lines & Arrows", "Text & Math", "Graphs", "3D", "AI & ML", "Drawings", "Media", "Custom"]


def default_params(item_id: str) -> dict:
    it = BY_ID[item_id]
    return {p["id"]: p["default"] for p in it["params"]}


def public_items():
    from library_meta import META
    out = []
    for it in ITEMS:
        d = dict(it)
        desc, tags = META.get(it["id"], ("", []))
        d["desc"], d["tags"] = desc, list(tags)
        out.append(d)
    # imported items go to the client as well, under category "Imported" (not in the built-in groups)
    for it in IMPORTED:
        out.append(dict(it))
    for it in user.ITEMS:
        out.append(user.public_item(it))
    return out
