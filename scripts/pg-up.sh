#!/usr/bin/env bash
# Start the local Postgres 16 cluster and make sure the app database exists.
#
# The container ships an already-initialised cluster at /var/lib/postgresql/16/main,
# so there is no initdb here. Postgres refuses to run as root, hence `su postgres`
# for every administrative step.
set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
DB=${DB:-winner_wheel}

if ! su postgres -c "$PGBIN/pg_isready -q" 2>/dev/null; then
  echo "==> starting postgres cluster"
  pg_ctlcluster 16 main start 2>/dev/null \
    || su postgres -c "$PGBIN/pg_ctl -D /var/lib/postgresql/16/main \
         -o '-c config_file=/etc/postgresql/16/main/postgresql.conf' \
         -l /tmp/pg.log start"
fi

for _ in $(seq 1 60); do
  su postgres -c "$PGBIN/pg_isready -q" 2>/dev/null && break
  sleep 0.3
done
su postgres -c "$PGBIN/pg_isready" || { echo "postgres did not start"; cat /tmp/pg.log 2>/dev/null; exit 1; }

# A TCP-reachable superuser password: node connects over 127.0.0.1, and peer
# auth only works for a local socket owned by the postgres system user.
su postgres -c "psql -qtAc \"alter role postgres password 'postgres'\"" >/dev/null

if ! su postgres -c "psql -qtAc \"select 1 from pg_database where datname='$DB'\"" | grep -q 1; then
  echo "==> creating database $DB"
  su postgres -c "createdb $DB"
fi

echo "==> postgres ready: $DB"
