#!/usr/bin/env bash
# Everything CI runs. The pre-push hook calls this too.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "== repo: files over 100 MB"
oversized=$(git ls-files -z | xargs -0 -I{} sh -c '[ -f "$1" ] || exit 0; find "$1" -type f -size +100M' _ {})
if [ -n "$oversized" ]; then
  echo "$oversized"
  exit 1
fi

echo "== pipeline"
(
  cd pipeline
  uv sync --quiet --frozen
  uv run --frozen ruff check .
  uv run --frozen ruff format --check .
  uv run --frozen pyright
  uv run --frozen pytest -q
)

echo "== backend"
(
  cd backend
  ./gradlew test --console=plain
)

echo "== web"
(
  cd web
  pnpm install --frozen-lockfile --silent
  pnpm exec oxlint --deny-warnings
  pnpm exec vitest run
  pnpm build
)
