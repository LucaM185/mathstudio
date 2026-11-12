"""
Semantic library search tests.   Run:   engine/.venv/bin/python engine/tests/test_search.py
"""
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import library  # noqa: E402
import search  # noqa: E402

FAILS = []


def check(cond, msg):
    if not cond:
        FAILS.append(msg)
        print("  FAIL:", msg)


ML = {it["id"] for it in library.ITEMS if it["category"] == "AI & ML"}


def ids(r, tier=None):
    return [h["id"] for h in r["results"] if tier is None or h["tier"] == tier]


print("1. keyword search (no model)")
kw = search.Searcher()
kw.status = "unavailable"
for q, want in [("circle", "circle"), ("cir", "circle"), ("arow", "arrow"), ("trnsformer", "transformer_block"),
                ("neural", "neural_network"), ("hexagon", "polygon"), ("Quadratic", "tex_formula"), ("relu", "activation_fn")]:
    r = kw.search(q)
    check(r["results"] and r["results"][0]["id"] == want, f"keyword {q!r}: expected {want} first, got {ids(r)[:5]}")
check(kw.search("")["results"] == [], "empty query returns nothing")
check(kw.search("zzqqxx")["results"] == [], "nonsense query returns nothing")
check(kw.search("x" * 5000)["results"] == [], "huge query handled")

print("2. semantic search")
t0 = time.time()
s = search.Searcher(tempfile.mkdtemp())
s.start(wait=True)
print(f"   model {s.status} in {time.time() - t0:.1f}s {s.error}")
check(s.status == "ready", f"semantic model failed to load: {s.error}")
if s.status == "ready":
    r = s.search("transformer architecture")
    got = set(ids(r))
    check(ids(r)[0] == "transformer_block", f"transformer architecture → {ids(r)[:3]}")
    check(ML <= got, f"transformer architecture should surface all ML items, missing {ML - got}")
    check(not (got - ML), f"transformer architecture leaked non-ML items: {got - ML}")
    check(r["related"] == "AI & ML", f"related category {r['related']}")
    for q, must in [
        ("machine learning", {"neural_network", "gradient_descent"}),
        ("deep learning", {"neural_network", "activation_fn"}),
        ("chatgpt", {"transformer_block"}),
        ("how do LLMs pick the next word", {"softmax_probs"}),
        ("image recognition", {"convolution"}),
        ("overfitting", {"loss_curve"}),
        ("probability", {"die", "softmax_probs"}),
        ("linear algebra", {"matrix", "vector", "number_plane"}),
        ("music", {"piano"}),
        ("wrong answer", {"exmark"}),
        ("pie chart", {"sector"}),
        ("chapter heading", {"title"}),
        ("programming", {"code"}),
        ("geometry", {"triangle", "circle", "polygon"}),
    ]:
        r = s.search(q)
        top = set(ids(r, "match")[:6])
        check(must <= top, f"{q!r}: expected {must} in top matches, got {ids(r)[:8]}")
    for q, bad in [("music", ML), ("circle", ML), ("linear algebra", {"piano", "clock"}), ("probability", {"title", "piano"})]:
        r = s.search(q)
        check(not (set(ids(r)) & bad), f"{q!r}: unrelated results {set(ids(r)) & bad}")
    t0 = time.perf_counter()
    for i in range(30):
        s.search(f"neural network {i}")
    dt = (time.perf_counter() - t0) / 30 * 1000
    print(f"   {dt:.1f} ms / query")
    check(dt < 60, f"search too slow: {dt:.1f} ms")
    # cached index: second searcher should start much faster
    t0 = time.time()
    s2 = search.Searcher(s.cache_dir)
    s2.start(wait=True)
    check(s2.status == "ready" and s2.search("attention")["results"][0]["id"] in ML, "cached index works")
    print(f"   warm start {time.time() - t0:.2f}s")

print("\n" + ("ALL SEARCH TESTS PASSED" if not FAILS else f"{len(FAILS)} FAILURES"))
sys.exit(1 if FAILS else 0)
