"""Randomise where the correct answer sits in a multiple-choice question.

Content audit 2026-10-21: the question generator (an LLM) put the correct answer
at B about half the time and at D almost never (2-6%), across all 9,444 questions.
Options were served in stored order, so "always pick B, never D" beat chance, and a
practice-exam score overstated readiness for the real SOPEEC paper, which has no
such pattern. Every insert path calls shuffle_options() before writing.

Questions whose wording depends on option position are left alone: an option like
"All of the above" or "A and B", or a question or explanation that names an
option by letter ("option C", "(B)").
"""
import random
import re

_POSITION_WORDS = re.compile(r'(all of the above|none of the above|both [a-d] and|\b[a-d] and [a-d]\b)', re.I)
_LETTER_REF = re.compile(r'(\b(?i:option|answer|choice) [A-D]\b|\([A-D]\)|\b[A-D]\) )')


def position_dependent(options, question_text='', explanation=''):
    if any(_POSITION_WORDS.search(str(o)) for o in options):
        return True
    return bool(_LETTER_REF.search(question_text or '') or _LETTER_REF.search(explanation or ''))


def shuffle_options(options, correct_answer, question_text='', explanation='', rng=None):
    """Return (options, correct_answer) with the options in random order.

    The correct option's TEXT is unchanged; only its position moves. Unchanged
    if the question is position-dependent or the input is malformed.
    """
    if not isinstance(options, list) or len(options) < 2:
        return options, correct_answer
    if not isinstance(correct_answer, int) or not 0 <= correct_answer < len(options):
        return options, correct_answer
    if position_dependent(options, question_text, explanation):
        return options, correct_answer
    rng = rng or random
    order = list(range(len(options)))
    rng.shuffle(order)
    return [options[i] for i in order], order.index(correct_answer)
