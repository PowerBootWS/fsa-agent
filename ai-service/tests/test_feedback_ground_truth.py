"""FEEDBACK MODE is told the verdict instead of re-deriving it.

Practice questions are pre-generated multiple choice: every row in `questions`
carries an integer `correct_answer`, `_evaluate_practice_answer` grades against
it deterministically, and `TutorPanel.jsx` paints the right option green and a
wrong pick red before the server is even consulted. No model is involved in
deciding whether the student was right.

The tutor still wrote the feedback paragraph, and was told neither the correct
option nor the verdict — so on a calculation question it had to re-derive the
answer from scratch to have anything to say, and its independently-derived
verdict could contradict the highlight the student was looking at. The ground
truth was in the same state dict, two keys away.

The "do not reveal the answer" rule stays in force while a question is in play.
It is only lifted once the student has answered, when the answer is already on
her screen.
"""
import pytest

from agents import tutor_prompt
from agents.orchestrator import Orchestrator, _remember_current_question


QUESTION = {
    'question_text': 'A tank containing 2000 kg of water is heated from 25 °C to 75 °C. '
                     'Using a specific heat of 4.183 kJ/kg°C, how much heat energy, '
                     'in megajoules, is required?',
    'options': ['418.3 MJ', '420 MJ', '213.5 MJ', '627.45 MJ'],
    'correct_answer': 0,
}


def _state(answered, correct=None):
    state = {
        'activity': 'practice',
        'display_is_question': True,
        'awaiting_next_question': answered,
        'current_question_id': 13022,
        'current_question_correct_answer': QUESTION['correct_answer'],
    }
    _remember_current_question(state, QUESTION)
    if answered:
        state['last_answer_correct'] = correct
        state['last_answer_text'] = 'A' if correct else 'C'
    return state


def _prompt(state):
    return tutor_prompt.build({'lesson_code': '2A2-1-1', 'title': 'Heat calculations'},
                              None, state, 'Katrina')


class TestWhileTheQuestionIsInPlay:
    def test_the_correct_option_is_not_revealed(self):
        prompt = _prompt(_state(answered=False))
        assert 'THE CORRECT ANSWER IS' not in prompt

    def test_the_do_not_reveal_rule_is_still_stated(self):
        prompt = _prompt(_state(answered=False))
        assert 'never reveal' in prompt.lower() or 'do not reveal' in prompt.lower()


class TestOnceTheStudentHasAnswered:
    def test_the_correct_option_is_named(self):
        prompt = _prompt(_state(answered=True, correct=False))
        assert 'THE CORRECT ANSWER IS' in prompt
        assert 'A. 418.3 MJ' in prompt

    def test_a_wrong_answer_is_stated_as_established_fact(self):
        prompt = _prompt(_state(answered=True, correct=False))
        assert 'INCORRECT' in prompt

    def test_a_right_answer_is_stated_as_established_fact(self):
        prompt = _prompt(_state(answered=True, correct=True))
        assert 'That answer is CORRECT.' in prompt
        assert 'INCORRECT' not in prompt

    def test_the_model_is_told_not_to_praise_an_answer_that_was_wrong(self):
        """The eval's 'Exactly right!' hallucination, killed on this surface."""
        prompt = _prompt(_state(answered=True, correct=False))
        assert 'That answer is INCORRECT.' in prompt
        assert 'do not congratulate her on an answer she did not give' in prompt.lower()

    def test_the_model_is_told_not_to_re_derive_the_verdict(self):
        prompt = _prompt(_state(answered=True, correct=False))
        lowered = prompt.lower()
        assert 'do not re-derive' in lowered or 'do not recalculate' in lowered
        assert 'already been graded' in lowered

    def test_no_ground_truth_block_without_a_recorded_verdict(self):
        """A resumed session may have no verdict on state; say nothing rather than guess."""
        state = _state(answered=True)
        state.pop('last_answer_correct', None)
        assert 'THE CORRECT ANSWER IS' not in _prompt(state)


class TestTheGradedVerdictIsRecorded:
    @pytest.mark.parametrize('answer,expected', [('A', True), ('C', False)])
    def test_evaluate_records_the_verdict_for_the_prompt(self, answer, expected):
        orchestrator = Orchestrator()
        state = {
            'attempts': {}, 'questions_done': 0,
            'current_question_id': 13022,
            'current_question_correct_answer': 0,
        }
        orchestrator._evaluate_practice_answer(state, answer, {})
        assert state['last_answer_correct'] is expected
        assert state['last_answer_text'] == answer
