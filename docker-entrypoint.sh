#!/bin/sh
# Prepare the lab database, then hand off to the container command.
set -e

echo "[lab] LAB_MODE=${LAB_MODE:-vulnerable}"
echo "[lab] syncing SQLite schema..."
pnpm exec prisma db push --skip-generate

if [ "${LAB_SEED:-true}" = "true" ]; then
  echo "[lab] seeding lab users and notes..."
  pnpm exec tsx prisma/seed.ts
fi

echo "[lab] starting API on ${HOST:-0.0.0.0}:${PORT:-3000}"
exec "$@"
