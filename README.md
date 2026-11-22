# Wherd

A daily map of meaning: five small word maps, one hidden word each, tap where it belongs. See `SPEC.md`.

```sh
make setup   # once: Python 3.12 venv + spaCy model (needs uv)
make data    # rebuild public/data (365 days from the launch date)
make serve   # http://localhost:8000, debug view at /debug.html?day=YYYY-MM-DD
```

`public/` is the whole site: plain HTML, CSS and ES modules, no build step.

## Deploy

Pushing to `main` publishes `public/` to GitHub Pages via `.github/workflows/pages.yml`
(repo Settings → Pages → Source: GitHub Actions). The pipeline does not run in CI:
run `make data` locally and commit `public/data/`. Day files currently run until the
last date in `public/data/days/`; raise `DAYS` in `pipeline/build.py` before then.

- Launch date: `LAUNCH` in `pipeline/build.py` and `public/js/config.js` (keep in sync).
- Scoring constant: `SIGMA` in `public/js/config.js`.
- Anchors: `pipeline/anchors.txt`; excluded words: `pipeline/blocklist.txt`.
