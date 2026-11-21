"""Staged calculation questions: the tutor must put step 1's formula choices in front of
the student itself. Since 2026-11-20 the question panel shows the final numeric answers
(the exam-facing options), and step 1 stores its choices under 'options' — the prompt
read 'formula_options', which no question has, so it always passed an empty list."""
from agents.tutor_prompt import _build_staged_problem_block

FORMULAS = ["Nr = Ns × (1 + s)", "Nr = Ns − s", "Nr = Ns × (1 − s)", "Nr = Ns × s"]


def _state(step1):
    return {"staged_step": 1, "staged_context": {"step_data": {"steps": [
        step1, {"type": "final_answer", "options": ["1128 r/min", "1", "2", "3"], "correct": 0}]}}}


def test_formula_step_presents_the_stored_options():
    block = _build_staged_problem_block(_state({"type": "formula_choice", "options": FORMULAS, "correct": 2}))
    assert "Nr = Ns × (1 − s)" in block


def test_formula_options_key_still_wins_when_present():
    block = _build_staged_problem_block(_state({"type": "formula_choice", "formula_options": ["F = ma"], "correct": 0}))
    assert "F = ma" in block
