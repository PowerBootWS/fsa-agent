#!/usr/bin/env bash
# Rebuild fsa_agent_test from production's *schema* (backlog #115).
#
# The test database used to be built by replaying server/migrations/, which
# misses everything that predates the numbered migrations (chat_history and
# lessons came from a legacy init.sql) and anything ever applied by hand. A
# schema-only dump of production is the whole story by construction. No rows
# are copied. One-off backup tables (*_bak*, *backup*, *_purged_*) are left out.
#
# Run from the host:  bash fsa-agent/server/scripts/rebuild-test-db.sh
# Re-run after any production schema change, then run the suite.
set -euo pipefail

SRC=fsa_agent
DST=fsa_agent_test   # hard-coded on purpose: this script drops its target
PG="docker exec -i fsa-postgres"

dump=$(mktemp)
trap 'rm -f "$dump"' EXIT

$PG pg_dump -U postgres -d "$SRC" --schema-only --schema=public --no-owner --no-privileges \
  -T 'public.*_bak*' -T 'public.*backup*' -T 'public.*_purged_*' > "$dump"

$PG psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS $DST WITH (FORCE)" \
  -c "CREATE DATABASE $DST"

# The dump carries its own CREATE SCHEMA public.
$PG psql -U postgres -d "$DST" -q -c "DROP SCHEMA public CASCADE"
$PG psql -U postgres -d "$DST" -v ON_ERROR_STOP=1 -q < "$dump" >/dev/null

tables=$($PG psql -U postgres -d "$DST" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
echo "$DST rebuilt from $SRC schema: $tables tables/views"
