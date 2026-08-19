"""Regressions from Katrina's 2026-08-18 report.

1. The profanity gate matched bare substrings, so ordinary Power Engineering
   vocabulary tripped it — 'brass'/'mass'/'class' all contain 'ass'. Pasting a
   question about brass warned her, and pasting it again ended her session.
2. The tutor's system prompt said "a question is on display" but never said
   WHICH question, so follow-ups were answered against earlier chat.
"""
import pytest

from agents import tutor as tutor_module
from agents.tutor import PROFANITY_RE, TutorAgent
from agents import tutor_prompt
from agents.orchestrator import _remember_current_question


CLEAN = [
    '600 kg of brass (specific heat 0.383 kJ/kg°C) is mixed intimately with '
    '400 kg of aluminum (specific heat 0.909 kJ/kg°C). What is the specific '
    'heat capacity of the mixture?',
    'what is the mass flow rate through the superheater',
    'I am studying 2nd Class Part A2',
    'the gasses expand through the turbine',
    'we sent the scrap to the yard',
    'open the gauge cocks on the water column',
    'check the try cock and the drain cock',
    'assume steady state across the assembly',
    'glass wool insulation on the compass housing',
    'bypass the classification for now',
]

DIRTY = [
    'this is fucking broken',
    'you are an ass',
    'that answer is crap',
    'shitty question',
    'bullshit',
    'dumbass',
]


@pytest.mark.parametrize('text', CLEAN)
def test_domain_vocabulary_is_not_profanity(text):
    assert PROFANITY_RE.search(text) is None, f'false positive on: {text}'


@pytest.mark.parametrize('text', DIRTY)
def test_real_profanity_still_caught(text):
    assert PROFANITY_RE.search(text) is not None


def test_brass_question_does_not_warn_or_end_session():
    agent = TutorAgent.__new__(TutorAgent)  # no API key needed for this path
    state = {'profanity_count': 0}
    msg = CLEAN[0]
    assert agent._check_profanity(msg, state) is None
    assert state['profanity_count'] == 0
    # Second paste of the same text must not end the session either.
    assert agent._check_profanity(msg, state) is None


def test_profanity_filter_is_disabled_by_default():
    """Owner decision 2026-08-19: the gate must never warn or end a session."""
    assert tutor_module.PROFANITY_FILTER_ENABLED is False


@pytest.mark.parametrize('text', DIRTY)
def test_real_profanity_passes_through_when_filter_disabled(text):
    agent = TutorAgent.__new__(TutorAgent)
    state = {'profanity_count': 0}
    # Same message twice: still no warning, no stop, no state mutation.
    assert agent._check_profanity(text, state) is None
    assert agent._check_profanity(text, state) is None
    assert state['profanity_count'] == 0


def test_filter_still_works_when_explicitly_re_enabled(monkeypatch):
    monkeypatch.setattr(tutor_module, 'PROFANITY_FILTER_ENABLED', True)
    agent = TutorAgent.__new__(TutorAgent)
    state = {'profanity_count': 0}
    first = agent._check_profanity('this is fucking broken', state)
    assert first['action'] == 'warning'
    second = agent._check_profanity('this is fucking broken', state)
    assert second['action'] == 'stop'
    # And clean domain vocabulary is still clean even when enabled.
    assert agent._check_profanity(CLEAN[0], {'profanity_count': 0}) is None


def test_remember_current_question_populates_state():
    state = {}
    _remember_current_question(state, {
        'question_text': 'What is the specific heat capacity of the mixture?',
        'options': ['0.5934 kJ/kg°C', '0.6986 kJ/kg°C', '0.646 kJ/kg°C', '1.292 kJ/kg°C'],
    })
    assert state['current_question_text'].startswith('What is the specific heat')
    assert state['current_question_options'][0] == 'A. 0.5934 kJ/kg°C'
    assert state['current_question_options'][3] == 'D. 1.292 kJ/kg°C'


def test_display_panel_note_includes_the_actual_question():
    state = {}
    _remember_current_question(state, {
        'question_text': '600 kg of brass is mixed with 400 kg of aluminum.',
        'options': ['0.5934 kJ/kg°C', '0.6986 kJ/kg°C'],
    })
    note = tutor_prompt._build_display_panel_note('practice', False, state)
    assert '600 kg of brass' in note
    assert 'A. 0.5934 kJ/kg°C' in note


def test_display_panel_note_survives_missing_question():
    note = tutor_prompt._build_display_panel_note('practice', False, {})
    assert 'DISPLAY PANEL' in note
    note_none = tutor_prompt._build_display_panel_note('practice', True, None)
    assert 'DISPLAY PANEL' in note_none
