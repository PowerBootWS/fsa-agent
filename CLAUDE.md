# fsa-agent Project

Full Steam Ahead Agent - Interactive learning platform for Power Engineers in Canada.

## Architecture

```
fsa-agent (parent)
├── server/       - Express.js API backend
├── client/       - React frontend (served by Express)
├── ai-service/   - Python AI agent service
├── docs/         - Design specs and documentation
└── docker-compose.yml
```

## Multi-Session Work

This project will be built over multiple sessions. Track progress using:
- TodoWrite for current implementation tasks
- Project memory for context that spans sessions
- SPEC.md in docs/ contains the design baseline

## Key Design Decisions

1. **Express + Python** - Backend API in Node.js, AI service in Python
2. **PostgreSQL** - Existing container at ~/postgres
3. **Security** - All DB access via backend API, not exposed to frontend
4. **Iframe-only** - Validates parent domain, CORS restricted

## Agent System

- **Orchestrator** - Central coordinator, tracks progress/scoring
- **Tutor Agent** - User interaction, feedback, guidance
- **Researcher** - Fetches lesson content from PostgreSQL
- **Display Agent** - Manages top section of Tab 2

## Environment

See .env.example for required variables. Key vars:
- PARENT_DOMAIN - Allowed iframe parent domain
- POSTGRES_* - Database connection
- PYTHON_SERVICE_URL - Internal URL to AI service