"""
Quick exercise — the check-in card's "Quick exercise with the tutor"
(lesson tutor redesign, slice 5).

The tutor asks multiple-choice questions on the slides a check-in covers, one
at a time. Each question comes back as a structured block the client renders
as a clickable card, so the tutor never again "puts a question up" that the
student can't see, and the client grades the click against the key the tutor
wrote. The exercise's progress (how many asked, how many right, what was just
picked) lives in the client and is sent with every turn, so nothing here
depends on in-process state surviving a restart.

A line format rather than JSON on purpose: questions carry LaTeX, and in JSON
"\\frac" is a valid escape (form feed + "rac"), so a model that forgets to
double its backslashes corrupts the formula silently.
"""
import re

MAX_QUESTIONS = 4

_BLOCK = re.compile(r'\[QUESTION\](.*?)\[/QUESTION\]', re.DOTALL | re.IGNORECASE)
_OPTION = re.compile(r'^\s*([A-D])[).:]\s*(.+?)\s*$', re.MULTILINE)
_LETTERS = 'ABCD'

FORMAT = """[QUESTION]
Q: <the question, self-contained>
A) <option>
B) <option>
C) <option>
D) <option>
ANSWER: <A, B, C or D>
WHY: <one or two sentences on why that answer is right, from the slides>
[/QUESTION]"""


def _int(value, lo, hi):
    return value if isinstance(value, int) and not isinstance(value, bool) and lo <= value <= hi else None


def sanitize(raw):
    """The exercise state the client sent, shape-checked. None if absent or unusable."""
    if not isinstance(raw, dict):
        return None
    from_slide = _int(raw.get('from_slide'), 0, 10000)
    after_slide = _int(raw.get('after_slide'), 0, 10000)
    if from_slide is None or after_slide is None or after_slide < from_slide:
        return None
    out = {
        'from_slide': from_slide,
        'after_slide': after_slide,
        'asked': _int(raw.get('asked'), 0, 50) or 0,
        'correct': _int(raw.get('correct'), 0, 50) or 0,
        'recap_points': [p for p in (raw.get('recap_points') or []) if isinstance(p, str)][:6],
        'last': None,
    }
    last = raw.get('last')
    if isinstance(last, dict) and isinstance(last.get('question_text'), str):
        options = [o for o in (last.get('options') or []) if isinstance(o, str)]
        correct = _int(last.get('correct_index'), 0, 3)
        selected = _int(last.get('selected_index'), 0, 3)
        if len(options) == 4 and correct is not None and selected is not None:
            out['last'] = {
                'question_text': last['question_text'],
                'options': options,
                'correct_index': correct,
                'selected_index': selected,
                'explanation': last.get('explanation') if isinstance(last.get('explanation'), str) else '',
            }
    return out


def parse_reply(text):
    """
    Split a tutor reply into (message, question). `question` is
    {question_text, options[4], correct_answer, explanation} or None when the
    reply has no block, or a block that doesn't hold exactly four options and
    a valid answer — a malformed card is worse than no card.
    """
    text = text or ''
    match = _BLOCK.search(text)
    if not match:
        return text.strip(), None
    message = (text[:match.start()] + text[match.end():]).strip()
    block = match.group(1)

    q = re.search(r'^\s*Q:\s*(.+?)(?=^\s*A[).:])', block, re.MULTILINE | re.DOTALL)
    options = {m.group(1).upper(): m.group(2) for m in _OPTION.finditer(block)}
    answer = re.search(r'^\s*ANSWER:\s*\(?([A-D])\)?', block, re.MULTILINE | re.IGNORECASE)
    why = re.search(r'^\s*WHY:\s*(.+)', block, re.MULTILINE | re.DOTALL)
    if not q or not answer or sorted(options) != list(_LETTERS):
        return message, None
    return message, {
        'question_text': ' '.join(q.group(1).split()),
        'options': [options[letter] for letter in _LETTERS],
        'correct_answer': _LETTERS.index(answer.group(1).upper()),
        'explanation': ' '.join(why.group(1).split()) if why else '',
    }


def as_text(message, question):
    """Readable form of a turn for the transcript, so later turns and the
    saved conversation show the question as the student saw it."""
    if not question:
        return message
    lines = [message, '', question['question_text']] if message else [question['question_text']]
    lines += [f'{_LETTERS[i]}) {opt}' for i, opt in enumerate(question['options'])]
    return '\n'.join(lines)


def describe_last(last):
    """The student's latest pick, stated as graded fact for the prompt."""
    if not last:
        return ''
    picked = _LETTERS[last['selected_index']]
    right = _LETTERS[last['correct_index']]
    verdict = 'CORRECT' if last['selected_index'] == last['correct_index'] else 'INCORRECT'
    lines = [
        f'The student just answered your question: "{last["question_text"]}"',
        *[f'  {_LETTERS[i]}) {o}' for i, o in enumerate(last['options'])],
        f'They picked {picked}. That is {verdict}. The keyed answer is {right}.',
    ]
    if last.get('explanation'):
        lines.append(f'Your own explanation when you wrote it: {last["explanation"]}')
    return '\n'.join(lines)
