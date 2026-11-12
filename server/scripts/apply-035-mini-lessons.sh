#!/usr/bin/env bash
# One-off (2026-11): free public mini lessons.
# Run AFTER feature/mini-lessons is merged to master in both fsa-agent and
# fsa-lesson-creator. Migration 035 must land before the api: the new routes
# read the mini_lesson_* tables.
# Never prints the publish token.
set -euo pipefail
cd /home/debian/fsa-agent

AGENT_ENV=/home/debian/fsa-agent/.env
LC_ENV=/home/debian/fsa-lesson-creator/.env
MINI_DIR=/home/debian/media-mini

# 1. Backup
sudo /usr/local/bin/fsa-backup.sh daily | tail -1

# 2-3. Migration + verify
docker exec -i fsa-postgres psql -U postgres -d fsa_agent -v ON_ERROR_STOP=1 -q < server/migrations/035_mini_lessons.sql
docker exec fsa-postgres psql -U postgres -d fsa_agent -Atc "SELECT 'mini lesson tables: ' || count(*) || '/4' FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('mini_lessons','mini_lesson_versions','mini_lesson_slides','mini_lesson_questions')"

# 4. Media dir (world-readable like /home/debian/media; the api mounts it read-only)
mkdir -p "$MINI_DIR"
chmod 755 "$MINI_DIR"

# 5. Env: add only what is missing; one shared token in both files
has() { grep -q "^$1=" "$2" 2>/dev/null; }
if has MINI_LESSON_PUBLISH_TOKEN "$AGENT_ENV"; then
  TOKEN=$(grep -m1 '^MINI_LESSON_PUBLISH_TOKEN=' "$AGENT_ENV" | cut -d= -f2-)
else
  TOKEN=$(openssl rand -hex 32)
  echo "MINI_LESSON_PUBLISH_TOKEN=$TOKEN" >> "$AGENT_ENV"
fi
has FSA_MINI_MEDIA_DIR "$AGENT_ENV" || echo "FSA_MINI_MEDIA_DIR=$MINI_DIR" >> "$AGENT_ENV"
has MINI_LESSON_PUBLISH_TOKEN "$LC_ENV" || echo "MINI_LESSON_PUBLISH_TOKEN=$TOKEN" >> "$LC_ENV"
has MINI_LESSON_API_BASE "$LC_ENV" || echo "MINI_LESSON_API_BASE=https://learn.fullsteamahead.ca" >> "$LC_ENV"
has FSA_MINI_MEDIA_DIR "$LC_ENV" || echo "FSA_MINI_MEDIA_DIR=$MINI_DIR" >> "$LC_ENV"
unset TOKEN
a=$(grep -m1 '^MINI_LESSON_PUBLISH_TOKEN=' "$AGENT_ENV" | cut -d= -f2-)
b=$(grep -m1 '^MINI_LESSON_PUBLISH_TOKEN=' "$LC_ENV" | cut -d= -f2-)
if [ -n "$a" ] && [ "$a" = "$b" ]; then echo "publish token: set, same in both .env files"; else echo "publish token: MISMATCH between .env files"; exit 1; fi
unset a b

# 6. Build + deploy api
(cd client-v2 && npm run build >/dev/null)
GITHUB_TOKEN=$(gh auth token) docker compose build api >/dev/null
docker compose up -d api

# 7. Test DB picks up the new schema
bash server/scripts/rebuild-test-db.sh

# 8. Live checks (through Cloudflare)
sleep 5
curl -s -o /dev/null -w "lesson app: %{http_code}\n" https://learn.fullsteamahead.ca/
page=$(curl -s -w '\n%{http_code}' https://learn.fullsteamahead.ca/explained/does-not-exist)
echo "explained page: $(echo "$page" | tail -1), noindex: $(echo "$page" | grep -c noindex)"
curl -s -o /dev/null -w "explained api (expect 404): %{http_code}\n" https://learn.fullsteamahead.ca/api/explained/2B3-1-7
curl -s -o /dev/null -w "internal api without token (expect 401/403): %{http_code}\n" https://learn.fullsteamahead.ca/api/internal/mini-lessons/

# 9. Container sees the media dir
docker compose exec -T api ls -ld /srv/fsa-mini-media
echo DONE
