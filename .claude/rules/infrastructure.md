# fsa-agent Infrastructure Rules

## Networking

- All containers run on the internal `fsa-network` Docker bridge.
- External access is via **Cloudflare Tunnel only** — direct IP or `localhost` hits will NOT reach the correct container.
- Any container that must be reachable from outside the server MUST be on the `cloudflare` Docker network in `docker-compose.yml`.
- Never test endpoints via `curl http://localhost:PORT` or `curl http://<container-ip>:PORT` — those bypass Cloudflare and will fail or hit the wrong service.

## URLs

| App | Public URL | Notes |
|-----|-----------|-------|
| fsa-agent (API + React) | `https://learn.fullsteamahead.ca` | **The live platform** (client-v2, authenticated). The only active front end. |
| fsa-agent (legacy) | `https://fsachat.fullsteamahead.ca` | **RETIRED 2026-06-13** — old GHL-iframe / client-v1 path. "Retired, no live traffic" was read as "harmless" for two months: until 2026-08-16 this host bypassed `requireAuth` **and** `requireActiveSubscription` entirely (`platformAuth` only ran auth when `Host` contained `learn.fullsteamahead.ca`), so it served the full paid library to anonymous callers over the public internet. `/api` now returns 421 on any non-platform host. Don't build against it, and don't assume a retired route is a closed one. |

## Testing Endpoints

Test against the live platform host (through Cloudflare), not `localhost`/container IPs:
```
curl https://learn.fullsteamahead.ca/api/<route>
```

## Docker Compose

- Both `api` and `ai-service` are built images (not bind-mounted volumes), so any code change requires a rebuild.
- **Do not pass `--env-file`.** Container env comes from `env_file:` in the compose: `/home/debian/.env.shared` then `/home/debian/fsa-agent/.env`. The old central `/home/debian/.env` is **retired** (env-split Step 10) — mode `000`, deleted 2026-08-27. Never source or pass it.
- **Cloudflare Workers hold their own copies of shared credentials** as Cloudflare secrets and do **not** read either env file. Rotating a secret in `.env.shared` must be followed by a `wrangler secret put` pass over `fsa-lead-capture` and `fsa-stripe-coupon`, or they keep using the revoked value.
- Python AI service:
  ```
  docker compose build ai-service && \
  docker compose up -d ai-service
  ```
- Node API + React client (build **client-v2** first — `client/` is dead v1):
  ```
  cd client-v2 && npm run build && cd .. && \
  docker compose build api && \
  docker compose up -d api
  ```

## Database

- PostgreSQL container: `fsa-postgres` (postgres:15-alpine), database `fsa_agent`.
- Run migrations via: `docker exec fsa-postgres psql -U postgres -d fsa_agent -f /path/to/migration.sql`
- Or pipe SQL directly: `docker exec fsa-postgres psql -U postgres -d fsa_agent -c "ALTER TABLE ..."`
