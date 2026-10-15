#!/usr/bin/env bash
# One-off (2026-10-12): apply migration 023 (chat_history.updated_at) to
# production and deploy the api that reads it (backlogs #116, #117).
# The daily brief's platform_usage collector already queries updated_at, so run
# this before the next 10:00 brief.
set -euo pipefail
cd /home/debian/fsa-agent

echo "== backup"
sudo /usr/local/bin/fsa-backup.sh daily | tail -1

echo "== migration 023"
docker exec -i fsa-postgres psql -U postgres -d fsa_agent -v ON_ERROR_STOP=1 -q \
  < server/migrations/023_chat_history_updated_at.sql
docker exec fsa-postgres psql -U postgres -d fsa_agent -Atc \
  "SELECT count(*) || ' rows, ' || count(*) FILTER (WHERE updated_at IS NULL) || ' null updated_at' FROM chat_history"

echo "== api deploy"
GITHUB_TOKEN=$(gh auth token) docker compose build api >/dev/null
docker compose up -d api

echo "== test DB follows production schema"
bash server/scripts/rebuild-test-db.sh

echo "DONE"
