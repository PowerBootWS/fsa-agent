#!/usr/bin/env bash
# Owner-run: load exam_topic_groups into production from the exam breakdown CSV.
# Needs migration 038 applied first (server/scripts/apply-038-leveled-exam-levels.sh).
# Re-run whenever wiki/reference/sopeec-exam-breakdown.csv is regenerated. Idempotent.
set -euo pipefail
cd /home/debian/fsa-agent
SQL=$(mktemp --suffix=.sql)
python3 scripts/load_topic_groups.py --sql-out "$SQL"
sudo /usr/local/bin/fsa-backup.sh daily | tail -1
docker exec -i fsa-postgres psql -U postgres -d fsa_agent -v ON_ERROR_STOP=1 -q < "$SQL"
docker exec fsa-postgres psql -U postgres -d fsa_agent -Atc "SELECT paper_code || ': ' || count(*) || ' groups, ' || sum(exam_questions) || ' questions' FROM exam_topic_groups GROUP BY paper_code ORDER BY paper_code"
rm -f "$SQL"
echo DONE
