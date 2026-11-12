"""
Hybrid semantic search over the mobject library.

  score = semantic (sentence embeddings, BAAI/bge-small-en-v1.5 via onnxruntime)
        + lexical  (name / tag / description words, prefixes, typo-tolerant)

The embedding model (~130 MB) is fetched from the Hugging Face hub on first use and cached
in ~/.cache/huggingface.  Until it is ready — or if it can't be loaded at all — search
transparently falls back to lexical matching, so the library is always searchable.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
import time

import numpy as np

import library
from library_meta import CATEGORY_DESC, META

MODEL_REPO = os.environ.get("MATHSTUDIO_EMBED_MODEL", "BAAI/bge-small-en-v1.5")
SEM_FLOOR = 0.60
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "
_WORD = re.compile(r"[a-z0-9]+")
STOP = {"a", "an", "the", "of", "and", "or", "for", "to", "in", "on", "with", "something", "stuff", "thing", "things",
        "some", "show", "me", "i", "want", "like", "about", "that", "this", "is", "are", "my", "how", "what"}


def words(s: str) -> list[str]:
    return _WORD.findall(s.lower())


def stem(w: str) -> str:
    for suf in ("ations", "ation", "ings", "ing", "ers", "er", "es", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def edit_distance(a: str, b: str, cap: int = 3) -> int:
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    """Optimal-string-alignment distance (insert / delete / substitute / swap), early exit above cap."""
    pp: list[int] = []
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
            if i > 1 and j > 1 and ca == b[j - 2] and a[i - 2] == cb:
                cur[j] = min(cur[j], pp[j - 2] + 1)
        if min(cur) > cap:
            return cap + 1
        pp, prev = prev, cur
    return prev[-1]


class Doc:
    def __init__(self, item: dict):
        self.id = item["id"]
        self.name = item["name"]
        self.category = item["category"]
        desc, tags = META.get(self.id, ("", []))
        self.desc, self.tags = desc, list(tags)
        self.name_list = words(self.name)
        self.name_words = set(self.name_list) | {stem(w) for w in self.name_list} | set(words(self.id.replace("_", " ")))
        self.tag_words = {w for t in self.tags for w in words(t)} | set(words(self.category))
        self.tag_words |= {stem(w) for w in self.tag_words}
        self.desc_words = set(words(self.desc)) | {stem(w) for w in words(self.desc)}
        self.phrases = [self.name.lower()] + [t.lower() for t in self.tags]
        # what the embedding model sees
        self.passage = f"{self.name}. {self.desc} Related: {', '.join(self.tags)}. Category: {self.category}."
        self.facets = [self.name] + self.tags


class Embedder:
    """Tiny ONNX sentence-embedding wrapper (CLS pooling, L2-normalised)."""

    def __init__(self, model_dir: str):
        import onnxruntime as ort
        from tokenizers import Tokenizer

        self.tok = Tokenizer.from_file(os.path.join(model_dir, "tokenizer.json"))
        self.tok.enable_truncation(max_length=128)
        self.tok.enable_padding(pad_id=0, pad_token="[PAD]")
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2
        opts.log_severity_level = 3
        self.sess = ort.InferenceSession(os.path.join(model_dir, "onnx", "model.onnx"), opts,
                                         providers=["CPUExecutionProvider"])
        self.inputs = {i.name for i in self.sess.get_inputs()}
        self.lock = threading.Lock()

    def encode(self, texts: list[str], batch: int = 32) -> np.ndarray:
        out = []
        for i in range(0, len(texts), batch):
            enc = self.tok.encode_batch(texts[i:i + batch])
            ids = np.array([e.ids for e in enc], dtype=np.int64)
            mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
            feed = {"input_ids": ids, "attention_mask": mask}
            if "token_type_ids" in self.inputs:
                feed["token_type_ids"] = np.zeros_like(ids)
            with self.lock:
                hidden = self.sess.run(None, feed)[0]
            v = hidden[:, 0]
            out.append(v / np.linalg.norm(v, axis=1, keepdims=True).clip(1e-9))
        return np.concatenate(out) if out else np.zeros((0, 384), np.float32)


class Searcher:
    def __init__(self, cache_dir: str | None = None):
        self.cache_dir = cache_dir
        self.docs = [Doc(it) for it in library.ITEMS if not it.get("hidden")]
        self.status = "idle"          # idle | loading | downloading | ready | unavailable
        self.error = ""
        self.emb: Embedder | None = None
        self._ready = threading.Event()
        self._wanted = threading.Event()
        self._started = False
        self._qcache: dict[str, tuple[np.ndarray, np.ndarray]] = {}
        self.vocab = set().union(*(d.name_words | d.tag_words | d.desc_words for d in self.docs))

    # ------------------------------------------------------------------ model
    def start(self, wait: bool = False, delay: float = 0.0):
        if not self._started:
            self._started = True

            def run():
                if delay and not self._wanted.wait(delay):   # first search cancels the delay
                    pass
                self._load()
            threading.Thread(target=run, daemon=True, name="semantic-search").start()
        if wait:
            self._ready.wait(timeout=600)

    def _model_dir(self) -> str:
        if os.path.isdir(MODEL_REPO):
            return MODEL_REPO
        from huggingface_hub import snapshot_download
        pats = ["onnx/model.onnx", "tokenizer.json", "config.json"]
        try:
            return snapshot_download(MODEL_REPO, allow_patterns=pats, local_files_only=True)
        except Exception:
            if os.environ.get("MATHSTUDIO_OFFLINE"):
                raise
            self.status = "downloading"
            return snapshot_download(MODEL_REPO, allow_patterns=pats)

    def _load(self):
        t0 = time.time()
        self.status = "loading"
        try:
            os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
            os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
            emb = Embedder(self._model_dir())
            self._index(emb)
            self.emb = emb
            self.status = "ready"
            print(f"[search] semantic index ready ({len(self.docs)} items, {time.time() - t0:.1f}s)", flush=True)
        except Exception as e:  # pragma: no cover - depends on network / install
            self.status = "unavailable"
            self.error = f"{type(e).__name__}: {e}"
            print(f"[search] semantic search unavailable, using keyword search: {self.error}", flush=True)
        finally:
            self._ready.set()

    def _index(self, emb: Embedder):
        cats = list(CATEGORY_DESC)
        texts = [d.passage for d in self.docs] + [f for d in self.docs for f in d.facets] + \
                [f"{c}: {CATEGORY_DESC[c]}" for c in cats]
        key = hashlib.sha1(json.dumps([MODEL_REPO, texts]).encode()).hexdigest()[:16]
        path = os.path.join(self.cache_dir, f"search-index-{key}.npy") if self.cache_dir else None
        vecs = None
        if path and os.path.exists(path):
            try:
                vecs = np.load(path)
                if vecs.shape[0] != len(texts):
                    vecs = None
            except Exception:
                vecs = None
        if vecs is None:
            vecs = emb.encode(texts).astype(np.float32)
            if path:
                try:
                    np.save(path, vecs)
                except OSError:
                    pass
        n = len(self.docs)
        self.passage_vecs = vecs[:n]
        self.facet_vecs = vecs[n:len(texts) - len(cats)]
        self.facet_owner = np.array([i for i, d in enumerate(self.docs) for _ in d.facets])
        cat_vecs = vecs[len(texts) - len(cats):]
        self.cat_index = {c: i for i, c in enumerate(cats)}
        self.cat_vecs = cat_vecs

    # ------------------------------------------------------------------ scoring
    def _lexical(self, q: str) -> np.ndarray:
        toks = [w for w in words(q) if w not in STOP] or words(q)
        scores = np.zeros(len(self.docs))
        if not toks:
            return scores
        ql = q.strip().lower()
        phrase_re = re.compile(r"(^|\W)" + re.escape(ql))     # phrase starts at a word boundary
        # typo tolerance only for words the library doesn't know ("clock" must not fuzz to "block")
        fuzzy_ok = {w: not any(v.startswith(w) for v in self.vocab) for w in toks}
        for i, d in enumerate(self.docs):
            total = 0.0
            for k, w in enumerate(toks):
                last = k == len(toks) - 1          # the word being typed: allow prefixes
                s = stem(w)
                best = 0.0
                if w in d.name_words:
                    best = 1.0
                elif w in d.tag_words:
                    best = 0.75
                elif s != w and (s in d.name_words or s in d.tag_words):
                    best = 0.45            # stem-only ("heading" ~ "head") is weak evidence
                elif len(w) >= 2 and any(n.startswith(w) for n in d.name_words):
                    best = 0.85 if last else 0.6
                elif len(w) >= 3 and any(t.startswith(w) for t in d.tag_words):
                    best = 0.6 if last else 0.4
                elif w in d.desc_words or s in d.desc_words:
                    best = 0.4
                elif len(w) >= 4 and fuzzy_ok[w]:
                    cap = 1 if len(w) < 8 else 2
                    if any(edit_distance(w, n, cap) <= cap for n in d.name_words if abs(len(n) - len(w)) <= cap):
                        best = 0.7
                    elif any(edit_distance(w, t, cap) <= cap for t in d.tag_words if abs(len(t) - len(w)) <= cap):
                        best = 0.5
                total += best
            sc = total / len(toks)
            if sc > 0:
                # tie-break: prefer items whose *whole* name the query covers ("arow" → Arrow before Curved Arrow)
                covered = sum(1 for n in d.name_list if any(
                    n.startswith(w) or (len(w) >= 4 and edit_distance(w, n, 1) <= 1) for w in toks))
                sc += 0.1 * covered / max(len(d.name_list), 1)
            if len(ql) >= 3 and any(phrase_re.search(p) for p in d.phrases):
                sc += 0.35
            scores[i] = sc
        return scores

    def _qvecs(self, q: str):
        if q not in self._qcache:
            v = self.emb.encode([QUERY_PREFIX + q, q])
            if len(self._qcache) > 256:
                self._qcache.clear()
            self._qcache[q] = (v[0], v[1])
        return self._qcache[q]

    def _semantic(self, q: str) -> np.ndarray | None:
        if self.status != "ready" or len(q.strip()) < 3:
            return None
        qp, qs = self._qvecs(q.strip())
        passage = self.passage_vecs @ qp
        facet_all = self.facet_vecs @ qs
        facet = np.full(len(self.docs), -1.0)
        np.maximum.at(facet, self.facet_owner, facet_all)
        cat_sim = self.cat_vecs @ qs
        cat = np.array([cat_sim[self.cat_index[d.category]] if d.category in self.cat_index else 0 for d in self.docs])
        return 0.45 * passage + 0.35 * facet + 0.20 * cat

    def search(self, q: str, limit: int = 60) -> dict:
        """Ranked results.  Each hit is tier "match" (relevant on its own) or "related"
        (the rest of the category the query is clearly about, e.g. all of AI & ML for
        "transformer architecture")."""
        q = (q or "").strip()[:200]
        if q:
            self._wanted.set()
        out = {"results": [], "semantic": False, "status": self.status, "related": None}
        if not q:
            return out
        lex = self._lexical(q)
        sem = self._semantic(q) if len(q) >= 4 else None
        n = len(self.docs)
        if sem is None:
            score = lex
            primary = lex >= 0.3
            related = np.zeros(n, bool)
            rel_cat = None
        else:
            out["semantic"] = True
            # Calibrate against the whole library: what stands out from the crowd is relevant.
            mu, sd = float(sem.mean()), float(sem.std()) or 1e-6
            z = (sem - mu) / sd
            top = float(sem.max())
            score = (sem - mu) / max(top - mu, 1e-6) + 0.6 * lex      # best semantic hit → 1.0
            # semantic-only hits must stand out from the crowd *and* clear an absolute floor
            # (gibberish like "zzqxv" still has a z-score outlier, but tops out around 0.58)
            primary = (lex >= 0.5) | (((z >= 2.0) | ((z >= 1.5) & (sem >= top - 0.08))) & (sem >= SEM_FLOOR))
            if len(q) < 6 and lex.max() >= 0.5:                       # short + matches names: mostly lexical
                primary &= (lex >= 0.3) | (z >= 2.8)
            # Which category is the query about?  Mean of each category's 3 best items.
            cats: dict[str, list[float]] = {}
            for i, d in enumerate(self.docs):
                cats.setdefault(d.category, []).append(z[i])
            ranked = {c: sorted(v, reverse=True) for c, v in cats.items()}
            cat_score = {c: float(np.mean(v[:3])) for c, v in ranked.items()}
            rel_cat = max(cat_score, key=cat_score.get)
            in_cat = np.array([d.category == rel_cat for d in self.docs])
            hits = int((primary & in_cat).sum())
            # a single strong hit counts when its neighbours in the category also lean that way
            coherent = len(ranked[rel_cat]) >= 3 and min(ranked[rel_cat][1:3]) >= 1.2
            if (hits >= 2 or (hits == 1 and coherent)) and hits * 2 >= int(primary.sum()):
                related = in_cat & ~primary & (z >= -0.5)
            else:
                related, rel_cat = np.zeros(n, bool), None
        order = np.argsort(-score)
        res = [{"id": self.docs[i].id, "score": round(float(score[i]), 4), "tier": "match"} for i in order if primary[i]]
        res += [{"id": self.docs[i].id, "score": round(float(score[i]), 4), "tier": "related"} for i in order if related[i]]
        out["results"] = res[:limit]
        out["related"] = rel_cat if related.any() else None
        return out


_instance: Searcher | None = None


def get(cache_dir: str | None = None) -> Searcher:
    global _instance
    if _instance is None:
        _instance = Searcher(cache_dir)
    return _instance
