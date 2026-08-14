#!/usr/bin/env bash
# Drop and rebuild the schema, apply every migration in order, then seed.
#
# Migrations run as the postgres SUPERUSER -- exactly how Supabase applies
# them -- so object ownership and SECURITY DEFINER semantics match production.
# pgcrypto is an untrusted extension in PG16 and needs superuser regardless.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB=${DB:-winner_wheel}

bash "$ROOT/scripts/pg-up.sh"

echo "==> dropping schema"
su postgres -c "psql -v ON_ERROR_STOP=1 -q -d $DB -c '
  drop schema if exists public cascade;
  drop schema if exists extensions cascade;
  create schema public;'"

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "==> $(basename "$f")"
  su postgres -c "psql -v ON_ERROR_STOP=1 -q -d $DB -f '$f'"
done

echo "==> seed.sql"
su postgres -c "psql -v ON_ERROR_STOP=1 -q -d $DB -f '$ROOT/supabase/seed.sql'"

su postgres -c "psql -qtA -d $DB -c \"
  select 'customers=' || (select count(*) from customers)
      || ' eligible='  || (select count(*) from campaign_customers where is_eligible)
      || ' prizes='    || (select count(*) from prizes)
      || ' awardable=' || (select sum(remaining_quantity) from prizes);\""

echo "==> database ready"
