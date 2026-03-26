#!/bin/sh
# Fix Docker socket permissions so appuser can create terminal containers.
# On Docker Desktop (macOS/Windows), the socket is root:root.
if [ -S /var/run/docker.sock ]; then
    SOCK_GID=$(stat -c '%g' /var/run/docker.sock 2>/dev/null || stat -f '%g' /var/run/docker.sock 2>/dev/null)
    if [ "$SOCK_GID" != "0" ]; then
        # Socket has a non-root group — add appuser to that group
        groupadd -g "$SOCK_GID" -o docker-host 2>/dev/null || true
        usermod -aG docker-host appuser 2>/dev/null || true
    else
        # Socket is root:root — make it group-accessible
        chmod 666 /var/run/docker.sock
    fi
fi

exec gosu appuser "$@"
