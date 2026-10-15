#!/usr/bin/env bash
# One-off (2026-10-12): NPS survey (backlog #127). Migration 024 + api/client deploy.
# The daily brief's nps collector reads nps_responses, so run before the 10:00 brief.
set -euo pipefail
cd /home/debian/fsa-agent
sudo /usr/local/bin/fsa-backup.sh daily | tail -1
docker exec -i fsa-postgres psql -U postgres -d fsa_agent -v ON_ERROR_STOP=1 -q < server/migrations/024_nps_responses.sql
docker exec fsa-postgres psql -U postgres -d fsa_agent -Atc "SELECT 'nps_responses rows: ' || count(*) FROM nps_responses"
(cd client-v2 && npm run build >/dev/null)
GITHUB_TOKEN=$(gh auth token) docker compose build api >/dev/null
docker compose up -d api
bash server/scripts/rebuild-test-db.sh
sleep 5
curl -s -o /dev/null -w "nps/next anonymous: %{http_code} (expect 401)\n" https://learn.fullsteamahead.ca/api/platform/nps/next
echo DONE
