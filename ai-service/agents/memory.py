"""
Tutor memory — what the tutor should remember about a student across
objectives and restarts (tutor_memory table, migration 025).

Before 2026-10-13 the tutor kept everything in per-objective, in-process state.
A student who asked to be called "Garlock" in 2B1-1-1 was, two objectives later,
told Garlock is a gasket manufacturer. Twice.

The record is deliberately small and structured: a preferred name, standing
preferences about how the tutor talks to them, and a few short notes. It is
rewritten by a cheap model pass over the latest exchanges, never by copying the
transcript in, so it cannot grow without bound or fill with chatter.
"""
import json
import re

MAX_PREFERENCES = 10
MAX_NOTES = 10
MAX_ITEM_CHARS = 140
MAX_NAME_CHARS = 40

# Phrases that usually mean the student is telling us something to remember.
# Checked on every turn so "call me Garlock" is stored at once, not on the
# next 3-exchange heartbeat (which a student who moves on never reaches).
_TRIGGERS = (
    'call me', 'my name', 'name is', 'nickname', "don't call", 'dont call',
    "don't use", 'dont use', 'stop using', 'stop calling', 'prefer', 'remember',
    'i work', 'i study', "i'm studying", 'im studying', 'i am studying',
    'my exam', 'please use',
)

EXTRACT_SYSTEM = (
    'You maintain a short memory file a tutor keeps about one student. '
    'Reply with JSON only, no prose and no code fences.'
)

EXTRACT_PROMPT = """Current memory (JSON):
{memory}

Latest exchanges between the student and the tutor:
{turns}

Return the UPDATED memory as JSON with exactly these keys:
- "preferred_name": what the student asked to be called, or null if they never said. Keep the existing value unless they asked for a change.
- "preferences": standing instructions about how the tutor should talk to them (e.g. "use my name sparingly", "keep answers short"). Max {max_prefs}, each under {max_chars} characters.
- "notes": durable facts useful to a tutor (e.g. "works at a pulp mill", "writing 2B1 in November", "found reheat cycles confusing"). Max {max_notes}, each under {max_chars} characters.

Only record what the STUDENT said or clearly asked for. Drop anything the student has since withdrawn. Do not record course content, questions they asked, anything one-off, or remarks about the tutor's own name. Names go only in preferred_name, never in notes, and never guess at a student's real name."""


def should_extract(message, exchange_count, interval=3):
    """True when this turn is worth a memory pass."""
    if exchange_count and exchange_count % interval == 0:
        return True
    text = f' {str(message or "").lower()} '
    return any(t in text for t in _TRIGGERS)


def _clean_list(items, cap):
    out = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, str):
            continue
        item = ' '.join(item.split())[:MAX_ITEM_CHARS]
        if item and item.lower() not in (o.lower() for o in out):
            out.append(item)
    return out[-cap:]


def normalise(raw):
    """Coerce a model reply (or a DB row) into the stored shape, with caps."""
    raw = raw if isinstance(raw, dict) else {}
    name = raw.get('preferred_name')
    name = ' '.join(name.split())[:MAX_NAME_CHARS] if isinstance(name, str) else None
    if name and name.lower() in ('null', 'none', 'undefined'):
        name = None
    return {
        'preferred_name': name or None,
        'preferences': _clean_list(raw.get('preferences'), MAX_PREFERENCES),
        'notes': _clean_list(raw.get('notes'), MAX_NOTES),
    }


def parse_reply(text):
    """Pull the JSON object out of a model reply. None if there isn't one."""
    if not text:
        return None
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except (ValueError, TypeError):
        return None


def build_extract_messages(memory, turns):
    rendered = '\n'.join(
        f'{"STUDENT" if t.get("role") == "user" else "TUTOR"}: {t.get("content", "")[:800]}'
        for t in turns
    )
    prompt = EXTRACT_PROMPT.format(
        memory=json.dumps(normalise(memory)),
        turns=rendered,
        max_prefs=MAX_PREFERENCES,
        max_notes=MAX_NOTES,
        max_chars=MAX_ITEM_CHARS,
    )
    return [
        {'role': 'system', 'content': EXTRACT_SYSTEM},
        {'role': 'user', 'content': prompt},
    ]
