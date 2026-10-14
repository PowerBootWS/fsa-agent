#!/usr/bin/env bash
# Lesson tutor redesign slice 3: migration 026, the check-in lookup in
# /api/v2/checkpoint, and the reviewed check-in cards loaded into production.
# Run only after Russ has signed off the 50-card review sample.
# Spec: docs/superpowers/specs/2026-10-13-lesson-tutor-redesign.md
set -euo pipefail
cd /home/debian/fsa-agent
CARDS=${1:-data/checkins/checkins.jsonl}
test -s "$CARDS"
sudo /usr/local/bin/fsa-backup.sh daily | tail -1
docker exec -i fsa-postgres psql -U postgres -d fsa_agent -v ON_ERROR_STOP=1 -q < server/migrations/026_lesson_checkins.sql
GITHUB_TOKEN=$(gh auth token) docker compose build api >/dev/null
docker compose up -d api
POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' /home/debian/.env.shared | cut -d= -f2-) \
POSTGRES_DB=fsa_agent POSTGRES_HOST=localhost POSTGRES_PORT=5434 \
  python3 ai-service/scripts/generate_checkins.py load --in "$CARDS" --allow-production
docker exec fsa-postgres psql -U postgres -d fsa_agent -Atc \
  "SELECT 'lesson_checkins: ' || count(*) FROM lesson_checkins"
bash server/scripts/rebuild-test-db.sh
echo DONE
