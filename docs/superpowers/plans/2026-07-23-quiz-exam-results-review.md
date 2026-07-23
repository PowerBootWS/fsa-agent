# Chapter Quiz Fix + Question Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the chapter-quiz dead end (no visible result, no retry), widen its question pool, and add a per-question right/wrong review to chapter quizzes and practice exams for every class — additive only for 2nd/3rd Class practice exams, which keep their existing chapter-stats table, weighting chart, and AI summary untouched.

**Architecture:** Backend (`ai-service`) changes are the bulk of this: merge the chapter quiz's two-round-trip debrief into one immediate response, track per-question detail (question text, options, selected/correct answer, explanation) during both chapter quizzes and practice exams, and surface it as a new `question_review` array on the existing `display_update` payload — no new endpoints. Frontend (`client-v2`) gets one new shared component (`QuestionReview`, rendered inline for chapter quizzes, in a modal for practice exams) and small, targeted edits to `ResultsPanel` and `QuizExamDisplaySection` to wire it in and add the chapter-quiz retry button that doesn't exist today.

**Tech Stack:** Python/Flask (`ai-service`), React (`client-v2`), Pytest, no `client-v2` test harness (build + manual verification, matching existing project convention).

**Source spec:** `docs/superpowers/specs/2026-07-23-quiz-exam-results-review-design.md`

## Global Constraints

- `CHAPTER_QUIZ_QUESTION_COUNT` moves from `8` to `15` — a chapter with fewer available questions returns exactly what's available; never pad, never error.
- `question_review` items share one shape everywhere they appear (chapter quiz and practice exam, any class): `{question_text, options, correct_index, selected_index, correct, explanation}`.
- 2nd/3rd Class practice exam results (`chapter_stats`, `objective_breakdowns`/`TeachingNotes`, `next_attempt_allocation`, the AI tutor summary) are **never** removed, reordered, or restyled by this plan — every new element is additive.
- 4th Class's existing "no AI tutor chat during practice exams, visible during chapter quizzes" gating (`isFourthClass` in `client-v2/src/ExamRouter.jsx`'s `QuizExamView`) is unaffected — the new chapter-quiz retry button reuses the same invisible chat-message mechanism (`onAnswer('yes')`) already used by practice-exam retry.
- `client-v2` has no test harness — frontend tasks are verified via `npm run build` + a live click-through, not invented unit tests, matching every prior task in this branch.
- No live deploy inside individual task dispatches (if executed via subagent-driven-development) — this branch is already deployed to production from prior work in this session; redeploy and verify live only once, at the end, matching the established pattern.

---

## Task 1: Wider chapter-quiz question pool

**Files:**
- Modify: `ai-service/agents/researcher.py:768-800` (`get_chapter_quiz_questions`)
- Modify: `ai-service/agents/orchestrator.py:24` (`CHAPTER_QUIZ_QUESTION_COUNT`)
- Modify: `client-v2/src/components/PracticeExamLobby.jsx:96`
- Test: `ai-service/tests/test_chapter_quiz_question_pool.py`

**Interfaces:**
- No signature change to `get_chapter_quiz_questions(chapter_id, limit=10)` — same call sites, same return shape, just a wider `WHERE` clause.

- [ ] **Step 1: Write the failing test**

Create `ai-service/tests/test_chapter_quiz_question_pool.py`:

```python
import sys, os
from unittest.mock import MagicMock, patch
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.researcher import Researcher


def make_researcher():
    r = Researcher.__new__(Researcher)
    r.db_config = {}
    return r


def test_get_chapter_quiz_questions_draws_from_both_question_types():
    r = make_researcher()
    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = []
    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    with patch.object(r, '_get_connection', return_value=mock_conn):
        r.get_chapter_quiz_questions('4A-1', limit=15)

    executed_sql = mock_cursor.execute.call_args[0][0]
    assert "question_type IN ('chapter_quiz', 'objective_practice')" in executed_sql
    assert "chapter_id = %s" in executed_sql
    executed_params = mock_cursor.execute.call_args[0][1]
    assert executed_params == ('4A-1', 15)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ai-service && python3 -m pytest tests/test_chapter_quiz_question_pool.py -v`
Expected: FAIL — the current query only has `question_type = 'chapter_quiz'`, not the `IN (...)` clause.

- [ ] **Step 3: Widen the query**

In `ai-service/agents/researcher.py`, change `get_chapter_quiz_questions`'s query from:

```python
                SELECT id, question_text, options, correct_answer, explanation,
                       difficulty, topic, step_data
                FROM questions
                WHERE chapter_id = %s AND question_type = 'chapter_quiz'
                ORDER BY RANDOM()
                LIMIT %s
```

to:

```python
                SELECT id, question_text, options, correct_answer, explanation,
                       difficulty, topic, step_data
                FROM questions
                WHERE chapter_id = %s
                  AND question_type IN ('chapter_quiz', 'objective_practice')
                  AND standalone = TRUE
                  AND options IS NOT NULL AND jsonb_array_length(options) > 0
                ORDER BY RANDOM()
                LIMIT %s
```

(The `standalone`/`options` filters match what `get_exam_questions` already applies to the `objective_practice` pool elsewhere in this file — needed now that this query draws from that pool too, so it doesn't pull malformed or non-standalone rows.)

- [ ] **Step 4: Raise the question-count target**

In `ai-service/agents/orchestrator.py`, change:

```python
CHAPTER_QUIZ_QUESTION_COUNT = 8
```

to:

```python
CHAPTER_QUIZ_QUESTION_COUNT = 15
```

- [ ] **Step 5: Update the stale copy text**

In `client-v2/src/components/PracticeExamLobby.jsx`, change:

```jsx
          <p className="lobby-panel-desc">
            Drill a specific chapter with a focused 8-question quiz.
          </p>
```

to:

```jsx
          <p className="lobby-panel-desc">
            Drill a specific chapter with a focused quiz — up to 15 questions, drawn
            randomly each time.
          </p>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd ai-service && python3 -m pytest tests/test_chapter_quiz_question_pool.py -v`
Expected: PASS.

- [ ] **Step 7: Run the full ai-service suite to check for regressions**

Run: `cd ai-service && python3 -m pytest -q`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add ai-service/agents/researcher.py ai-service/agents/orchestrator.py client-v2/src/components/PracticeExamLobby.jsx ai-service/tests/test_chapter_quiz_question_pool.py
git commit -m "feat: widen chapter quiz question pool, raise target to 15"
```

---

## Task 2: Chapter quiz — immediate result, no dead end, question review, retry

**Files:**
- Modify: `ai-service/agents/orchestrator.py` (`_process_chapter_quiz` and new helper methods)
- Test: `ai-service/tests/test_chapter_quiz_debrief.py`

**Interfaces:**
- Consumes: `CHAPTER_QUIZ_QUESTION_COUNT` (Task 1), `self._evaluate_mc_answer`, `self._is_exam_retry` (existing, reused as-is — its phrase list is generic enough for a quiz retry too, not exam-specific in practice).
- Produces: `self._parse_mc_selected_index(message)` — returns the 0-based option index a message selected, or `None`. New method, used by both this task and Task 3.
- Produces: `question_review` field on the `quiz_done` `display_update`, shape `{question_text, options, correct_index, selected_index, correct, explanation}` per item — consumed by Task 5's frontend work.

- [ ] **Step 1: Write the failing tests**

Create `ai-service/tests/test_chapter_quiz_debrief.py`:

```python
import sys, os
from unittest.mock import MagicMock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.orchestrator import Orchestrator, CHAPTER_QUIZ_QUESTION_COUNT


def make_quiz_state(questions, index, correct=0):
    return {
        'user': 'student@example.com',
        'lesson_id': '4A-1',
        'mode': 'chapter_quiz',
        'first_name': 'Jordan',
        'complexity_level': 3,
        'chat_history': [],
        'quiz_questions': questions,
        'quiz_index': index,
        'quiz_correct': correct,
        'quiz_awaiting_feedback': False,
        'quiz_current_correct_answer': None,
        'quiz_done': False,
    }


def two_question_bank():
    return [
        {'id': 1, 'question_text': 'Q1', 'options': ['A', 'B', 'C', 'D'],
         'correct_answer': 0, 'explanation': 'Because A.', 'topic': 'friction', 'difficulty': 3},
        {'id': 2, 'question_text': 'Q2', 'options': ['W', 'X', 'Y', 'Z'],
         'correct_answer': 2, 'explanation': 'Because Y.', 'topic': 'pressure', 'difficulty': 3},
    ]


def test_last_question_returns_full_debrief_immediately_no_second_round_trip():
    """Regression test for the dead end: answering the last question must
    return type='quiz_done' with a real score directly, not a placeholder
    requiring a second message.

    Note: answers are always sent as a letter ("My answer is C"), never the
    option's text — the frontend always sends `My answer is ${opt.label}`
    where label is A/B/C/D (see _build_quiz_question_display), and
    _evaluate_mc_answer/_parse_mc_selected_index only recognize a/b/c/d and
    1-4, not arbitrary option text. Q2's correct_answer is index 2 → letter C.
    """
    orch = Orchestrator()
    questions = two_question_bank()
    state = make_quiz_state(questions, index=2)
    state['quiz_awaiting_feedback'] = True
    state['quiz_current_correct_answer'] = 2  # correct answer to Q2 (index 2, already answered Q1)
    state['quiz_correct'] = 1

    mock_researcher = MagicMock()
    mock_display = MagicMock()

    result = orch._process_chapter_quiz(state, 'student@example.com', '4A-1', 'My answer is C', mock_researcher, mock_display)

    assert result['display_update']['type'] == 'quiz_done'
    assert result['display_update']['score'] == 2
    assert result['display_update']['total'] == 2
    assert state['quiz_done'] is True


def test_debrief_includes_full_question_review():
    orch = Orchestrator()
    questions = two_question_bank()
    state = make_quiz_state(questions, index=2)
    state['quiz_done'] = True
    state['quiz_correct'] = 1
    state['quiz_review'] = [
        {'question_text': 'Q1', 'options': ['A', 'B', 'C', 'D'], 'correct_index': 0,
         'selected_index': 1, 'correct': False, 'explanation': 'Because A.'},
        {'question_text': 'Q2', 'options': ['W', 'X', 'Y', 'Z'], 'correct_index': 2,
         'selected_index': 2, 'correct': True, 'explanation': 'Because Y.'},
    ]

    mock_researcher = MagicMock()
    mock_display = MagicMock()

    result = orch._process_chapter_quiz(state, 'student@example.com', '4A-1', 'hello', mock_researcher, mock_display)

    review = result['display_update']['question_review']
    assert len(review) == 2
    assert review[0] == {'question_text': 'Q1', 'options': ['A', 'B', 'C', 'D'], 'correct_index': 0,
                          'selected_index': 1, 'correct': False, 'explanation': 'Because A.'}


def test_answering_a_question_appends_to_quiz_review_with_selected_index():
    orch = Orchestrator()
    questions = two_question_bank()
    state = make_quiz_state(questions, index=1)
    state['quiz_awaiting_feedback'] = True
    state['quiz_current_correct_answer'] = 0  # Q1's correct answer

    mock_researcher = MagicMock()
    mock_researcher.record_response.return_value = None
    mock_display = MagicMock()

    orch._process_chapter_quiz(state, 'student@example.com', '4A-1', 'My answer is B', mock_researcher, mock_display)

    assert state['quiz_review'] == [
        {'question_text': 'Q1', 'options': ['A', 'B', 'C', 'D'], 'correct_index': 0,
         'selected_index': 1, 'correct': False, 'explanation': 'Because A.'},
    ]


def test_retry_after_quiz_done_loads_a_fresh_set_and_resets_review():
    orch = Orchestrator()
    questions = two_question_bank()
    state = make_quiz_state(questions, index=2)
    state['quiz_done'] = True
    state['quiz_correct'] = 2
    state['quiz_review'] = [{'question_text': 'stale', 'options': [], 'correct_index': 0,
                              'selected_index': 0, 'correct': True, 'explanation': ''}]

    mock_researcher = MagicMock()
    fresh_questions = two_question_bank()
    mock_researcher.get_chapter_quiz_questions.return_value = fresh_questions
    mock_display = MagicMock()

    result = orch._process_chapter_quiz(state, 'student@example.com', '4A-1', 'yes', mock_researcher, mock_display)

    mock_researcher.get_chapter_quiz_questions.assert_called_once_with('4A-1', limit=CHAPTER_QUIZ_QUESTION_COUNT)
    assert result['display_update']['type'] == 'question'
    assert state['quiz_done'] is False
    assert state['quiz_correct'] == 0
    assert state['quiz_review'] == []
    assert state['quiz_questions'] == fresh_questions


def test_non_retry_message_after_quiz_done_returns_cached_debrief_not_a_reset():
    orch = Orchestrator()
    questions = two_question_bank()
    state = make_quiz_state(questions, index=2)
    state['quiz_done'] = True
    state['quiz_correct'] = 1
    state['quiz_review'] = []

    mock_researcher = MagicMock()
    mock_display = MagicMock()

    result = orch._process_chapter_quiz(state, 'student@example.com', '4A-1', 'thanks!', mock_researcher, mock_display)

    mock_researcher.get_chapter_quiz_questions.assert_not_called()
    assert result['display_update']['type'] == 'quiz_done'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ai-service && python3 -m pytest tests/test_chapter_quiz_debrief.py -v`
Expected: FAIL — no `_parse_mc_selected_index`, no `question_review` tracking, no retry detection, and the last-question path currently returns a placeholder instead of the full debrief.

- [ ] **Step 3: Add `_parse_mc_selected_index`**

In `ai-service/agents/orchestrator.py`, immediately after the existing `_evaluate_mc_answer` method (search for `def _evaluate_mc_answer`), add:

```python
    def _parse_mc_selected_index(self, message):
        """
        Returns the 0-based option index the student's message selected, or
        None if unparseable. Sibling to _evaluate_mc_answer (which only
        returns whether the answer was correct) — this returns WHICH option
        was picked, needed to build a full question-review list.
        """
        msg = message.strip().lower()
        letter_map = {'a': 0, 'b': 1, 'c': 2, 'd': 3}
        if msg in letter_map:
            return letter_map[msg]

        letter_match = re.search(r'\b([abcd])\b', msg)
        if letter_match:
            return letter_map.get(letter_match.group(1))

        num_match = re.search(r'\b([1234])\b', msg)
        if num_match:
            return int(num_match.group(1)) - 1

        return None
```

- [ ] **Step 4: Track per-question review data on each answer**

In `_process_chapter_quiz`, inside the `if state['quiz_awaiting_feedback']:` block (the section that computes `student_correct` via `self._evaluate_mc_answer(message, correct_index)`), change:

```python
            # Parse what the student selected
            student_correct = self._evaluate_mc_answer(message, correct_index)

            # Record response silently
            researcher.record_response(
```

to:

```python
            # Parse what the student selected
            student_correct = self._evaluate_mc_answer(message, correct_index)
            selected_index = self._parse_mc_selected_index(message)
            state.setdefault('quiz_review', []).append({
                'question_text': current_q.get('question_text', ''),
                'options': options,
                'correct_index': correct_index,
                'selected_index': selected_index,
                'correct': student_correct,
                'explanation': explanation,
            })

            # Record response silently
            researcher.record_response(
```

- [ ] **Step 5: Extract debrief-building into a shared helper**

Replace the entire `if state.get('quiz_done'):` block near the top of `_process_chapter_quiz` (currently building the summary text and returning the `quiz_done` display inline) with a call to a new helper, and add that helper right after `_process_chapter_quiz` (before `_build_quiz_question_display`).

Change this block:

```python
        # ---- Handle debrief phase ----
        if state.get('quiz_done'):
            correct = state['quiz_correct']
            score_pct = int(correct / total * 100) if total else 0
            topics_missed = state.get('quiz_topics_missed', [])
            missed_str = ', '.join(topics_missed) if topics_missed else 'none in particular'
            summary = (
                f"Quiz complete, {first_name}! You got **{correct} out of {total}** "
                f"({score_pct}%).\n\n"
            )
            if score_pct >= 80:
                summary += f"Great work — you're clearly solid on this chapter. {missed_str != 'none in particular' and f'A quick look at **{missed_str}** would round things out nicely.' or ''}"
            elif score_pct >= 60:
                summary += f"Decent foundation. Worth revisiting **{missed_str}** before the practice exam — those topics came up in your wrong answers."
            else:
                summary += f"There's room to strengthen this chapter. I'd recommend going back through **{missed_str}** — those are the areas where you dropped marks. The practice exam will also help reinforce them."

            return {
                'tutor_response': summary,
                'display_update': {'type': 'quiz_done', 'title': 'Chapter Quiz Complete',
                                   'score': correct, 'total': total, 'score_pct': score_pct},
                'progress_update': {},
                'complexity_level': state['complexity_level'],
                'first_name': first_name,
                'action': None,
                'mode': 'chapter_quiz',
            }
```

to:

```python
        # ---- Handle debrief phase ----
        if state.get('quiz_done'):
            if self._is_exam_retry(message):
                return self._reset_and_start_quiz(state, researcher, chapter_id, first_name)
            return self._build_chapter_quiz_debrief(state, first_name)
```

Then add the new helper immediately after `_process_chapter_quiz`'s closing brace (before `def _build_quiz_question_display`):

```python
    def _build_chapter_quiz_debrief(self, state, first_name):
        """
        Score + full question review for a finished chapter quiz. Called both
        immediately after the last question is answered and on resume (a
        follow-up message after quiz_done that isn't a retry trigger) — same
        content either way, no second round-trip needed to see it.
        """
        correct = state['quiz_correct']
        total = len(state['quiz_questions'])
        score_pct = int(correct / total * 100) if total else 0
        topics_missed = state.get('quiz_topics_missed', [])
        missed_str = ', '.join(topics_missed) if topics_missed else 'none in particular'
        summary = (
            f"Quiz complete, {first_name}! You got **{correct} out of {total}** "
            f"({score_pct}%).\n\n"
        )
        if score_pct >= 80:
            summary += f"Great work — you're clearly solid on this chapter. {missed_str != 'none in particular' and f'A quick look at **{missed_str}** would round things out nicely.' or ''}"
        elif score_pct >= 60:
            summary += f"Decent foundation. Worth revisiting **{missed_str}** before the practice exam — those topics came up in your wrong answers."
        else:
            summary += f"There's room to strengthen this chapter. I'd recommend going back through **{missed_str}** — those are the areas where you dropped marks. The practice exam will also help reinforce them."

        return {
            'tutor_response': summary,
            'display_update': {
                'type': 'quiz_done', 'title': 'Chapter Quiz Complete',
                'score': correct, 'total': total, 'score_pct': score_pct,
                'question_review': state.get('quiz_review', []),
            },
            'progress_update': {},
            'complexity_level': state['complexity_level'],
            'first_name': first_name,
            'action': None,
            'mode': 'chapter_quiz',
        }

    def _reset_and_start_quiz(self, state, researcher, chapter_id, first_name):
        """Chapter-quiz retry — mirrors _reset_and_start_exam's pattern exactly
        (chat-message-triggered, not a remount: QuizExamView's init effect
        only fires once per mount, so a fresh question set has to arrive via
        the same in-place state-update path every other answer uses)."""
        qs = researcher.get_chapter_quiz_questions(chapter_id, limit=CHAPTER_QUIZ_QUESTION_COUNT)
        if not qs:
            return {
                'tutor_response': f"Sorry {first_name}, I couldn't load new quiz questions for this chapter right now. Please try again in a moment.",
                'display_update': None,
                'progress_update': {},
                'complexity_level': state.get('complexity_level', 3),
                'first_name': first_name,
                'action': None,
                'mode': 'chapter_quiz',
            }

        state['quiz_questions'] = qs
        state['quiz_correct'] = 0
        state['quiz_done'] = False
        state['quiz_topics_missed'] = []
        state['quiz_review'] = []
        state['quiz_awaiting_feedback'] = True
        state['quiz_current_correct_answer'] = qs[0]['correct_answer']
        state['quiz_index'] = 1

        display_update = self._build_quiz_question_display(qs[0], 0, len(qs))
        intro = (
            f"Fresh chapter quiz, {first_name}! **{len(qs)} questions**, one at a time, "
            f"randomly selected — here's question 1."
        )
        return {
            'tutor_response': intro,
            'display_update': display_update,
            'progress_update': {},
            'complexity_level': state['complexity_level'],
            'first_name': first_name,
            'action': None,
            'mode': 'chapter_quiz',
        }
```

- [ ] **Step 6: Return the full debrief immediately from the last-question path (no more placeholder)**

Still inside the `if state['quiz_awaiting_feedback']:` block, change the "last question" branch from:

```python
            # If this was the last question, move to debrief
            if idx >= total:
                state['quiz_done'] = True
                feedback += f"\n\nThat's all {total} questions! Let me tally up your results…"
                # Return without a new question — next message triggers debrief
                return {
                    'tutor_response': feedback,
                    'display_update': self._build_quiz_progress_display(idx, total, state['quiz_correct'], chapter_id),
                    'progress_update': {},
                    'complexity_level': state['complexity_level'],
                    'first_name': first_name,
                    'action': None,
                    'mode': 'chapter_quiz',
                }
```

to:

```python
            # If this was the last question, return the full debrief now —
            # no second round-trip required to see the result.
            if idx >= total:
                state['quiz_done'] = True
                return self._build_chapter_quiz_debrief(state, first_name)
```

This was `_build_quiz_progress_display`'s only call site (confirmed via
`grep -n "_build_quiz_progress_display" ai-service/agents/orchestrator.py` — it
appears exactly twice: its own `def` and this one call, which this step just
removed). Delete the now-dead method too — search for
`def _build_quiz_progress_display` (right after `_build_quiz_question_display`)
and remove it:

```python
    def _build_quiz_progress_display(self, questions_done, total, correct, chapter_id):
        return {
            'type': 'quiz_progress',
            'title': f'Chapter Quiz — {chapter_id}',
            'questions_done': questions_done,
            'total': total,
            'correct': correct,
        }
```

Before deleting, re-run `grep -n "_build_quiz_progress_display" ai-service/agents/orchestrator.py` yourself to confirm it's still only the two matches (def + the now-removed call) — if a third reference has appeared for any reason, stop and report NEEDS_CONTEXT rather than deleting a method something else depends on.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd ai-service && python3 -m pytest tests/test_chapter_quiz_debrief.py -v`
Expected: all 5 PASS.

- [ ] **Step 8: Run the full ai-service suite to check for regressions**

Run: `cd ai-service && python3 -m pytest -q`
Expected: all PASS, including `test_chapter_quiz_question_pool.py` from Task 1 and the existing debrief tests from earlier in this branch.

- [ ] **Step 9: Commit**

```bash
git add ai-service/agents/orchestrator.py ai-service/tests/test_chapter_quiz_debrief.py
git commit -m "fix: chapter quiz returns immediate results with full question review and retry"
```

---

## Task 3: Practice exam — per-question review

**Files:**
- Modify: `ai-service/agents/orchestrator.py` (`_process_practice_exam`'s answer recording, `_generate_exam_debrief`)
- Test: `ai-service/tests/test_practice_exam_question_review.py`

**Interfaces:**
- Consumes: `self._parse_mc_selected_index` (Task 2).
- Produces: `question_review` field on the `exam_done` `display_update`, same shape as Task 2's — consumed by Task 5's frontend work. Added **alongside** `chapter_stats`, `objective_breakdowns`, `next_attempt_allocation` — none of those change.

- [ ] **Step 1: Write the failing tests**

Create `ai-service/tests/test_practice_exam_question_review.py`:

```python
import sys, os
from unittest.mock import MagicMock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.orchestrator import Orchestrator, PRACTICE_EXAM_QUESTION_COUNT


def make_exam_state(exam_results):
    return {
        'exam_results': exam_results,
        'complexity_level': 3,
        'exam_question_count': PRACTICE_EXAM_QUESTION_COUNT,
        'chat_history': [],
        'exam_lead_magnet': False,
    }


def test_exam_results_capture_question_text_options_and_selected_index():
    """Answering an exam question must record enough detail to build a full
    review later, not just correctness."""
    orch = Orchestrator()
    state = {
        'exam_questions': [
            {'id': 10, 'question_text': 'Q1', 'options': ['A', 'B', 'C', 'D'],
             'correct_answer': 0, 'explanation': 'Use Barlow.', 'difficulty': 3,
             'topic': 'thickness', 'chapter_id': '2B1-1', 'course_id': '2B1', 'lesson_code': '2B1-1-2'},
        ],
        'exam_index': 1,
        'exam_results': [],
        'exam_init_hello': False,
        'complexity_level': 3,
    }
    mock_researcher = MagicMock()

    orch._record_exam_answer(state, 'student@example.com', '2B1', 'My answer is B', mock_researcher)

    assert state['exam_results'] == [{
        'chapter_id': '2B1-1', 'question_id': 10, 'correct': False,
        'lesson_code': '2B1-1-2', 'topic': 'thickness', 'explanation': 'Use Barlow.',
        'question_text': 'Q1', 'options': ['A', 'B', 'C', 'D'],
        'correct_index': 0, 'selected_index': 1,
    }]


def test_exam_debrief_includes_question_review_alongside_existing_fields():
    """The new question_review array must not replace chapter_stats,
    objective_breakdowns, or next_attempt_allocation."""
    orch = Orchestrator()
    state = make_exam_state([
        {'question_id': 1, 'correct': False, 'chapter_id': '2B1-1', 'lesson_code': '2B1-1-2',
         'topic': 'friction', 'explanation': 'Use friction formula.',
         'question_text': 'Q1', 'options': ['A', 'B', 'C', 'D'], 'correct_index': 0, 'selected_index': 1},
        {'question_id': 2, 'correct': True, 'chapter_id': '2B1-1', 'lesson_code': '2B1-1-3',
         'topic': 'friction', 'explanation': '',
         'question_text': 'Q2', 'options': ['W', 'X', 'Y', 'Z'], 'correct_index': 2, 'selected_index': 2},
    ])
    mock_researcher = MagicMock()
    mock_researcher.get_questions_by_ids.return_value = {}
    mock_tutor = MagicMock()
    mock_tutor.respond.return_value = {'response': 'Solid effort!'}
    orch._call_llm_for_teaching_tips = MagicMock(return_value={1: 'Review friction.'})

    result = orch._generate_exam_debrief(
        state, 'student@example.com', '2B1', 'Jordan',
        mock_researcher, mock_tutor, {}, None,
    )

    display = result['display_update']
    assert display['chapter_stats'] == [{'chapter': '2B1-1', 'correct': 1, 'total': 2, 'pct': 50, 'status': 'Developing'}]
    assert len(display['objective_breakdowns']) == 1
    assert display['next_attempt_allocation'] is not None
    assert display['question_review'] == [
        {'question_text': 'Q1', 'options': ['A', 'B', 'C', 'D'], 'correct_index': 0,
         'selected_index': 1, 'correct': False, 'explanation': 'Use friction formula.'},
        {'question_text': 'Q2', 'options': ['W', 'X', 'Y', 'Z'], 'correct_index': 2,
         'selected_index': 2, 'correct': True, 'explanation': ''},
    ]


def test_fourth_class_exam_debrief_also_gets_question_review():
    """4th Class keeps zero prose (Task 8, unchanged) but still gets the
    review data — the reduced-AI debrief and question_review are independent."""
    orch = Orchestrator()
    state = make_exam_state([
        {'question_id': 1, 'correct': True, 'chapter_id': '4A-1', 'lesson_code': '4A-1-2',
         'topic': 'friction', 'explanation': '',
         'question_text': 'Q1', 'options': ['A', 'B'], 'correct_index': 0, 'selected_index': 0},
    ])
    mock_researcher = MagicMock()
    mock_tutor = MagicMock()

    result = orch._generate_exam_debrief(
        state, 'student@example.com', '4A', 'Jordan',
        mock_researcher, mock_tutor, {}, None,
    )

    assert result['tutor_response'] == ''
    assert result['display_update']['objective_breakdowns'] == []
    assert result['display_update']['question_review'] == [
        {'question_text': 'Q1', 'options': ['A', 'B'], 'correct_index': 0,
         'selected_index': 0, 'correct': True, 'explanation': ''},
    ]
    mock_tutor.respond.assert_not_called()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ai-service && python3 -m pytest tests/test_practice_exam_question_review.py -v`
Expected: FAIL — `_record_exam_answer` doesn't exist yet (Step 3 extracts it), and `question_review` isn't in the debrief payload yet.

- [ ] **Step 3: Extract the answer-recording block into a named method**

In `_process_practice_exam`, find the "Record answer for previous question" block:

```python
        # ---- Record answer for previous question ----
        if idx > 0 and not state.get('exam_init_hello'):
            prev_q = questions[idx - 1]
            correct = self._evaluate_mc_answer(message, prev_q['correct_answer'])
            state['exam_results'].append({
                'chapter_id': prev_q['chapter_id'],
                'question_id': prev_q['id'],
                'correct': correct,
                # Objective enrichment — already in memory, needed for debrief
                'lesson_code': prev_q.get('lesson_code', ''),
                'topic': prev_q.get('topic', ''),
                'explanation': prev_q.get('explanation', ''),
            })
            researcher.record_response(
                user_email=user,
                question_id=prev_q['id'],
                session_type='practice_exam',
                course_id=course_id,
                chapter_id=prev_q['chapter_id'],
                correct=correct,
            )

        state['exam_init_hello'] = False
```

Replace the whole block with:

```python
        # ---- Record answer for previous question ----
        if idx > 0 and not state.get('exam_init_hello'):
            self._record_exam_answer(state, user, course_id, message, researcher)

        state['exam_init_hello'] = False
```

Then add the extracted method near `_evaluate_mc_answer`/`_parse_mc_selected_index` (same section of the file):

```python
    def _record_exam_answer(self, state, user, course_id, message, researcher):
        """Scores and persists the previous exam question's answer, and
        captures enough detail (question text, options, both indices) for
        the debrief's question_review."""
        idx = state['exam_index']
        prev_q = state['exam_questions'][idx - 1]
        correct = self._evaluate_mc_answer(message, prev_q['correct_answer'])
        selected_index = self._parse_mc_selected_index(message)
        state['exam_results'].append({
            'chapter_id': prev_q['chapter_id'],
            'question_id': prev_q['id'],
            'correct': correct,
            # Objective enrichment — already in memory, needed for debrief
            'lesson_code': prev_q.get('lesson_code', ''),
            'topic': prev_q.get('topic', ''),
            'explanation': prev_q.get('explanation', ''),
            'question_text': prev_q.get('question_text', ''),
            'options': prev_q.get('options', []),
            'correct_index': prev_q['correct_answer'],
            'selected_index': selected_index,
        })
        researcher.record_response(
            user_email=user,
            question_id=prev_q['id'],
            session_type='practice_exam',
            course_id=course_id,
            chapter_id=prev_q['chapter_id'],
            correct=correct,
        )
```

Note: the test in Step 1 calls `orch._record_exam_answer(state, user, course_id, message, researcher)` directly with `state['exam_index']` already set to the post-increment value the real call site has at that point (`idx = state['exam_index']` inside the method reads `state['exam_questions'][idx - 1]` — matches the original inline code's `questions[idx - 1]` exactly, just reading `idx` from `state` instead of a local variable, since the extracted method no longer has the enclosing function's local `idx`/`questions` variables in scope).

- [ ] **Step 4: Add `question_review` to the debrief payload**

In `_generate_exam_debrief`, right after `results = state.get('exam_results', [])` (near the top of the method), add:

```python
        results = state.get('exam_results', [])
        if not results:
            return {
                'tutor_response': f"Exam complete, {first_name}! No results to summarize.",
                'display_update': {'type': 'exam_done'},
                'progress_update': {},
                'complexity_level': state['complexity_level'],
                'first_name': first_name,
                'action': None,
                'mode': 'practice_exam',
            }
```

leave that early-return unchanged (an empty exam has nothing to review either), but further down where `display_update` is built:

```python
        display_update = {
            'type': 'exam_done',
            'title': f'{course_id} Exam Results',
            'score': total_correct,
            'total': total_q,
            'score_pct': score_pct,
            'chapter_stats': chapter_lines,
            'objective_breakdowns': objective_breakdowns,
            'next_attempt_allocation': next_allocation,
        }
```

change to:

```python
        question_review = [
            {
                'question_text': r.get('question_text', ''),
                'options': r.get('options', []),
                'correct_index': r.get('correct_index'),
                'selected_index': r.get('selected_index'),
                'correct': r['correct'],
                'explanation': r.get('explanation', ''),
            }
            for r in results
        ]

        display_update = {
            'type': 'exam_done',
            'title': f'{course_id} Exam Results',
            'score': total_correct,
            'total': total_q,
            'score_pct': score_pct,
            'chapter_stats': chapter_lines,
            'objective_breakdowns': objective_breakdowns,
            'next_attempt_allocation': next_allocation,
            'question_review': question_review,
        }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ai-service && python3 -m pytest tests/test_practice_exam_question_review.py -v`
Expected: all 3 PASS.

- [ ] **Step 6: Run the full ai-service suite to check for regressions**

Run: `cd ai-service && python3 -m pytest -q`
Expected: all PASS — in particular, the existing `test_orchestrator_debrief.py` and `test_orchestrator_fourth_class_debrief.py` files must still pass unchanged, confirming `chapter_stats`/`objective_breakdowns`/`next_attempt_allocation`/`tutor_response` behavior is untouched.

- [ ] **Step 7: Commit**

```bash
git add ai-service/agents/orchestrator.py ai-service/tests/test_practice_exam_question_review.py
git commit -m "feat: add per-question review data to practice exam debrief"
```

---

## Task 4: Frontend `QuestionReview` component

**Files:**
- Create: `client-v2/src/components/QuestionReview.jsx`
- Modify: `client-v2/src/index.css` (new `.qr-*` rules, added after the existing `.results-*` block)

**Interfaces:**
- Produces: `QuestionReview({ questions })` — renders an inline list. `questions` is the `question_review` array from Tasks 2/3.
- Produces: `QuestionReviewModal({ questions, onClose })` — wraps `QuestionReview` in a modal overlay. Consumed by Task 5's `ResultsPanel` changes.

- [ ] **Step 1: Create the component**

Create `client-v2/src/components/QuestionReview.jsx`:

```jsx
import { MathContent } from './MathContent.jsx';

function QuestionReviewItem({ item, index }) {
  const { question_text, options, correct_index, selected_index, correct, explanation } = item;

  return (
    <div className={`qr-item${correct ? ' qr-item--correct' : ' qr-item--wrong'}`}>
      <div className="qr-item-header">
        <span className="qr-item-num">Q{index + 1}</span>
        <span className={correct ? 'qr-badge-pass' : 'qr-badge-fail'}>
          {correct ? 'Correct' : 'Incorrect'}
        </span>
      </div>
      <div className="qr-item-question">
        <MathContent text={question_text} />
      </div>
      <div className="qr-item-options">
        {(options || []).map((opt, i) => {
          const isCorrect = i === correct_index;
          const isSelected = i === selected_index;
          const cls = [
            'qr-option',
            isCorrect ? 'qr-option--correct' : '',
            isSelected && !isCorrect ? 'qr-option--selected-wrong' : '',
          ].filter(Boolean).join(' ');
          return (
            <div key={i} className={cls}>
              <span className="qr-option-label">{String.fromCharCode(65 + i)}.</span>
              <span className="qr-option-text"><MathContent text={opt} /></span>
              {isSelected && <span className="qr-option-tag">Your answer</span>}
              {isCorrect && <span className="qr-option-tag qr-option-tag--correct">Correct answer</span>}
            </div>
          );
        })}
      </div>
      {!correct && explanation && (
        <div className="qr-item-explanation">{explanation}</div>
      )}
    </div>
  );
}

export function QuestionReview({ questions }) {
  if (!questions || questions.length === 0) return null;
  return (
    <div className="qr-list">
      {questions.map((q, i) => (
        <QuestionReviewItem key={i} item={q} index={i} />
      ))}
    </div>
  );
}

export function QuestionReviewModal({ questions, onClose }) {
  return (
    <div className="qr-modal-overlay" onClick={onClose}>
      <div className="qr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="qr-modal-header">
          <span className="qr-modal-title">All Questions ({(questions || []).length})</span>
          <button className="qr-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="qr-modal-body">
          <QuestionReview questions={questions} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add styles**

In `client-v2/src/index.css`, immediately after the existing `.results-review-tutor { padding: 1rem; overflow-y: auto; }` rule (search for it — it's right after the `.results-*` block), add:

```css
/* Question Review — per-question right/wrong breakdown, shared by chapter
   quiz results (inline) and practice exam results (inside a modal). */
.qr-list { display: flex; flex-direction: column; gap: 14px; margin-top: 20px; }

.qr-item {
  border-radius: 8px;
  padding: 14px 16px;
  border: 1px solid var(--plate-edge);
  background: var(--iron);
}
.qr-item--correct { border-left: 3px solid transparent; }
.qr-item--wrong { border-left: 3px solid transparent; }

.qr-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.qr-item-num { font-weight: 700; color: var(--gray-mid); font-size: 13px; }

.qr-badge-pass, .qr-badge-fail {
  font-size: 11px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.qr-badge-pass { background: rgba(82,168,130,0.18); color: #52a882; }
.qr-badge-fail { background: rgba(220,38,38,0.15); color: #dc2626; }

.qr-item-question { color: var(--off-white); font-size: 14px; margin-bottom: 10px; }

.qr-item-options { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.qr-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 5px;
  font-size: 13px;
  color: var(--gray-light);
  background: transparent;
}
.qr-option--correct { background: rgba(82,168,130,0.12); color: var(--off-white); }
.qr-option--selected-wrong { background: rgba(220,38,38,0.1); color: var(--off-white); }
.qr-option-label { font-weight: 700; color: var(--gray-mid); }
.qr-option-tag {
  margin-left: auto;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--gray-mid);
}
.qr-option-tag--correct { color: #52a882; }

.qr-item-explanation {
  font-size: 12px;
  color: var(--gray-mid);
  border-top: 1px solid var(--plate-edge);
  padding-top: 8px;
  margin-top: 4px;
}

.qr-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 24px;
}
.qr-modal {
  background: var(--carbon);
  border: 1px solid var(--plate-edge);
  border-radius: 10px;
  width: 100%;
  max-width: 720px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.qr-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--plate-edge);
}
.qr-modal-title { font-weight: 700; color: var(--off-white); font-size: 15px; }
.qr-modal-close {
  background: none;
  border: none;
  color: var(--gray-mid);
  font-size: 16px;
  cursor: pointer;
}
.qr-modal-body { padding: 16px 20px; overflow-y: auto; }
```

- [ ] **Step 3: Verify with a build**

```bash
cd client-v2 && npm run build
```
Must complete with zero errors. This component isn't wired into anything yet (Task 5 does that) — this step just confirms it compiles standalone with no syntax/import errors.

- [ ] **Step 4: Commit**

```bash
git add client-v2/src/components/QuestionReview.jsx client-v2/src/index.css
git commit -m "feat: add QuestionReview component (inline list + modal)"
```

---

## Task 5: Wire `QuestionReview` into `ResultsPanel`, add chapter-quiz retry

**Files:**
- Modify: `client-v2/src/ExamRouter.jsx` (`ResultsPanel`, `QuizExamDisplaySection`, the chapter-quiz phase's back button label)

**Interfaces:**
- Consumes: `QuestionReview`, `QuestionReviewModal` (Task 4); `question_review` on `displayContent` (Tasks 2/3).

- [ ] **Step 1: Import the new component**

In `client-v2/src/ExamRouter.jsx`, add near the other component imports at the top of the file (alongside the existing `import { TeachingNotes, NextAttemptPreview } from './components/TeachingNotes.jsx';`):

```jsx
import { QuestionReview, QuestionReviewModal } from './components/QuestionReview.jsx';
```

- [ ] **Step 2: Extend `ResultsPanel` to render the review — inline for chapter quiz, modal for exams**

Change the full `ResultsPanel` function from:

```jsx
export function ResultsPanel({ displayContent, isExam, onRetry, onSelectChapter, user }) {
  const { score, total, score_pct, chapter_stats,
          objective_breakdowns, next_attempt_allocation } = displayContent;
  const scoreColor = score_pct >= 75 ? '#16a34a' : score_pct >= 55 ? '#d97706' : '#dc2626';
  const [retrying, setRetrying] = useState(false);

  const handleRetry = () => {
    setRetrying(true);
    onRetry();
  };

  const hasFocus = objective_breakdowns && objective_breakdowns.length > 0;

  // Left column — the score overview, always visible (sticky) while the
  // right-hand lesson accordion scrolls independently.
  const overview = (
    <div className="exam-results-overview">
      <div className="results-score" style={{ color: scoreColor }}>
        {score}/{total} <span className="results-score-pct">({score_pct}%)</span>
      </div>

      {chapter_stats && chapter_stats.length > 0 && (
        <table className="results-table">
          <thead>
            <tr><th>Chapter</th><th>Score</th><th>Status</th></tr>
          </thead>
          <tbody>
            {chapter_stats.map(row => (
              <tr key={row.chapter} className={`results-row results-row--${row.status === 'Strong' ? 'strong' : row.status === 'Needs review' ? 'weak' : 'mid'}`}>
                <td>{row.chapter}</td>
                <td>{row.correct}/{row.total} ({row.pct}%)</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {next_attempt_allocation && (
        <NextAttemptPreview
          nextAttemptAllocation={next_attempt_allocation}
          totalCount={total}
        />
      )}

      {onRetry && (
        <div className="results-retry-block">
          <button
            className="results-retry-btn"
            onClick={handleRetry}
            disabled={retrying}
          >
            {retrying ? 'Loading next exam…' : 'Retake Exam (Adaptive)'}
          </button>
          <p className="results-retry-hint">
            Your next exam will pull more questions from chapters you struggled with.
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className={`results-panel${hasFocus ? ' results-panel--split' : ''}`}>
      {overview}
      {hasFocus && (
        <div className="exam-results-focus">
          <TeachingNotes
            objectiveBreakdowns={objective_breakdowns}
            chapterStats={chapter_stats}
            onSelectChapter={onSelectChapter}
          />
        </div>
      )}
    </div>
  );
}
```

to:

```jsx
export function ResultsPanel({ displayContent, isExam, onRetry, onSelectChapter, user }) {
  const { score, total, score_pct, chapter_stats,
          objective_breakdowns, next_attempt_allocation, question_review } = displayContent;
  const scoreColor = score_pct >= 75 ? '#16a34a' : score_pct >= 55 ? '#d97706' : '#dc2626';
  const [retrying, setRetrying] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);

  const handleRetry = () => {
    setRetrying(true);
    onRetry();
  };

  const hasFocus = objective_breakdowns && objective_breakdowns.length > 0;
  const hasReview = question_review && question_review.length > 0;

  // Left column — the score overview, always visible (sticky) while the
  // right-hand lesson accordion scrolls independently.
  const overview = (
    <div className="exam-results-overview">
      <div className="results-score" style={{ color: scoreColor }}>
        {score}/{total} <span className="results-score-pct">({score_pct}%)</span>
      </div>

      {chapter_stats && chapter_stats.length > 0 && (
        <table className="results-table">
          <thead>
            <tr><th>Chapter</th><th>Score</th><th>Status</th></tr>
          </thead>
          <tbody>
            {chapter_stats.map(row => (
              <tr key={row.chapter} className={`results-row results-row--${row.status === 'Strong' ? 'strong' : row.status === 'Needs review' ? 'weak' : 'mid'}`}>
                <td>{row.chapter}</td>
                <td>{row.correct}/{row.total} ({row.pct}%)</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {next_attempt_allocation && (
        <NextAttemptPreview
          nextAttemptAllocation={next_attempt_allocation}
          totalCount={total}
        />
      )}

      {/* Chapter quiz (short, ~15 questions max): show the review inline,
          directly on the results screen. */}
      {hasReview && !isExam && <QuestionReview questions={question_review} />}

      {/* Practice exam (25-100 questions): a button opens a modal instead —
          additive, sits below the existing chapter-stats table and
          weighting chart without disturbing them. */}
      {hasReview && isExam && (
        <div className="results-view-all-block">
          <button
            className="results-view-all-btn"
            onClick={() => setReviewModalOpen(true)}
          >
            View All Questions
          </button>
        </div>
      )}

      {onRetry && (
        <div className="results-retry-block">
          <button
            className="results-retry-btn"
            onClick={handleRetry}
            disabled={retrying}
          >
            {retrying
              ? 'Loading…'
              : isExam ? 'Retake Exam (Adaptive)' : 'Retry Quiz'}
          </button>
          <p className="results-retry-hint">
            {isExam
              ? 'Your next exam will pull more questions from chapters you struggled with.'
              : 'Get a fresh, randomly selected set of questions for this chapter.'}
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className={`results-panel${hasFocus ? ' results-panel--split' : ''}`}>
      {overview}
      {hasFocus && (
        <div className="exam-results-focus">
          <TeachingNotes
            objectiveBreakdowns={objective_breakdowns}
            chapterStats={chapter_stats}
            onSelectChapter={onSelectChapter}
          />
        </div>
      )}
      {hasReview && isExam && reviewModalOpen && (
        <QuestionReviewModal
          questions={question_review}
          onClose={() => setReviewModalOpen(false)}
        />
      )}
    </div>
  );
}
```

Add the CSS for the new button — in `client-v2/src/index.css`, right after the `.results-retry-hint` rule, add:

```css
.results-view-all-block { margin-top: 16px; text-align: center; }
.results-view-all-btn {
  display: inline-block;
  background: transparent;
  color: var(--off-white);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 20px;
  border: 1px solid var(--plate-edge);
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
}
.results-view-all-btn:hover { border-color: var(--gray-mid); }
```

- [ ] **Step 3: Enable retry for chapter quiz results**

In `QuizExamDisplaySection`, change:

```jsx
      <ResultsPanel
        displayContent={displayContent}
        isExam={isExam}
        onRetry={isExam ? () => onAnswer('yes') : null}
        onSelectChapter={onSelectChapter}
        user={user}
      />
```

to:

```jsx
      <ResultsPanel
        displayContent={displayContent}
        isExam={isExam}
        onRetry={(isExam || mode === 'chapter_quiz') ? () => onAnswer('yes') : null}
        onSelectChapter={onSelectChapter}
        user={user}
      />
```

- [ ] **Step 4: Fix the chapter-quiz back-button label**

In the chapter-quiz phase's render (search for `← Back to Exam`), change:

```jsx
          <button className="quizexam-back-btn" onClick={handleBack}>
            ← Back to Exam
          </button>
```

to:

```jsx
          <button className="quizexam-back-btn" onClick={handleBack}>
            ← Back to Lobby
          </button>
```

(`handleBack` returns to `returnPhase`, which is always `'lobby'` — chapter quizzes are only ever entered from the lobby's chapter grid via `handleSelectChapter`. The old label was misleading; this matches the exam phase's own "← Back to Lobby" button for consistency.)

- [ ] **Step 5: Build and verify**

```bash
cd client-v2 && npm run build
```
Must complete with zero errors. No live deploy in this step (see plan Global Constraints) — full verification happens once, at the end, after all tasks land.

Read through the full diff once more and confirm:
- 2nd/3rd Class practice exam rendering path (`isExam=true`, real `chapter_stats`/`objective_breakdowns` present): `chapter_stats` table, `NextAttemptPreview`, and `TeachingNotes` all still render exactly where they did before — the only new elements are the "View All Questions" button and (when clicked) the modal.
- 4th Class practice exam rendering path (`isExam=true`, `objective_breakdowns` always `[]`): `hasFocus` is `false` (unchanged from before this task — `TeachingNotes` never rendered for 4th Class already), "View All Questions" button present.
- Chapter quiz rendering path (`isExam=false`, any class): `QuestionReview` renders inline, retry button now present with "Retry Quiz" label and the quiz-specific hint text.

- [ ] **Step 6: Commit**

```bash
git add client-v2/src/ExamRouter.jsx client-v2/src/index.css
git commit -m "feat: wire QuestionReview into ResultsPanel, add chapter quiz retry"
```

---

## Task 6: Deploy and live-verify

**Files:** none — deployment and verification only.

- [ ] **Step 1: Rebuild and deploy both containers**

```bash
cd client-v2 && npm run build && cd ..
docker compose -p fsa-agent --env-file /home/debian/.env build api
docker compose -p fsa-agent --env-file /home/debian/.env up -d api
docker compose -p fsa-agent --env-file /home/debian/.env build ai-service
docker compose -p fsa-agent --env-file /home/debian/.env up -d ai-service
```

(Use `-p fsa-agent` explicitly, matching the earlier live-testing session in this branch — the worktree's directory name does not match the production project name, and omitting `-p` creates a stray, unreachable container stack instead of updating the real one.)

- [ ] **Step 2: Restart ai-service to clear in-memory session state**

```bash
docker restart fsa-agent-ai-service-1
```

(In-memory `conversation_state` from any earlier testing session would otherwise mask real behavior — this bit the chapter-allocation fix earlier in this branch and is worth doing deliberately here too.)

- [ ] **Step 3: Live-verify against production**

Using the real test account (`sysadmin@powerboot.ca`, `class_code='fourth'`) via a fresh browser session (not a cached tab):

- Start a chapter quiz. Confirm: up to 15 questions (fewer only if the chapter genuinely has fewer available), the result appears immediately after the last question (no extra message needed), the result shows a full per-question review (all questions, right and wrong, with the correct answer and explanation marked), and a "Retry Quiz" button that starts a fresh random set in place.
- Complete a practice exam. Confirm: the existing chapter-stats table and next-attempt weighting chart are unchanged, and a new "View All Questions" button opens a modal with the full per-question review.
- If a 2nd/3rd Class account is available, repeat both checks there — confirm the AI tutor summary and `TeachingNotes` panel are still present and unchanged for practice exams, and that chapter quizzes also now show the immediate result + review + retry (the universal backend fix applying there too, as agreed).

- [ ] **Step 4: Report results**

Summarize what was verified (and any issues found) back to the user before considering this plan complete — matching how every other live-verification pass in this branch has been handled.
