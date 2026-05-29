"""
Checkpoint agent — generates adaptive check-in messages for lesson pauses.
Uses OpenRouter (same pattern as other agents in this service).
"""
import os
import requests

_OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

_SYSTEM = (
    "You are a helpful Power Engineering instructor assistant. "
    "Your role is to briefly check in with a student who just completed a section of lesson content. "
    "Keep your message to 1-2 sentences. Be encouraging but honest. "
    "Do not start with 'I' or 'As your instructor'."
)


def generate_checkin(sections_covered: list[dict], correct_pct: float, question_count: int) -> str:
    """
    Generate a check-in message tailored to the student's recent performance.

    sections_covered: [{title, body}] — the sections just covered
    correct_pct: float 0.0–1.0 — fraction of recent checkpoint questions answered correctly
    question_count: int — how many checkpoint questions have been asked so far
    Returns: a short check-in message string.
    """
    api_key = os.getenv('OPENROUTER_API_KEY')
    model = os.getenv('OPENROUTER_MODEL', 'google/gemini-3-flash-preview')

    topics = ", ".join(s["title"] for s in sections_covered if s.get("title"))
    if not topics:
        topics = "the recent content"

    if question_count == 0:
        performance_note = "This is their first checkpoint."
    elif correct_pct >= 0.8:
        performance_note = f"They've answered {int(correct_pct * 100)}% of recent questions correctly — strong understanding."
    elif correct_pct >= 0.5:
        performance_note = f"They've answered {int(correct_pct * 100)}% of recent questions correctly — moderate understanding."
    else:
        performance_note = f"They've only answered {int(correct_pct * 100)}% of recent questions correctly — may be struggling."

    prompt = (
        f"The student just finished sections covering: {topics}. "
        f"{performance_note} "
        "Write a brief check-in message. "
        "If they're doing well, offer to keep going or try a challenge question. "
        "If they're struggling, be encouraging and invite them to ask questions."
    )

    try:
        response = requests.post(
            _OPENROUTER_URL,
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
            },
            json={
                'model': model,
                'max_tokens': 150,
                'messages': [
                    {'role': 'system', 'content': _SYSTEM},
                    {'role': 'user', 'content': prompt},
                ],
            },
            timeout=20,
        )
        response.raise_for_status()
        return response.json()['choices'][0]['message']['content'].strip()
    except Exception:
        return "Great work so far! Keep going, or ask me if anything needs clarification."
