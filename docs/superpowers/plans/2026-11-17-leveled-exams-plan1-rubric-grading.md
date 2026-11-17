# Leveled Practice Exams — Plan 1: Rubric, Topic Groups and Grading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every 2nd/3rd Class practice-exam question a calibrated difficulty level (1–4) and a topic group, starting with 2B1, and report the per-topic/per-level gaps that Plan 2 (bank fill) must close.

**Architecture:** Schema + topic-group loader live in `fsa-agent` (owner of the `questions` table). The rubric, grader, calibration and apply tooling live in `fsa-lesson-creator`, next to the existing question-review pipeline and its `claude -p` helper (`lib/ai.py`). Grading reads from `fsa_agent_scratch`, writes JSONL job files, and reaches production only through an owner-run apply script with a backup, matching the course-cutover pattern.

**Tech Stack:** PostgreSQL 15 (`fsa-postgres`, host port 5434), Python 3 + pytest (`fsa-lesson-creator/venv`, `fsa-agent/scripts`), Jest (`fsa-agent/server`), `claude -p` via `lib/ai.py`.

**Spec:** `fsa-agent/docs/superpowers/specs/2026-11-17-leveled-practice-exams-design.md` (sections 1–3 and Phase 1).

**Follow-on plans (not this one):** Plan 2 — fill the 2B1 bank to the 3× gate using the gap report from Task 8. Plan 3 — leveled engine, results/verdict, free exam, drop the 25-question option.

## Global Constraints

- Never write to production from an agent. Production changes ship as an owner-run script that takes `sudo /usr/local/bin/fsa-backup.sh daily` first.
- Scratch writes must first check `SELECT to_regclass('public._scratch_meta')` is non-null; refuse otherwise.
- Tests: Jest only against `POSTGRES_DB=fsa_agent_test POSTGRES_HOST=localhost POSTGRES_PORT=5434` plus `POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' /home/debian/.env.shared | cut -d= -f2-)`. Never `source` `.env.shared`.
- Never delete questions; never touch `questions.difficulty` (old 1–5 scale stays as is).
- Only `standalone = TRUE` questions with non-empty `options` are graded (same filter as `Researcher.get_exam_questions`).
- Levels: 1 = building block, 2 = straightforward textbook, 3 = typical real exam question, 4 = Max (hardest realistic). Relative to each paper's own real exam.
- Five rubric dimensions, each scored 1–4: `concepts`, `thinking`, `wording`, `distractors`, `calculation` (`calculation` is `null` for non-calculation questions).
- All grading LLM calls go through `claude -p` (`LESSON_LLM_BACKEND=claude-cli`). A run must stop, not fall back to OpenRouter, if the CLI is disabled mid-run — every grade must come from the calibrated grader.
- Calibration gate: ≥80% exact level match with Russ's blind grades and zero disagreements of two or more levels, per class, before bulk grading that class.
- Bank gate (for Plan 2): per topic group per level, ≥3× the topic's questions per 100-question sitting (target 4×).
- Papers in scope: `second` = 2A1, 2A2, 2A3, 2B1, 2B2, 2B3; `third` = 3A1, 3A2, 3B1, 3B2. 4A/4B are graded after the 4th Class course build (separate run of the same tools).

## Review Focus

1. A grader batch returns fewer grades than questions sent, duplicate ids, or ids not in the batch → that batch is rejected and retried, never partially written (Task 5).
2. A question is edited (rewrite in place, course cutover) between grading and apply → its stale grade must not be applied (Task 7, text hash in the `WHERE`).
3. The CLI hits the subscription limit halfway through a paper → the run stops cleanly and a rerun resumes from the next ungraded question without regrading (Task 5).
4. Calculation questions carry their steps in `step_data`; the grader must see them, or every staged calc question gets under-graded (Task 4).
5. Russ's calibration sheet must render LaTeX; raw `$\frac{...}$` in a spreadsheet makes the blind grading unreliable (Task 6).

---

### Task 1: Schema — topic groups table and level columns (fsa-agent)

**Files:**
- Create: `fsa-agent/server/migrations/038_leveled_exam_levels.sql`
- Test: `fsa-agent/server/tests/leveledSchema.test.js`

**Interfaces:**
- Produces: table `exam_topic_groups (paper_code varchar(10), topic_key varchar(60), display_name text NOT NULL, exam_questions smallint NOT NULL CHECK (exam_questions >= 0), chapter_ids text[] NOT NULL, sort_order smallint NOT NULL, PRIMARY KEY (paper_code, topic_key))`; columns `questions.exam_level smallint NULL CHECK (exam_level BETWEEN 1 AND 4)`, `questions.level_scores jsonb NULL`; index `idx_questions_exam_level (course_id, exam_level) WHERE standalone`.
- Topic group of a question is resolved by join (`questions.chapter_id = ANY(exam_topic_groups.chapter_ids)`); no denormalised `topic_key` column.

- [ ] **Step 1: Write the failing test** `leveledSchema.test.js` using `tests/testPool.js`:
  - `exam_topic_groups` exists with the columns above.
  - inserting a question with `exam_level = 5` rejects with a check violation; `exam_level = NULL` and `4` succeed (clean up only the fixture rows it inserted).
- [ ] **Step 2: Run it, expect FAIL** — `cd fsa-agent/server && POSTGRES_PASSWORD=… npx jest tests/leveledSchema.test.js` → fails on missing relation.
- [ ] **Step 3: Write migration 038.** Header comment in the style of 037 (date, purpose, replay-safe). Use `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS`.
- [ ] **Step 4: Apply to test + scratch.** `bash fsa-agent/server/scripts/rebuild-test-db.sh` does not pick up unapplied migrations (it copies the production schema), so apply 038 to `fsa_agent_test` and `fsa_agent_scratch` directly with `docker cp` + `psql -f`. Note: scratch is rebuilt nightly from production, so 038 must be re-applied to scratch daily until production has it.
- [ ] **Step 5: Run test, expect PASS.**
- [ ] **Step 6: Commit** `feat(db): 038 exam topic groups + question exam_level`.
- [ ] **Step 7: Owner handoff.** Write `fsa-agent/server/scripts/apply_038_prod.sh` (backup → `psql -v ON_ERROR_STOP=1 -f` → `\d questions` grep for `exam_level`). Do not run it; list it in the task report for Russ.

### Task 2: Topic group loader (fsa-agent)

**Files:**
- Create: `fsa-agent/scripts/load_topic_groups.py`
- Create: `fsa-agent/scripts/load_topic_groups_prod.sh` (owner-run: backup → apply the SQL from `--sql-out`)
- Test: `fsa-agent/scripts/test_load_topic_groups.py`

**Interfaces:**
- Produces:
  - `TopicGroup` dataclass: `paper_code: str, topic_key: str, display_name: str, exam_questions: int, chapter_ids: list[str], sort_order: int`
  - `parse_topic_groups(csv_path: str, papers: list[str]) -> list[TopicGroup]` — `topic_key` = slug of `topic_cluster` (lowercase, non-alphanumerics → `-`); `display_name` = `topic_cluster`; `chapter_ids` = `f"{paper}-{n}"` for each `n` in `fsa_chapters` split on `;`; `sort_order` = CSV row order within the paper.
  - `validate(groups: list[TopicGroup], chapter_ids_by_paper: dict[str, set[str]]) -> list[str]` — returns error strings: paper total ≠ 100; a DB chapter with standalone questions in no group; a chapter in two groups.
  - `load(conn, groups: list[TopicGroup]) -> int` — upsert by PK, delete groups for the loaded papers that are no longer in the CSV; returns rows written.
  - CLI: `python3 load_topic_groups.py --target scratch|test [--csv PATH]` or `--sql-out PATH` (default CSV `/home/debian/wiki/reference/sopeec-exam-breakdown.csv`). Refuses any DB target other than scratch/test; production gets the `--sql-out` file via `load_topic_groups_prod.sh`, run by Russ.

- [ ] **Step 1: Write failing tests** (parse the real CSV):
  - `test_2b1_has_six_groups_summing_100`: 6 groups, `sum(exam_questions) == 100`.
  - `test_2b1_steam_turbines`: `display_name == 'Steam Turbines & Condensers'`, `exam_questions == 30`, `chapter_ids == ['2B1-1','2B1-2','2B1-3','2B1-4']`.
  - `test_quoted_cluster_names_parse` — every paper in scope sums to exactly 100 (catches comma-in-quotes mis-parsing).
  - `test_zero_question_rows_kept`: 3A1 "Math foundations" present with `exam_questions == 0`.
  - `test_out_of_scope_classes_skipped`: no `5th`/`1B4` paper codes when `papers` is the 10 in-scope codes.
  - `test_validate_flags_unmapped_chapter`: `validate` with an extra DB chapter `2B1-12` returns an error naming it.
- [ ] **Step 2: Run, expect FAIL** — `cd fsa-agent/scripts && python3 -m pytest test_load_topic_groups.py -v`.
- [ ] **Step 3: Implement** with the `csv` module (not split-on-comma).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Load scratch and validate against live chapters:** `python3 load_topic_groups.py --target scratch` → prints rows written and zero validation errors for all 10 papers. Any validation error is a stop-and-report, not a fix-in-place (the mapping lives in `fsa-marketing/scripts/build_exam_breakdown_csv.py`).
- [ ] **Step 6: Commit** `feat(scripts): topic group loader from exam breakdown CSV`.

### Task 3: Rubric and trap catalogue (content)

**Files:**
- Create: `fsa-lesson-creator/jobs/levels/RUBRIC.md` (versioned; first line `rubric_version: 1`)
- Create: `fsa-lesson-creator/jobs/levels/traps.md`
- Create: `fsa-lesson-creator/scripts/common_wrong_answers.py`

**Interfaces:**
- Produces: `RUBRIC.md` read verbatim into the grader system prompt by Task 4; `rubric_version` parsed from its first line.

- [ ] **Step 1:** Read `fsa-website/articles/sopeec-multiple-choice-traps/index.html` and `fsa-website/articles/multiple-choice-power-engineering-strategy/index.html`; list every trap/technique named.
- [ ] **Step 2:** Write `common_wrong_answers.py --paper 2B1` (scratch, read-only): for standalone questions with ≥10 responses in `question_responses`, list those where one wrong option draws ≥40% of answers, with the question, that option and the share. Run it for all 10 papers; output to `jobs/levels/wrong-answers-<P>.md`.
- [ ] **Step 3:** Write `traps.md`: each trap with a name, a one-line description, and one example (from the articles or the wrong-answer reports). Group by kind: wording (NOT/EXCEPT/MOST), near-miss distractors (unit, gauge vs absolute, sign, order of magnitude), calculation (wrong formula variant, skipped conversion), concept swaps.
- [ ] **Step 4:** Write `RUBRIC.md`: the anchor (spec §2), the five dimensions with a definition per score 1–4 (spec table, expanded to observable criteria), the trap rule (level 3 introduces traps from `traps.md`, Max uses them freely), and two real 2B1 example questions per level with their dimension scores. The level rule must match Task 4's `level_from_scores` exactly.
- [ ] **Step 5: Commit** `docs(levels): rubric v1 + trap catalogue`.

### Task 4: Grade model — scores → level, validation, prompt (fsa-lesson-creator)

**Files:**
- Create: `fsa-lesson-creator/lib/exam_levels.py`
- Test: `fsa-lesson-creator/tests/test_exam_levels.py`

**Interfaces:**
- Produces:
  - `DIMENSIONS = ("concepts", "thinking", "wording", "distractors", "calculation")`
  - `level_from_scores(scores: dict) -> int` — mean of the non-null dimension scores, rounded half-up, then capped at `scores["thinking"] + 1`, clamped to 1–4.
  - `validate_grade(grade: dict, expected_id: int) -> None` — raises `ValueError` unless: `id == expected_id`; every dimension present; each is int 1–4 (`calculation` may be `None`); `rationale` non-empty str.
  - `build_grader_prompt(questions: list[dict], rubric_text: str) -> tuple[str, str]` — returns `(system, user)`. Each question rendered with id, paper, topic group name, text, the 4 options lettered A–D, the correct letter, explanation, and every `step_data.steps[i]` prompt + options when present. The grader returns JSON `{"grades": [{"id", "concepts", "thinking", "wording", "distractors", "calculation", "rationale"}]}` — it never returns a level; the level is always computed by `level_from_scores`.
  - `text_hash(q: dict) -> str` — md5 hex of `question_text`.

- [ ] **Step 1: Write failing tests:**
  - `level_from_scores({"concepts":1,"thinking":1,"wording":1,"distractors":1,"calculation":None}) == 1`
  - `level_from_scores({"concepts":3,"thinking":3,"wording":2,"distractors":2,"calculation":None}) == 3` (2.5 rounds up)
  - `level_from_scores({"concepts":4,"thinking":1,"wording":4,"distractors":4,"calculation":4}) == 2` (thinking cap)
  - `level_from_scores({"concepts":4,"thinking":4,"wording":4,"distractors":4,"calculation":4}) == 4`
  - `validate_grade` raises on wrong id, on missing `wording`, on `thinking: 5`, on empty rationale; passes a complete grade with `calculation: None`.
  - `build_grader_prompt` with a staged question: user text contains every step's prompt and the correct letter; system text contains the rubric text verbatim.
- [ ] **Step 2: Run, expect FAIL** — `cd fsa-lesson-creator && venv/bin/pytest tests/test_exam_levels.py -v`.
- [ ] **Step 3: Implement.** Round half-up explicitly (`int(x + 0.5)`), not Python's banker's `round`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(levels): grade model and grader prompt`.

### Task 5: Grader run script (fsa-lesson-creator)

**Files:**
- Create: `fsa-lesson-creator/scripts/grade_exam_levels.py`
- Test: `fsa-lesson-creator/tests/test_grade_exam_levels.py`

**Interfaces:**
- Consumes: Task 4 functions; `lib.ai.complete_json`, `lib.ai._cli_enabled`.
- Produces: `jobs/levels/<P>/grades.jsonl`, one line per question: `{"id", "paper", "topic_key", "text_hash", "rubric_version", "scores": {...}, "rationale", "level"}`. Function `grade_paper(paper: str, questions: list[dict], groups: dict[str, str], out_path: Path, complete=complete_json, batch_size=10) -> dict` returning `{"graded": int, "skipped": int, "stopped": str | None}`.
- CLI: `LESSON_LLM_BACKEND=claude-cli venv/bin/python scripts/grade_exam_levels.py --paper 2B1 [--ids 1,2,3] [--limit N]`. Reads standalone questions + topic groups from scratch (read-only; Task 1 tables must exist there).

- [ ] **Step 1: Write failing tests** with a fake `complete`:
  - resume: an existing line for id 7 with the current `rubric_version` and matching `text_hash` is skipped; a line with an older `rubric_version` or different hash is regraded.
  - bad batch: fake returns 9 grades for a 10-question batch → batch retried once, then the run stops with `stopped` set and none of that batch's ids written.
  - CLI disabled: monkeypatch `_cli_enabled` to return False before the second batch → run stops after batch 1, `stopped` mentions the CLI, batch 1 lines are on disk.
  - each written line has `level == level_from_scores(scores)`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Append-and-flush per completed batch, so a crash loses at most one batch. Check `_cli_enabled()` before every batch; never call `complete` when it is False.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Smoke run** on 20 real 2B1 questions: `--paper 2B1 --limit 20`. Check by eye that rationales cite the rubric and staged calc questions are scored on `calculation`.
- [ ] **Step 6: Commit** `feat(levels): resumable grader run`.

### Task 6: Calibration — blind sample and agreement check (fsa-lesson-creator)

**Files:**
- Create: `fsa-lesson-creator/scripts/level_calibration.py`
- Test: `fsa-lesson-creator/tests/test_level_calibration.py`

**Interfaces:**
- Produces:
  - `sample` subcommand: `--class second|third --n 30 --seed 17` → stratified across that class's papers (equal share per paper), mixing `question_type`, old `difficulty` and topic groups; writes `jobs/levels/calibration/<class>-v<rubric_version>-blind.csv` (`id, paper, topic, russ_level` — `russ_level` blank) and `...-blind.html` (numbered questions, options, correct answer, explanation, steps; LaTeX rendered with KaTeX from cdnjs with a pinned version; no grades, no scores).
  - `compare(russ: dict[int, int], grader: dict[int, int]) -> dict` → `{"n", "exact_pct", "off_by_two_plus", "confusion": {(russ, grader): count}, "disagreements": [ids]}`; `passes_gate(result) -> bool` = `exact_pct >= 80 and off_by_two_plus == 0`.
  - `compare` subcommand: reads the filled CSV + `grades.jsonl` for the sampled ids, prints the result and the disagreement questions with grader rationale; exit 0 only if the gate passes.

- [ ] **Step 1: Write failing tests:** `compare` on 10 pairs with 8 exact and 2 off-by-one → `exact_pct == 80`, gate passes; one off-by-two → gate fails; sampling with a fixed seed is deterministic and spreads evenly across the class's papers (30 over 6 papers → 5 each).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(levels): calibration sample + agreement gate`.
- [ ] **Step 6: Calibration round (operational, needs Russ).** Generate the `second` and `third` samples; grade the sampled ids (Task 5 `--ids`); send Russ the HTML sheets (publish via the Artifact tool, private) and the CSVs for entering levels. On return, run `compare`. If the gate fails: revise `RUBRIC.md` (bump `rubric_version`) and/or the prompt from the disagreements, regrade the sample, re-compare. Russ is only asked again if a revision changes how a dimension is defined. Keep every round's CSVs and results in `jobs/levels/calibration/` (they are the Phase 6 evidence) and commit them.

### Task 7: Apply grades — scratch and owner-run production (fsa-lesson-creator)

**Files:**
- Create: `fsa-lesson-creator/scripts/apply_exam_levels.py`
- Create: `fsa-lesson-creator/scripts/apply_exam_levels_prod.sh`
- Test: `fsa-lesson-creator/tests/test_apply_exam_levels.py`

**Interfaces:**
- Consumes: `grades.jsonl` (Task 5).
- Produces: `build_apply_sql(grades: list[dict]) -> str` — one transaction; per grade `UPDATE questions SET exam_level = <level>, level_scores = '<json>'::jsonb WHERE id = <id> AND md5(question_text) = '<text_hash>' AND standalone;`, then a final `SELECT` count of rows with `exam_level IS NOT NULL` for the paper. JSON includes scores, rationale, `rubric_version`.
- CLI: `apply_exam_levels.py --paper 2B1 --target scratch` (guarded by `_scratch_meta`) or `--sql-out jobs/levels/2B1/apply.sql`. Prod shell: backup → `psql -v ON_ERROR_STOP=1 -1 -f apply.sql` via `docker cp` → prints rows updated vs grades in file; any mismatch is reported (it means questions changed since grading — regrade those ids).

- [ ] **Step 1: Write failing tests:** generated SQL has one `UPDATE` per grade, the hash in each `WHERE`, `BEGIN`/`COMMIT`; a rationale containing a single quote is escaped (`'` → `''`); a grade whose `level` disagrees with `level_from_scores(scores)` raises.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(levels): apply grades (scratch + owner-run prod)`.

### Task 8: Grade 2B1 and report the gaps

**Files:**
- Modify: `fsa-lesson-creator/lib/exam_levels.py` (add `gap_report`)
- Modify: `fsa-lesson-creator/tests/test_exam_levels.py`
- Create: `fsa-lesson-creator/jobs/levels/2B1/gaps.md` (generated)

**Interfaces:**
- Produces: `gap_report(level_counts: dict[str, dict[int, int]], exam_questions: dict[str, int], minimum=3, target=4) -> list[dict]` — per topic and level: `{"topic_key", "level", "have", "need_min", "need_target", "short_min", "short_target"}` with `need_min = minimum * exam_questions[topic]`. Topics with `exam_questions == 0` are omitted. Plan 2's generation input.

- [ ] **Step 1: Write failing test:** Steam Turbines (`exam_questions` 30) with 40 questions at level 1 → `need_min 90, short_min 50, need_target 120, short_target 80`.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Grade all of 2B1** (only after the `second` calibration gate passed): `grade_exam_levels.py --paper 2B1`; rerun until `stopped` is null.
- [ ] **Step 6:** Apply to scratch (Task 7); generate `apply.sql` + hand Russ the prod command.
- [ ] **Step 7:** Write `jobs/levels/2B1/gaps.md`: level distribution per topic, the gap table, and the total new questions needed for the 3× gate and the 4× target.
- [ ] **Step 8: Commit** `feat(levels): 2B1 graded + gap report`.

### Task 9: Docs

- [ ] Update `wiki/projects/fsa-agent.md` (migration 038, `exam_topic_groups`, `exam_level` is the new scale, old `difficulty` unchanged) and `wiki/projects/fsa-lesson-creator.md` (the levels toolkit and calibration gate; 4th Class course builds grade with it after the build). Append to `wiki/log.md`. Update backlog #147 with Plan 1 status. Commit in the wiki repo.
