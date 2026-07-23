# Chapter Quiz & Exam Results — Question Review + 4th Class Chapter Quiz Redesign

**Date:** 2026-07-23
**Status:** Approved, implementing
**Repo touched:** `fsa-agent` (`ai-service`, `client-v2`)

## Problem

Found during a live click-through of the 4th Class feature (already deployed): a 4th
Class student completing a chapter quiz hits a dead end. After the last question, the
screen shows a bare "4 of 4 questions answered · 2 correct" with no visible next step —
the real debrief only appears after sending *another* chat message, an undiscoverable
requirement. Even once reached, that debrief has no per-question breakdown (only a total
score) and no retry button — the student's only option is "Back to Lobby."

Separately, chapter quizzes are artificially short: `get_chapter_quiz_questions` only
draws from questions tagged `chapter_quiz` (as opposed to the larger `objective_practice`
pool practice exams already use), so many chapters can't fill even the current 8-question
target — the chapter the owner tested had only 4 available.

While confirming this only affects 4th Class, the owner also asked for the same
"see every question, right and wrong" capability on **2nd/3rd Class practice exam
results**, which today only show chapter-level stats (a table of per-chapter %, and a
chart previewing how the next adaptive exam will be weighted) plus a short AI-generated
closing paragraph — no per-question detail exists anywhere in the product yet.

## Goals

1. **Wider chapter quiz question pool.** Draw from both `chapter_quiz` and
   `objective_practice` types; raise the target count from 8 to 15. No per-chapter
   hardcoding — a chapter with fewer than 15 available questions simply gets fewer (the
   existing `LIMIT` + `ORDER BY RANDOM()` pattern already degrades gracefully and already
   randomizes each attempt; neither needs new code).
2. **No dead end at the end of a chapter quiz.** The final answer's response IS the full
   result — no extra message required to "unlock" it.
3. **Question-by-question review, everywhere it's missing.** Every question answered
   (chapter quiz or practice exam, any class) becomes reviewable: question text, the
   options, which one the student picked, which one was correct, and the explanation.
4. **A real retry for chapter quizzes.** Today there is none at all — add one, matching
   how practice exam retry already works.
5. **Additive only for 2nd/3rd Class practice exams.** The existing chapter-stats table,
   next-attempt-weighting chart, and AI tutor summary are untouched. The new question
   review is a new expandable section / modal on the same screen, not a replacement.
6. **4th Class gets the same review data.** For chapter quizzes, it's the primary result
   (no existing content to preserve — reduced-AI debrief has no prose, and a chapter
   quiz has no chapter table since it's already scoped to one chapter). For practice
   exams, it's the same additive modal 2nd/3rd Class gets, alongside 4th Class's
   existing chapter-stats table and weighting chart.

## Non-goals

- Redesigning the 2nd/3rd Class practice-exam screen beyond adding the review
  section/modal — the chapter-stats table, weighting chart, and AI summary keep their
  current look and position.
- Generating new question content — the owner is expanding the bank separately; this
  work only widens which existing pools a chapter quiz draws from.
- Any change to how practice-exam *questions* are selected, weighted, or scored — only
  the *review* of already-scored answers is new.

## Part A — Wider chapter quiz pool

`ai-service/agents/researcher.py`, `get_chapter_quiz_questions`:
- `WHERE chapter_id = %s AND question_type = 'chapter_quiz'` →
  `WHERE chapter_id = %s AND question_type IN ('chapter_quiz', 'objective_practice')`
  (keep the existing `standalone = TRUE` / non-empty-`options` filters practice exams
  already apply to `objective_practice`, so we don't pull malformed rows).
- `orchestrator.py`: `CHAPTER_QUIZ_QUESTION_COUNT = 8` → `15`.
- `client-v2/src/components/PracticeExamLobby.jsx`: update the "focused 8-question quiz"
  copy to "up to 15 questions".

Sanity-checked against the real bank: combining both pools, 4A's chapters average ~28
questions (min 7), 4B's average ~31 (min 14) — only 2 of 111 chapters across both papers
would ever come up short of 15, and those just get fewer, not an error.

## Part B — Chapter quiz: immediate result + review + retry (`ai-service/agents/orchestrator.py`)

`_process_chapter_quiz` currently, on the last question's answer, returns a
`quiz_progress`-type placeholder ("Let me tally up your results…") and only builds the
real `quiz_done` debrief on the *next* incoming message (the actual dead end). Fix:
build and return the full debrief in that same response — no second round-trip.

**New per-question tracking:** add `state.setdefault('quiz_review', []).append({...})`
alongside the existing `researcher.record_response(...)` call at each answer, capturing:
`question_text`, `options`, `correct_index`, `selected_index`, `explanation`. This needs
a new helper, `_parse_mc_selected_index(message)` (a sibling to the existing
`_evaluate_mc_answer`, which only returns true/false) — reuses the same letter/number
parsing, returns the index or `None`.

**New `quiz_done` display shape:**
```python
{
    'type': 'quiz_done',
    'title': 'Chapter Quiz Complete',
    'score': correct, 'total': total, 'score_pct': score_pct,
    'question_review': [
        {
            'question_text': str, 'options': [str, ...],
            'correct_index': int, 'selected_index': int | None,
            'correct': bool, 'explanation': str,
        }, ...
    ],
}
```
`question_review` is populated identically for every class — the 4th-Class-specific
behavior is entirely in what the *frontend* does with it (Part D), not in this payload.

**New retry mechanism**, mirroring the existing practice-exam pattern
(`_is_exam_retry` / `_reset_and_start_exam`) exactly: `_is_quiz_retry(message)` (same
affirmative-phrase matching) checked in the chapter-quiz debrief branch, calling
`_reset_and_start_quiz(state, ...)` which reloads a fresh random set (same
`get_chapter_quiz_questions` call, same chapter) and resets quiz state — chat-triggered,
not a remount, for the same reason practice-exam retry has to work this way (established
during the 4th Class branch: `QuizExamView`'s init effect only fires once per mount).

## Part C — Practice exam: per-question review (`ai-service/agents/orchestrator.py`)

`_process_practice_exam`'s answer-recording (`state['exam_results'].append({...})`,
~line 901) currently stores `chapter_id, question_id, correct, lesson_code, topic,
explanation` — no question text, no options, no selected answer. Add `question_text`,
`options`, `correct_index` (from `prev_q`, already in scope) and `selected_index` (via
the same new `_parse_mc_selected_index` helper from Part B).

`_generate_exam_debrief`'s `display_update` gains a `question_review` array built from
`state['exam_results']`, same shape as Part B's, added **alongside** the existing
`chapter_stats` / `objective_breakdowns` / `next_attempt_allocation` keys — none of those
change. For 4th Class, `objective_breakdowns` stays `[]` and `tutor_response` stays `''`
exactly as Task 8 already built; `question_review` is populated the same as everyone
else's.

## Part D — Frontend (`client-v2/src/ExamRouter.jsx` + a new component)

**New shared component**, `QuestionReview.jsx` (or a section inside `ExamRouter.jsx`'s
component file, following the file's existing convention of colocating small
result-rendering pieces): takes `questions: question_review[]`, renders each as
question text, the option list with the student's pick and the correct answer both
visually marked (distinct styling for "your answer, correct" / "your answer, wrong" /
"correct answer you didn't pick" / plain), and the explanation. No new endpoint — this
is pure presentation of data already in `displayContent`.

**`ResultsPanel`** (used for both `exam_done` and `quiz_done`) gains a `question_review`
prop, presented two different ways depending on context (resolving the "expandable
section or modal" open question from the brainstorm — picking modal, since the owner's
stated preference was "ideally even just a button that opens a modal", and a 25-100
question list is too long to sit well inline in an expandable section anyway):
- **Any class's practice exam** (`exam_done`): a new "View All Questions" button below
  the existing content (chapter-stats table, next-attempt chart, and — for 2nd/3rd Class
  only — the AI summary, all unchanged) opens `QuestionReview` in a modal. 2nd/3rd and
  4th Class share this exact treatment; the only pre-existing difference between them
  (present today, not something this spec changes) is that 4th Class's debrief has no
  `TeachingNotes`/tutor chat to sit alongside it.
- **Any class's chapter quiz** (`quiz_done`): `QuestionReview` renders inline, directly
  on the results screen, no modal — a chapter quiz tops out at ~15 questions, short
  enough to show in full immediately, and for 4th Class this inline view *is* the
  results screen (no other content to click through to reach it).

**Retry button for `quiz_done`:** `onRetry` is currently `isExam ? () => onAnswer('yes') : null` — `null` for chapter quiz, which is why there's no button today. Change to
`(isExam || mode === 'chapter_quiz') ? () => onAnswer('yes') : null` — reuses the exact
existing chat-trigger plumbing, now matched by Part B's new `_is_quiz_retry` detection on
the backend.

**Back to Lobby:** the chapter-quiz phase's top bar already has a "← Back to Exam"
button (returns to the paper-picker/chapter-grid lobby) — this was likely just not
noticed amid the dead-end confusion. No structural change needed once the dead end and
missing retry are fixed; verify during implementation whether the label should read
"← Back to Chapters" instead of "← Back to Exam" for clarity in chapter-quiz context
specifically (cosmetic, decide during implementation, not a design blocker).

## Explicitly unaffected

- `chapter_stats`, `objective_breakdowns`, `next_attempt_allocation`, and the AI tutor
  summary prompt/call for 2nd/3rd Class practice exams — no changes to their computation,
  content, or rendering position.
- Practice exam question selection/weighting logic (`_compute_chapter_allocations`,
  `get_exam_questions`) — untouched by this spec.
- 4th Class's existing "no AI tutor chat during practice exams, visible during chapter
  quizzes" gating (`isFourthClass` in `QuizExamView`) — unaffected; the new retry button
  reuses the same invisible chat-message mechanism already established for 4th Class
  practice exam retry.

## Verification

- Chapter quiz for a chapter with ≥15 combined-pool questions returns 15; a chapter with
  fewer returns exactly what's available, no error.
- Finishing a chapter quiz's last question immediately shows score + full question
  review + Retry + Back — no second message needed, for any class.
- Chapter quiz retry produces a fresh random set (different question mix on repeat,
  given a large enough pool) without leaving the current screen.
- 2nd/3rd Class practice exam results: chapter-stats table, weighting chart, and AI
  summary all still present and unchanged; a new "View All Questions" button opens a
  modal showing every question with correctness marked.
- 4th Class practice exam results: chapter-stats table and weighting chart still present
  (Task 8, unchanged); "View All Questions" button and modal present and populated;
  still zero AI prose anywhere on the page.
