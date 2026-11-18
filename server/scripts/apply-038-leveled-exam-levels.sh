#!/usr/bin/env bash
# One-off (2026-11): leveled practice exams groundwork (backlog #147, Plan 1 Task 1).
# Run AFTER branch leveled-exams-plan1 is merged to master. Schema only: adds
# exam_topic_groups and questions.exam_level/level_scores. No code reads them
# yet, so no api rebuild is needed. Replay-safe.
set -euo pipefail
cd /home/debian/fsa-agent

# 1. Backup
sudo /usr/local/bin/fsa-backup.sh daily | tail -1

# 2. Migration
docker exec -i fsa-postgres psql -U postgres -d fsa_agent -v ON_ERROR_STOP=1 -q < server/migrations/038_leveled_exam_levels.sql

# 3. Verify
docker exec fsa-postgres psql -U postgres -d fsa_agent -Atc "SELECT 'exam_topic_groups: ' || (to_regclass('public.exam_topic_groups') IS NOT NULL)"
docker exec fsa-postgres psql -U postgres -d fsa_agent -Atc "SELECT 'questions new columns: ' || count(*) || '/2' FROM information_schema.columns WHERE table_name='questions' AND column_name IN ('exam_level','level_scores')"

# 4. Test DB picks up the new schema
bash server/scripts/rebuild-test-db.sh
echo DONE
