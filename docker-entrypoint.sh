#!/bin/sh
# Container startup wrapper.
# When Railway (or any orchestrator) mounts a fresh persistent volume on
# /app/uploads, the mount point is owned by root and the `node` user that
# actually runs the app cannot write to it. We start as root, chown the
# expected directories, then drop privileges to `node` before exec'ing
# the real command.
#
# When the container is already started as a non-root user (e.g. local
# docker-compose with `user: "${UID}:${GID}"`), we skip the chown and
# just exec the command directly.

set -e

if [ "$(id -u)" = "0" ]; then
    for dir in /app/uploads /app/logs /app/client/public/images; do
        if [ -d "$dir" ]; then
            chown -R node:node "$dir" 2>/dev/null || true
        fi
    done
    exec su-exec node "$@"
fi

exec "$@"
