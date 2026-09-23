#!/usr/bin/env bash

set -euo pipefail

run_chunk() {
  local offset="$1"
  local limit="$2"

  echo
  echo "========================================"
  echo "Corpus chunk: offset=${offset} limit=${limit}"
  echo "========================================"

  npm run corpus:inventory -- --offset "$offset" --limit "$limit"

  echo
  echo "Current failure summary"
  echo "-----------------------"

  npm run corpus:failures -- --summary
}

run_chunk  5000 5000
run_chunk 10000 5000
run_chunk 15000 5000
run_chunk 20000 5000
run_chunk 25000 5000
run_chunk 30000 5000

echo
echo "========================================"
echo "Final Summary"
echo "========================================"

npm run corpus:failures -- --summary

echo
echo "========================================"
echo "Next Recommended Target"
echo "========================================"

npm run corpus:next
