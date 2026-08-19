"""
Checkpoint agent — generates adaptive check-in messages for lesson pauses.
Uses OpenRouter (same pattern as other agents in this service).
"""
import os
import requests

_OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

# The caller always renders a practice question directly beneath this message,
# so the message must introduce it, not offer it. The earlier wording asked
# "would you like to try a practice question?" and the question then appeared
# regardless — which read as the question being part of the slide rather than a
# separate exercise.
_SYSTEM = (
    "You are a helpful Power Engineering instructor assistant. "
    "Your role is to briefly check in with a student who just finished watching a portion of the lesson. "
    "A separate practice question is shown directly below your message, so introduce it as an extra "
    "question on the same topic for them to try themselves — never as the worked example they were "
    "just shown, and never as something they can opt out of receiving. "
    "Also invite them to say if anything in that content didn't make sense. "
    "End with a short prompt to click Next if they're good to keep going. "
    "Keep your message to 2-3 sentences. Be encouraging but concise. "
    "Do not reference 'sections' or tell them to move to the next section. "
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
        "Introduce the practice question shown below your message as a separate question on the same "
        "topic for them to work through themselves — it is not the worked example from the lesson. "
        "Invite them to say if anything in that content didn't make sense or needs clarification. "
        "End with: if they're good, they can click Next to continue through the content. "
        "Do not mention moving to the next section."
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
        return ("Nice work! Here's a separate practice question on the same topic — give it a try "
                "yourself. If anything in that content didn't quite click, just ask. Otherwise click "
                "Next to keep going.")
