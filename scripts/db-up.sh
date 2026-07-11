#!/usr/bin/env bash
# Bring up the dev Postgres container with a persistent named volume.
#
# Idempotent. If an old `--rm`-style container named `naub-pg` is lying
# around from a previous bring-up, drop it first so the named-volume
# mount can claim the name.
#
# Uses plain `docker run` so it works on hosts without the docker-compose
# v2 plugin. (The docker-compose.yml at the repo root is kept as a
# reference for users who do.)
set -euo pipefail

CONTAINER_NAME="naub-pg"
VOLUME_NAME="naub-pg-data"
IMAGE="postgres:16"
PORT="5432:5432"

cd "$(dirname "$0")/.."

# Best-effort cleanup of any pre-existing container with the same name.
# Compose would have done this for us; running bare docker run, we have to.
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

# `docker volume create` is also idempotent — only creates if missing.
docker volume create "$VOLUME_NAME" >/dev/null

docker run -d \
  --name "$CONTAINER_NAME" \
  -e POSTGRES_PASSWORD=dev \
  -p "$PORT" \
  -v "$VOLUME_NAME":/var/lib/postgresql/data \
  --restart unless-stopped \
  "$IMAGE" >/dev/null

echo
echo "Container: $CONTAINER_NAME"
echo "Port:      $PORT"
echo "Volume:    $VOLUME_NAME  (persists across 'npm run db:down')"
echo
echo "Follow logs with: npm run db:logs"
echo "Tear down with:   npm run db:down"