#!/bin/sh
# Makes a safe copy of the friends database (also while the server is running)
# in server/backups/, and keeps the newest 8. Run from the server folder:
#   ./backup.sh
set -e
cd "$(dirname "$0")"
stamp=$(date +%Y-%m-%d_%H%M)
docker compose exec -T friends node --disable-warning=ExperimentalWarning -e \
  "new (require('node:sqlite').DatabaseSync)('/data/ski-friends.db').exec(\"VACUUM INTO '/data/backup.db'\")"
mkdir -p backups
mv data/backup.db "backups/ski-friends-$stamp.db"
ls -1t backups/ski-friends-*.db | tail -n +9 | xargs -r rm --
echo "Backup saved: backups/ski-friends-$stamp.db"
