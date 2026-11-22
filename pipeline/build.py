"""Wordatlas data pipeline: vocabulary -> embeddings -> per-anchor maps -> day files.

Run from the repo root:  make data   (or: pipeline/.venv/bin/python pipeline/build.py)
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import random
import shutil
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
PIPE = ROOT / "pipeline"
CACHE = PIPE / "cache"
OUT = ROOT / "docs" / "data"

LAUNCH = dt.date(2026, 11, 1)  # puzzle #1; keep in sync with docs/js/config.js
DAYS = 365
ROUNDS_PER_DAY = 5
SEED = 20261122

TOP_N = 14_000
TARGET_VOCAB = 5_000
HUB_DROP = 0.03        # drop the most "central" words (they show up near everything)
MODEL = "all-MiniLM-L6-v2"
PROMPT = "Represent the semantic concept: {}"

NEIGHBORS = 60
LABELS = 15            # labels besides the anchor
PAD = 0.05
K = 5                  # neighbourhood size for the overlap test
MIN_OVERLAP = 3        # of K
MAX_LABEL_COS = 0.85
MIN_PRESERVATION = 0.30  # mean 2D/high-dim kNN overlap below this counts as degenerate PCA


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# 1. Vocabulary ---------------------------------------------------------------

def build_vocab(anchors: list[str]):
    import nltk
    import spacy
    from nltk.corpus import wordnet as wn
    from wordfreq import top_n_list, zipf_frequency

    nltk.download("wordnet", quiet=True)

    nlp = spacy.load("en_core_web_sm", disable=["parser", "ner"])
    stop = nlp.Defaults.stop_words
    block = {w.strip() for w in (PIPE / "blocklist.txt").read_text().split() if w.strip()}

    raw = top_n_list("en", TOP_N)
    raw_set = set(raw)
    missing = [a for a in anchors if a not in raw_set]
    if missing:
        log(f"anchors outside top {TOP_N}, skipped: {', '.join(missing)}")
    anchors = [a for a in anchors if a in raw_set]

    cand = [w for w in raw if w.isalpha() and w.islower() and w.isascii() and len(w) >= 3
            and w not in stop and w not in block]

    def common_noun(w):
        # WordNet lists names (Floyd, Reuters) with capitals, so an exact lowercase lemma
        # match means a common noun; this also drops plurals whose singular is the lemma.
        return any(l.name() == w for s in wn.synsets(w, pos=wn.NOUN) for l in s.lemmas())

    nouns, others, lemma = [], [], {}
    for w, doc in zip(cand, nlp.pipe(cand, batch_size=1000)):
        tok = doc[0]
        lemma[w] = tok.lemma_.lower()
        if tok.pos_ == "PROPN" or not common_noun(w):
            continue
        if tok.pos_ == "NOUN":
            nouns.append(w)
        elif tok.pos_ in ("ADJ", "VERB"):
            others.append(w)

    words = nouns[:TARGET_VOCAB]
    if len(words) < TARGET_VOCAB:
        words += others[: TARGET_VOCAB - len(words)]
    have = set(words)
    for a in anchors:  # anchors are always in, even if spaCy tagged them oddly
        if a not in have:
            words.append(a)
            have.add(a)
            lemma.setdefault(a, a)

    zipf = {w: zipf_frequency(w, "en") for w in words}
    log(f"vocab: {len(words)} words ({len(nouns)} nouns available)")
    return words, lemma, zipf, anchors


# 2. Embeddings ---------------------------------------------------------------

def embed(words: list[str]) -> np.ndarray:
    key = hashlib.sha1(("\n".join(words) + MODEL + PROMPT).encode()).hexdigest()[:12]
    path = CACHE / f"emb-{key}.npy"
    if path.exists():
        return np.load(path)
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(MODEL)
    E = model.encode([PROMPT.format(w) for w in words], batch_size=256,
                     normalize_embeddings=True, show_progress_bar=True)
    E = E.astype(np.float32)
    CACHE.mkdir(exist_ok=True)
    np.save(path, E)
    return E


def drop_hubs(words, E, keep):
    """Remove words that sit in the 20-NN lists of unusually many other words."""
    k, counts = 20, np.zeros(len(words), int)
    for i in range(0, len(words), 1000):
        S = E[i:i + 1000] @ E.T
        for r, row in enumerate(S):
            row[i + r] = -1
        np.add.at(counts, np.argpartition(-S, k, axis=1)[:, :k].ravel(), 1)
    cut = np.quantile(counts, 1 - HUB_DROP)
    ok = [i for i, w in enumerate(words) if counts[i] <= cut or w in keep]
    log(f"hubs dropped: {len(words) - len(ok)} (e.g. "
        f"{', '.join(words[i] for i in np.argsort(-counts)[:8])})")
    return [words[i] for i in ok], E[ok]


# 3/4. Rounds -----------------------------------------------------------------

def is_variant(a: str, b: str, lemma: dict) -> bool:
    if lemma.get(a, a) == lemma.get(b, b):
        return True
    short, long_ = sorted((a, b), key=len)
    return long_.startswith(short) and len(long_) - len(short) <= 3


def knn(D: np.ndarray, k: int) -> np.ndarray:
    D = D.copy()
    np.fill_diagonal(D, np.inf)
    return np.argsort(D, axis=1)[:, :k]


def overlaps(P: np.ndarray, Dhi: np.ndarray) -> np.ndarray:
    D2 = np.linalg.norm(P[:, None] - P[None], axis=2)
    a, b = knn(D2, K), knn(Dhi, K)
    return np.array([len(set(a[i]) & set(b[i])) for i in range(len(P))])


def project(X: np.ndarray, Dhi: np.ndarray):
    import warnings

    from sklearn.decomposition import PCA
    from sklearn.manifold import MDS

    P = PCA(n_components=2, random_state=SEED).fit_transform(X)
    ov = overlaps(P, Dhi)
    method = "pca"
    if ov.mean() / K < MIN_PRESERVATION:
        with warnings.catch_warnings():  # sklearn renames MDS arguments across versions
            warnings.simplefilter("ignore", FutureWarning)
            M = MDS(n_components=2, dissimilarity="precomputed", random_state=SEED,
                    n_init=4, normalized_stress="auto").fit_transform(Dhi)
        ov_m = overlaps(M, Dhi)
        if ov_m.mean() > ov.mean():
            P, ov, method = M, ov_m, "mds"
    # uniform scale into [PAD, 1-PAD], centred on the short axis
    P = P - P.min(axis=0)
    span = P.max()
    P = P / span * (1 - 2 * PAD)
    P += PAD + ((1 - 2 * PAD) - P.max(axis=0)) / 2
    return P, ov, method


def farthest_points(P: np.ndarray, start: int, n: int) -> list[int]:
    chosen = [start]
    d = np.linalg.norm(P - P[start], axis=1)
    for _ in range(n):
        i = int(np.argmax(d))
        chosen.append(i)
        d = np.minimum(d, np.linalg.norm(P - P[i], axis=1))
    return chosen


def build_round(anchor: str, words, idx, E, lemma, zipf, rng: random.Random):
    a = idx[anchor]
    sims = E @ E[a]
    picked = [a]
    for j in np.argsort(-sims):
        if len(picked) == NEIGHBORS + 1:
            break
        w = words[j]
        if j == a or any(is_variant(w, words[p], lemma) for p in picked):
            continue
        picked.append(int(j))

    X = E[picked]
    C = X @ X.T
    Dhi = np.clip(1 - C, 0, None)
    P, ov, method = project(X, Dhi)

    labeled = set(farthest_points(P, 0, LABELS))
    lab = sorted(labeled)
    cands = []
    for i in range(len(picked)):
        if i in labeled or ov[i] < MIN_OVERLAP:
            continue
        if C[i, lab].max() > MAX_LABEL_COS:
            continue
        if np.linalg.norm(P[lab] - P[i], axis=1).min() < 0.03:
            continue  # sitting on top of a label is too easy
        cands.append((ov[i] + 0.4 * zipf[words[picked[i]]], i))
    if not cands:
        return None
    cands.sort(reverse=True)
    t = rng.choice(cands[:3])[1]

    near = [int(j) for j in np.argsort(Dhi[t]) if j != t][:3]
    return {
        "anchor": anchor,
        "target": words[picked[t]],
        "near": [words[picked[j]] for j in near],
        "meta": {"method": method, "overlap": int(ov[t]),
                 "preservation": round(float(ov.mean() / K), 3)},
        "words": [{"w": words[p], "x": round(float(P[i, 0]), 4), "y": round(float(P[i, 1]), 4),
                   "label": i in labeled} for i, p in enumerate(picked)],
    }


# 5/6. Schedule + output --------------------------------------------------------

def schedule(anchors: list[str]) -> list[list[str]]:
    rng = random.Random(SEED)
    seq: list[str] = []
    while len(seq) < DAYS * ROUNDS_PER_DAY:
        deck = anchors[:]
        rng.shuffle(deck)
        # avoid repeating an anchor across a deck boundary inside the same day
        while seq and deck[0] in seq[-ROUNDS_PER_DAY:]:
            rng.shuffle(deck)
        seq += deck
    return [seq[i * ROUNDS_PER_DAY:(i + 1) * ROUNDS_PER_DAY] for i in range(DAYS)]


def dump(path: Path, obj) -> int:
    s = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    path.write_text(s)
    return len(s.encode())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, help="only build the first N anchors (quick test)")
    args = ap.parse_args()

    anchors = [l.strip() for l in (PIPE / "anchors.txt").read_text().splitlines()
               if l.strip() and not l.startswith("#")]
    if args.limit:
        anchors = anchors[: args.limit]
    words, lemma, zipf, anchors = build_vocab(anchors)
    E = embed(words)
    # The shared prompt pulls every vector the same way; removing the mean direction
    # spreads the space out and weakens generic words like "thing" or "help".
    E = E - E.mean(axis=0)
    E /= np.linalg.norm(E, axis=1, keepdims=True)
    words, E = drop_hubs(words, E, set(anchors))
    idx = {w: i for i, w in enumerate(words)}

    rounds = {}
    for anchor in anchors:
        rng = random.Random(f"{SEED}:{anchor}")
        r = build_round(anchor, words, idx, E, lemma, zipf, rng)
        if r is None:
            log(f"skip {anchor}: no target qualifies")
            continue
        rounds[anchor] = r
    methods = [r["meta"]["method"] for r in rounds.values()]
    log(f"rounds: {len(rounds)}/{len(anchors)}  (pca {methods.count('pca')}, mds {methods.count('mds')})")

    for d in ("days", "rounds"):
        shutil.rmtree(OUT / d, ignore_errors=True)
        (OUT / d).mkdir(parents=True)

    for anchor, r in rounds.items():
        dump(OUT / "rounds" / f"{anchor}.json", r)

    biggest = 0
    days = schedule(list(rounds))
    for n, names in enumerate(days):
        day = (LAUNCH + dt.timedelta(days=n)).isoformat()
        biggest = max(biggest, dump(OUT / "days" / f"{day}.json",
                                    {"day": day, "rounds": [rounds[a] for a in names]}))

    dump(OUT / "index.json", {
        "launch": LAUNCH.isoformat(),
        "last": (LAUNCH + dt.timedelta(days=DAYS - 1)).isoformat(),
        "anchors": sorted(rounds),
    })
    log(f"wrote {DAYS} day files, largest {biggest / 1024:.1f} KB")
    if biggest > 20 * 1024:
        log("warning: a day file exceeds 20 KB")


if __name__ == "__main__":
    main()
