# Phase 2 — Remaining Work

Quick reference. Each item is independent and can be brainstormed/specced separately.

---

## Phase 2B — GHL LMS Restructuring

**What:** Collapse the per-objective GHL lesson pages into one page per course paper.

- Current: one GHL lesson page per objective (e.g. "2A1 Chapter 1 Objective 1") with iframe pointing to `?lesson=2A1-1-1`
- Target: one GHL lesson page per paper (e.g. "2A1") with iframe pointing to `?lesson=2A1`
- The client-v2 player already handles `?lesson=2A1` and resumes from last position via `course_progress`

**Tasks:**
- Update iframe URLs on all existing GHL lesson pages (6 papers × N objectives each)
- Optionally remove/redirect the old per-objective pages
- No code changes required — this is GHL admin config only

---

## Phase 2C — Practice Exam & Chapter Quiz into client-v2 ✓ DONE 2026-06-03

**Implementation:**
- `?mode=exam` URL param routes to `ExamRouter` in client-v2/src/ExamRouter.jsx
- Ported: `PracticeExamRouter`, `QuizExamView`, `ResultsPanel` + helpers
- New components: `MathContent`, `CountdownTimer`, `PracticeExamLobby`, `TeachingNotes` in client-v2/src/components/
- Tutor chat panel stays visible during exam
- GHL exam entry: `?lesson=3A1&mode=exam&user=...`
- GHL lesson entry: `?lesson=3A1&user=...` (unchanged)

---

## Also Deferred — Chapter Titles Population

Once the SoPEEC curriculum reference sheet is available:
- Run UPDATE on the `chapters` table to populate `title` for each `(course_id, chapter_num)`
- Currently defaults to "Chapter N" in the NavigationHeader dropdown
