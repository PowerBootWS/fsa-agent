"""Backlog #97 — the tutor could not do arithmetic reliably and nothing checked it.

Katrina (2A2) answered a heat-energy problem correctly — 5 kg x 4.187 kJ/kg.C x 60 C
= 1256.1 kJ — gave `1256.1` four separate times, and was told each time she had "a
small decimal error", then in the same breath that the answer "should actually be
1256.1". Prompt hardening shipped 2026-08-19 lowered the rate but left the model both
posing and grading its own arithmetic.

These tests cover the calculator tool the tutor must use before asserting any numeric
judgement, and the guard that catches a judgement made without one.
"""
import pytest

from agents import calculator


class TestEvaluator:
    @pytest.mark.parametrize('expression,expected', [
        ('5 * 4.187 * 60', 1256.1),
        ('2 + 3', 5),
        ('10 / 4', 2.5),
        ('(2 + 3) * 4', 20),
        ('2 ** 10', 1024),
        ('-7 + 2', -5),
        ('sqrt(144)', 12),
        ('round(1256.0999999999999, 1)', 1256.1),
    ])
    def test_evaluates_arithmetic(self, expression, expected):
        result = calculator.evaluate(expression)
        assert result['ok'] is True, result
        assert result['result'] == pytest.approx(expected)

    def test_katrina_heat_energy_problem(self):
        """The exact calculation she was told was wrong, four times."""
        result = calculator.evaluate('5 * 4.187 * 60')
        assert result['ok'] is True
        assert result['result'] == pytest.approx(1256.1)

    def test_float_noise_is_not_shown_to_the_student(self):
        """0.1 + 0.2 must not come back as 0.30000000000000004."""
        result = calculator.evaluate('0.1 + 0.2')
        assert result['ok'] is True
        assert str(result['result']) == '0.3'

    @pytest.mark.parametrize('expression', [
        '__import__("os").system("id")',
        'open("/etc/passwd").read()',
        'x + 1',
        '[i for i in range(10)]',
        '(1).__class__',
        'lambda: 1',
    ])
    def test_rejects_anything_that_is_not_arithmetic(self, expression):
        result = calculator.evaluate(expression)
        assert result['ok'] is False
        assert result.get('error')

    def test_rejects_oversized_exponent(self):
        """9**9**9 would hang the container, not calculate anything."""
        result = calculator.evaluate('9 ** 9 ** 9')
        assert result['ok'] is False

    def test_rejects_overlong_expression(self):
        result = calculator.evaluate('1+' * 5000 + '1')
        assert result['ok'] is False

    def test_division_by_zero_is_an_error_not_a_crash(self):
        result = calculator.evaluate('5 / 0')
        assert result['ok'] is False
        assert result.get('error')

    def test_syntax_error_is_an_error_not_a_crash(self):
        result = calculator.evaluate('5 * * 4')
        assert result['ok'] is False


# ---------------------------------------------------------------------------
# The tool loop and the verify-before-judge guard.
#
# Every test below drives TutorAgent.respond() with the OpenRouter HTTP layer
# replaced, so nothing here reaches the network.
# ---------------------------------------------------------------------------
import json
from unittest.mock import MagicMock

from agents import tutor as tutor_module
from agents.tutor import TutorAgent


def _tool_call(expression, call_id='call_1'):
    return {'choices': [{'message': {
        'role': 'assistant',
        'content': None,
        'tool_calls': [{
            'id': call_id,
            'type': 'function',
            'function': {'name': 'calculate',
                         'arguments': json.dumps({'expression': expression})},
        }],
    }}]}


def _final(text):
    return {'choices': [{'message': {'role': 'assistant', 'content': text}}]}


def _agent(monkeypatch, *payloads):
    """A TutorAgent whose session returns `payloads` in order. Returns (agent, posts)."""
    monkeypatch.setattr(tutor_module, 'CALCULATOR_ENABLED', True)
    agent = TutorAgent()
    queue = list(payloads)
    posts = []

    def fake_post(url, json=None, timeout=None, **kwargs):
        posts.append(json)
        response = MagicMock()
        response.raise_for_status.return_value = None
        response.json.return_value = queue.pop(0) if queue else _final('(exhausted)')
        return response

    agent.session.post = fake_post
    return agent, posts


def _respond(agent, user_message, state=None):
    return agent.respond(
        user_message,
        lesson_context={'lesson_code': '2A2-1-1', 'title': 'Heat calculations'},
        progress=None,
        state=state if state is not None else {},
        first_name='Katrina',
    )


class TestToolLoop:
    def test_calculator_is_offered_to_the_model(self, monkeypatch):
        agent, posts = _agent(monkeypatch, _final('Hello.'))
        _respond(agent, 'hi')
        names = [t['function']['name'] for t in posts[0]['tools']]
        assert 'calculate' in names

    def test_tool_result_is_fed_back_and_the_final_answer_returned(self, monkeypatch):
        agent, posts = _agent(
            monkeypatch,
            _tool_call('5 * 4.187 * 60'),
            _final("That's it, 1256.1 kJ."),
        )
        result = _respond(agent, 'I make it 1256.1 kJ')

        assert result['response'] == "That's it, 1256.1 kJ."
        assert len(posts) == 2
        tool_messages = [m for m in posts[1]['messages'] if m.get('role') == 'tool']
        assert tool_messages, 'the tool result was never sent back to the model'
        assert '1256.1' in tool_messages[0]['content']

    def test_ordinary_turn_costs_one_api_call(self, monkeypatch):
        agent, posts = _agent(monkeypatch, _final('Good question. Steam is water vapour.'))
        _respond(agent, 'what is steam?')
        assert len(posts) == 1

    def test_a_broken_expression_is_reported_to_the_model_not_crashed(self, monkeypatch):
        agent, posts = _agent(
            monkeypatch,
            _tool_call('5 / 0'),
            _final('Let me look at that again.'),
        )
        result = _respond(agent, 'is 5/0 = 0?')
        assert result['response'] == 'Let me look at that again.'
        tool_messages = [m for m in posts[1]['messages'] if m.get('role') == 'tool']
        assert 'division by zero' in tool_messages[0]['content']

    def test_the_loop_cannot_run_away(self, monkeypatch):
        """A model that only ever emits tool calls must still terminate."""
        agent, posts = _agent(monkeypatch, *[_tool_call('1 + 1', f'c{i}') for i in range(20)])
        _respond(agent, 'what is 1 + 1?')
        assert len(posts) <= tutor_module.MAX_API_CALLS_PER_TURN


class TestVerifyBeforeJudgeGuard:
    def test_verdict_without_a_calculation_forces_a_second_pass(self, monkeypatch):
        agent, posts = _agent(
            monkeypatch,
            _final("That's not quite right, there's a small decimal error."),
            _tool_call('5 * 4.187 * 60'),
            _final("You're right, 1256.1 kJ."),
        )
        result = _respond(agent, 'I get 1256.1 kJ')

        forced = [p for p in posts if p.get('tool_choice')]
        assert forced, 'the guard never forced the calculator'
        assert forced[0]['tool_choice']['function']['name'] == 'calculate'
        assert result['response'] == "You're right, 1256.1 kJ."

    def test_guard_stays_out_of_ordinary_conversation(self, monkeypatch):
        agent, posts = _agent(monkeypatch, _final("That's right, superheat is exactly that."))
        _respond(agent, 'so superheat is heat added above saturation?')
        assert len(posts) == 1, 'a turn with no student number must not be re-run'

    def test_no_second_pass_when_the_model_already_calculated(self, monkeypatch):
        agent, posts = _agent(
            monkeypatch,
            _tool_call('5 * 4.187 * 60'),
            _final("Not quite — I make it 1256.1 kJ, you said 1200."),
        )
        _respond(agent, 'I get 1200 kJ')
        assert not any(p.get('tool_choice') for p in posts)

    def test_confirming_verdicts_are_guarded_too(self, monkeypatch):
        """Confirming a wrong answer breaks trust the same way as rejecting a right one."""
        agent, posts = _agent(
            monkeypatch,
            _final("That's exactly right, well done."),
            _tool_call('5 * 4.187 * 60'),
            _final("Actually I make it 1256.1 kJ, not 1500."),
        )
        _respond(agent, 'is it 1500 kJ?')
        assert any(p.get('tool_choice') for p in posts)


class TestFallbackWhenTheForcedPassFails:
    def test_uncomputed_verdict_is_stripped_and_the_teaching_kept(self, monkeypatch):
        verdict = ("That's not quite right, there's a small decimal error. "
                   "Sensible heat is mass times specific heat times temperature rise.")
        agent, _ = _agent(monkeypatch, _final(verdict), _final(verdict))
        result = _respond(agent, 'I get 1256.1 kJ')

        assert 'small decimal error' not in result['response']
        assert 'Sensible heat is mass times specific heat' in result['response']
        assert 'walk me through' in result['response'].lower()

    def test_a_reply_that_is_only_a_verdict_still_says_something_useful(self, monkeypatch):
        agent, _ = _agent(monkeypatch, _final('Not quite, try again.'), _final('Not quite, try again.'))
        result = _respond(agent, 'I get 1256.1')
        assert 'try again' not in result['response'].lower()
        assert result['response'].strip()

    def test_katrina_regression_a_correct_answer_is_never_called_wrong(self, monkeypatch):
        """5 kg x 4.187 kJ/kg.C x 60 C = 1256.1 kJ. She gave 1256.1 four times."""
        agent, _ = _agent(
            monkeypatch,
            _final("You have a small decimal error — check your calculator."),
            _final("You have a small decimal error — check your calculator."),
        )
        result = _respond(agent, 'The answer is 1256.1 kJ')
        assert 'decimal error' not in result['response']
        assert 'check your calculator' not in result['response']


class TestKillSwitch:
    def test_calculator_can_be_turned_off_without_a_rebuild(self, monkeypatch):
        monkeypatch.setattr(tutor_module, 'CALCULATOR_ENABLED', False)
        agent = TutorAgent()
        posts = []

        def fake_post(url, json=None, timeout=None, **kwargs):
            posts.append(json)
            response = MagicMock()
            response.raise_for_status.return_value = None
            response.json.return_value = _final('Not quite right.')
            return response

        agent.session.post = fake_post
        _respond(agent, 'I get 1256.1')

        assert 'tools' not in posts[0]
        assert len(posts) == 1


class TestPromptLatexExample:
    """Found while working #97, pre-existing and unrelated to the calculator.

    The BEHAVIOUR RULES prompt is a plain (non-raw) f-string, so the `\\frac` in
    its own worked LaTeX example was read by Python as the `\\f` escape — a form
    feed — and the model has been shown `\\x0crac{P_1}{T_1}` on every tutor turn
    while being told to write `$\\frac{...}$`. The instruction demonstrated the
    opposite of the rule it states.
    """

    def test_latex_example_reaches_the_model_intact(self):
        from agents import tutor_prompt

        prompt = tutor_prompt.build(
            {'lesson_code': '2A2-1-1', 'title': 'Heat calculations'}, None, {}, 'Katrina')

        assert '\\frac' in prompt
        assert '\x0c' not in prompt, 'a form feed reached the prompt (\\f from \\frac)'
