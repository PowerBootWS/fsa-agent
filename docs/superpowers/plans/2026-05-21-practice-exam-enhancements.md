# Practice Exam Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the FSA Agent practice exam into a tutoring-first experience with a pre-exam lobby, optional countdown timer, objective-level teaching debrief, next-attempt preview, and inline chapter quiz access.

**Architecture:** A lobby screen replaces the immediate exam start in React; exam configuration (question count, timer toggle) flows client → Express → Python on the first 'hello' message. The Python debrief groups wrong answers by objective (using `lesson_code`), calls the LLM once in batch for teaching tips, and computes the next-attempt allocation — all returned in the existing `display_update` payload. New React components render the lobby, timer, and enriched results panel.

**Tech Stack:** React 18 + Vite (client), Express.js + pg (API), Python Flask + psycopg2 (AI service), PostgreSQL

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `server/src/routes/exam.js` | `GET /api/exam/:courseId/chapters` endpoint |
| Modify | `server/src/index.js` | Register exam router |
| Modify | `server/src/routes/chat.js` | Forward `examConfig` field to Python service |
| Modify | `ai-service/app.py` | Pass `exam_config` from request body to orchestrator |
| Modify | `ai-service/agents/researcher.py` | Add `get_questions_by_ids()` |
| Modify | `ai-service/agents/orchestrator.py` | Dynamic count, enrich results, enhanced debrief |
| Create | `ai-service/tests/test_researcher.py` | Unit tests for `get_questions_by_ids` |
| Create | `ai-service/tests/test_orchestrator_debrief.py` | Unit tests for debrief helpers |
| Create | `client/src/CountdownTimer.jsx` | Countdown timer component |
| Create | `client/src/PracticeExamLobby.jsx` | Pre-exam lobby (config + chapter list) |
| Create | `client/src/TeachingNotes.jsx` | Teaching cards + next-attempt preview |
| Modify | `client/src/App.jsx` | Lobby routing, ResultsPanel + QuizExamView updates |
| Modify | `client/src/index.css` | Styles for all new components |

---

## Task 1: Express exam chapters endpoint

**Files:**
- Create: `server/src/routes/exam.js`
- Modify: `server/src/index.js`

- [ ] **Step 1: Create the route file**

Create `server/src/routes/exam.js`:
```javascript
const express = require('express');
const router = express.Router();
const { pool } = require('../services/database');

// GET /api/exam/:courseId/chapters
// Returns sorted list of chapter IDs that have questions for this course.
router.get('/:courseId/chapters', async (req, res) => {
  try {
    const { courseId } = req.params;
    const result = await pool.query(
      `SELECT DISTINCT chapter_id
       FROM questions
       WHERE course_id = $1
         AND chapter_id IS NOT NULL
         AND options IS NOT NULL
         AND jsonb_array_length(options) > 0
       ORDER BY chapter_id`,
      [courseId]
    );
    res.json({ chapters: result.rows.map(r => r.chapter_id) });
  } catch (error) {
    console.error('Error fetching chapters:', error.message);
    res.status(500).json({ error: 'Failed to fetch chapters' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Register the router in index.js**

In `server/src/index.js`, add after the existing route imports (around line 58):
```javascript
const examRouter = require('./routes/exam');
```
And after `app.use('/api/diagnostic', diagnosticRouter);` (around line 70):
```javascript
app.use('/api/exam', examRouter);
```

- [ ] **Step 3: Test the endpoint manually**

Rebuild and restart the API container, then verify:
```bash
curl https://fsachat.fullsteamahead.ca/api/exam/2B1/chapters
```
Expected: `{"chapters":["2B1-1","2B1-2","2B1-3",...]}` (actual chapter IDs will vary)

- [ ] **Step 4: Commit**

```bash
cd /home/debian/projects/fsa/fsa-agent
git add server/src/routes/exam.js server/src/index.js
git commit -m "feat: add GET /api/exam/:courseId/chapters endpoint"
```

---

## Task 2: Thread examConfig through Express → Python

**Files:**
- Modify: `server/src/routes/chat.js`
- Modify: `ai-service/app.py`

- [ ] **Step 1: Update Express chat route to forward examConfig**

Replace the entire contents of `server/src/routes/chat.js`:
```javascript
const express = require('express');
const router = express.Router();
const axios = require('axios');

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5000';

// Send message to Tutor Agent
router.post('/', async (req, res) => {
  try {
    const { user, lessonId, message, examConfig } = req.body;

    if (!user || !lessonId || !message) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Forward to Python AI service — include examConfig when present
    const payload = { user, lessonId, message };
    if (examConfig) payload.examConfig = examConfig;

    const response = await axios.post(`${PYTHON_SERVICE_URL}/agent/chat`, payload);

    res.json(response.data);
  } catch (error) {
    console.error('Error in chat:', error.message);
    res.status(500).json({ error: 'Failed to get response from tutor' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Update app.py to read examConfig and pass to orchestrator**

Replace the `chat()` function in `ai-service/app.py` (lines 29–58):
```python
@app.route('/agent/chat', methods=['POST'])
def chat():
    """Main chat endpoint - interacts with Tutor Agent"""
    data = request.json
    user = data.get('user')
    lesson_id = data.get('lessonId')
    message = data.get('message')
    exam_config = data.get('examConfig')  # optional: {count: int, timed: bool}

    if not all([user, lesson_id, message]):
        return jsonify({'error': 'Missing required parameters'}), 400

    # Get lesson context from Researcher
    lesson_context = researcher.get_lesson_context(lesson_id)

    # Get user progress for context
    progress = researcher.get_user_progress(user, lesson_id)

    # Process through Orchestrator
    response = orchestrator.process(
        user=user,
        lesson_id=lesson_id,
        message=message,
        lesson_context=lesson_context,
        progress=progress,
        tutor=tutor,
        display=display,
        researcher=researcher,
        exam_config=exam_config,
    )

    return jsonify(response)
```

- [ ] **Step 3: Commit**

```bash
cd /home/debian/projects/fsa/fsa-agent
git add server/src/routes/chat.js ai-service/app.py
git commit -m "feat: thread examConfig from client through Express to Python AI service"
```

---

## Task 3: Researcher.get_questions_by_ids()

**Files:**
- Modify: `ai-service/agents/researcher.py`
- Create: `ai-service/tests/test_researcher.py`

- [ ] **Step 1: Set up pytest**

```bash
cd /home/debian/projects/fsa/fsa-agent/ai-service
pip install pytest pytest-mock 2>/dev/null || true
mkdir -p tests
touch tests/__init__.py
```

- [ ] **Step 2: Write the failing test**

Create `ai-service/tests/test_researcher.py`:
```python
import pytest
from unittest.mock import MagicMock, patch
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.researcher import Researcher


def make_researcher():
    r = Researcher.__new__(Researcher)
    r.db_config = {}
    return r


def test_get_questions_by_ids_returns_dict_keyed_by_id():
    r = make_researcher()
    mock_rows = [
        {'id': 1, 'lesson_code': '2B1-3-2', 'topic': 'thickness_formula', 'explanation': 'Use Barlow.'},
        {'id': 2, 'lesson_code': '2B1-1-4', 'topic': 'pressure',          'explanation': 'Pressure rises.'},
    ]
    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = mock_rows
    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    with patch.object(r, '_get_connection', return_value=mock_conn):
        result = r.get_questions_by_ids([1, 2])

    assert result[1]['lesson_code'] == '2B1-3-2'
    assert result[2]['topic'] == 'pressure'
    assert result[1]['explanation'] == 'Use Barlow.'


def test_get_questions_by_ids_empty_input_returns_empty():
    r = make_researcher()
    result = r.get_questions_by_ids([])
    assert result == {}


def test_get_questions_by_ids_handles_null_fields():
    r = make_researcher()
    mock_rows = [
        {'id': 5, 'lesson_code': None, 'topic': None, 'explanation': None},
    ]
    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = mock_rows
    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    with patch.object(r, '_get_connection', return_value=mock_conn):
        result = r.get_questions_by_ids([5])

    assert result[5]['lesson_code'] == ''
    assert result[5]['topic'] == ''
    assert result[5]['explanation'] == ''
```

- [ ] **Step 3: Run test — confirm it fails**

```bash
cd /home/debian/projects/fsa/fsa-agent/ai-service
python -m pytest tests/test_researcher.py -v
```
Expected: `AttributeError: 'Researcher' object has no attribute 'get_questions_by_ids'`

- [ ] **Step 4: Implement get_questions_by_ids in researcher.py**

Add this method to the `Researcher` class in `ai-service/agents/researcher.py`, after `get_chapter_quiz_questions` and before `extract_key_points`:

```python
def get_questions_by_ids(self, ids):
    """
    Fetch lesson_code, topic, explanation for a list of question IDs.
    Fallback used when exam_results are missing enrichment fields.
    Returns dict keyed by question id: {id: {lesson_code, topic, explanation}}
    """
    if not ids:
        return {}
    try:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, lesson_code, topic, explanation
            FROM questions
            WHERE id = ANY(%s)
            """,
            (list(ids),)
        )
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        return {
            row['id']: {
                'lesson_code': row['lesson_code'] or '',
                'topic': row['topic'] or '',
                'explanation': row['explanation'] or '',
            }
            for row in rows
        }
    except Exception as e:
        print(f'Researcher.get_questions_by_ids error: {e}')
        return {}
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
cd /home/debian/projects/fsa/fsa-agent/ai-service
python -m pytest tests/test_researcher.py -v
```
Expected: 3 tests PASSED

- [ ] **Step 6: Commit**

```bash
cd /home/debian/projects/fsa/fsa-agent
git add ai-service/agents/researcher.py ai-service/tests/__init__.py ai-service/tests/test_researcher.py
git commit -m "feat: add Researcher.get_questions_by_ids() with tests"
```

---

## Task 4: Orchestrator — exam_config in state + dynamic question count

**Files:**
- Modify: `ai-service/agents/orchestrator.py`
- Create: `ai-service/tests/test_orchestrator_debrief.py`

- [ ] **Step 1: Write failing test for dynamic question count**

Create `ai-service/tests/test_orchestrator_debrief.py`:
```python
import pytest
from unittest.mock import MagicMock, patch
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.orchestrator import Orchestrator, PRACTICE_EXAM_QUESTION_COUNT


def make_state(overrides=None):
    base = {
        'user': 'test@example.com',
        'lesson_id': '2B1',
        'mode': 'practice_exam',
        'first_name': 'Jordan',
        'initialized': True,
        'exchange_count': 0,
        'score': 100,
        'struggles': [],
        'attempts': {},
        'complexity_level': 3,
        'activity': 'greeting',
        'questions_done': 0,
        'session_limit_reached': False,
        'seen_question_ids': [],
        'staged_step': 1,
        'staged_problem_id': None,
        'staged_context': {},
        'staged_step1_answer': None,
        'staged_step2_answer': None,
        'staged_step3_answer': None,
        'review_index': 0,
        'chat_history': [],
        'profanity_count': 0,
        'quiz_questions': [],
        'quiz_index': 0,
        'quiz_correct': 0,
        'quiz_awaiting_feedback': False,
        'quiz_current_correct_answer': None,
        'exam_questions': [],
        'exam_index': 0,
        'exam_results': [],
        'exam_phase': 'answering',
        'exam_question_count': PRACTICE_EXAM_QUESTION_COUNT,
        'exam_timed': False,
    }
    if overrides:
        base.update(overrides)
    return base


def test_state_uses_exam_config_count():
    """exam_question_count in state comes from exam_config passed to process()."""
    orch = Orchestrator()
    orch._api_key = None  # disable LLM calls

    mock_researcher = MagicMock()
    mock_researcher.get_user_by_email.return_value = {'first_name': 'Jordan'}
    mock_researcher.get_user_progress.return_value = None
    mock_researcher.get_lesson_context.return_value = {
        'title': '2B1', 'summary': '', 'key_points': [],
        'narration_text': '', 'video_transcript': '', 'lesson_code': '2B1',
    }
    mock_researcher.get_chapter_weights.return_value = {}
    mock_researcher.get_exam_questions.return_value = []
    mock_researcher.get_relevant_chunks.return_value = []

    mock_tutor = MagicMock()
    mock_tutor.respond.return_value = {'response': 'hello', 'action': None}
    mock_display = MagicMock()
    mock_display.create_initial_display.return_value = None
    mock_display.determine_update.return_value = None

    orch.process(
        user='test@example.com',
        lesson_id='2B1',
        message='hello',
        lesson_context=mock_researcher.get_lesson_context('2B1'),
        progress=None,
        tutor=mock_tutor,
        display=mock_display,
        researcher=mock_researcher,
        exam_config={'count': 25, 'timed': True},
    )

    state = orch.conversation_state['test@example.com:2B1']
    assert state['exam_question_count'] == 25
    assert state['exam_timed'] is True


def test_state_defaults_to_constant_when_no_config():
    """Without exam_config, exam_question_count defaults to PRACTICE_EXAM_QUESTION_COUNT."""
    orch = Orchestrator()
    orch._api_key = None

    mock_researcher = MagicMock()
    mock_researcher.get_user_by_email.return_value = {'first_name': 'Jordan'}
    mock_researcher.get_chapter_weights.return_value = {}
    mock_researcher.get_exam_questions.return_value = []
    mock_researcher.get_relevant_chunks.return_value = []

    mock_tutor = MagicMock()
    mock_tutor.respond.return_value = {'response': 'hi', 'action': None}
    mock_display = MagicMock()
    mock_display.create_initial_display.return_value = None
    mock_display.determine_update.return_value = None

    orch.process(
        user='test2@example.com',
        lesson_id='2B1',
        message='hello',
        lesson_context={'title': '2B1', 'summary': '', 'key_points': [],
                        'narration_text': '', 'video_transcript': '', 'lesson_code': '2B1'},
        progress=None,
        tutor=mock_tutor,
        display=mock_display,
        researcher=mock_researcher,
        exam_config=None,
    )

    state = orch.conversation_state['test2@example.com:2B1']
    assert state['exam_question_count'] == PRACTICE_EXAM_QUESTION_COUNT
    assert state['exam_timed'] is False
```

- [ ] **Step 2: Run — confirm tests fail**

```bash
cd /home/debian/projects/fsa/fsa-agent/ai-service
python -m pytest tests/test_orchestrator_debrief.py::test_state_uses_exam_config_count tests/test_orchestrator_debrief.py::test_state_defaults_to_constant_when_no_config -v
```
Expected: FAILED (TypeError: `process()` got unexpected keyword argument 'exam_config')

- [ ] **Step 3: Update orchestrator.py — process() signature + state init**

In `ai-service/agents/orchestrator.py`, make these two surgical changes:

**Change 1** — update `process()` signature (line 53):
```python
def process(self, user, lesson_id, message, lesson_context, progress,
            tutor, display, researcher, exam_config=None):
```

**Change 2** — in the state initialization block (the dict starting around line 75), add these two keys after `'exam_phase': 'answering',`:
```python
                # Exam configuration (set once on session init from client)
                'exam_question_count': (exam_config or {}).get('count', PRACTICE_EXAM_QUESTION_COUNT),
                'exam_timed': (exam_config or {}).get('timed', False),
```

**Change 3** — in `_process_practice_exam`, replace the hardcoded limit with state value. Find this block (around line 786):
```python
            qs = researcher.get_exam_questions(
                course_id=course_id,
                limit=PRACTICE_EXAM_QUESTION_COUNT,
                weights=weights if weights else None,
            )
```
Replace with:
```python
            count = state.get('exam_question_count', PRACTICE_EXAM_QUESTION_COUNT)
            qs = researcher.get_exam_questions(
                course_id=course_id,
                limit=count,
                weights=weights if weights else None,
            )
```

**Change 4** — in `_reset_and_start_exam`, replace the hardcoded limit (around line 1024):
```python
        qs = researcher.get_exam_questions(
            course_id=course_id,
            limit=PRACTICE_EXAM_QUESTION_COUNT,
            weights=weights if weights else None,
        )
```
Replace with:
```python
        count = state.get('exam_question_count', PRACTICE_EXAM_QUESTION_COUNT)
        qs = researcher.get_exam_questions(
            course_id=course_id,
            limit=count,
            weights=weights if weights else None,
        )
```
And update the intro text in `_reset_and_start_exam` that references `len(qs)` — already dynamic, no change needed.

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd /home/debian/projects/fsa/fsa-agent/ai-service
python -m pytest tests/test_orchestrator_debrief.py -v
```
Expected: 2 tests PASSED

- [ ] **Step 5: Commit**

```bash
cd /home/debian/projects/fsa/fsa-agent
git add ai-service/agents/orchestrator.py ai-service/tests/test_orchestrator_debrief.py
git commit -m "feat: orchestrator reads exam_config for dynamic question count and timer flag"
```

---

## Task 5: Orchestrator — enrich exam_results with objective data

**Files:**
- Modify: `ai-service/agents/orchestrator.py`

Context: Each question in `state['exam_questions']` already has `lesson_code`, `topic`, and `explanation` (loaded by `researcher.get_exam_questions`). When recording a wrong answer into `exam_results`, we need to copy these fields so the debrief can group by objective without another DB query.

- [ ] **Step 1: Write failing test**

Add this test to `ai-service/tests/test_orchestrator_debrief.py`:
```python
def test_exam_results_include_objective_enrichment():
    """Wrong answers in exam_results carry lesson_code, topic, explanation."""
    orch = Orchestrator()

    # Pre-seed state with two questions — first one the student gets wrong
    state = make_state({
        'exam_questions': [
            {
                'id': 10,
                'question_text': 'Q1',
                'options': ['A', 'B', 'C', 'D'],
                'correct_answer': 0,
                'explanation': 'Use Barlow formula.',
                'difficulty': 3,
                'topic': 'thickness_formula',
                'question_type': 'objective_practice',
                'chapter_id': '2B1-3',
                'course_id': '2B1',
                'lesson_code': '2B1-3-2',
            },
            {
                'id': 11,
                'question_text': 'Q2',
                'options': ['A', 'B', 'C', 'D'],
                'correct_answer': 1,
                'explanation': 'Pressure formula.',
                'difficulty': 3,
                'topic': 'pressure',
                'question_type': 'objective_practice',
                'chapter_id': '2B1-1',
                'course_id': '2B1',
                'lesson_code': '2B1-1-4',
            },
        ],
        'exam_index': 1,  # question 0 already presented
        'exam_results': [],
        'exam_init_hello': False,
    })
    orch.conversation_state['test@example.com:2B1'] = state

    mock_researcher = MagicMock()
    mock_researcher.record_response.return_value = None

    mock_display = MagicMock()
    mock_display.create_initial_display.return_value = None

    mock_tutor = MagicMock()
    mock_tutor.respond.return_value = {'response': '', 'action': None}

    # Student answers 'B' (wrong — correct is 'A' = index 0)
    orch._process_practice_exam(
        state=state,
        user='test@example.com',
        lesson_id='2B1',
        message='My answer is B',
        researcher=mock_researcher,
        display=mock_display,
        tutor=mock_tutor,
        lesson_context={'title': '2B1', 'summary': '', 'key_points': [], 'narration_text': '', 'video_transcript': ''},
        progress=None,
    )

    assert len(state['exam_results']) == 1
    result = state['exam_results'][0]
    assert result['correct'] is False
    assert result['lesson_code'] == '2B1-3-2'
    assert result['topic'] == 'thickness_formula'
    assert result['explanation'] == 'Use Barlow formula.'
```

- [ ] **Step 2: Run — confirm test fails**

```bash
cd /home/debian/projects/fsa/fsa-agent/ai-service
python -m pytest tests/test_orchestrator_debrief.py::test_exam_results_include_objective_enrichment -v
```
Expected: FAILED (exam_results entry missing lesson_code, topic, explanation keys)

- [ ] **Step 3: Enrich exam_results in _process_practice_exam**

In `ai-service/agents/orchestrator.py`, find the block that records the answer for the previous question (around line 825–840):
```python
        if idx > 0 and not state.get('exam_init_hello'):
            prev_q = questions[idx - 1]
            correct = self._evaluate_mc_answer(message, prev_q['correct_answer'])
            state['exam_results'].append({
                'chapter_id': prev_q['chapter_id'],
                'question_id': prev_q['id'],
                'correct': correct,
            })
```

Replace with:
```python
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
```

- [ ] **Step 4: Run — confirm test passes**

```bash
cd /home/debian/projects/fsa/fsa-agent/ai-service
python -m pytest tests/test_orchestrator_debrief.py -v
```
Expected: 3 tests PASSED

- [ ] **Step 5: Commit**

```bash
cd /home/debian/projects/fsa/fsa-agent
git add ai-service/agents/orchestrator.py ai-service/tests/test_orchestrator_debrief.py
git commit -m "feat: enrich exam_results with lesson_code, topic, explanation for debrief"
```

---

## Task 6: Orchestrator — enhanced debrief

**Files:**
- Modify: `ai-service/agents/orchestrator.py`

This task replaces `_generate_exam_debrief` with an enhanced version that:
1. Groups wrong answers by objective (`lesson_code`)
2. Makes one batched LLM call for teaching tips
3. Computes next-attempt allocation
4. Returns `objective_breakdowns` and `next_attempt_allocation` in `display_update`

- [ ] **Step 1: Write failing tests for debrief helpers**

Add these tests to `ai-service/tests/test_orchestrator_debrief.py`:
```python
def test_parse_lesson_code_extracts_chapter_and_objective():
    orch = Orchestrator()
    ch, obj = orch._parse_lesson_code('2B1-3-2', '')
    assert ch == '3'
    assert obj == '2'


def test_parse_lesson_code_falls_back_gracefully():
    orch = Orchestrator()
    ch, obj = orch._parse_lesson_code('', '2B1-3')
    assert ch == '3'
    assert obj == '?'


def test_group_wrong_by_objective():
    orch = Orchestrator()
    results = [
        {'correct': False, 'lesson_code': '2B1-3-2', 'chapter_id': '2B1-3',
         'topic': 'thickness', 'explanation': 'Use Barlow.', 'question_id': 1},
        {'correct': True,  'lesson_code': '2B1-1-1', 'chapter_id': '2B1-1',
         'topic': 'scope',     'explanation': 'Scope def.',   'question_id': 2},
        {'correct': False, 'lesson_code': '2B1-3-2', 'chapter_id': '2B1-3',
         'topic': 'thickness', 'explanation': 'Use Barlow.', 'question_id': 3},
    ]
    grouped = orch._group_wrong_by_objective(results)
    assert len(grouped) == 1
    assert '2B1-3-2' in grouped
    assert grouped['2B1-3-2']['count'] == 2


def test_group_wrong_falls_back_to_chapter_id_key():
    orch = Orchestrator()
    results = [
        {'correct': False, 'lesson_code': '', 'chapter_id': '2B1-3',
         'topic': 'pressure', 'explanation': 'P formula.', 'question_id': 5},
    ]
    grouped = orch._group_wrong_by_objective(results)
    assert '2B1-3' in grouped
```

- [ ] **Step 2: Run — confirm tests fail**

```bash
cd /home/debian/projects/fsa/fsa-agent/ai-service
python -m pytest tests/test_orchestrator_debrief.py::test_parse_lesson_code_extracts_chapter_and_objective tests/test_orchestrator_debrief.py::test_parse_lesson_code_falls_back_gracefully tests/test_orchestrator_debrief.py::test_group_wrong_by_objective tests/test_orchestrator_debrief.py::test_group_wrong_falls_back_to_chapter_id_key -v
```
Expected: 4 tests FAILED

- [ ] **Step 3: Add helper methods to Orchestrator**

Add these two methods to the `Orchestrator` class in `orchestrator.py`, immediately before `_generate_exam_debrief`:

```python
    def _parse_lesson_code(self, lesson_code, fallback_chapter_id=''):
        """
        Parse '2B1-3-2' → ('3', '2').  Returns ('?', '?') if unparseable.
        Falls back to chapter_id suffix if lesson_code is empty.
        """
        parts = lesson_code.split('-') if lesson_code else []
        if len(parts) == 3:
            return parts[1], parts[2]
        # Fallback: derive chapter number from chapter_id tail
        fb_parts = fallback_chapter_id.split('-') if fallback_chapter_id else []
        chap = fb_parts[-1] if len(fb_parts) >= 2 else '?'
        return chap, '?'

    def _group_wrong_by_objective(self, results):
        """
        Group wrong answers by objective key (lesson_code, or chapter_id as fallback).
        Returns {key: {lesson_code, chapter_id, topic, explanation, count}}
        """
        by_objective = {}
        for r in results:
            if r['correct']:
                continue
            key = r.get('lesson_code') or r.get('chapter_id', 'unknown')
            if key not in by_objective:
                by_objective[key] = {
                    'lesson_code': r.get('lesson_code', ''),
                    'chapter_id': r.get('chapter_id', ''),
                    'topic': r.get('topic', ''),
                    'explanation': r.get('explanation', ''),
                    'count': 0,
                }
            by_objective[key]['count'] += 1
            # Keep first non-empty explanation
            if not by_objective[key]['explanation'] and r.get('explanation'):
                by_objective[key]['explanation'] = r['explanation']
        return by_objective
```

- [ ] **Step 4: Run helper tests — confirm they pass**

```bash
cd /home/debian/projects/fsa/fsa-agent/ai-service
python -m pytest tests/test_orchestrator_debrief.py -v
```
Expected: all tests PASSED

- [ ] **Step 5: Add _call_llm_for_teaching_tips method**

Add this method to `Orchestrator`, after `_group_wrong_by_objective`:

```python
    def _call_llm_for_teaching_tips(self, prompt, expected_count):
        """
        Single batched LLM call that returns teaching tips for all missed objectives.
        Returns dict {1: 'tip text', 2: 'tip text', ...}.
        Falls back to empty dict on any error.
        """
        import re
        if not self._api_key or expected_count == 0:
            return {}
        try:
            session = requests.Session()
            session.headers.update({
                'Authorization': f'Bearer {self._api_key}',
                'Content-Type': 'application/json',
            })
            response = session.post(
                f'{self._base_url}/chat/completions',
                json={
                    'model': self._model,
                    'max_tokens': max(150, 100 * expected_count),
                    'messages': [
                        {
                            'role': 'system',
                            'content': 'You are an expert 2nd Class Power Engineering instructor.',
                        },
                        {'role': 'user', 'content': prompt},
                    ],
                },
                timeout=30,
            )
            response.raise_for_status()
            content = response.json()['choices'][0]['message']['content'].strip()

            # Parse numbered list: "1. tip\n\n2. tip"
            tips = {}
            pattern = re.compile(
                r'^\s*(\d+)\.\s+(.+?)(?=^\s*\d+\.|\Z)',
                re.MULTILINE | re.DOTALL,
            )
            for m in pattern.finditer(content):
                tips[int(m.group(1))] = m.group(2).strip()
            return tips

        except Exception as e:
            print(f'Orchestrator._call_llm_for_teaching_tips error: {e}')
            return {}
```

- [ ] **Step 6: Replace _generate_exam_debrief**

In `ai-service/agents/orchestrator.py`, replace the entire `_generate_exam_debrief` method (lines 893–1006) with:

```python
    def _generate_exam_debrief(self, state, user, course_id, first_name,
                                researcher, tutor, lesson_context, progress):
        """Generate the end-of-exam debrief with objective-level teaching tips."""
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

        # --- Enrich any wrong answers missing lesson_code (edge case fallback) ---
        wrong_missing = [
            r['question_id'] for r in results
            if not r['correct'] and not r.get('lesson_code')
        ]
        if wrong_missing:
            enrichment = researcher.get_questions_by_ids(wrong_missing)
            for r in results:
                if not r['correct'] and not r.get('lesson_code') and r['question_id'] in enrichment:
                    r.update(enrichment[r['question_id']])

        # --- Group wrong answers by objective ---
        by_objective = self._group_wrong_by_objective(results)

        # --- Generate teaching tips via single batched LLM call ---
        objective_breakdowns = []
        if by_objective:
            objectives_list = list(by_objective.values())
            numbered_lines = []
            for i, obj in enumerate(objectives_list, 1):
                chap_num, obj_num = self._parse_lesson_code(obj['lesson_code'], obj['chapter_id'])
                topic_label = obj['topic'].replace('_', ' ') if obj['topic'] else 'general concept'
                explanation = obj['explanation'] or 'No additional context available.'
                numbered_lines.append(
                    f"{i}. Chapter {chap_num} Objective {obj_num} (topic: {topic_label})\n"
                    f"   Explanation: {explanation}"
                )

            batch_prompt = (
                f"A student studying for the 2nd Class Power Engineering exam missed questions "
                f"on the following objectives. For each, write a 2-3 sentence teaching tip "
                f"that identifies what the student needs to remember or watch for — concrete "
                f"guidance specific to power engineering that helps them get it right next time. "
                f"Format your response as a numbered list matching the objective numbers.\n\n"
                + '\n\n'.join(numbered_lines)
            )
            tips = self._call_llm_for_teaching_tips(batch_prompt, len(objectives_list))

            for i, obj in enumerate(objectives_list):
                chap_num, obj_num = self._parse_lesson_code(obj['lesson_code'], obj['chapter_id'])
                topic_label = obj['topic'].replace('_', ' ') if obj['topic'] else 'general concept'
                objective_breakdowns.append({
                    'lesson_code': obj['lesson_code'],
                    'chapter_id': obj['chapter_id'],
                    'chapter_num': chap_num,
                    'objective_num': obj_num,
                    'topic': topic_label,
                    'teaching_tip': tips.get(i + 1, obj['explanation'] or ''),
                    'wrong_count': obj['count'],
                })

        # --- Aggregate chapter stats ---
        chapter_stats = {}
        for r in results:
            cid = r['chapter_id'] or 'Unknown'
            chapter_stats.setdefault(cid, {'correct': 0, 'total': 0})
            chapter_stats[cid]['total'] += 1
            if r['correct']:
                chapter_stats[cid]['correct'] += 1

        total_q = len(results)
        total_correct = sum(1 for r in results if r['correct'])
        score_pct = int(total_correct / total_q * 100) if total_q else 0

        chapter_lines = []
        weak_chapters, strong_chapters = [], []
        for cid, s in sorted(chapter_stats.items()):
            pct = int(s['correct'] / s['total'] * 100) if s['total'] else 0
            status = 'Strong' if pct >= 70 else ('Needs review' if pct < 50 else 'Developing')
            chapter_lines.append({
                'chapter': cid, 'correct': s['correct'],
                'total': s['total'], 'pct': pct, 'status': status,
            })
            if pct < 60:
                weak_chapters.append(cid)
            elif pct >= 75:
                strong_chapters.append(cid)

        # --- Compute next-attempt allocation ---
        fresh_weights = {
            cid: {'accuracy': s['correct'] / s['total'] if s['total'] else 0.5, 'total': s['total']}
            for cid, s in chapter_stats.items()
        }
        exam_count = state.get('exam_question_count', PRACTICE_EXAM_QUESTION_COUNT)
        all_chapters = list(chapter_stats.keys())
        next_allocation = self._compute_chapter_allocations(all_chapters, exam_count, fresh_weights)

        # --- Build tutor debrief message ---
        missed_obj_mentions = []
        for obj in objective_breakdowns[:3]:
            missed_obj_mentions.append(
                f"Chapter {obj['chapter_num']} Objective {obj['objective_num']} ({obj['topic']})"
            )
        weak_str = ', '.join(weak_chapters) if weak_chapters else 'none'
        strong_str = ', '.join(strong_chapters) if strong_chapters else 'none'
        missed_str = ', '.join(missed_obj_mentions) if missed_obj_mentions else ''

        debrief_prompt = (
            f"The student {first_name} just completed a {total_q}-question practice exam for {course_id}.\n"
            f"Overall: {total_correct}/{total_q} ({score_pct}%)\n"
            f"Strong chapters: {strong_str}\n"
            f"Chapters needing review: {weak_str}\n"
            + (f"Missed objectives: {missed_str}\n" if missed_str else '')
            + f"\nWrite a warm, concise debrief (4-6 sentences). Acknowledge their score. "
            f"Highlight 1-2 strong chapters if any. "
            + (f"Reference the specific missed objectives by name ({missed_str}) and say you've added teaching notes below. " if missed_str else '')
            + f"Mention the next exam will be weighted to their weak areas. "
            f"End by asking if they'd like to try again. Address them as {first_name}."
        )

        debrief_state = {
            'activity': 'exam_debrief',
            'mode': 'practice_exam',
            'complexity_level': state.get('complexity_level', 3),
            'questions_done': total_q,
            'session_limit_reached': False,
            'chat_history': state.get('chat_history', []),
            'relevant_chunks': [],
            'display_is_question': False,
            'awaiting_next_question': False,
            'is_resume': False,
            'no_questions_available': False,
            'first_name': first_name,
            'exam_debrief_prompt': debrief_prompt,
        }

        tutor_result = tutor.respond(
            user_message=debrief_prompt,
            lesson_context={'title': f'{course_id} Practice Exam', 'summary': '', 'key_points': [],
                            'narration_text': '', 'video_transcript': ''},
            progress=progress,
            state=debrief_state,
            first_name=first_name,
        )
        tutor_response = tutor_result.get('response', '') if isinstance(tutor_result, dict) else str(tutor_result)

        return {
            'tutor_response': tutor_response,
            'display_update': {
                'type': 'exam_done',
                'title': f'{course_id} Exam Results',
                'score': total_correct,
                'total': total_q,
                'score_pct': score_pct,
                'chapter_stats': chapter_lines,
                'objective_breakdowns': objective_breakdowns,
                'next_attempt_allocation': next_allocation,
            },
            'progress_update': {},
            'complexity_level': state['complexity_level'],
            'first_name': first_name,
            'action': None,
            'mode': 'practice_exam',
        }
```

- [ ] **Step 7: Remove the duplicate _is_exam_retry and _reset_and_start_exam methods**

The current `orchestrator.py` has `_is_exam_retry` and `_reset_and_start_exam` defined **twice** (lines 1012–1079 and again 1085–1152). Delete the second copy of each (the one starting at line 1085). Keep only the first definition.

- [ ] **Step 8: Run all tests — confirm they pass**

```bash
cd /home/debian/projects/fsa/fsa-agent/ai-service
python -m pytest tests/ -v
```
Expected: all tests PASSED

- [ ] **Step 9: Rebuild and smoke-test the AI service**

```bash
cd /home/debian/projects/fsa
docker compose --env-file .env build ai-service && \
docker compose --env-file .env up -d ai-service
docker compose --env-file .env logs ai-service --tail=20
```
Expected: service starts, no import errors

- [ ] **Step 10: Commit**

```bash
cd /home/debian/projects/fsa/fsa-agent
git add ai-service/agents/orchestrator.py ai-service/tests/test_orchestrator_debrief.py
git commit -m "feat: enhanced exam debrief with objective grouping, batched LLM teaching tips, next-attempt allocation"
```

---

## Task 7: CountdownTimer React component

**Files:**
- Create: `client/src/CountdownTimer.jsx`
- Modify: `client/src/index.css`

- [ ] **Step 1: Create CountdownTimer.jsx**

Create `client/src/CountdownTimer.jsx`:
```jsx
import React, { useState, useEffect, useRef } from 'react';

/**
 * Countdown timer for timed exams.
 * Counts down from totalSeconds to 0, then counts upward showing time over.
 * Stops when stopped prop is true (e.g. when debrief is shown).
 */
export function CountdownTimer({ totalSeconds, stopped = false }) {
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (stopped) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [stopped]);

  const remaining = totalSeconds - elapsed;
  const isOver = remaining <= 0;
  const displaySeconds = isOver ? -remaining : remaining;

  const h = Math.floor(displaySeconds / 3600);
  const m = Math.floor((displaySeconds % 3600) / 60);
  const s = displaySeconds % 60;

  const formatted = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;

  const display = isOver ? `+${formatted}` : formatted;
  const warn = !isOver && remaining <= 600; // amber under 10 minutes

  return (
    <span className={`exam-timer${isOver ? ' exam-timer--over' : warn ? ' exam-timer--warn' : ''}`}>
      ⏱ {display}
    </span>
  );
}
```

- [ ] **Step 2: Add CSS for timer**

Append to `client/src/index.css`:
```css
/* ── Countdown Timer ──────────────────────────────────────── */
.exam-timer {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 0.95rem;
  letter-spacing: 0.03em;
  color: #374151;
}
.exam-timer--warn { color: #d97706; }
.exam-timer--over { color: #dc2626; }
```

- [ ] **Step 3: Commit**

```bash
cd /home/debian/projects/fsa/fsa-agent
git add client/src/CountdownTimer.jsx client/src/index.css
git commit -m "feat: CountdownTimer component with amber/red states and post-zero count-up"
```

---

## Task 8: PracticeExamLobby React component

**Files:**
- Create: `client/src/PracticeExamLobby.jsx`
- Modify: `client/src/index.css`

- [ ] **Step 1: Create PracticeExamLobby.jsx**

Create `client/src/PracticeExamLobby.jsx`:
```jsx
import React, { useState, useEffect } from 'react';

const COUNT_OPTIONS = [
  { count: 25,  label: '25 Questions', sublabel: '~45 min' },
  { count: 50,  label: '50 Questions', sublabel: '~1.5 hrs' },
  { count: 100, label: '100 Questions', sublabel: '~3 hrs' },
];

/**
 * Pre-exam lobby. Shows:
 *   Left panel  — question count selector, timer toggle, Start button.
 *   Right panel — per-chapter quiz buttons for inline chapter practice.
 *
 * Props:
 *   courseId       string   e.g. '2B1'
 *   lessonTitle    string   display name
 *   onStartExam    fn({count, timed}) — called when student clicks Start
 *   onSelectChapter fn(chapterId)     — called when a chapter button is clicked
 */
export function PracticeExamLobby({ courseId, lessonTitle, onStartExam, onSelectChapter }) {
  const [selectedCount, setSelectedCount] = useState(null);
  const [timed, setTimed] = useState(false);
  const [chapters, setChapters] = useState([]);
  const [chaptersLoading, setChaptersLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/exam/${encodeURIComponent(courseId)}/chapters`)
      .then(r => r.json())
      .then(data => setChapters(data.chapters || []))
      .catch(() => setChapters([]))
      .finally(() => setChaptersLoading(false));
  }, [courseId]);

  const handleStart = () => {
    if (!selectedCount) return;
    onStartExam({ count: selectedCount, timed });
  };

  return (
    <div className="lobby-page">
      <h1 className="lobby-title">{lessonTitle || courseId}</h1>
      <p className="lobby-subtitle">Choose how you want to practise</p>

      <div className="lobby-panels">
        {/* ── Practice Exam panel ── */}
        <div className="lobby-panel">
          <h2 className="lobby-panel-heading">Practice Exam</h2>
          <p className="lobby-panel-desc">
            Adaptive exam drawn from all chapters — weighted to your weak areas after each attempt.
          </p>

          <div className="lobby-count-options">
            {COUNT_OPTIONS.map(opt => (
              <button
                key={opt.count}
                className={`lobby-count-btn${selectedCount === opt.count ? ' lobby-count-btn--selected' : ''}`}
                onClick={() => setSelectedCount(opt.count)}
              >
                <span className="lobby-count-label">{opt.label}</span>
                <span className="lobby-count-sublabel">{opt.sublabel}</span>
              </button>
            ))}
          </div>

          <label className="lobby-timer-toggle">
            <input
              type="checkbox"
              checked={timed}
              onChange={e => setTimed(e.target.checked)}
            />
            <span className="lobby-timer-label">⏱ Timed Exam</span>
          </label>
          {timed && (
            <p className="lobby-timer-note">Countdown starts when your first question loads.</p>
          )}

          <button
            className="lobby-start-btn"
            onClick={handleStart}
            disabled={!selectedCount}
          >
            Start Exam →
          </button>
        </div>

        {/* ── Chapter Quizzes panel ── */}
        <div className="lobby-panel">
          <h2 className="lobby-panel-heading">Chapter Quizzes</h2>
          <p className="lobby-panel-desc">
            Drill a specific chapter with a focused 8-question quiz.
          </p>

          {chaptersLoading ? (
            <p className="lobby-loading">Loading chapters…</p>
          ) : chapters.length === 0 ? (
            <p className="lobby-loading">No chapter quizzes available yet.</p>
          ) : (
            <div className="lobby-chapter-grid">
              {chapters.map(chapterId => {
                // Display as "Chapter N" by extracting the trailing number
                const parts = chapterId.split('-');
                const label = parts.length >= 2 ? `Chapter ${parts[parts.length - 1]}` : chapterId;
                return (
                  <button
                    key={chapterId}
                    className="lobby-chapter-btn"
                    onClick={() => onSelectChapter(chapterId)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add lobby CSS**

Append to `client/src/index.css`:
```css
/* ── Lobby ────────────────────────────────────────────────── */
.lobby-page {
  max-width: 860px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}
.lobby-title {
  font-size: 1.6rem;
  font-weight: 700;
  margin-bottom: 0.25rem;
  color: #111827;
}
.lobby-subtitle {
  color: #6b7280;
  margin-bottom: 2rem;
  font-size: 1rem;
}
.lobby-panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
}
@media (max-width: 600px) {
  .lobby-panels { grid-template-columns: 1fr; }
}
.lobby-panel {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.lobby-panel-heading {
  font-size: 1.1rem;
  font-weight: 700;
  color: #111827;
  margin: 0;
}
.lobby-panel-desc {
  font-size: 0.875rem;
  color: #6b7280;
  margin: 0;
  line-height: 1.5;
}
.lobby-count-options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.lobby-count-btn {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  text-align: left;
}
.lobby-count-btn:hover { border-color: #6366f1; }
.lobby-count-btn--selected { border-color: #6366f1; background: #eef2ff; }
.lobby-count-label { font-weight: 600; font-size: 0.95rem; color: #111827; }
.lobby-count-sublabel { font-size: 0.8rem; color: #6b7280; }
.lobby-timer-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}
.lobby-timer-label { font-size: 0.9rem; font-weight: 500; color: #374151; }
.lobby-timer-note { font-size: 0.8rem; color: #6b7280; margin: 0; }
.lobby-start-btn {
  margin-top: auto;
  padding: 0.75rem 1.5rem;
  background: #6366f1;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.lobby-start-btn:hover:not(:disabled) { background: #4f46e5; }
.lobby-start-btn:disabled { background: #c7d2fe; cursor: not-allowed; }
.lobby-loading { font-size: 0.875rem; color: #9ca3af; }
.lobby-chapter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 0.5rem;
}
.lobby-chapter-btn {
  padding: 0.6rem 0.5rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  color: #374151;
}
.lobby-chapter-btn:hover { border-color: #6366f1; background: #eef2ff; color: #4f46e5; }
```

- [ ] **Step 3: Commit**

```bash
cd /home/debian/projects/fsa/fsa-agent
git add client/src/PracticeExamLobby.jsx client/src/index.css
git commit -m "feat: PracticeExamLobby component with exam config and chapter quiz selection"
```

---

## Task 9: TeachingNotes + NextAttemptPreview React components

**Files:**
- Create: `client/src/TeachingNotes.jsx`
- Modify: `client/src/index.css`

- [ ] **Step 1: Create TeachingNotes.jsx**

Create `client/src/TeachingNotes.jsx`:
```jsx
import React from 'react';

/**
 * TeachingNotes
 * Renders one card per missed objective with the LLM teaching tip.
 * If the chapter score is below 50%, shows a "Try Chapter Quiz" button.
 *
 * Props:
 *   objectiveBreakdowns  array  from display_update.objective_breakdowns
 *   chapterStats         array  from display_update.chapter_stats [{chapter, pct, ...}]
 *   onSelectChapter      fn(chapterId) — triggers inline chapter quiz
 */
export function TeachingNotes({ objectiveBreakdowns, chapterStats, onSelectChapter }) {
  if (!objectiveBreakdowns || objectiveBreakdowns.length === 0) return null;

  // Build a quick lookup: chapter_id → pct
  const chapterPctMap = {};
  (chapterStats || []).forEach(c => { chapterPctMap[c.chapter] = c.pct; });

  return (
    <div className="teaching-notes">
      <h2 className="teaching-notes-heading">Where to focus</h2>
      {objectiveBreakdowns.map((obj, i) => {
        const chapterPct = chapterPctMap[obj.chapter_id] ?? 100;
        const showQuizBtn = chapterPct < 50;
        return (
          <div key={i} className="teaching-card">
            <div className="teaching-card-header">
              <span className="teaching-card-location">
                Chapter {obj.chapter_num} · Objective {obj.objective_num}
              </span>
              {obj.topic && (
                <span className="teaching-card-topic">{obj.topic}</span>
              )}
            </div>
            <p className="teaching-card-tip">{obj.teaching_tip}</p>
            {showQuizBtn && (
              <button
                className="teaching-card-quiz-btn"
                onClick={() => onSelectChapter(obj.chapter_id)}
              >
                📝 Try the Chapter Quiz instead →
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * NextAttemptPreview
 * Shows a visual breakdown of the predicted question allocation for the next exam.
 *
 * Props:
 *   nextAttemptAllocation  object  {chapter_id: count}
 *   totalCount             number  total questions in the exam
 */
export function NextAttemptPreview({ nextAttemptAllocation, totalCount }) {
  if (!nextAttemptAllocation) return null;

  const entries = Object.entries(nextAttemptAllocation).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return null;

  const numChapters = entries.length;
  const baseline = Math.round(totalCount / numChapters);
  const maxCount = Math.max(...entries.map(([, c]) => c));

  return (
    <div className="next-attempt-preview">
      <h2 className="next-attempt-heading">Your next exam will look like this</h2>
      <div className="next-attempt-rows">
        {entries.map(([chapterId, count]) => {
          const barWidth = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
          const moreFocus = count > baseline;
          // Display as "Chapter N"
          const parts = chapterId.split('-');
          const label = parts.length >= 2 ? `Chapter ${parts[parts.length - 1]}` : chapterId;
          return (
            <div key={chapterId} className="next-attempt-row">
              <span className="next-attempt-label">{label}</span>
              <div className="next-attempt-bar-wrap">
                <div className="next-attempt-bar" style={{ width: `${barWidth}%` }} />
              </div>
              <span className="next-attempt-count">{count}q</span>
              {moreFocus && (
                <span className="next-attempt-flag">↑ more focus</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add CSS for teaching notes and next attempt preview**

Append to `client/src/index.css`:
```css
/* ── Teaching Notes ───────────────────────────────────────── */
.teaching-notes { margin-top: 1.5rem; }
.teaching-notes-heading {
  font-size: 1rem;
  font-weight: 700;
  color: #111827;
  margin-bottom: 0.75rem;
}
.teaching-card {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 10px;
  padding: 1rem 1.25rem;
  margin-bottom: 0.75rem;
}
.teaching-card-header {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.teaching-card-location {
  font-weight: 700;
  font-size: 0.875rem;
  color: #92400e;
}
.teaching-card-topic {
  font-size: 0.8rem;
  color: #b45309;
  background: #fef3c7;
  border-radius: 4px;
  padding: 1px 6px;
}
.teaching-card-tip {
  font-size: 0.9rem;
  color: #374151;
  line-height: 1.6;
  margin: 0 0 0.75rem;
}
.teaching-card-quiz-btn {
  font-size: 0.85rem;
  font-weight: 600;
  color: #4f46e5;
  background: none;
  border: 1px solid #c7d2fe;
  border-radius: 6px;
  padding: 0.4rem 0.75rem;
  cursor: pointer;
  transition: background 0.15s;
}
.teaching-card-quiz-btn:hover { background: #eef2ff; }

/* ── Next Attempt Preview ─────────────────────────────────── */
.next-attempt-preview { margin-top: 1.5rem; }
.next-attempt-heading {
  font-size: 1rem;
  font-weight: 700;
  color: #111827;
  margin-bottom: 0.75rem;
}
.next-attempt-rows { display: flex; flex-direction: column; gap: 0.4rem; }
.next-attempt-row {
  display: grid;
  grid-template-columns: 90px 1fr 36px auto;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}
.next-attempt-label { color: #374151; font-weight: 500; }
.next-attempt-bar-wrap {
  height: 8px;
  background: #e5e7eb;
  border-radius: 4px;
  overflow: hidden;
}
.next-attempt-bar {
  height: 100%;
  background: #6366f1;
  border-radius: 4px;
  transition: width 0.4s ease;
}
.next-attempt-count { color: #6b7280; text-align: right; }
.next-attempt-flag { font-size: 0.75rem; color: #dc2626; font-weight: 600; white-space: nowrap; }
```

- [ ] **Step 3: Commit**

```bash
cd /home/debian/projects/fsa/fsa-agent
git add client/src/TeachingNotes.jsx client/src/index.css
git commit -m "feat: TeachingNotes and NextAttemptPreview components"
```

---

## Task 10: App.jsx — wire everything together

**Files:**
- Modify: `client/src/App.jsx`

This task makes four focused changes to App.jsx:
1. Import new components
2. Add lobby phase routing for `practice_exam` mode
3. Update `QuizExamView` to accept and use `examConfig` + show timer
4. Update `ResultsPanel` to render teaching notes, next-attempt preview, and chapter quiz buttons

- [ ] **Step 1: Add imports at the top of App.jsx**

After the existing imports (after line 7, `import 'katex/dist/katex.min.css';`), add:
```jsx
import { CountdownTimer } from './CountdownTimer.jsx';
import { PracticeExamLobby } from './PracticeExamLobby.jsx';
import { TeachingNotes, NextAttemptPreview } from './TeachingNotes.jsx';
```

- [ ] **Step 2: Update App() to use lobby phase routing for practice_exam**

In `App.jsx`, find the `practice_exam` render block (lines 160–175):
```jsx
  // Quiz and exam modes: no tabs, full page
  if (mode === 'chapter_quiz' || mode === 'practice_exam') {
    return (
      <ErrorBoundary>
        <div className="app-container app-fullpage">
          <QuizExamView
            lesson={lesson}
            user={user}
            lessonId={lessonId}
            mode={mode}
            chatState={chatState}
            setChatState={setChatState}
          />
        </div>
      </ErrorBoundary>
    );
  }
```

Replace it with:
```jsx
  // Chapter quiz mode (direct URL, not from lobby): no tabs, full page
  if (mode === 'chapter_quiz') {
    return (
      <ErrorBoundary>
        <div className="app-container app-fullpage">
          <QuizExamView
            lesson={lesson}
            user={user}
            lessonId={lessonId}
            mode={mode}
            chatState={chatState}
            setChatState={setChatState}
            examConfig={null}
          />
        </div>
      </ErrorBoundary>
    );
  }

  // Practice exam mode: show lobby first, then exam or inline chapter quiz
  if (mode === 'practice_exam') {
    return (
      <ErrorBoundary>
        <div className="app-container app-fullpage">
          <PracticeExamRouter
            lesson={lesson}
            user={user}
            lessonId={lessonId}
            chatState={chatState}
            setChatState={setChatState}
          />
        </div>
      </ErrorBoundary>
    );
  }
```

- [ ] **Step 3: Add PracticeExamRouter component**

Add this new component to App.jsx, before the `QuizExamView` function definition:
```jsx
// ---------------------------------------------------------------------------
// Practice exam routing (lobby → exam or chapter quiz)
// ---------------------------------------------------------------------------

function PracticeExamRouter({ lesson, user, lessonId, chatState, setChatState }) {
  // phase: 'lobby' | 'exam' | 'chapter_quiz'
  const [phase, setPhase] = React.useState('lobby');
  const [examConfig, setExamConfig] = React.useState(null);       // {count, timed}
  const [activeChapterId, setActiveChapterId] = React.useState(null);
  const [returnPhase, setReturnPhase] = React.useState('lobby');  // where Back goes

  const handleStartExam = (config) => {
    setExamConfig(config);
    setPhase('exam');
  };

  const handleSelectChapter = (chapterId) => {
    // Remember where to return when Back is pressed
    setReturnPhase(phase);
    setActiveChapterId(chapterId);
    setPhase('chapter_quiz');
    // Reset chat state so the chapter quiz initialises cleanly
    setChatState({ messages: [], displayContent: null, complexityLevel: 3, examProgress: null });
  };

  const handleBack = () => {
    setPhase(returnPhase);
    setActiveChapterId(null);
    // Reset chat state when returning to lobby so a fresh exam can start
    if (returnPhase === 'lobby') {
      setChatState({ messages: [], displayContent: null, complexityLevel: 3, examProgress: null });
    }
  };

  if (phase === 'lobby') {
    return (
      <PracticeExamLobby
        courseId={lessonId}
        lessonTitle={lesson?.title}
        onStartExam={handleStartExam}
        onSelectChapter={handleSelectChapter}
      />
    );
  }

  if (phase === 'chapter_quiz') {
    return (
      <div className="quizexam-with-back">
        <div className="quizexam-back-bar">
          <button className="quizexam-back-btn" onClick={handleBack}>
            ← Back to Exam
          </button>
        </div>
        <QuizExamView
          lesson={lesson}
          user={user}
          lessonId={activeChapterId}
          mode="chapter_quiz"
          chatState={chatState}
          setChatState={setChatState}
          examConfig={null}
          onSelectChapter={null}
        />
      </div>
    );
  }

  // phase === 'exam'
  return (
    <QuizExamView
      lesson={lesson}
      user={user}
      lessonId={lessonId}
      mode="practice_exam"
      chatState={chatState}
      setChatState={setChatState}
      examConfig={examConfig}
      onSelectChapter={handleSelectChapter}
    />
  );
}
```

- [ ] **Step 4: Update QuizExamView signature and add examConfig to init call + timer**

Find `function QuizExamView({ lesson, user, lessonId, mode, chatState, setChatState })` and replace the signature with:
```jsx
function QuizExamView({ lesson, user, lessonId, mode, chatState, setChatState, examConfig, onSelectChapter }) {
```

In the `useEffect` auto-init block (around line 243), update the fetch body to include `examConfig`:
```jsx
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user,
          lessonId,
          message: 'hello',
          ...(examConfig ? { examConfig } : {}),
        }),
      })
```

In the `return` of `QuizExamView`, find the header bar section and update it to include the timer:
```jsx
      {/* Header bar */}
      <div className="quizexam-header">
        <span className="quizexam-title">{lesson?.title || lessonId}</span>
        <div className="quizexam-header-right">
          {isExam && examProgress && !isDone && (
            <ExamProgressBar current={examProgress.current} total={examProgress.total} />
          )}
          {!isExam && displayContent?.type === 'quiz_progress' && !isDone && (
            <ExamProgressBar
              current={displayContent.questions_done}
              total={displayContent.total}
              correct={displayContent.correct}
            />
          )}
          {isExam && examConfig?.timed && examProgress && !isDone && (
            <CountdownTimer
              totalSeconds={{ 25: 2700, 50: 5400, 100: 10800 }[examConfig.count] ?? 5400}
              stopped={isDone}
            />
          )}
        </div>
      </div>
```

Add the CSS for the header layout to `client/src/index.css`:
```css
.quizexam-header-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}
```

- [ ] **Step 5: Update ResultsPanel to render teaching notes and next-attempt preview**

Find `function ResultsPanel({ displayContent, isExam, onRetry })` and replace with:
```jsx
function ResultsPanel({ displayContent, isExam, onRetry, onSelectChapter }) {
  const { score, total, score_pct, chapter_stats,
          objective_breakdowns, next_attempt_allocation } = displayContent;
  const scoreColor = score_pct >= 75 ? '#16a34a' : score_pct >= 55 ? '#d97706' : '#dc2626';
  const [retrying, setRetrying] = React.useState(false);

  const handleRetry = () => {
    setRetrying(true);
    onRetry();
  };

  return (
    <div className="results-panel">
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

      {objective_breakdowns && objective_breakdowns.length > 0 && (
        <TeachingNotes
          objectiveBreakdowns={objective_breakdowns}
          chapterStats={chapter_stats}
          onSelectChapter={onSelectChapter}
        />
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
}
```

- [ ] **Step 6: Pass onSelectChapter into ResultsPanel from QuizExamDisplaySection**

Find `function QuizExamDisplaySection({ displayContent, onAnswer, isExam, mode })` and add `onSelectChapter` to its props:
```jsx
function QuizExamDisplaySection({ displayContent, onAnswer, isExam, mode, onSelectChapter }) {
```

In that function, find the `ResultsPanel` render (around line 696):
```jsx
    return <ResultsPanel displayContent={displayContent} isExam={isExam} onRetry={isExam ? () => onAnswer('yes') : null} />;
```
Replace with:
```jsx
    return (
      <ResultsPanel
        displayContent={displayContent}
        isExam={isExam}
        onRetry={isExam ? () => onAnswer('yes') : null}
        onSelectChapter={onSelectChapter}
      />
    );
```

In `QuizExamView`'s return, find `<QuizExamDisplaySection` and add `onSelectChapter`:
```jsx
          <QuizExamDisplaySection
            displayContent={displayContent}
            onAnswer={sendAnswer}
            mode={mode}
            isExam={isExam}
            onSelectChapter={onSelectChapter}
          />
```

- [ ] **Step 7: Add CSS for back bar and quizexam-with-back layout**

Append to `client/src/index.css`:
```css
/* ── Chapter quiz back bar ────────────────────────────────── */
.quizexam-with-back { display: flex; flex-direction: column; height: 100%; }
.quizexam-back-bar {
  padding: 0.5rem 1rem;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}
.quizexam-back-btn {
  background: none;
  border: none;
  color: #6366f1;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0.25rem 0;
}
.quizexam-back-btn:hover { color: #4f46e5; }
```

- [ ] **Step 8: Build and full integration test**

```bash
cd /home/debian/projects/fsa/fsa-agent/client
npm run build
cd ..
docker compose --env-file /home/debian/projects/fsa/.env build api && \
docker compose --env-file /home/debian/projects/fsa/.env up -d api
docker compose --env-file /home/debian/projects/fsa/.env logs api --tail=20
```
Expected: build succeeds, container starts, no errors

- [ ] **Step 9: Smoke test in browser**

Open `https://fsachat.fullsteamahead.ca?user=<test-email>&lesson=2B1`

Verify:
1. Lobby screen loads — two panels visible
2. Chapters appear in the right panel
3. Selecting a question count enables the Start button
4. Timer toggle shows/hides the countdown note
5. Clicking a chapter button shows chapter quiz with Back button
6. Back button returns to lobby
7. Starting exam with timed enabled shows countdown in header
8. Countdown goes amber at 10min, red at 0, then counts up with `+`

Use the existing demo endpoint to fast-track to debrief:
```bash
curl -X POST https://fsachat.fullsteamahead.ca/api/demo/exam-debrief \
  -H "Content-Type: application/json" \
  -d '{"user":"test@example.com","lessonId":"2B1"}'
```
Then open `https://fsachat.fullsteamahead.ca?user=test@example.com&lesson=2B1` and send any message to trigger the debrief. Verify:
- Teaching cards appear per missed objective
- Next Attempt Preview table renders with bars
- "Try Chapter Quiz" appears on cards where chapter pct < 50

- [ ] **Step 10: Commit**

```bash
cd /home/debian/projects/fsa/fsa-agent
git add client/src/App.jsx client/src/index.css
git commit -m "feat: wire lobby, timer, and enhanced debrief into App — practice exam enhancements complete"
```

---

## Final deploy

- [ ] **Rebuild and deploy both services**

```bash
cd /home/debian/projects/fsa

# AI service
docker compose --env-file .env build ai-service && \
docker compose --env-file .env up -d ai-service

# API + React client (build React first)
cd fsa-agent/client && npm run build && cd ../.. && \
docker compose --env-file .env -f fsa-agent/docker-compose.yml build api && \
docker compose --env-file .env -f fsa-agent/docker-compose.yml up -d api
```

- [ ] **Verify both containers healthy**

```bash
docker compose --env-file /home/debian/projects/fsa/.env logs ai-service --tail=10
docker compose --env-file /home/debian/projects/fsa/.env logs api --tail=10
```
Expected: no errors, both containers running
