# Run every check that CI runs.
default: lint test site

lint: lint-py lint-rs lint-js

test: test-py test-rs test-js

# -- Python (reference implementation; also generates spec/) ------------------
[working-directory: 'python']
lint-py:
    uv run ruff format --check .
    uv run ruff check .
    uv run mypy

[working-directory: 'python']
test-py *args:
    uv run pytest {{args}}

# Regenerate spec/examples and spec/conformance from the Python reference.
generate:
    uv run --project python python scripts/generate.py

# -- Rust ---------------------------------------------------------------------
[working-directory: 'rust']
lint-rs:
    cargo fmt --check
    cargo clippy --all-targets -- -D warnings
    cargo clippy --all-targets --no-default-features -- -D warnings

[working-directory: 'rust']
test-rs:
    cargo test
    cargo test --no-default-features

# -- JS -----------------------------------------------------------------------
[working-directory: 'js']
lint-js:
    npm run check

[working-directory: 'js']
test-js:
    npm test

# -- benchmarks and the viewer --------------------------------------------------
bench:
    cd rust && cargo bench --bench operad
    cd python && uv run python benchmarks/bench.py
    cd js && node bench/bench.js

# Build the docs site + viewer + playground into dist/ (what Vercel deploys).
# Fails on any broken relative link or #anchor.
site:
    npm ci --prefix site
    npm run --prefix site build

# Load the built site in Chromium: pages, the viewer, a playground edit.
smoke: site
    npm run --prefix site smoke

# Serve the repository root and open http://localhost:8000/viewer/
serve port="8000":
    python3 -m http.server {{port}}
