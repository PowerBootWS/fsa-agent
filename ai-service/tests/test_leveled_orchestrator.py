"""Leveled practice exam through the orchestrator (Plan 3, Task 5). No DB: a fake store."""
import os
import sys
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.orchestrator import Orchestrator  # noqa: E402

P = '2B1'
GROUPS = [{'topic_key': 'a', 'display_name': 'Boilers', 'exam_questions': 60, 'chapter_ids': ['2B1-1'], 'sort_order': 0},
          {'topic_key': 'b', 'display_name': 'Pumps', 'exam_questions': 40, 'chapter_ids': ['2B1-2'], 'sort_order': 1}]


class FakeStore:
    def __init__(self, engine='leveled', levels=None):
        self.engine = engine
        self._levels = levels or {'a': 2, 'b': 2}
        self.started, self.finished, self.saved = [], [], []
        self.next_id = 100

    def __call__(self, researcher):          # used as leveled_store_factory
        return self

    def engine_for(self, email, paper, lead):
        return self.engine

    def topic_groups(self, paper):
        return GROUPS

    def levels(self, email, paper):
        return dict(self._levels)

    def next_round_up_first(self, email, paper):
        return True

    def recent_ids(self, email, paper):
        return set()

    def pick(self, paper, group, level, n, avoid, taken):
        qs = []
        for i in range(n):
            self.next_id += 1
            qs.append({'id': self.next_id, 'question_text': f'{group["topic_key"]} q{i}', 'options': ['w', 'x', 'y', 'z'],
                       'correct_answer': 0, 'explanation': '', 'topic': 't', 'chapter_id': group['chapter_ids'][0],
                       'course_id': paper, 'lesson_code': '', 'exam_level': level, 'topic_key': group['topic_key']})
        return qs, []

    def last_topics(self, email, paper):
        return None

    def start_sitting(self, *a):
        self.started.append(a)
        return 7

    def finish_sitting(self, *a):
        self.finished.append(a)

    def save_levels(self, email, paper, levels):
        self.saved.append(levels)


def make(store, count=100, lead=False):
    o = Orchestrator.__new__(Orchestrator)
    o.leveled_store_factory = store
    o._distractor_coaching = MagicMock(return_value={})
    researcher = MagicMock()
    researcher.start_attempt.return_value = 55
    researcher.get_exam_questions.return_value = [
        {'id': 1, 'question_text': 'q', 'options': ['a', 'b', 'c', 'd'], 'correct_answer': 0, 'explanation': '',
         'difficulty': 3, 'topic': '', 'question_type': 'chapter_quiz', 'chapter_id': '2B1-1', 'course_id': P,
         'lesson_code': ''}]
    researcher.get_chapter_weights.return_value = None
    tutor = MagicMock()
    tutor.respond.return_value = {'response': 'debrief'}
    state = {'user': 's@example.com', 'lesson_id': P, 'first_name': 'Sam', 'complexity_level': 3,
             'exam_questions': [], 'exam_index': 0, 'exam_results': [], 'exam_phase': 'answering', 'exam_done': False,
             'exam_question_count': count, 'exam_timed': True, 'exam_lead_magnet': lead, '_starting_new_exam': True}
    kw = dict(researcher=researcher, display=MagicMock(), tutor=tutor, lesson_context={}, progress={})

    def send(msg):
        return o._process_practice_exam(state, 's@example.com', P, msg, **kw)
    return o, state, researcher, send


def answer_all(state, send, right_topics=()):
    r = None
    while not state.get('exam_done'):
        q = state['exam_questions'][state['exam_index'] - 1]
        r = send('My answer is A' if q['topic_key'] in right_topics else 'My answer is B')
    return r


def test_leveled_start_builds_exact_topic_mix():
    store = FakeStore()
    _, state, researcher, send = make(store, 100)
    r = send('hello')
    qs = state['exam_questions']
    assert len(qs) == 100 and sum(q['topic_key'] == 'a' for q in qs) == 60
    assert all('exam_level' in q for q in qs)
    assert len(store.started) == 1 and state['exam_engine'] == 'leveled'
    assert r['display_update']['engine'] == 'leveled' and r['display_update']['topic'] in ('Boilers', 'Pumps')
    assert 'chapter_id' not in r['display_update']
    researcher.get_exam_questions.assert_not_called()
    _, state50, _, send50 = make(FakeStore(), 50)
    send50('hello')
    assert len(state50['exam_questions']) == 50


def test_refresh_keeps_the_sitting():
    store = FakeStore()
    _, state, researcher, send = make(store, 50)
    first = send('hello')
    send('My answer is A')
    shown = state['exam_questions'][state['exam_index'] - 1]['id']
    again = send('hello')
    assert len(store.started) == 1
    assert again['display_update']['question_id'] == shown
    assert len(state['exam_results']) == 1           # 'hello' was not scored
    assert first['display_update']['question_id'] != shown


def test_completion_moves_levels_and_saves():
    store = FakeStore()
    _, state, researcher, send = make(store, 50)
    send('hello')
    r = answer_all(state, send, right_topics=('a',))
    lv = r['display_update']['leveled']
    by = {t['topic_key']: t for t in lv['topics']}
    assert by['a']['new_level'] == 3 and by['b']['new_level'] == 1
    assert store.saved == [{'a': 3, 'b': 1}]
    assert store.finished[0][1] == 'completed' and store.finished[0][2] == 55
    assert researcher.finish_attempt.called and researcher.save_last_debrief.called


def test_lead_magnet_uses_free_mix_and_never_saves_levels():
    store = FakeStore()
    _, state, _, send = make(store, 50, lead=True)
    send('hello')
    levels = {q['exam_level'] for q in state['exam_questions']}
    assert levels == {2, 3, 4}
    answer_all(state, send, right_topics=('a', 'b'))
    assert store.saved == []
    assert state['last_debrief']['display_update']['leveled']['lead_magnet'] is True


def test_time_up_with_no_answers():
    store = FakeStore()
    _, state, researcher, send = make(store, 50)
    send('hello')
    r = send('__time_up__')
    lv = r['display_update']['leveled']
    assert store.finished[0][1] == 'timed_out'
    assert all(t['correct'] == 0 for t in lv['topics']) and r['display_update']['total'] == 50
    assert store.saved == [{'a': 1, 'b': 1}]
    assert researcher.start_attempt.call_count == 1
    assert researcher.record_response.call_count == 50


def test_orphan_sitting_does_not_move_levels():
    store = FakeStore()
    _, state, _, send = make(store, 50)
    send('hello')
    send('My answer is A')
    _, state2, _, send2 = make(store, 50)                # service restarted: state lost
    send2('hello')
    assert len(store.started) == 2 and store.saved == [] and store.finished == []


def test_adaptive_when_not_enabled():
    store = FakeStore(engine='adaptive')
    _, state, researcher, send = make(store, 50)
    r = send('hello')
    researcher.get_exam_questions.assert_called_once_with(course_id=P, limit=50, weights=None)
    assert store.started == [] and state['exam_engine'] == 'adaptive'
    assert 'engine' not in r['display_update'] and r['display_update']['chapter_id'] == '2B1-1'


def test_leveled_debrief_shape():
    store = FakeStore()
    _, state, _, send = make(store, 50)
    send('hello')
    r = answer_all(state, send)
    du = r['display_update']
    assert du['type'] == 'exam_done' and 'chapter_stats' not in du
    lv = du['leveled']
    assert set(lv) >= {'topics', 'predicted_pct', 'band', 'message', 'holding_back', 'pass_pct'}
    assert lv['band'] == 'fail' and lv['message'] == "If you wrote this paper today, you'd likely fail."
    assert lv['holding_back'] == ['Boilers', 'Pumps']
    assert r['tutor_response'] == 'debrief'


def test_retake_starts_a_new_leveled_sitting():
    store = FakeStore()
    _, state, _, send = make(store, 50)
    send('hello')
    answer_all(state, send)
    send('hello')                                        # results cached
    r = send('retake')
    assert len(store.started) == 2 and r['display_update']['engine'] == 'leveled'
    assert len(state['exam_questions']) == 50 and state['exam_results'] == []


class BrokenStore(FakeStore):
    def topic_groups(self, paper):
        raise RuntimeError('db down')


class EmptyStore(FakeStore):
    def topic_groups(self, paper):
        return []


def test_leveled_failure_falls_back_to_adaptive():
    for store in (BrokenStore(), EmptyStore()):
        _, state, researcher, send = make(store, 50)
        r = send('hello')
        assert state['exam_engine'] == 'adaptive'
        researcher.get_exam_questions.assert_called_once_with(course_id=P, limit=50, weights=None)
        assert r['display_update']['type'] == 'exam_question'
        assert store.started == []                       # no empty sitting written


def test_time_up_after_results_returns_the_results():
    store = FakeStore()
    _, state, _, send = make(store, 50)
    send('hello')
    done = answer_all(state, send)
    again = send('__time_up__')
    assert again['display_update'] == done['display_update']
    assert len(store.finished) == 1 and len(store.saved) == 1


def test_time_up_while_results_are_being_built_does_nothing():
    store = FakeStore()
    o, state, _, send = make(store, 50)
    send('hello')
    state['exam_done'] = True
    state['exam_phase'] = 'debrief'
    state['_debrief_started'] = True                     # the final answer's request is building them
    r = send('__time_up__')
    assert r['display_update'] is None and store.finished == []


def test_late_time_up_never_restarts_a_finished_exam():
    store = FakeStore()
    o, state, _, send = make(store, 50, lead=True)
    send('hello')
    done = answer_all(state, send)
    assert o._time_up_after_done(state)['display_update'] == done['display_update']
    state2 = {'exam_done': False}
    assert o._time_up_after_done(state2) is None


def test_free_exam_shows_a_starting_level_not_a_level_change():
    store = FakeStore()
    _, state, _, send = make(store, 50, lead=True)
    send('hello')
    r = answer_all(state, send, right_topics=('a',))
    rows = {t['topic_key']: t for t in r['display_update']['leveled']['topics']}
    assert rows['a']['level'] == rows['a']['new_level'] == 3
    assert rows['b']['level'] == rows['b']['new_level'] == 1
    from agents.leveled_session import debrief_prompt
    p = debrief_prompt('Sam', P, r['display_update']['leveled'])
    assert 'moving to' not in p and 'would start' in p
