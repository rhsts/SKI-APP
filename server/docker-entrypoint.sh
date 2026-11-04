#!/bin/sh
# The data folder is mounted from the Pi and may belong to root: hand it to the
# unprivileged "node" user, then run the server as that user.
set -e
mkdir -p /data
chown -R node:node /data
exec setpriv --reuid=node --regid=node --init-groups node --disable-warning=ExperimentalWarning /app/index.js
