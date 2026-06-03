# Exam Results → Lesson Deep-Link Design

**Date:** 2026-06-03
**Status:** Approved

---

## Goal

Give students a one-click path from a missed-objective card in the practice exam results panel to the exact lesson in the `client-v2` lesson player that covers that objective.

---

## Context

After completing a practice exam or chapter quiz, the `ResultsPanel` in `client/` renders `TeachingNotes` — a list of cards for each missed objective, each showing an LLM-generated teaching tip and (for weak chapters) a "Try the Chapter Quiz" button. The `objective_breakdowns` payload already carries `lesson_code` (e.g., `2A1-1-3`) for each entry.

The `client-v2` lesson player accepts `?lesson=2A1-1-3&user=email` and opens at that specific objective. This feature wires the two together.

---

## Scope

**In scope:**
- "Review this lesson →" button on every missed-objective card in `TeachingNotes`
- Opens `/v2/?lesson={lesson_code}&user={email}` in a new browser tab
- Locked/disabled state in lead magnet mode
- Button omitted silently when `lesson_code` is falsy

**Out of scope:**
- Any server or DB changes
- Changes to `client-v2`
- In-iframe navigation or postMessage to the GHL parent page (deferred to Phase 2B — GHL restructuring)

---

## Files Changed

| File | Change |
|------|--------|
| `client/src/TeachingNotes.jsx` | Add `user` prop; render lesson-review button per card |
| `client/src/App.jsx` | Add `user` prop to `ResultsPanel`; pass it at both call sites |

---

## Data Flow

```
PracticeExamRouter  ← already receives user prop
  └─ ResultsPanel   ← add user prop; pass to TeachingNotes
       └─ TeachingNotes  ← add user prop; build link per card
```

`objective_breakdowns[i].lesson_code` is the full lesson code (`2A1-1-3`). It originates from the `questions` table column `lesson_code` and is assembled in `orchestrator.py → _build_debrief`. A small number of older questions may have `lesson_code = null`; the button is omitted for those entries.

---

## Component Behaviour

### TeachingNotes

New prop: `user` (string — learner email).

For each card in `objectiveBreakdowns`:
- If `obj.lesson_code` is truthy and `leadMagnetMode` is false:
  - Render a button: `📖 Review this Lesson →`
  - `onClick`: `window.open('/v2/?lesson=' + obj.lesson_code + '&user=' + encodeURIComponent(user), '_blank')`
- If `obj.lesson_code` is truthy and `leadMagnetMode` is true:
  - Render a disabled button: `🔒 Lesson Review — Unlock with Full Access`
- If `obj.lesson_code` is falsy:
  - No button rendered

The existing chapter-quiz button logic is unchanged. Both buttons can appear on the same card when `chapterPct < 50`.

### ResultsPanel

New prop: `user` (string).

Pass `user` to the `<TeachingNotes>` call.

### App.jsx call sites

`ResultsPanel` is rendered in two places inside `PracticeExamRouter`:
1. `phase === 'results'` block (line ~335) — add `user={user}`
2. Inside `QuizExamView` (line ~885) — add `user={user}`

---

## Visual Layout (per card)

```
┌─────────────────────────────────────────────────────┐
│ Chapter 2 · Objective 3            topic label       │
│ Teaching tip text here...                            │
│                                                      │
│ [📖 Review this Lesson →]  [📝 Try the Chapter Quiz] │
└─────────────────────────────────────────────────────┘
```

Chapter quiz button only appears when `chapterPct < 50`. Lesson review button appears whenever `lesson_code` is present.

---

## CSS

Two new classes following the `teaching-card-quiz-btn` pattern:
- `.teaching-card-lesson-btn` — primary action style (blue/teal, distinct from quiz button)
- `.teaching-card-lesson-btn--locked` — muted/disabled style matching `teaching-card-quiz-btn--locked`

---

## No Server Changes

The `/v2/` lesson player already handles `?lesson=LESSON_CODE&user=EMAIL` entry. No new API routes or DB changes are required.
