#!/usr/bin/env bash
# Lesson tutor redesign slice 4: check-in cards + tutor drawer, switched on
# for the emails given (default russ@ only). No migration.
# Usage: apply-027-tutor-v2.sh [comma-separated emails | '*']
set -euo pipefail
cd /home/debian/fsa-agent
EMAILS=${1:-russ@fullsteamahead.ca}
if grep -q '^TUTOR_V2_EMAILS=' .env; then
  sed -i "s|^TUTOR_V2_EMAILS=.*|TUTOR_V2_EMAILS=${EMAILS}|" .env
else
  printf '\n# Lesson tutor redesign slice 4 (check-in cards + drawer). Emails or *.\nTUTOR_V2_EMAILS=%s\n' "$EMAILS" >> .env
fi
(cd client-v2 && npm run build >/dev/null)
GITHUB_TOKEN=$(gh auth token) docker compose build api >/dev/null
docker compose up -d api
sleep 5
docker exec fsa-agent-api-1 printenv TUTOR_V2_EMAILS
curl -s -o /dev/null -w "chat history anonymous: %{http_code} (expect 401)\n" https://learn.fullsteamahead.ca/api/chat/history/2B1-1-1
echo DONE
