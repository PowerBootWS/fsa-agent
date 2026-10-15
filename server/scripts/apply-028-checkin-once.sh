#!/usr/bin/env bash
# One-off (2026-10-14): check-ins show once per student (learner_sessions.max_section)
# + "Quick exercise" button beside "Ask about this slide".
# Migration 027 must land before the api: the PATCH writes max_section.
set -euo pipefail
cd /home/debian/fsa-agent
sudo /usr/local/bin/fsa-backup.sh daily | tail -1
docker exec -i fsa-postgres psql -U postgres -d fsa_agent -v ON_ERROR_STOP=1 -q < server/migrations/027_learner_session_max_section.sql
docker exec fsa-postgres psql -U postgres -d fsa_agent -Atc "SELECT 'max_section column: ' || count(*) FROM information_schema.columns WHERE table_name='learner_sessions' AND column_name='max_section'"
(cd client-v2 && npm run build >/dev/null)
GITHUB_TOKEN=$(gh auth token) docker compose build api >/dev/null
docker compose up -d api
bash server/scripts/rebuild-test-db.sh
sleep 5
curl -s -o /dev/null -w "lesson app: %{http_code}\n" https://learn.fullsteamahead.ca/
echo DONE
