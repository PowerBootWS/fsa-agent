# Pinned to the Debian codename (not floating `slim`) — `slim` silently rolled onto
# trixie and renamed libgdk-pixbuf2.0-0, breaking the apt-get step below.
FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libharfbuzz0b \
    libcairo2 \
    libgdk-pixbuf2.0-0 \
    libffi-dev \
    shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

# gunicorn instead of Flask's development server (audit A4, 2026-10-21).
# ONE worker on purpose: the tutor keeps each student's conversation state in
# memory (Orchestrator.conversation_state), so a second worker process would
# split a student's session between two copies. Threads give the concurrency
# the dev server's threaded mode gave. The worker timeout only fires if the
# whole process hangs; gthread heartbeats from its main loop, so a long tutor
# or resume call does not trip it.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "16", "--worker-class", "gthread", "--timeout", "600", "--graceful-timeout", "30", "--access-logfile", "-", "app:app"]
