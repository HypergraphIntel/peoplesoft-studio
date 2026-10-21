#!/usr/bin/env bash
# SELECT-only IB calibration capture; shell startup supplies the existing lab environment.
set -euo pipefail
if [[ $# != 2 || ! $1 =~ ^(before|after)$ || ! $2 =~ ^ib[0-9]+-[a-z0-9-]+$ ]]; then
  echo 'usage: bash tools/lab/ib-lifecycle-capture.sh before|after ibNN-case-name' >&2
  exit 2
fi
capture_args=("$1" --case "$2")
if [[ $1 == after ]]; then capture_args+=(--omit-nonlab-rows); fi
if [[ -n ${PSLAB_ROUTINGS:-} ]]; then capture_args+=(--routings "$PSLAB_ROUTINGS"); fi
exec bash -lic 'exec node --import tsx tools/corpus/save-protocol/snapshot.ts "$@"' ib-lifecycle-capture "${capture_args[@]}"
