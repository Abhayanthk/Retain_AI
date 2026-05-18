.PHONY: dev fastapi inngest install build prebake-onnx

# Default shell
SHELL := /bin/bash

# Configuration
PYTHON_VENV := .venv
PYTHON_BIN := $(PYTHON_VENV)/bin/python
UVICORN_BIN := $(PYTHON_VENV)/bin/uvicorn
APP_MODULE := app.main:app
PORT ?= 8000
INNGEST_URL := http://127.0.0.1:$(PORT)/api/inngest
ONNX_CACHE_DIR := app/rag/onnx_cache

install:
	python3 -m venv $(PYTHON_VENV)
	$(PYTHON_VENV)/bin/pip install -r requirements.txt
	$(PYTHON_BIN) -m app.rag.ingest

# Pre-download Chroma's ONNX embedder into a project-dir cache that Render
# preserves between build and runtime. Symlinks $HOME/.cache/chroma to it so
# the runtime container reuses the cache instead of re-downloading (~80MB
# spike that OOM-kills the 512MB free tier).
prebake-onnx:
	mkdir -p $(ONNX_CACHE_DIR)
	mkdir -p $$HOME/.cache
	rm -rf $$HOME/.cache/chroma
	ln -sfn $(abspath $(ONNX_CACHE_DIR)) $$HOME/.cache/chroma
	$(PYTHON_BIN) -c "from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2; ef = ONNXMiniLM_L6_V2(preferred_providers=['CPUExecutionProvider']); v = ef(['warmup sentence to force model download']); print(f'[prebake] embedded vector dim={len(v[0])}')"
	@echo "[prebake] cache contents:" && ls -lah $(ONNX_CACHE_DIR) || true

build: install prebake-onnx

fastapi:
	$(UVICORN_BIN) $(APP_MODULE) --reload --port $(PORT)

start:
	$(UVICORN_BIN) $(APP_MODULE) --host 0.0.0.0 --port $(PORT)

inngest:
	npx inngest-cli@latest dev -u $(INNGEST_URL)

dev:
	@echo "Starting FastAPI and Inngest Dev Server..."
	@npx concurrently -n "FastAPI,Inngest" -c "cyan,magenta" \
		"$(UVICORN_BIN) $(APP_MODULE) --reload --port $(PORT)" \
		"npx inngest-cli@latest dev -u $(INNGEST_URL)"
