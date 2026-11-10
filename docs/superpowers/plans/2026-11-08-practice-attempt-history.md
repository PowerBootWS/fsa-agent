# Practice Attempt History: Implementation Plan

> **Status: Phases A, B, C live 2026-11-10.** A is collecting data. The B/C pages are reachable at `/attempts` by URL only; the entry-point links (§4) wait for Russ. Phase D not started.
>
> Written 2026-11-08 from a Telegram request (task 1794180077059-36843d2a assessment + follow-up). Russ approved **all** items below, extras included, and will add more features of his own (see "Additional features (Russ to add)"). He will pick this up himself in an interactive session as the `debian`/FSA user. Nothing in this document has been built: no code, no migrations, no schema changes, no backlog item.
>
> Every fact below was re-checked on 2026-11-08 against the code on `master` and against `fsa_agent_scratch` (scratch refreshed 2026-11-08 02:15 from the 02:33 daily dump, read-only queries only). Re-run the numbers before building, since they drift.

**Goal:** students can see a list of every practice exam and chapter quiz they have taken, open any one of them and review it question by question exactly as it was shown to them, retry the questions they got wrong, and see which chapters are consistently weak.

**Estimate:** about 4 to 6 working days in total, including tests against `fsa_agent_test` (never production).

---

## 1. Where things stand today (verified)

### What students can see

- **Practice exams:** the paper's practice exam lobby (`client-v2/src/components/PracticeExamLobby.jsx:29`, button at `:90`) has **"Review most recent results"**. It calls `GET /api/exam/:courseId/last-results` (`server/src/routes/exam.js:63`, `requireAuth` + `requireActiveSubscription` + `requirePaperEntitlement`, scoped to `req.user.email`), which proxies to the AI service `GET /agent/exam/<course_id>/last-results` (`ai-service/app.py:88`). That reads in-memory state, falling back to the `exam_last_debrief` table (`ai-service/agents/researcher.py:839` `save_last_debrief`, `:865` `get_last_debrief`).
  - `exam_last_debrief` has primary key `(user_email, course_id)` and is **upserted** on every finished exam (`ai-service/agents/orchestrator.py:1812-1818`). Each new exam overwrites the previous one. Scratch: 86 rows, 79 students, 12 papers.
  - The stored `display_update.question_review` is the only place a question is saved **as it was shown** (`question_text`, `options`, `correct_index`, `selected_index`, `correct`, `explanation`; built at `orchestrator.py:1745`).
- **Chapter quizzes:** the review exists only in the AI service's in-memory state (`state['quiz_review']`, `orchestrator.py:1003`) and is returned once in the `quiz_done` payload (`_build_chapter_quiz_debrief`, `orchestrator.py:1092`). Nothing durable. It is gone when the student leaves, and on every `ai-service` restart/deploy.
- **No list of past attempts anywhere.**
- The per-question review UI already exists: `client-v2/src/components/QuestionReview.jsx` (`QuestionReviewItem` takes exactly the `question_review` item shape above). Reuse it.

### What is logged

`public.question_responses` (one row per answered question):

| column | notes |
|---|---|
| `user_email`, `question_id`, `session_type`, `course_id`, `chapter_id`, `correct`, `answered_at` | present on every row |
| `selected_index` | added 2026-09-20 (`researcher.py:809` `record_response`). Scratch: **8,030 of 15,850 rows (51%)** have it; earliest `practice_exam` 2026-09-20, earliest `chapter_quiz` 2026-09-21 |

- `session_type` CHECK allows `lesson | chapter_quiz | practice_exam | diagnostic`; in scratch only `practice_exam` (9,802 rows, since 2026-05-06) and `chapter_quiz` (6,048, since 2026-04-28) exist. 141 distinct students.
- **No attempt ID.** Each answer is its own `INSERT` with its own `CURRENT_TIMESTAMP` (writers: `orchestrator.py:1013` chapter quiz, `orchestrator.py:2108` `_record_exam_answer` practice exam; also `server/src/routes/diagnostic.js:156` for the free diagnostic). Old sittings can only be rebuilt by grouping on timestamps.
- **No question snapshot** except the single `exam_last_debrief` row per student per paper. Every other answer points at the **live** `questions` row.
- `question_responses.question_id` → `questions(id)` **ON DELETE CASCADE**, and `questions.lesson_id` → `lessons(id)` **ON DELETE CASCADE**. Deleting a question, or a lesson, silently deletes students' answers. (`question_flags` cascades the same way; out of scope here.)

### Corrections to the 2026-11-08 assessment

1. **The 2A1 cutover was far bigger than 2B1.** Comparing the cutover backup tables with live `questions` (same IDs):

   | paper | backup table | questions in backup | still exist | wording/options/key changed | key index changed |
   |---|---|---|---|---|---|
   | 2A1 | `questions_bak_2a1cutover_20261009_1523` | 553 | 523 | 493 | 396 |
   | 2B1 | `questions_bak_2b1cutover_20261101_1127` | 631 | 631 | 198 | 132 |
   | 2B3 | `questions_bak_2b3cutover_20261027_2200` | 254 | 254 | 97 | 60 |

   ("Key index changed" includes option reshuffles, so not every one is a wrong-key fix.) Looking up the live question for an old answer is already wrong for most 2A1 history.
2. **History has already been lost, not just at risk.** 30 2A1 questions were dropped on 2026-10-12; the 123 answers in `question_responses_bak_2a1drop_20261012` no longer exist in `question_responses` (cascade). They survive only in that backup table.
3. **Existing bug, found while verifying (not fixed, per "do not build"):** `getLastExam` in `server/src/services/paperStats.js:20` treats "the last practice exam" as rows with `answered_at = MAX(answered_at)`. Because each answer has its own timestamp, that matches **exactly one answer**: scratch shows 142 of 142 student/paper pairs return a single row. So the "last practice exam" score shown on the course lobby (`platform.js:618`, `:720`) and Home page (`services/homeSummary.js:24`) is always 0% or 100%, and Home's "weakest chapter" (`homeSummary.js:7`) is just the chapter of the last question answered. The attempts table in Phase A fixes this properly (Phase D rewires it). **Decision for Russ: fix it now as a stand-alone bug, or wait for this plan** (see Open questions).
4. **Name clash to avoid:** `public.practice_exam_attempts` already exists and belongs to the free practice exam lead magnet (`email`, `verification_code`, unique `(email, paper_code)`). The new table must use a different name. This plan uses `assessment_attempts`.
5. `client-v2` now has a test harness (`vitest`, `*.test.jsx` in `src/pages`); the July plan's "no client test harness" note is out of date.

---

## 2. Phase A: Data (~1 day)

Next migration number is `034` (`server/migrations/033_two_weeks_out.sql` is the latest). One migration file, idempotent (`IF NOT EXISTS`), applied to `fsa_agent_test` and scratch first.

### A1. `assessment_attempts` table

```sql
CREATE TABLE IF NOT EXISTS assessment_attempts (
  id              BIGSERIAL PRIMARY KEY,
  user_email      VARCHAR(255) NOT NULL,
  course_id       VARCHAR(10)  NOT NULL,          -- paper, e.g. 2B1, 4A
  chapter_id      VARCHAR(20),                    -- set for chapter quizzes, NULL for practice exams
  kind            VARCHAR(20)  NOT NULL CHECK (kind IN ('practice_exam','chapter_quiz','retry_wrong')),
  parent_attempt_id BIGINT REFERENCES assessment_attempts(id) ON DELETE SET NULL, -- retry_wrong source
  started_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,                    -- NULL = in progress or abandoned
  question_count  SMALLINT,                       -- questions served
  score           SMALLINT,                       -- correct count, set on finish
  score_pct       SMALLINT,
  chapter_stats   JSONB,                          -- {chapter_id: {correct, total}} for exams
  source          VARCHAR(20)  NOT NULL DEFAULT 'live' CHECK (source IN ('live','pre_history'))
);
CREATE INDEX IF NOT EXISTS idx_aa_user_course ON assessment_attempts (user_email, course_id, started_at DESC);
```

### A2. Columns on `question_responses`

```sql
ALTER TABLE question_responses
  ADD COLUMN IF NOT EXISTS attempt_id BIGINT REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS position SMALLINT,          -- order shown within the attempt
  ADD COLUMN IF NOT EXISTS question_snapshot JSONB;    -- {question_text, options, correct_index, explanation, lesson_code, topic}
CREATE INDEX IF NOT EXISTS idx_qr_attempt ON question_responses (attempt_id, position);
```

All nullable, so every existing reader (`platform.js:597,702,781`, `platformGate.js:35`, `nps.js:35`, `admin.js:185`, `database.js:144`, `paperStats.js:27`, `researcher.py:906` `get_chapter_weights`) keeps working unchanged.

### A3. Stop answers being deleted with their question

```sql
ALTER TABLE question_responses ALTER COLUMN question_id DROP NOT NULL;
ALTER TABLE question_responses DROP CONSTRAINT question_responses_question_id_fkey;
ALTER TABLE question_responses ADD CONSTRAINT question_responses_question_id_fkey
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE SET NULL;
```

- Covers both chains (deleting a question, and deleting a lesson that cascades to its questions).
- Check before shipping: any query that `JOIN questions` on `question_responses` must tolerate `question_id IS NULL` (none of the listed readers join today; re-grep, and don't rely on one wide grep, see memory "rtk grep false negative").
- Lock: `ALTER ... DROP/ADD CONSTRAINT` validates the whole table (~16k rows); trivial, but run outside peak hours.

### A4. Write path (AI service)

- `researcher.py`: new `start_attempt(user, course_id, kind, chapter_id=None, question_count, parent_attempt_id=None) -> id` and `finish_attempt(id, score, score_pct, chapter_stats)`. `record_response` gains `attempt_id`, `position`, `question_snapshot` parameters (defaulted `None` so `diagnostic.js`-style callers are unaffected).
- `orchestrator.py`:
  - Practice exam start (initial start and `_reset_and_start_exam`, `orchestrator.py:1913`): `state['attempt_id'] = start_attempt(...)`.
  - Chapter quiz start (initial question load near `:960` and `_reset_and_start_quiz` `:1128`): same.
  - `_record_exam_answer` (`:2087`) and the chapter-quiz feedback branch (`:991-1021`): pass `attempt_id`, `position` (`idx`), and the snapshot built from the **same in-memory question dict** that was rendered (not re-read from DB).
  - Exam debrief (`:1805-1818`): `finish_attempt` with `score`, `score_pct`, and the `chapter_stats` dict computed at `:1632`. Keep `save_last_debrief` exactly as is (`server/src/scripts/coaching_due.js:171` also reads `exam_last_debrief`).
  - Chapter quiz debrief (`_build_chapter_quiz_debrief`, `:1092`): `finish_attempt` **once** (it is called again on resume; guard with `state['attempt_finished']`).
- **Persist chapter quiz results:** with A1+A2 every chapter quiz becomes an attempt with snapshotted answers, so its review survives leaving the page and restarts. No separate "last quiz debrief" table needed.
- All writes stay non-fatal (same try/except pattern as `record_response`): a history write failure must never break a quiz.
- 4th Class: same code path; nothing class-specific in Phase A.

### A5. Data volume

~16k response rows in 6 months; snapshots add ~1-2 KB each. Negligible for this database. No retention policy needed now.

---

## 3. Phase B: API (~1 day)

Express, in a new `server/src/routes/attempts.js` mounted under `/api/attempts`, using the shared pool (same pattern as `platform.js`). Middleware: `requireAuth`, `requireActiveSubscription`; per-paper `requirePaperEntitlement` where a `course` is given.

| endpoint | returns |
|---|---|
| `GET /api/attempts?course=2B1&kind=practice_exam` | the caller's attempts, newest first: `id, course_id, chapter_id, kind, started_at, finished_at, score, question_count, score_pct, source`. Paginated (`limit` default 50). |
| `GET /api/attempts/:id` | header as above + `questions[]` in `position` order, each in the exact `QuestionReview` item shape `{question_text, options, correct_index, selected_index, correct, explanation}` built from `question_snapshot`. |
| `GET /api/attempts/weak-chapters?course=2B1` | Phase D, see below. |

- **Ownership:** every query is `WHERE user_email = req.user.email`. An attempt ID belonging to someone else returns **404, not 403** (no existence leak). Never accept `?user=`; this is the IDOR pattern fixed in backlog #88 (`exam.js:47-56` comment).
- **Rows without a snapshot** (pre-history, or `selected_index` NULL): return `questions: []` with `review_available: false`; never fall back to the live question (see #138 section).
- Abandoned attempts (`finished_at IS NULL` and `started_at` older than e.g. 6 h): excluded by default (Open question 2).

---

## 4. Phase C: Screens (1 to 1.5 days)

- **"My past attempts" page:** `client-v2/src/pages/AttemptsPage.jsx` + co-located `AttemptsPage.css` (prefix `at-`; no inline layout styles, per the mobile rule in `fsa-agent/CLAUDE.md`). Route `/attempts` (optional `?course=`) in `client-v2/src/App.jsx`. Table/cards: date, paper, type (Practice exam / Chapter quiz + chapter name / Retry), score. Pre-history rows show score only, labelled "Before detailed history started", not clickable.
- **Attempt detail:** `/attempts/:id` renders the header plus the existing `QuestionReview` component unchanged.
- **Entry points:** a "Past attempts" link next to "Review most recent results" in `PracticeExamLobby.jsx`, on `QuizOnlyLobbyPage.jsx` (4th Class), and after a chapter quiz finishes. Keep "Review most recent results" as is.
- Tests: vitest for the page (list, empty state, pre-history row not clickable, detail renders `QuestionReview`), `npm run build`, then a live click-through on `learn.fullsteamahead.ca` as `russ@fullsteamahead.ca` (memory "test with russ@ account").

---

## 5. Phase D: Extras (1 to 2 days)

### D1. "Retry the ones I got wrong"

- Button on the attempt detail page (and on the finished-quiz/exam result) when the attempt has ≥1 wrong answer with a snapshot.
- Builds on the existing chapter-quiz retry (`_reset_and_start_quiz`, `orchestrator.py:1128`; triggered by the invisible chat message mechanism, `onAnswer('yes')` in `client-v2/src/ExamRouter.jsx`). Add a variant that takes an explicit question list: the wrong `question_id`s from the parent attempt, served as a `kind='retry_wrong'` attempt with `parent_attempt_id` set.
- Serve the **live** question (current wording/key), not the snapshot: the student should practise the current material. Skip questions whose `question_id` is now NULL (deleted). If none survive, show "These questions have since been replaced" and offer a normal chapter quiz.
- Responses from a retry: `session_type` stays `chapter_quiz` (CHECK constraint unchanged) and the attempt `kind` distinguishes it. Note this means retries count in `get_chapter_weights` (adaptive exam weighting); Open question 4.
- Practice-exam wrong answers span chapters; the retry is a cross-chapter quiz run on the chapter-quiz code path with `chapter_id = NULL`.

### D2. Weak-chapter summary

- `GET /api/attempts/weak-chapters?course=` aggregates `assessment_attempts.chapter_stats` over the student's last N finished practice exams for that paper (N default 3; Open question 5), returning per-chapter correct/total/pct, sorted weakest first, with chapter titles from `chapters`.
- Shown on the attempts page for the selected paper and optionally on the lobby.
- **Rewire `getLastExam`** (`paperStats.js:20`) to read the latest finished `practice_exam` attempt, which fixes the Home/lobby 0%/100% bug (Correction 3) for every attempt taken after Phase A ships. Until a student has one, keep the old behaviour or show nothing (Open question 1).

---

## 6. Order and rollout

1. **Phase A ships alone** (migration + AI-service write path). Let it collect for **1 to 2 weeks** so most active students have real history before anyone sees the page.
2. **Phase B + C** (API + history page) together.
3. **Phase D** (retry wrong, weak chapters, `getLastExam` rewire).

Deploy per phase, using the standard commands in `fsa-agent/CLAUDE.md`:
- Before the migration: `sudo /usr/local/bin/fsa-backup.sh daily`; note the path.
- Migration: `docker cp` + `psql -f` against `fsa_agent`, **after** it has been applied and tested on `fsa_agent_test` and `fsa_agent_scratch`; then `bash server/scripts/rebuild-test-db.sh`.
- **Phase A order is mandatory: migration 034 on production first, then the ai-service deploy.** The new `record_response` INSERT names the new columns; against the old schema it fails, and because it is non-fatal every answer would be silently dropped.
- Phase A: `docker compose build ai-service && docker compose up -d ai-service`.
- Phase A backfill (Russ's OK, it writes to real student records): `node server/scripts/backfill_debrief_attempts.js` (dry run) then `--write`. On scratch 2026-11-10: 67 of 89 debriefs linked, 9 had no `question_review`, 13 could not be aligned (9 free-exam takers with no answer rows, 4 2A1 sittings whose answers were lost in the 2026-10-12 cascade). Restarting the AI service drops in-memory quiz/exam state for anyone mid-attempt (existing behaviour); deploy in a quiet hour.
- Phase B/C/D: client-v2 build + `GITHUB_TOKEN=$(gh auth token) docker compose build api && docker compose up -d api`.
- After Phase A: verify on production read-only that new rows have `attempt_id`, `position` and `question_snapshot`, and that one attempt per sitting is created (count attempts vs distinct sittings for the day).
- Wiki: update `wiki/projects/fsa-agent.md` (DB schema, API reference) and append to `wiki/log.md` per phase.

### Rollback

- **Code:** redeploy the previous image/commit. Phase A writes are additive; old code ignores the new columns and table.
- **Schema:** leave the new table/columns in place on rollback (harmless). If the FK change must be reverted, delete or reattach any `question_id IS NULL` rows first, since `NOT NULL` and `ON DELETE CASCADE` cannot be restored over them. Prefer not to revert A3: it is the protection against #138 data loss.
- **Data:** restore from the backup taken just before the migration if anything went wrong.

---

## 7. Migration and backfill

- **No backfill of snapshots is possible** for old answers: the question as shown was never stored (except one `exam_last_debrief` per student per paper), and for 2A1/2B1/2B3 the live question has changed since.
- **Pre-history attempt rows (default, cheap):** create `source='pre_history'` attempts with score only, no per-question review. Two ways to group old answers into sittings:
  - **Option 1 (recommended): time-gap grouping.** Per `(user_email, course_id, session_type, chapter_id for quizzes)`, order by `answered_at`; start a new sitting when the gap exceeds X minutes (e.g. 30). Score = correct/total in the group. Do **not** link the old responses to these attempts (leave `attempt_id` NULL) so nothing pretends to be reviewable.
    - Trade-off: it is a guess. Two exams taken back to back merge; an exam paused over lunch splits; abandoned exams look like short low scores. Filter groups below a minimum size (e.g. exams < 10 answers) or label them. Re-derive from these exact rules, not a looser diagnostic query (memory "backfill exact criterion"), and dry-run on scratch with counts per student before touching production.
  - **Option 2: no backfill.** History starts the day Phase A ships. Simplest and honest; old activity is invisible on the page.
- **Optional bonus:** the 79 `exam_last_debrief` rows contain a true snapshot of each student's latest exam. They could become one fully reviewable pre-history attempt each (snapshot from `display_update.question_review`, score from `display_update.score/total`). Cheap and accurate; Open question 3.
- `question_responses_bak_2a1drop_20261012` (123 answers to deleted questions) could be re-inserted with `question_id = NULL` once A3 lands, so those sittings' scores are not undercounted by the backfill. Only if Option 1 is chosen.
- Backfill script is a one-off in `server/scripts/`, idempotent (skips users who already have `pre_history` rows), run on scratch first, then production after a backup and Russ's OK (it writes to real student records).

---

## 8. Interaction with #138 (2nd Class rebuild)

- **Today:** the cutovers update questions in place with the same ID (`scripts/cutover_2a1.py` pattern) and occasionally delete questions. Any history view that joins the live `questions` row would show a student's old answer against new wording or a different key; this is already the case for most 2A1 history and a third of 2B1.
- **After Phase A:** every new answer carries its own snapshot, so in-place edits no longer change what a past attempt shows, and A3 means a deleted question leaves the answer in place with `question_id = NULL`.
- **Sequencing:** Phase A should ship **before the next #138 cutover** (remaining per backlog: 2A2 check, 2A3, 2B2) so that cutover cannot wipe or rewrite any history. If a cutover has to happen first, its script should not delete questions (deactivate or leave them) and should keep its `question_responses_bak_*` backup as the earlier cutovers did.
- Cutover scripts need no change after Phase A for history purposes. They should still keep backing up `question_responses` as now.
- D1 (retry wrong) deliberately serves the **live** question, so a retry after a cutover practises the new material.
- Adaptive weighting (`get_chapter_weights`) and `paperStats` keep reading `correct` from `question_responses` regardless of edits; unchanged by this plan.

---

## 9. Test plan

All automated tests run against **`fsa_agent_test`** only (`POSTGRES_DB=fsa_agent_test POSTGRES_HOST=localhost POSTGRES_PORT=5434` + `POSTGRES_PASSWORD` extracted with a single targeted grep, never by sourcing `.env.shared`; `testPool.js` refuses any other DB). Never against production.

- **Migration:** apply to `fsa_agent_test` and to `fsa_agent_scratch` (guard with `SELECT 1 FROM _scratch_meta`); re-apply to prove idempotence; delete a question in scratch and confirm its responses remain with `question_id IS NULL`; delete a lesson and confirm the same.
- **AI service (pytest, `ai-service/tests/`):** start/finish attempt on exam and quiz start and retry; each recorded answer carries `attempt_id`, `position`, snapshot equal to the rendered question; quiz debrief on resume does not finish twice; a history-write exception does not break the quiz.
- **End-to-end through the real entry point** (memory "E2E tests drive the real entry point"): take a chapter quiz and a practice exam through the `/agent` chat endpoint on scratch, not by inserting rows with a helper; then fetch them via `/api/attempts` and `/api/attempts/:id`. Prove the new tests fail against current `master`.
- **API (server, jest):** list/detail scoped to the caller; another student's ID → 404; no `?user=` honoured; pre-history attempts return `review_available: false`; entitlement enforced per paper; edited live question does not change a stored attempt's detail.
- **Client (vitest):** attempts list, empty state, pre-history label, detail reuses `QuestionReview`, retry button only when wrong answers exist.
- **D1/D2:** retry serves only the wrong questions, skips deleted ones, records `kind='retry_wrong'` with `parent_attempt_id`; weak-chapter aggregation over last N; `getLastExam` returns the real last-exam score (regression test for Correction 3).
- **Live check** after each deploy as `russ@fullsteamahead.ca` on `learn.fullsteamahead.ca`, including mobile width.

---

## 10. Open questions / decisions for Russ

1. **`getLastExam` bug** (Correction 3): Home and the lobby show the last practice exam score as 0% or 100% and the "weakest chapter" is the last question's chapter. Fix it now as a stand-alone bug (group by sitting), or wait for Phase D?
2. **Unfinished attempts:** hide them, or show them as "Not finished" with the questions answered so far?
3. **Backfill:** Option 1 (time-gap grouping, score-only), Option 2 (history starts at launch), and/or convert the 79 `exam_last_debrief` rows into one reviewable attempt each?
4. **Retry-wrong answers in adaptive weighting:** should retry answers count toward the practice-exam chapter weighting (`get_chapter_weights`)? Counting them makes weak chapters look better faster.
5. **Weak-chapter window:** last 3 practice exams, last 30 days, or all time?
6. **4th Class explanations:** generated prose is skipped for 4th Class (`orchestrator.py:1758` comment), but question explanations already show in its review. Keep showing them in history? (Assumed yes.)
7. **Retention:** keep attempt history forever, or cap (e.g. last 50 per paper)? Assumed forever.
8. **Visibility after cancellation:** history behind `requireActiveSubscription` like everything else (assumed), or viewable by lapsed subscribers?
9. **Admin/CRM view:** should Russ see a student's attempt list too (e.g. in fsa-crm or the coaching flow)? Not in scope unless added below.
10. **Sequencing with #138:** confirm Phase A goes in before the next 2nd Class cutover.

---

## 11. Additional features (Russ to add)

**Answers to section 10 (Russ, 2026-11-10):** Q1 wait for Phase D. Q3 convert the `exam_last_debrief` rows into one reviewable `pre_history` attempt each; no time-gap backfill. Q2/Q4/Q5/Q8 defaults accepted: hide unfinished attempts; retry answers do not count toward adaptive weighting; weak chapters = last 3 practice exams; history needs an active subscription.

**No extra features for this project.** Russ flagged a future, separate project to keep in mind so nothing here has to be undone:

- **Chapter mastery levels 1 to 4 replace count-based adaptive weighting.** Each practice exam keeps the real provincial exam's fixed chapter makeup (questions per chapter out of 100). The first sitting serves level 2 questions in every chapter; strong results move that chapter up a level on the next sitting, weak results drop it (to 1 at the floor) until the student improves. Level 4 in every chapter = ready to write, and the platform shows the level per chapter.
- Higher levels are harder by **question style**, not just content: "except" traps, several technically-true options where only one answers the question, and similar. Needs a large question rewrite across all papers.
- Build this project as if the leveling change is not happening. Compatibility notes: `assessment_attempts.chapter_stats` already stores per-chapter correct/total per sitting, which is the input a level step needs; `question_snapshot` is JSONB, so a question's level can be added to it later without a migration; the weak-chapter view (D2) is the natural place a per-chapter level would later be shown.

---

## 12. Fresh-session checklist

1. Read this file, `wiki/projects/fsa-agent.md`, and the latest `wiki/log.md` entries.
2. Re-run the verification queries in section 1 on `fsa_agent_scratch` (numbers drift; check whether a #138 cutover happened since 2026-11-08).
3. Confirm Russ's answers to section 10 and any items in section 11.
4. Branch in `fsa-agent` (repo default branch is `master`), take a backup, then start Phase A.
