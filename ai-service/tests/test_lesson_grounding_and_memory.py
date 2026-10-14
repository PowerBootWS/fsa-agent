"""
Lesson-player tutoring after the first NPS response (2026-10-13, 2nd Class,
score 3). Each test maps to something she hit:

  - the tutor answered from general recall and contradicted her own slide
    (it got 4 retrieved slides, never the ones she had covered);
  - it said it had put a question up, she saw nothing, and it gave the answer;
  - it forgot what she asked to be called on the next objective, and forgot
    everything on every ai-service restart;
  - it used her name constantly.
"""
import sys, os
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents import memory, tutor_prompt
from agents.orchestrator import Orchestrator, _apply_screen_question
from agents.researcher import Researcher


COVERED = {
    'slides': [
        {'slide_number': 21, 'title': 'Four Casing Tandem Compound', 'body': 'Fossil plants', 'narration': ''},
        {'slide_number': 22, 'title': 'Four-Casing Cross Compound Nuclear Arrangement',
         'body': 'Nuclear plants of 800 to 1300 MW standardized on the four casing cross compound arrangement.',
         'narration': ''},
    ],
    'total': 49,
    'source': 'SOURCE TEXT',
}


def make_researcher_mock(transcript=None, mem=None):
    r = MagicMock()
    r.get_user_by_email.return_value = {'first_name': 'Katelyn'}
    r.get_chat_history.return_value = list(transcript or [])
    r.get_tutor_memory.return_value = dict(mem or {})
    r.get_slides_through.return_value = COVERED
    r.search_library.return_value = []
    return r


def make_tutor_mock(reply='Four-casing cross compound.'):
    t = MagicMock()

    def respond(user_message, lesson_context, progress, state, first_name=None):
        t.last_state = state
        t.last_prompt = tutor_prompt.build(lesson_context, progress, state, first_name)
        state.setdefault('full_transcript', []).extend([
            {'role': 'user', 'content': user_message},
            {'role': 'assistant', 'content': reply},
        ])
        return {'response': reply}

    t.respond.side_effect = respond
    return t


def run_turn(orch, researcher, tutor, message='which arrangement?', **kw):
    return orch.process(
        user='k@example.com', lesson_id='2B1-1-1', message=message,
        lesson_context={'title': 'Turbine selection'}, progress=None,
        tutor=tutor, display=MagicMock(), researcher=researcher, **kw,
    )


def fresh_orchestrator():
    o = Orchestrator()
    o._api_key = None  # no live memory extraction in unit tests
    return o


# ----------------------------------------------------------------------
# Grounding
# ----------------------------------------------------------------------

def test_lesson_turn_is_grounded_in_covered_slides():
    r, t = make_researcher_mock(), make_tutor_mock()
    run_turn(fresh_orchestrator(), r, t, slide_number=22)

    r.get_slides_through.assert_called_once_with('2B1-1-1', 22)
    assert 'four casing cross compound arrangement' in t.last_prompt
    assert 'slide 2 of 49' in t.last_prompt
    assert 'the slide is right and you are wrong' in t.last_prompt


def test_no_slide_number_falls_back_to_retrieval():
    r, t = make_researcher_mock(), make_tutor_mock()
    r.get_relevant_chunks.return_value = []
    run_turn(fresh_orchestrator(), r, t)

    r.get_slides_through.assert_not_called()
    r.get_relevant_chunks.assert_called_once()


def test_get_slides_through_filters_to_reached_slides():
    res = Researcher.__new__(Researcher)
    cursor = MagicMock()
    cursor.fetchall.return_value = [{'slide_number': 1, 'title': 't', 'body': 'b', 'narration': 'n'}]
    cursor.fetchone.return_value = {'total': 49, 'source': 'x' * 20000}
    conn = MagicMock(); conn.cursor.return_value = cursor
    with patch.object(res, '_get_connection', return_value=conn):
        out = res.get_slides_through('2B1-1-1', 22)

    sql, params = cursor.execute.call_args_list[0][0]
    assert 'slide_number <= %s' in sql and params == ('2B1-1-1', 22)
    assert out['total'] == 49
    assert len(out['source']) == Researcher.SOURCE_TEXT_CAP


# ----------------------------------------------------------------------
# No phantom questions
# ----------------------------------------------------------------------

def test_lesson_mode_never_emits_a_display_or_enters_practice():
    r, t = make_researcher_mock(), make_tutor_mock()
    out = run_turn(fresh_orchestrator(), r, t, message='yeah more practice questions', slide_number=5)

    assert out['display_update'] is None
    assert t.last_state['activity'] == 'free_discussion'
    assert 'DISPLAY PANEL' not in t.last_prompt
    assert 'Never say you have posted, displayed, put up or refreshed a question' in t.last_prompt
    r.get_questions.assert_not_called()


def test_unanswered_screen_card_is_in_the_prompt_without_its_answer():
    r, t = make_researcher_mock(), make_tutor_mock()
    card = {'question_text': 'Which arrangement for nuclear?', 'options': ['Tandem', 'Cross'],
            'selected_index': None, 'correct_answer': None}
    run_turn(fresh_orchestrator(), r, t, slide_number=22, screen_question=card)

    assert 'PRACTICE CARD ON SCREEN' in t.last_prompt
    assert 'Which arrangement for nuclear?' in t.last_prompt
    assert 'THE CORRECT ANSWER IS' not in t.last_prompt


def test_answered_screen_card_carries_the_graded_verdict():
    state = {}
    _apply_screen_question(state, {'question_text': 'Q', 'options': ['a', 'b', 'c', 'd'],
                                   'selected_index': 1, 'correct_answer': 3})
    assert state['last_answer_correct'] is False
    assert state['current_question_correct_answer'] == 3
    assert state['last_answer_text'] == 'B. b'


def test_card_from_an_earlier_turn_does_not_linger():
    state = {}
    _apply_screen_question(state, {'question_text': 'Q', 'options': ['a'], 'selected_index': 0, 'correct_answer': 0})
    _apply_screen_question(state, None)
    assert not state['screen_question_present']
    assert 'current_question_text' not in state and 'last_answer_correct' not in state


# ----------------------------------------------------------------------
# Transcript and memory persistence
# ----------------------------------------------------------------------

def test_restart_resumes_the_saved_transcript():
    prior = [{'role': 'user', 'content': 'call me Garlock'},
             {'role': 'assistant', 'content': 'You got it, Garlock!'}]
    r, t = make_researcher_mock(transcript=prior), make_tutor_mock()
    run_turn(fresh_orchestrator(), r, t, slide_number=3)

    assert t.last_state['chat_history'][:2] == prior
    saved = r.save_chat_history.call_args.kwargs['messages']
    assert saved[:2] == prior and len(saved) == 4


def test_transcript_saved_every_turn():
    r, t = make_researcher_mock(), make_tutor_mock()
    o = fresh_orchestrator()
    run_turn(o, r, t, slide_number=3)
    run_turn(o, r, t, slide_number=4)
    assert r.save_chat_history.call_count == 2


def test_preferred_name_from_memory_replaces_account_name():
    r = make_researcher_mock(mem={'preferred_name': 'Garlock', 'preferences': ['use my name sparingly'], 'notes': []})
    t = make_tutor_mock()
    run_turn(fresh_orchestrator(), r, t, slide_number=3)

    assert 'named Garlock' in t.last_prompt
    assert 'use my name sparingly' in t.last_prompt
    assert 'Katelyn' not in t.last_prompt


def test_name_is_used_sparingly_by_default():
    prompt = tutor_prompt.build({'title': 'T'}, None, {'activity': 'greeting'}, 'Katelyn')
    assert 'never in every message' in prompt


def test_memory_update_is_saved_when_the_model_returns_a_change():
    r, t = make_researcher_mock(), make_tutor_mock(reply='Garlock it is.')
    o = fresh_orchestrator()
    o._api_key = 'k'
    reply = MagicMock()
    reply.json.return_value = {'choices': [{'message': {'content':
        '{"preferred_name": "Garlock", "preferences": [], "notes": []}'}}]}
    with patch('agents.orchestrator.requests.post', return_value=reply) as post:
        run_turn(o, r, t, message='ok Kelvin sounds good. Id like you to call me Garlock', slide_number=3)

    post.assert_called_once()
    r.save_tutor_memory.assert_called_once_with(
        'k@example.com', {'preferred_name': 'Garlock', 'preferences': [], 'notes': []})


def test_memory_left_alone_when_nothing_changed():
    r = make_researcher_mock(mem={'preferred_name': 'Garlock', 'preferences': [], 'notes': []})
    t = make_tutor_mock()
    o = fresh_orchestrator(); o._api_key = 'k'
    reply = MagicMock()
    reply.json.return_value = {'choices': [{'message': {'content':
        '{"preferred_name": "Garlock", "preferences": [], "notes": []}'}}]}
    with patch('agents.orchestrator.requests.post', return_value=reply):
        run_turn(o, r, t, message='remember that', slide_number=3)
    r.save_tutor_memory.assert_not_called()


def test_should_extract_triggers():
    assert memory.should_extract('Id like you to call me Garlock', 1)
    assert memory.should_extract('stop using my name so much', 1)
    assert memory.should_extract('what is latent heat', 3)        # heartbeat
    assert not memory.should_extract('what is latent heat', 1)
    assert not memory.should_extract("i dont understand the question", 1)


def test_normalise_caps_and_dedupes():
    raw = {'preferred_name': '  Garlock  ', 'preferences': ['a', 'A', 5, 'b'],
           'notes': [f'n{i}' for i in range(15)]}
    out = memory.normalise(raw)
    assert out['preferred_name'] == 'Garlock'
    assert out['preferences'] == ['a', 'b']
    assert len(out['notes']) == memory.MAX_NOTES and out['notes'][-1] == 'n14'
    assert memory.normalise({'preferred_name': 'null'})['preferred_name'] is None


def test_parse_reply_tolerates_fences_and_junk():
    assert memory.parse_reply('```json\n{"preferred_name": "G"}\n```') == {'preferred_name': 'G'}
    assert memory.parse_reply('no json here') is None
