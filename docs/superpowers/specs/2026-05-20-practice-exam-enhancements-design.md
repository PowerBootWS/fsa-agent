# Practice Exam Enhancements — Design Spec

**Date:** 2026-05-20  
**Status:** Approved  
**Scope:** fsa-agent (React client + Express API + Python AI service)  
**Out of scope:** Question generation (separate activity)

---

## Overview

Transforms the practice exam from a score-and-retry loop into a tutoring experience. Five interconnected enhancements:

1. Pre-exam lobby with configuration (question count, timer, chapter quiz access)
2. Countdown timer during timed exams
3. Objective-level tutoring debrief with LLM teaching tips
4. Next-attempt preview showing predicted question allocation
5. "Try Chapter Quiz" shortcut on weak-chapter teaching cards

---

## 1. Lobby Screen

### Trigger
When `mode === 'practice_exam'` (lessonId matches `^[A-Z0-9]{2,5}$`), render `PracticeExamLobby` instead of jumping straight into `QuizExamView`.

### Layout
Two panels side by side (stacked on narrow screens):

**Left — Practice Exam panel**
- Question count selector: three mutually exclusive buttons
  - `25 Questions · ~45 min`
  - `50 Questions · ~1.5 hrs`
  - `100 Questions · ~3 hrs`
- Timer toggle: `⏱ Timed Exam` (on/off). When on: note "Countdown starts when your first question loads."
- "Start Exam" CTA (disabled until a count is selected)

**Right — Chapter Quizzes panel**
- One button per chapter, fetched from `GET /api/exam/:courseId/chapters`
- Clicking a chapter button starts that chapter's quiz inline (no page navigation)

### Chapter list endpoint (new)
`GET /api/exam/:courseId/chapters` — Express route, queries DB directly:
```sql
SELECT DISTINCT chapter_id FROM questions
WHERE course_id = $1 AND chapter_id IS NOT NULL
  AND options IS NOT NULL AND jsonb_array_length(options) > 0
ORDER BY chapter_id
```
Returns `{ chapters: ["2B1-1", "2B1-2", ...] }`.

### Exam start config
On "Start Exam", client sends:
```json
POST /api/chat
{ "user": "...", "lessonId": "2B1", "message": "hello",
  "examConfig": { "count": 50, "timed": true } }
```
The Express chat route forwards `examConfig` to the Python AI service. Orchestrator reads it on session init and stores `exam_question_count` and `exam_timed` in conversation state. `PRACTICE_EXAM_QUESTION_COUNT` constant is replaced by this dynamic value.

### Inline chapter quiz navigation
When a chapter button is clicked (from lobby or from a teaching card):
- React updates local state: `{ lobbyMode: 'chapter_quiz', chapterLessonId: '2B1-3' }`
- Renders `QuizExamView` with `lessonId = '2B1-3'`
- Existing chapter quiz flow handles the session as normal
- Header shows **"← Back to Exam"** button that returns React state to `{ lobbyMode: 'lobby' }`
- No page navigation, no iframe reload

---

## 2. Countdown Timer

### Scope
Pure React — no backend involvement.

### Behaviour
- Only rendered when `examConfig.timed === true` and exam is in answering phase
- Starts counting down from configured duration when first question loads
  - 25 questions: 45:00 (45 minutes)
  - 50 questions: 90:00 (1 hour 30 minutes)
  - 100 questions: 180:00 (3 hours)
- Display format: `H:MM:SS` (e.g. `1:29:43`)
- At 10 minutes remaining: text colour amber
- At 0:00:00: text turns red, timer reverses to count upward as `+M:SS` (e.g. `+2:14`)
- Timer never stops the exam — informational only
- Timer stops when the debrief is shown

### Implementation
`CountdownTimer` component using `useEffect` + `setInterval(1000)`. Start time stored as a `useRef` (epoch ms) when first question mounts. Renders in the `quizexam-header` bar, right-aligned.

---

## 3. Objective-Level Tutoring Debrief

### Data enrichment during exam
The orchestrator already loads full question objects into `exam_questions` at session start, including `lesson_code`, `topic`, and `explanation`. When recording wrong answers in `exam_results`, also store these three fields — no extra DB query needed.

```python
state['exam_results'].append({
    'chapter_id': prev_q['chapter_id'],
    'question_id': prev_q['id'],
    'correct': correct,
    # enrichment (already in memory):
    'lesson_code': prev_q.get('lesson_code', ''),
    'topic': prev_q.get('topic', ''),
    'explanation': prev_q.get('explanation', ''),
})
```

### Researcher — new method
`get_questions_by_ids(ids)` — fallback for any wrong answers missing `lesson_code` or `explanation` (edge case where questions were loaded without full fields):
```sql
SELECT id, lesson_code, topic, explanation FROM questions WHERE id = ANY(%s)
```
Returns `{ id: {lesson_code, topic, explanation} }`.

### Enhanced `_generate_exam_debrief`

**Step 1 — Separate and group wrong answers:**
```python
wrong = [r for r in results if not r['correct']]
# Group by lesson_code; if lesson_code absent, group by chapter_id
by_objective = {}
for r in wrong:
    key = r.get('lesson_code') or r.get('chapter_id', 'unknown')
    by_objective.setdefault(key, []).append(r)
```

**Step 2 — Single batched LLM prompt for teaching tips:**
Build one prompt covering all missed objectives:
```
For each missed objective below, write a 2-3 sentence teaching tip.
Be direct and specific to power engineering content.
Focus on what the student needs to remember or watch for.
Format your response as a numbered list matching the objective numbers.

1. Chapter 3 Objective 2 (topic: thickness_formula)
   Explanation: [explanation text]

2. Chapter 1 Objective 4 (topic: pressure_relationship)
   Explanation: [explanation text]
```
Parse numbered responses back into `{lesson_code, chapter, objective_num, topic, teaching_tip}`.

If there are no wrong answers, skip this step entirely.

**Step 3 — Next-attempt allocation:**
Compute using existing `_compute_chapter_allocations` with current exam results as weights. Store predicted counts as `next_attempt_allocation: { chapter_id: count }`.

**Step 4 — Enhanced debrief payload:**
```python
{
    'type': 'exam_done',
    'title': '...',
    'score': ...,
    'total': ...,
    'score_pct': ...,
    'chapter_stats': [...],           # existing
    'objective_breakdowns': [...],    # new: list of {lesson_code, chapter_id, objective_num, topic, teaching_tip}
    'next_attempt_allocation': {...}, # new: {chapter_id: predicted_count}
}
```

**Tutor chat message** shifts to reference specific objectives:
> "You dropped marks on Chapter 3 Objective 2 (Barlow's formula) and Chapter 1 Objective 4 — I've added teaching notes for both below."

---

## 4. Results Panel (React)

### Section order
1. Overall score (existing)
2. Chapter breakdown table (existing)
3. Teaching Notes (new) — only if wrong answers exist
4. Next Attempt Preview (new)
5. Retry button (existing)

### Teaching Notes section
Heading: **"Where to focus"**

One card per missed objective (grouped, not per question). Card anatomy:
- Header: `Chapter X · Objective Y — [topic label]`
- Body: LLM teaching tip (2–3 sentences), shown expanded by default
- Footer (conditional): **"📝 Try the Chapter Quiz instead →"** button

**Chapter Quiz button trigger:** shown when `chapter_stats[card.chapter_id].pct < 50` (student missed majority of questions from that chapter). Clicking starts the inline chapter quiz for that chapter (same mechanism as the lobby chapter buttons).

### Next Attempt Preview section
Heading: **"Your next exam will look like this"**

Compact table, one row per chapter:
```
Chapter 1   ████░░░░░░   8 questions   ↑ more focus
Chapter 2   ██░░░░░░░░   4 questions
Chapter 3   ██████████  12 questions   ↑ more focus
```
- Progress bar width: `count / max_count * 100%`
- "↑ more focus" label: shown when predicted count exceeds the even-distribution baseline (`total / num_chapters`)
- Counts from `next_attempt_allocation` in debrief payload

---

## 5. Data Flow Summary

```
Student lands on practice exam page (lessonId = '2B1')
  → React renders PracticeExamLobby
  → GET /api/exam/2B1/chapters → chapter list rendered

Student configures exam and clicks Start
  → POST /api/chat { message: 'hello', examConfig: { count: 50, timed: true } }
  → Express forwards examConfig to Python AI service
  → Orchestrator stores count + timed in session state
  → Questions loaded: get_exam_questions(course_id, limit=50, weights=...)
  → QuizExamView renders with CountdownTimer (if timed)

Student answers questions
  → Each answer: wrong answers enriched with lesson_code, topic, explanation in exam_results
  → On last answer: _generate_exam_debrief() called

Debrief generation (Python)
  → Group wrong answers by objective
  → Single batched LLM call → teaching tips
  → _compute_chapter_allocations with fresh weights → next_attempt_allocation
  → Return enriched payload

ResultsPanel renders
  → Chapter stats table
  → Teaching cards (per objective, with optional Chapter Quiz button)
  → Next Attempt Preview table
  → Retry / Chapter Quiz buttons
```

---

## 6. Files Changed

| File | Change |
|------|--------|
| `client/src/App.jsx` | Add `PracticeExamLobby`, `CountdownTimer`, enhance `ResultsPanel`, add chapter quiz inline routing |
| `server/src/routes/chat.js` | Forward `examConfig` field to Python service |
| `server/src/routes/lesson.js` (or new file) | Add `GET /api/exam/:courseId/chapters` endpoint |
| `ai-service/agents/orchestrator.py` | Read `examConfig`, dynamic question count, enrich `exam_results`, enhanced debrief |
| `ai-service/agents/researcher.py` | Add `get_questions_by_ids()` method |

No database schema changes required.

---

## 7. Out of Scope

- Question generation (separate activity)
- Persisting exam configuration preferences across sessions
- Mobile/responsive layout refinements beyond basic stacking
