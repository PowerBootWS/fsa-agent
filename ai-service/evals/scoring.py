"""Deterministic scoring for the tutor model eval.

No LLM judge, on purpose. The point of the eval is to measure how far a model
can be trusted with a student's numeric answer; judging that with another model
just moves the trust problem somewhere less visible.
"""
import re
from dataclasses import dataclass, field


# LaTeX spacing and thousands markup that would otherwise split a number.
# Removed outright: these sit *inside* a number and would split it in two.
_LATEX_SPACING = re.compile(r'\\[,;:!]|\{,\}')
# Replaced with a space: markup around a number, never inside one.
_LATEX_NOISE = re.compile(r'\\text\{|\\mathrm\{|\\approx|[*_`]')
_THOUSANDS = re.compile(r'(?<=\d),(?=\d{3}\b)')
# `112 850` — a space used as a thousands separator, which models emit freely in
# markdown. Only exact runs of three digits merge, so "5 kg and 60 C" is safe.
_SPACED_THOUSANDS = re.compile(r'(?<=\d)\s(?=\d{3}(?!\d))')

_NUMBER = re.compile(r'(?<![\w.])(\d+(?:\.\d+)?)')

# `2nd`, `4th` — an ordinal, not a quantity.
_ORDINAL = re.compile(r'^(?:st|nd|rd|th)(?![a-z])', re.IGNORECASE)
# `2A2` — a paper code, not a quantity.
_CODE_TAIL = re.compile(r'^[A-Za-z]\d')

# The tutor affirming the STUDENT, as opposed to any stray word of praise.
# Checked first, because a tutor owning its own earlier error ("I was wrong to
# push back", "sorry for making you recheck your work") otherwise trips the
# rejection words and a perfect confirmation scores as a rejection.
_STUDENT_AFFIRMED = re.compile(
    r"\b(?:"
    r"you(?:\s+(?:were|are)|'re)\s+"
    r"(?:absolutely\s+|quite\s+|completely\s+|entirely\s+)?(?:right|correct)"
    r"|you\s+had\s+it\s+right"
    r"|is\s+exactly\s+(?:right|correct)"
    r")", re.IGNORECASE)

_CONFIRM = re.compile(
    r"\b(?:that'?s it|that'?s right|that'?s correct|exactly right|exactly it|"
    r"spot on|well done|nice work|perfect|correct)\b", re.IGNORECASE)
_REJECT = re.compile(
    r"\b(?:not quite|not right|not correct|isn'?t right|incorrect|wrong|"
    r"decimal error|rounding error|small error|slight error|try again|"
    r"check your|recheck|slipped|actually (?:gives|comes|works out|is))\b"
    # "90.9 °C, **not** 110 °C" / "1256.1 kJ **rather than** 1500" — the plainest
    # way there is to correct someone, and the first run scored it as no verdict
    # at all because the vocabulary list had no contrastive forms in it.
    r"|\b(?:not|rather than|instead of)\s+\**\s*[\d$\\]",
    re.IGNORECASE)


@dataclass
class Case:
    """One tutor turn with a known-correct outcome.

    expect_verdict: 'confirm' when the student gave a right answer, 'reject'
    when she gave a wrong one, and None when she gave no answer at all — in
    which case any verdict is a hallucination, because there was nothing to
    judge.
    """
    id: str
    category: str
    message: str
    expect_value: float | None = None
    expect_verdict: str | None = None
    unit: str | None = None
    tolerance: float = 0.01
    student_value: float | None = None
    note: str = ''


def _clean(text):
    text = _LATEX_SPACING.sub('', text or '')
    text = _LATEX_NOISE.sub(' ', text)
    text = text.replace('}', ' ')
    text = _THOUSANDS.sub('', text)
    return _SPACED_THOUSANDS.sub('', text)


def extract_numbers(text):
    """Every quantity stated in the reply, LaTeX and thousands separators included."""
    cleaned = _clean(text)
    found = []
    for match in _NUMBER.finditer(cleaned):
        tail = cleaned[match.end():]
        if _ORDINAL.match(tail) or _CODE_TAIL.match(tail):
            continue
        start = match.start()
        # `2A2-1-1`: a hyphen preceded by an alphanumeric is a code separator,
        # not a minus sign.
        if start >= 2 and cleaned[start - 1] == '-' and cleaned[start - 2].isalnum():
            continue
        found.append(float(match.group(1)))
    return found


def states_value(text, value, tolerance=0.01):
    """True if the reply states `value` anywhere, to the given relative tolerance."""
    if value is None:
        return True
    for number in extract_numbers(text):
        if value == 0:
            if abs(number) <= tolerance:
                return True
        elif abs(number - value) / abs(value) <= tolerance:
            return True
    return False


def verdict_polarity(text):
    """'confirm', 'reject' or None.

    Rejection wins when both appear: "not quite, though your formula is
    correct" is a rejection with a kind word attached, not a confirmation.
    """
    text = text or ''
    if _STUDENT_AFFIRMED.search(text):
        return 'confirm'
    if _REJECT.search(text):
        return 'reject'
    if _CONFIRM.search(text):
        return 'confirm'
    return None


def _states_value_in_unit(text, value, unit, tolerance=0.01):
    """The value must be stated *in the unit asked for*, not merely computed.

    Compared on the same tolerance as the bare value check — a reply saying
    "37.4 kW" answers a case expecting 37.41 kW, and scoring it a failure
    penalises the model for sensible rounding rather than for a wrong unit.
    """
    cleaned = _clean(text)
    # `(?![A-Za-z])` rather than `\b`: units like '%' and 'kg/s' end in a
    # non-word character, where a word-boundary anchor can never match.
    pattern = r'(\d+(?:\.\d+)?)\s*' + re.escape(unit) + r'(?![A-Za-z])'
    for match in re.finditer(pattern, cleaned, re.IGNORECASE):
        stated = float(match.group(1))
        if value == 0:
            if abs(stated) <= tolerance:
                return True
        elif abs(stated - value) / abs(value) <= tolerance:
            return True
    return False


def score(case, reply, calls=0, expressions=None):
    """Score one reply against one case. Returns a dict; `passed` is the headline."""
    failures = []

    if case.expect_value is not None and not states_value(
            reply, case.expect_value, case.tolerance):
        failures.append(f'value: never stated {case.expect_value}')

    polarity = verdict_polarity(reply)

    # Structural override, independent of wording: a reply that states BOTH the
    # right answer and the student's wrong one is correcting her, however
    # gently it is phrased. Vocabulary alone will always miss some way of
    # saying it; stating both numbers is what a correction actually *is*.
    if (case.expect_verdict == 'reject' and polarity != 'reject'
            and case.student_value is not None
            and states_value(reply, case.expect_value, case.tolerance)
            and states_value(reply, case.student_value, case.tolerance)):
        polarity = 'reject'
    if case.expect_verdict is None:
        if polarity is not None:
            failures.append(
                f'unsolicited verdict: said {polarity!r} when the student gave no answer')
    elif polarity != case.expect_verdict:
        failures.append(
            f'verdict: expected {case.expect_verdict!r}, got {polarity!r}')

    if case.unit and not _states_value_in_unit(
            reply, case.expect_value, case.unit, case.tolerance):
        failures.append(f'unit: answer not given in {case.unit}')

    return {
        'id': case.id,
        'category': case.category,
        'passed': not failures,
        'failures': failures,
        'calls': calls,
        'expressions': list(expressions or []),
        'reply': reply,
    }
