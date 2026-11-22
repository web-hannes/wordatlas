PY := pipeline/.venv/bin/python

.PHONY: setup data serve

# One-time: Python 3.12 venv with the pipeline's dependencies.
setup:
	uv venv --python 3.12 pipeline/.venv
	uv pip install --python $(PY) -r pipeline/requirements.txt
	$(PY) -m spacy download en_core_web_sm

# Rebuild every day file, practice round and the index.
data:
	$(PY) pipeline/build.py

serve:
	python3 tools/serve.py 8000
