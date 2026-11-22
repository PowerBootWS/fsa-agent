# Leveled Practice Exams — Plan 3: Engine, Results, Free Exam, Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a leveled practice exam (fixed typical topic mix, difficulty adapting per topic) for every student on papers where it is enabled, with a topic-level results screen and readiness verdict, the same engine for the free exam, and the 25-question option removed.

**Architecture:** A second engine inside the existing practice-exam flow (spec approach A). Pure logic (slot counts, level movement, predicted score, verdict, free-exam mix) lives in a new `ai-service/agents/leveled_exam.py`; its DB access lives in a new `ai-service/agents/leveled_store.py`. `Orchestrator` branches once at question selection and once at the debrief, keyed on `state['exam_engine']`; the adaptive path is untouched. Sittings reuse `assessment_attempts` / `question_responses` (kind and session_type `practice_exam`, so history pages keep working) plus a new `leveled_exam_sittings` row with the per-topic record. Which engine runs is decided by `LEVELED_PAPERS` (env, comma list) and an optional per-student opt-out `platform_users.exam_engine = 'adaptive'`.

**Tech Stack:** PostgreSQL 15 (`fsa-postgres`, host port 5434), Python 3 Flask + pytest (`ai-service`), Express + Jest (`server`), React + Vitest (`client-v2`).

**Spec:** `fsa-agent/docs/superpowers/specs/2026-11-17-leveled-practice-exams-design.md` (sections 4–6, Phase 2). Owner change 2026-11-22: **everyone moves over** once a paper is enabled (not opt-in); the adaptive engine stays as a per-student fallback (`exam_engine = 'adaptive'`), set from the profile during rollout.

## Global Constraints

- Production DB safety (root `CLAUDE.md`): tests only against `POSTGRES_DB=fsa_agent_test POSTGRES_HOST=localhost POSTGRES_PORT=5434` with `POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' /home/debian/.env.shared | cut -d= -f2-)`; never `source` `.env.shared`. Migration to production only after `sudo /usr/local/bin/fsa-backup.sh daily`, applied before the code that needs it. Re-run `bash server/scripts/rebuild-test-db.sh` after the migration lands in production.
- Never delete questions. The adaptive engine, chapter tests, tutor and diagnostic behave exactly as today (all their existing tests stay green).
- Leveled selection reads only `standalone AND exam_level IS NOT NULL AND options non-empty` (leveled-only rows included).
- Levels: 1 Foundation, 2 Core, 3 Exam-Level, 4 Max. Starting level 2 for every topic.
- Level movement (config): ≥80% at the current level → +1; <50% → −1; else stay; floor 1, cap 4; a topic with <5 questions in a sitting is judged on its last two completed sittings combined.
- Lengths 50 and 100 only (25 removed everywhere). 100 = exact `exam_topic_groups.exam_questions`; 50 = each halved, odd halves rounded alternately within the sitting, starting direction flipping between sittings; total exactly 50.
- Pool short at a topic's level → take from level−1, then level+1, then any level, and log it; never shrink the topic's slot count.
- Abandoned sittings never move levels. Timed-out sittings complete with unanswered questions wrong.
- Verdict bands (exact copy): `<60` "If you wrote this paper today, you'd likely fail." · `60–70` "You could pass, but it would be close." · `70–80` "You have a solid grasp and would likely pass comfortably." · `≥80 and most topics at Max` "You're ready — you're handling questions harder than the real exam." "Most topics at Max" = topics carrying ≥75% of the exam weight are at level 4 and none is below 3; otherwise ≥80 shows the 70–80 message.
- Student copy says the exam "follows the typical real-exam mix", never "the exact SOPEEC structure".
- Free exam level mix per topic: 30% level 2, 40% level 3, 30% Max (largest-remainder rounding).
- 4th Class is out of scope (not enabled; its debrief would be stats-only).
- `client-v2` styling: page-level CSS in co-located `*.css` files, no new inline layout objects.

## Review Focus

1. A page refresh mid-sitting re-sends `examConfig` → must continue the same sitting, not create a second `leveled_exam_sittings` row or reselect questions (Task 5 test `test_refresh_keeps_the_sitting`).
2. AI-service restart mid-sitting loses in-memory state → the orphan sitting stays `in_progress`, never moves levels, and the next start works (Task 5 test `test_orphan_sitting_does_not_move_levels`).
3. Time runs out with zero answers (no `assessment_attempts` row yet) → sitting completes, every topic scores 0, levels drop, no crash on `attempt_id None` (Task 5 test `test_time_up_with_no_answers`).
4. A topic whose pool is empty at its level and both neighbours → still gets its full slot count from any level, or the shortfall is logged and the exam total is still exact when the paper has enough questions overall (Task 3 test `test_fallback_any_level_keeps_slot_count`).
5. A student with `exam_engine = 'adaptive'`, or on a paper not in `LEVELED_PAPERS` → byte-identical adaptive behaviour (Task 5 test `test_adaptive_when_not_enabled`).

---

### Task 1: Migration 040 — sittings, topic levels, engine opt-out

**Files:**
- Create: `server/migrations/040_leveled_exam_engine.sql`
- Test: `server/tests/leveledEngineSchema.test.js`

**Interfaces:**
- Produces tables used by Tasks 3, 5, 7:
  - `student_topic_levels(user_email text, paper_code text, topic_key text, level smallint NOT NULL DEFAULT 2 CHECK (level BETWEEN 1 AND 4), updated_at timestamptz DEFAULT now(), PRIMARY KEY (user_email, paper_code, topic_key))`
  - `leveled_exam_sittings(id bigserial PK, user_email text NOT NULL, paper_code text NOT NULL, length smallint NOT NULL CHECK (length IN (50,100)), lead_magnet boolean NOT NULL DEFAULT false, attempt_id bigint REFERENCES assessment_attempts(id) ON DELETE SET NULL, status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','timed_out')), round_up_first boolean NOT NULL, question_ids integer[] NOT NULL, topics jsonb, level_changes jsonb, predicted_pct numeric(5,2), verdict_band text, started_at timestamptz DEFAULT now(), completed_at timestamptz)` + index `(user_email, paper_code, completed_at DESC)`.
  - `platform_users.exam_engine text NULL CHECK (exam_engine IN ('adaptive','leveled'))` (NULL = follow `LEVELED_PAPERS`).

- [ ] **Step 1: Write the failing test** — `leveledEngineSchema.test.js` asserts, via `information_schema`, every column above exists with its type; inserting a `student_topic_levels` row with level 5 fails with a check violation; a `leveled_exam_sittings` row with `length = 25` fails; `platform_users.exam_engine = 'other'` fails.
- [ ] **Step 2: Run it** — `cd server && POSTGRES_PASSWORD=… npx jest tests/leveledEngineSchema.test.js` → FAIL (relation does not exist).
- [ ] **Step 3: Write the migration** (all `IF NOT EXISTS`, idempotent), apply to `fsa_agent_test` with `docker exec -i fsa-postgres psql -U postgres -d fsa_agent_test < server/migrations/040_leveled_exam_engine.sql`.
- [ ] **Step 4: Run it** → PASS.
- [ ] **Step 5: Commit** `leveled exams: migration 040 (sittings, topic levels, engine opt-out)`.

### Task 2: Pure engine logic — `leveled_exam.py`

**Files:**
- Create: `ai-service/agents/leveled_exam.py`
- Test: `ai-service/tests/test_leveled_exam_logic.py`

**Interfaces (Produces):**
- `LEVEL_NAMES = {1: 'Foundation', 2: 'Core', 3: 'Exam-Level', 4: 'Max'}`; `CONFIG = {'up_pct': 0.80, 'down_pct': 0.50, 'min_questions': 5, 'level_step': 0.10, 'pass_pct': 65}`
- `slot_counts(groups: list[dict], length: int, round_up_first: bool) -> dict[str, int]` — `groups` items `{topic_key, exam_questions, sort_order}`; skips `exam_questions == 0`.
- `free_mix(n: int) -> dict[int, int]` — keys 2, 3, 4, sum n.
- `next_level(level: int, correct: int, total: int, prev: tuple[int, int] | None) -> int` — `prev` = (correct, total) of the same topic in the previous completed sitting, used only when `total < min_questions`.
- `predicted_pct(topics: dict[str, dict], groups: list[dict]) -> float` — `topics[k] = {level, correct, total}`; per topic `acc = correct/total` (0 if total 0), adjusted `clamp(acc + level_step × (level − 3), 0, 1)`, weighted by `exam_questions`; returns percent rounded to 1 dp.
- `verdict(pred: float, levels: dict[str, int], groups: list[dict]) -> tuple[str, str]` — (band key `'fail'|'close'|'solid'|'ready'`, exact message from Global Constraints).
- `holding_back(levels, topics, groups, n=3) -> list[str]` — topic keys with the lowest level, ties broken by larger exam weight.

- [ ] **Step 1: Write the failing tests** (one per function, spec values):
  - `slot_counts` for 100 returns each group's `exam_questions` exactly; for 50 with groups `[15,15,10,9,9,8,7,7,6,5,5,4]` (sum 100) the result sums to 50, each value is `floor` or `ceil` of half, and `round_up_first=True` vs `False` give different values for the first odd group; zero-weight groups absent.
  - `free_mix(10) == {2: 3, 3: 4, 4: 3}`; `free_mix(7)` sums to 7; `free_mix(1)` sums to 1.
  - `next_level(2, 8, 10, None) == 3`; `next_level(2, 4, 10, None) == 1`; `next_level(1, 0, 10, None) == 1`; `next_level(4, 10, 10, None) == 4`; `next_level(2, 3, 4, (5, 5)) == 3` (8/9 combined); `next_level(2, 3, 4, None) == 2` (too few, no history: stay).
  - `predicted_pct` with one topic all correct at Max == 100.0 (clamped); with two topics weights 60/40 at level 3, 50% and 100% → 70.0.
  - `verdict(85, all-at-4 levels, groups)[0] == 'ready'`; `verdict(85, …one topic weight 30 at level 3, rest at 4…)` → `'solid'` (weight at Max < 75%); `verdict(59.9, …)[0] == 'fail'`; `verdict(60, …)[0] == 'close'`; `verdict(70, …)[0] == 'solid'`; messages equal the constraint copy.
- [ ] **Step 2: Run** `cd ai-service && python3 -m pytest tests/test_leveled_exam_logic.py -q` → FAIL (module missing).
- [ ] **Step 3: Implement** — 50-length rounding: walk groups in `sort_order`; each odd-half topic takes ceil or floor alternately, starting with ceil when `round_up_first`. `free_mix` uses largest remainder over (0.3, 0.4, 0.3), ties to level 3.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `leveled exams: pure engine logic`.

### Task 3: Store — `leveled_store.py`

**Files:**
- Create: `ai-service/agents/leveled_store.py`
- Test: `ai-service/tests/test_leveled_store.py` (DB test, course `ZZ9`, skip unless `POSTGRES_DB == 'fsa_agent_test'`, same fixture pattern as `test_leveled_only_excluded.py`)

**Interfaces (Produces)** — class `LeveledStore(researcher)` using `researcher._get_connection()`:
- `engine_for(email: str, paper: str, lead_magnet: bool) -> str` — `'leveled'` iff `paper` in `os.getenv('LEVELED_PAPERS','')` split on commas and (lead magnet, or `platform_users.exam_engine` is NULL or `'leveled'` for that email); else `'adaptive'`.
- `topic_groups(paper) -> list[dict]` — `exam_topic_groups` rows ordered by `sort_order`.
- `levels(email, paper) -> dict[str, int]` — missing topics default 2.
- `save_levels(email, paper, levels: dict[str, int]) -> None` — upsert.
- `recent_ids(email, paper, sittings=3) -> set[int]` — `question_ids` of the user's last 3 sittings of this paper.
- `pick(paper, group: dict, level: int, n: int, avoid: set[int], taken: set[int]) -> tuple[list[dict], list[str]]` — questions (same dict fields as `Researcher.get_exam_questions` plus `exam_level`, `topic_key`) from the group's chapters; order of preference: level, level−1, level+1, then any level; within each, unseen (`not in avoid`) first, `ORDER BY random()`; never returns ids in `taken`; second value = log lines for every fallback used.
- `last_topics(email, paper) -> dict | None` — `topics` of the latest completed or timed-out sitting.
- `start_sitting(email, paper, length, lead_magnet, round_up_first, question_ids) -> int`
- `finish_sitting(sitting_id, status, attempt_id, topics, level_changes, predicted_pct, verdict_band) -> None` — `UPDATE … WHERE id = %s AND status = 'in_progress'`.
- `next_round_up_first(email, paper) -> bool` — negation of the last sitting's value; `True` when none.

- [ ] **Step 1: Write the failing tests** — fixture: `exam_topic_groups` ZZ9 with two groups (`a`: chapters ZZ9-1, 4 slots; `b`: ZZ9-2, 2 slots); questions: group a has 6 at level 2, 2 at level 1, 1 at level 3; group b has 1 at level 4 only; one leveled_only row; one `standalone=false` row; one `exam_level NULL` row. Tests:
  - `test_engine_for_follows_env_and_opt_out` (monkeypatch `LEVELED_PAPERS='ZZ9'`; user with `exam_engine='adaptive'` → adaptive; NULL → leveled; paper not listed → adaptive; lead magnet ignores the column).
  - `test_pick_prefers_level_then_lower` (a at level 2, n=4 → all level 2, no log); `test_pick_falls_back_down_then_up` (a at level 3, n=4 → 1 level 3, then level 2 fills, log mentions `a` and level 2).
  - `test_fallback_any_level_keeps_slot_count` (b at level 2, n=1 → the level-4 row, logged).
  - `test_pick_never_serves_unleveled_retired_or_taken`.
  - `test_pick_prefers_unseen` (avoid all but one level-2 id, n=1 → that id).
  - `test_levels_default_two_and_save_roundtrip`; `test_sitting_start_finish_and_round_parity`; `test_finish_is_once_only` (second finish leaves the first result).
- [ ] **Step 2: Run** `POSTGRES_DB=fsa_agent_test POSTGRES_HOST=localhost POSTGRES_PORT=5434 POSTGRES_PASSWORD=… python3 -m pytest tests/test_leveled_store.py -q` → FAIL.
- [ ] **Step 3: Implement** (parameterised SQL only; the leveled filter is `standalone AND exam_level IS NOT NULL AND options IS NOT NULL AND jsonb_array_length(options) > 0 AND chapter_id = ANY(%s)`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `leveled exams: store (engine choice, selection with fallback, sittings, levels)`.

### Task 4: Sanitise `examConfig`; lengths 50/100 only (server)

**Files:**
- Modify: `server/src/routes/chat.js:77` (examConfig forwarding), `server/src/routes/practiceExam.js:290-303`
- Test: `server/tests/chatRoute.test.js`, `server/tests/practiceExamRoute.test.js`

**Interfaces:** Produces `sanitizeExamConfig(raw, {leadMagnet}) -> {count, timed, lead_magnet?} | undefined` exported from `server/src/services/examConfig.js`: `count` ∈ {50, 100} else 50; `timed` boolean; `lead_magnet: true` only when `leadMagnet`; every other key dropped; `undefined` in → `undefined` out. `time_up` is not a config key (it is a message, Task 5).

- [ ] **Step 1: Failing tests** — `/api/chat` with `examConfig {count: 25, lead_magnet: true, x: 1}` forwards `{count: 50, timed: false}` to the mocked AI service; `/api/practice-exam/chat` forwards `lead_magnet: true` and `count: 100` when sent 100.
- [ ] **Step 2: Run** `npm test -- chatRoute practiceExamRoute` → FAIL.
- [ ] **Step 3: Implement** and use it in both routes.
- [ ] **Step 4: Run** → PASS. Then full `npm test` (record pass count).
- [ ] **Step 5: Commit** `exam config: sanitise, 50/100 only`.

### Task 5: Orchestrator branch — leveled selection, time-up, debrief data

**Files:**
- Modify: `ai-service/agents/orchestrator.py` (selection at ~:1349-1360 and `_reset_and_start_exam` ~:2044; answer handling ~:1422; debrief call ~:1673)
- Create: `ai-service/agents/leveled_debrief.py` (builds the leveled `display_update` and debrief prompt)
- Test: `ai-service/tests/test_leveled_orchestrator.py` (MagicMock researcher + fake `LeveledStore`, same harness style as `test_practice_exam_answer_count.py`)

**Interfaces:**
- Consumes Task 2 functions and Task 3 `LeveledStore`.
- Orchestrator holds `self.leveled_store_factory = LeveledStore` (overridable in tests).
- State keys added: `exam_engine` (`'adaptive'|'leveled'`), `leveled_sitting_id`, `leveled_levels` (levels at start), `leveled_groups`.
- Each leveled exam question dict carries `topic_key` and `exam_level` in addition to the adaptive fields; `_build_exam_question_display` adds `topic_name` (display name, never chapter) for leveled.
- Message `__time_up__` during `answering` in a leveled sitting: unanswered questions recorded as wrong (`record_response` with `selected_index=None`; `start_attempt` first if no attempt exists), sitting status `timed_out`, then the debrief.
- Leveled `display_update` (type stays `'exam_done'`, so `ExamResultsPage`, `last-results` and `fsa_last_exam_full` keep working): adaptive keys `score, total, score_pct, question_review, attempt_id` plus `leveled: {topics: [{topic_key, name, weight, level, level_name, new_level, new_level_name, correct, total}], predicted_pct, band, message, holding_back: [names], pass_pct: 65}`; `chapter_stats` and `next_attempt_allocation` omitted. Tutor debrief prompt for leveled: topic names, levels and changes, predicted score, verdict; no chapter weighting language. Lead magnet: levels are not saved and the copy points to signing up.

- [ ] **Step 1: Failing tests:**
  - `test_leveled_start_builds_exact_topic_mix` — 100 → per-topic counts equal `exam_questions`; 50 → sums to 50; every question has `topic_key` and `exam_level`; `start_sitting` called once.
  - `test_refresh_keeps_the_sitting` — second `'hello'` + same `examConfig` before finishing → no second `start_sitting`, same questions, same index.
  - `test_completion_moves_levels_and_saves` — topic a all correct at 2 → `new_level` 3; topic b all wrong at 2 → 1; `save_levels` called with those; `finish_sitting` status `completed`.
  - `test_lead_magnet_uses_free_mix_and_never_saves_levels`.
  - `test_time_up_with_no_answers` — `__time_up__` at index 0 → status `timed_out`, all topics 0 correct, levels drop, `start_attempt` called once.
  - `test_orphan_sitting_does_not_move_levels` — new Orchestrator instance (state lost) starts a fresh sitting; `save_levels` never called for the orphan.
  - `test_adaptive_when_not_enabled` — `engine_for` returns adaptive → `researcher.get_exam_questions` called exactly as today and the debrief has `chapter_stats`, no `leveled`.
  - `test_leveled_debrief_shape` — keys above present; `message` equals the band copy.
- [ ] **Step 2: Run** `python3 -m pytest tests/test_leveled_orchestrator.py -q` → FAIL.
- [ ] **Step 3: Implement** — decide the engine once when a sitting starts (`engine_for`), store it in state; branch only at the three points named above.
- [ ] **Step 4: Run** → PASS; then the whole ai-service suite (`python3 -m pytest -q`, record count; every existing practice-exam test green).
- [ ] **Step 5: Commit** `leveled exams: orchestrator engine branch, time-up, leveled debrief`.

### Task 6: Client — 50/100 only, time-up, leveled results

**Files:**
- Modify: `client-v2/src/pages/LobbyPage.jsx:362`, `client-v2/src/components/PracticeExamLobby.jsx:7-9`, `client-v2/src/ExamRouter.jsx` (timer map :733-737; `QuizExamView` time-up; `ResultsPanel` :177)
- Create: `client-v2/src/components/LeveledResults.jsx` + `LeveledResults.css` (`lr-` prefix)
- Test: `client-v2/src/components/LeveledResults.test.jsx`, `client-v2/src/pages/LobbyPage.test.jsx`

**Interfaces:** Consumes Task 5 `display_update.leveled` and Task 7's `/api/platform/me` `exam_engine_effective` (do Task 7 before this task's lobby line; the rest does not depend on it). `ResultsPanel` renders `<LeveledResults data={dc.leveled} />` in place of the chapter breakdown when `dc.leveled` exists; retry keeps `dc.total`.

- [ ] **Step 1: Failing tests** — Lobby shows exactly two length buttons (50, 100) and no "25"; `LeveledResults` renders each topic name with its level name, shows "Core → Exam-Level" on a level change, shows the band message verbatim and the predicted score against 65%, lists `holding_back` names, and never renders the word "chapter".
- [ ] **Step 2: Run** `cd client-v2 && npx vitest run src/components/LeveledResults.test.jsx src/pages/LobbyPage.test.jsx` → FAIL.
- [ ] **Step 3: Implement** — timer map `{50: 5400, 100: 10800}`; when timed and the countdown reaches 0 in a sitting, send `__time_up__` once (guard against double send) and show the results; untimed sittings never send it. Lobby line under the length picker when the exam is leveled (from `/api/platform/me` `exam_engine_effective`, Task 7): "Follows the typical real-exam mix. Difficulty adapts to your level in each topic."
- [ ] **Step 4: Run** → PASS; full `npx vitest run`; `npm run build`.
- [ ] **Step 5: Commit** `leveled exams: client results, time-up, 50/100 only`.

### Task 7: Profile fallback switch

**Files:**
- Modify: `server/src/routes/platform.js` (`GET /me` :893; new `PUT /exam-engine`), `server/src/middleware/requireAuth.js:17-32` (select `pu.exam_engine`), `client-v2/src/pages/ProfilePage.jsx` + `ProfilePage.css`
- Test: `server/tests/examEngineRoute.test.js`, `client-v2/src/pages/ProfilePage.test.jsx` (create if missing)

**Interfaces:** `/me` adds `exam_engine` (raw) and `exam_engine_effective` (`'leveled'` iff `active_paper` in `LEVELED_PAPERS` and `exam_engine` is not `'adaptive'`). `PUT /api/platform/exam-engine {engine: 'leveled'|'adaptive'}` → 200 `{exam_engine}`; anything else 400.

- [ ] **Step 1: Failing tests** — PUT stores the value and `/me` reflects both fields; invalid engine → 400; Profile shows the switch only when the active paper is enabled, labelled "Practice exam style" with options "Leveled (recommended)" and "Previous adaptive exam".
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; full server and client suites.
- [ ] **Step 5: Commit** `leveled exams: profile fallback switch`.

### Task 8: Free exam copy (fsa-website) and rollout

**Files:**
- Modify: `fsa-website/free-practice-exam.html` (every "25" length mention, including FAQ structured data) — separate repo, deploy with the `fsa-website-deploy` skill.
- Modify: `fsa-agent/.env` — `LEVELED_PAPERS=` (empty until go-live).
- Modify: wiki `projects/fsa-agent.md` (Leveled practice exams section), `log.md`.

- [ ] **Step 1:** Website copy: lengths 50 and 100 only; "follows the typical real-exam mix"; no "exact SOPEEC" wording. `grep -n "25" free-practice-exam.html` shows no exam-length mention.
- [ ] **Step 2: Deploy order** (owner OK per step): backup → apply 040 to production → `rebuild-test-db.sh` → build/restart api + ai-service with `LEVELED_PAPERS` empty (no behaviour change except 25 removed) → live check as russ@: a 50-question adaptive exam starts.
- [ ] **Step 3: Enable 2B1:** set `LEVELED_PAPERS=2B1`, restart ai-service and api; live check as russ@ (2B1 active): a 50-question exam shows topic names, a timed sitting reaches results, results show levels and the verdict; free exam on 2B1 via a verification code to russ@.
- [ ] **Step 4:** Add each further paper to `LEVELED_PAPERS` after its bank passes the 3× gate and Russ's spot check.
- [ ] **Step 5: Commit** wiki + website.
