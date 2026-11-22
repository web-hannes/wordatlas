# Wordatlas

A daily map of meaning: five small word maps, one hidden word each, tap where it belongs. See `SPEC.md`.

```sh
make setup   # once: Python 3.12 venv + spaCy model (needs uv)
make data    # rebuild docs/data (365 days from the launch date)
make serve   # http://localhost:8000, debug view at /debug.html?day=YYYY-MM-DD
```

`docs/` is the whole site: plain HTML, CSS and ES modules, no build step.

## Deploy

GitHub Pages serves `docs/` straight from the branch (Settings → Pages → Deploy from a branch,
`main`, `/docs`). The pipeline does not run on GitHub: run `make data` locally and commit
`docs/data/`. Day files run until the last date in `docs/data/days/`; raise `DAYS` in
`pipeline/build.py` before then.

- Launch date: `LAUNCH` in `pipeline/build.py` and `docs/js/config.js` (keep in sync).
- Scoring constant: `SIGMA` in `docs/js/config.js`.
- Anchors: `pipeline/anchors.txt`; excluded words: `pipeline/blocklist.txt`.
