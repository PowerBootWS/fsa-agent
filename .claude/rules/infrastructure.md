# fsa-agent Infrastructure Rules

## Networking

- All containers run on the internal `fsa-network` Docker bridge.
- External access is via **Cloudflare Tunnel only** — direct IP or `localhost` hits will NOT reach the correct container.
- Any container that must be reachable from outside the server MUST be on the `cloudflare` Docker network in `docker-compose.yml`.
- Never attempt to test endpoints via `curl http://localhost:PORT` or `curl http://<container-ip>:PORT` — those bypass Cloudflare and will fail or hit the wrong service.

## URLs

| App | Public URL | Notes |
|-----|-----------|-------|
| fsa-agent (API + React) | `https://fsachat.fullsteamahead.ca` | Loaded in iframe from the course LMS; query strings appended by LMS |

## Testing Endpoints

To test an API endpoint during development, use:
```
curl https://fsachat.fullsteamahead.ca/api/<route>
```
Not `localhost` or container IPs.

## Docker Compose

- `docker compose build <service>` then `docker compose up -d <service>` to deploy changes.
- Both `api` and `ai-service` are built images (not bind-mounted volumes), so any code change requires a rebuild.
- Python AI service: `docker compose build ai-service && docker compose up -d ai-service`
- Node API + React client: build React first (`cd client && npm run build`), then `docker compose build api && docker compose up -d api`

## Database

- PostgreSQL container: `fsa-postgres` (postgres:15-alpine)
- Database name: from `$POSTGRES_DB` env var
- Run migrations via: `docker exec fsa-postgres psql -U postgres -d fsa_agent -f /path/to/migration.sql`
- Or pipe SQL directly: `docker exec fsa-postgres psql -U postgres -d fsa_agent -c "ALTER TABLE ..."`
