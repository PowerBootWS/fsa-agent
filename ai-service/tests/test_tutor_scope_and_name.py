"""
Regression tests for the two faults Katrina reported on 2026-08-09:

  1. The tutor greeted her by her surname ("Hi Kromanoff") because
     get_user_by_email only looked in the legacy `users` table, which has no
     row for most platform students, and fell through to an email-derived
     fallback.
  2. The tutor refused to recap a concept the lesson referenced but did not
     teach, because the prompt fenced it inside the current lesson's content.
"""
import sys, os
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.researcher import Researcher
from agents.orchestrator import Orchestrator
from agents import tutor_prompt


def make_researcher():
    r = Researcher.__new__(Researcher)
    r.db_config = {}
    return r


def make_conn(fetchone_by_call=None, fetchall_rows=None):
    """Cursor whose fetchone() returns a different row per successive call."""
    cursor = MagicMock()
    if fetchone_by_call is not None:
        cursor.fetchone.side_effect = list(fetchone_by_call)
    if fetchall_rows is not None:
        cursor.fetchall.return_value = fetchall_rows
    conn = MagicMock()
    conn.cursor.return_value = cursor
    return conn, cursor


# ----------------------------------------------------------------------
# 1. Name resolution
# ----------------------------------------------------------------------

def test_first_name_comes_from_platform_users():
    r = make_researcher()
    conn, cursor = make_conn(fetchone_by_call=[
        {'first_name': 'Katrina', 'email': 'kromanoff@hotmail.com'},
    ])
    with patch.object(r, '_get_connection', return_value=conn):
        result = r.get_user_by_email('kromanoff@hotmail.com')

    assert result['first_name'] == 'Katrina'
    # platform_users must be the FIRST table queried, not a fallback
    assert 'platform_users' in cursor.execute.call_args_list[0][0][0]


def test_falls_back_to_legacy_users_table_when_no_platform_row():
    r = make_researcher()
    conn, cursor = make_conn(fetchone_by_call=[
        None,                                            # platform_users miss
        {'first_name': 'Russ', 'email': 'russ@fsa.ca'},  # legacy users hit
    ])
    with patch.object(r, '_get_connection', return_value=conn):
        result = r.get_user_by_email('russ@fsa.ca')

    assert result['first_name'] == 'Russ'


def test_email_derived_name_is_last_resort_only():
    r = make_researcher()
    conn, _ = make_conn(fetchone_by_call=[None, None])
    with patch.object(r, '_get_connection', return_value=conn):
        result = r.get_user_by_email('kromanoff@hotmail.com')

    # Still a surname — but only reached when the student exists in neither table
    assert result['first_name'] == 'Kromanoff'


def test_blank_stored_name_does_not_win_over_later_source():
    r = make_researcher()
    conn, _ = make_conn(fetchone_by_call=[
        {'first_name': '   ', 'email': 'a@b.ca'},
        {'first_name': 'Dale', 'email': 'a@b.ca'},
    ])
    with patch.object(r, '_get_connection', return_value=conn):
        result = r.get_user_by_email('a@b.ca')

    assert result['first_name'] == 'Dale'


# ----------------------------------------------------------------------
# 2. Library search
# ----------------------------------------------------------------------

def test_search_library_returns_one_chunk_per_lesson():
    r = make_researcher()
    rows = [
        {'lesson_code': '3A1-10-3', 'lesson_title': 'Superheat tables', 'slide_number': 10,
         'title': 'a', 'body': '', 'narration': '', 'source_content': '', 'rank': 0.9},
        {'lesson_code': '3A1-10-3', 'lesson_title': 'Superheat tables', 'slide_number': 11,
         'title': 'b', 'body': '', 'narration': '', 'source_content': '', 'rank': 0.8},
        {'lesson_code': '2A3-2-4', 'lesson_title': 'HRSG designs', 'slide_number': 9,
         'title': 'c', 'body': '', 'narration': '', 'source_content': '', 'rank': 0.7},
    ]
    conn, _ = make_conn(fetchall_rows=rows)
    with patch.object(r, '_get_connection', return_value=conn):
        result = r.search_library('what is superheated steam', limit=3)

    assert [c['lesson_code'] for c in result] == ['3A1-10-3', '2A3-2-4']
    assert result[0]['lesson_title'] == 'Superheat tables'


def test_search_library_no_meaningful_terms_skips_query():
    r = make_researcher()
    with patch.object(r, '_get_connection') as conn:
        assert r.search_library('how does that work') == []
        conn.assert_not_called()


# ----------------------------------------------------------------------
# 3. Orchestrator gating
# ----------------------------------------------------------------------

def test_knowledge_questions_trigger_background_search():
    o = Orchestrator.__new__(Orchestrator)
    state = {'activity': 'free_discussion'}
    assert o._wants_library_background(state, 'What is dryness fraction again?')
    assert o._wants_library_background(state, 'remind me what enthalpy means')


def test_short_answers_do_not_trigger_background_search():
    o = Orchestrator.__new__(Orchestrator)
    state = {'activity': 'practice'}
    assert not o._wants_library_background(state, 'B')
    assert not o._wants_library_background(state, 'option c')


def test_staged_problems_never_pull_background():
    o = Orchestrator.__new__(Orchestrator)
    state = {'activity': 'staged_problem'}
    assert not o._wants_library_background(state, 'What is the next step here?')


def test_init_hello_does_not_pull_background():
    o = Orchestrator.__new__(Orchestrator)
    state = {'activity': 'greeting'}
    assert not o._wants_library_background(state, 'What should we do today?', is_init_hello=True)


# ----------------------------------------------------------------------
# 4. Prompt construction
# ----------------------------------------------------------------------

BASE_LESSON = {'title': 'Boiler Safety Valves', 'summary': 'Valve sizing.', 'narration_text': 'x'}


def build_prompt(state):
    return tutor_prompt.build(BASE_LESSON, None, state, first_name='Katrina')


def test_prompt_no_longer_fences_the_tutor_inside_the_lesson():
    prompt = build_prompt({'activity': 'free_discussion'})
    assert 'stay strictly within this' not in prompt
    assert 'Do not introduce any external knowledge' not in prompt
    assert "covered in a later objective" not in prompt
    assert 'You may answer ANY question in the Power Engineering domain' in prompt


def test_background_block_appears_when_library_chunks_present():
    state = {
        'activity': 'free_discussion',
        'library_chunks': [{
            'lesson_code': '3A1-10-1',
            'lesson_title': 'Define saturated and superheated steam',
            'slide_number': 9,
            'title': 'Steam Heating Process Stages',
            'body': 'Sensible heat, then latent heat.',
            'narration': 'Water heats to saturation before it boils.',
            'source_content': '',
        }],
    }
    prompt = build_prompt(state)
    assert '## BACKGROUND FROM THE WIDER COURSE LIBRARY' in prompt
    assert 'From 3A1-10-1' in prompt
    assert 'Sensible heat' in prompt


def test_background_block_absent_when_nothing_retrieved():
    prompt = build_prompt({'activity': 'free_discussion', 'library_chunks': []})
    assert '## BACKGROUND FROM THE WIDER COURSE LIBRARY' not in prompt


def test_answer_giveaway_guard_survives_the_loosening():
    """Asserts the behaviour, not the sentence.

    Originally pinned the literal wording of the OFF-LIMITS rule. That wording
    was rewritten on 2026-08-26 when FEEDBACK MODE became ground-truth-driven —
    the guard is now scoped to a question STILL IN PLAY, because once the
    student has answered, the correct option is highlighted on her screen and
    withholding it from the tutor only forced it to re-derive the answer. The
    guard itself is unchanged in force: an unanswered question never has its
    answer revealed. See tests/test_feedback_ground_truth.py for the other half.
    """
    prompt = build_prompt({'activity': 'practice'})
    lowered = prompt.lower()
    assert 'reveal or confirm the answer' in lowered
    assert 'still in play' in lowered
    assert 'THE CORRECT ANSWER IS' not in prompt
