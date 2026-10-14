#!/usr/bin/env bash
# One-off (2026-10-13): lesson tutor redesign slices 1-2 (memory, transcript
# resume, covered-so-far grounding, per-objective chat thread).
# Migration 025 + ai-service + api/client deploy.
# Spec: docs/superpowers/specs/2026-10-13-lesson-tutor-redesign.md
set -euo pipefail
cd /home/debian/fsa-agent
sudo /usr/local/bin/fsa-backup.sh daily | tail -1
docker exec -i fsa-postgres psql -U postgres -d fsa_agent -v ON_ERROR_STOP=1 -q < server/migrations/025_tutor_memory.sql
docker exec fsa-postgres psql -U postgres -d fsa_agent -Atc "SELECT 'tutor_memory rows: ' || count(*) FROM tutor_memory"
docker compose build ai-service >/dev/null
docker compose up -d ai-service
(cd client-v2 && npm run build >/dev/null)
GITHUB_TOKEN=$(gh auth token) docker compose build api >/dev/null
docker compose up -d api
bash server/scripts/rebuild-test-db.sh
sleep 5
curl -s -o /dev/null -w "chat anonymous: %{http_code} (expect 401)\n" -X POST -H 'Content-Type: application/json' -d '{}' https://learn.fullsteamahead.ca/api/chat
docker exec fsa-agent-ai-service-1 grep -c "_process_lesson" agents/orchestrator.py
echo DONE
