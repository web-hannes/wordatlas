# Wordatlas — Spec v2

## Concept
Daily browser game: "GeoGuessr for meaning". Each round shows a small,
fixed 2D map of ~60 words around one anchor concept. One word is hidden;
the player taps where it belongs. Score by distance.
5 rounds/day, same for everyone, reset 00:00 UTC.

## Architecture
- No backend. Offline Python pipeline → static JSON.
- Frontend: plain HTML/CSS/JS (or Vite + vanilla TS), SVG or canvas.
- Deploy: GitHub Pages / Netlify.

## 1. Data pipeline (Python, /pipeline)
1. Vocabulary: top ~10k English words via `wordfreq`; keep lowercase
   alphabetic, length ≥ 3; drop stopwords and proper nouns; prefer nouns
   (spaCy POS). Target ~5,000 words.
2. Embeddings: sentence-transformers `all-MiniLM-L6-v2`, input
   "Represent the semantic concept: {word}". L2-normalize.
3. Anchors: curated list `anchors.txt` (~300 broad concepts, e.g. kitchen,
   ocean, music, war, money, weather). Each must be in the vocabulary.
4. Per round (anchor):
   a. Take the anchor's 60 nearest neighbors (cosine). Drop words that are
      inflections of each other or of the anchor (same lemma).
   b. Project these 61 words to 2D with PCA (fallback: MDS on cosine
      distance if PCA looks degenerate). Scale to [0,1] with 5% padding.
      Fixed seed.
   c. Labels: anchor at its position (bold) + 15 more words chosen by
      farthest-point sampling (good spread). Others = faint unlabeled dots.
   d. Target: one unlabeled word where
      - ≥ 3 of its 5 nearest 2D neighbors are also among its 5 nearest
        high-dim neighbors (within the 61),
      - cosine to every labeled word ≤ 0.85 (no near-duplicates).
      If no word qualifies, skip this anchor.
5. Schedule: deterministic order of anchors (seeded shuffle), 5 per day,
   precompute 365 days.
6. Output `public/data/days/{YYYY-MM-DD}.json`:
   { day, rounds: [{ anchor, target, words: [{w, x, y, label}] }] }
   Round coords to 4 decimals. Each file < 20 KB.

## 2. Game (frontend)
- Load today's file by UTC date. Puzzle number = days since launch.
- Fixed square view per round. No zoom, no pan. Mobile tap + desktop click.
- Show: labeled words, faint unlabeled dots, the target word as the prompt.
- Round flow: place pin (can move it) → "Confirm" → reveal true position,
  a line pin → truth, points, and labels for the target's 3 nearest words.
- Scoring: d = Euclidean distance in [0,1] space;
  points = round(1000 * exp(-d / 0.12)). Max 5000/day.
  σ is a constant in config; tune after playtesting.
- End screen: total, per-round result, share text without spoilers:
  "Wordatlas #12 3,840/5000 🟩🟩🟨🟥🟩"
  (≥800 🟩, ≥500 🟨, ≥200 🟧, else 🟥).
- localStorage (wrapped in try/catch): today's progress, streak, average.
- Practice mode: random anchors, unlimited.

## 3. Acceptance
- One command rebuilds all day files.
- Same date → same rounds on every device.
- Lighthouse mobile performance ≥ 90.
- Debug page `/debug.html?day=YYYY-MM-DD` shows all 5 maps with every label
  and the target highlighted, to check by eye.
- Playtest 20 rounds: target position should feel guessable. If not, raise
  the neighbor-overlap threshold or change PCA → MDS.

## Later (not MVP)
- Hard mode (fewer labels), German version (multilingual model,
  e.g. paraphrase-multilingual-MiniLM-L12-v2 + German word list).
