# Lesson tutor redesign: scripted check-ins, on-demand AI

Status: draft spec, not started · 2026-10-13 · Source: first NPS response (Katelyn Fournell, 2nd Class, score 3) and the code trace in `wiki/log.md` 2026-10-13.

## 1. Goal

Replace the always-on chat panel in the lesson player with:

1. **Scripted check-ins**: a pre-written "key points so far" card inserted into the slide flow at the existing checkpoint positions. It is written offline from the slides already covered, so it costs nothing per view and can't drift.
2. **An optional quick exercise** offered on each check-in: a short AI-led exchange (2–4 turns) on exactly the slides covered so far.
3. **"Ask about this slide"**: on-demand free questions, grounded in slides 1 through the current one.
4. **Persistent memory**: the tutor remembers the student across slides, objectives and service restarts.

Success means none of the four NPS failure modes can happen by construction:
- wrong answer contradicting the slides
- a question announced that never renders, then its answer given away
- the chat resetting on every slide
- pointing the student at content they haven't seen or can't open

## 2. Current state and assumptions

**Verified in code and data:**
- `client-v2/src/LessonPlayer.jsx` (338 lines) renders `ContentPanel` (60%) + `TutorPanel` (40%). On phones they become a Lesson / AI Tutor tab toggle.
- `TutorPanel.jsx` replaces all messages on every `sectionIndex` change (one section is one slide) with a canned `BETWEEN_MESSAGES` line. It reads only `tutor_response` from `/api/chat` and ignores `display_update`.
- Checkpoints: every 4th slide (`CHECKPOINT_INTERVAL`) or `lesson_chunks.checkpoint_after = true`. `/api/v2/checkpoint` serves a DB question filtered by `questions.earliest_slide <= learner_sessions.last_section`. 4,367 of 6,734 `objective_practice` questions have `earliest_slide` set; the rest are NULL and treated as answerable anywhere.
- `ai-service/agents/orchestrator.py` (2,002 lines) keeps `conversation_state` in memory, keyed `user:lesson_id`. It is lost on every restart. `chat_history` is written (one row per user+lesson) but never read back.
- Lesson-mode context is 4 retrieved slides (FTS since `795b0ea`, the first 4 slides before a question is asked). The tutor never knows which slide the student is on, or which checkpoint question is on screen.
- The lesson-mode activity machine (`greeting` → `practice` → `staged_problem` …) emits `display_update` question displays that client-v2 never renders. This is the source of "I've posted a question above".
- Model: `OPENROUTER_MODEL=google/gemini-3-flash-preview`. The calculator guard lives in `tutor.py`.
- Content size: 1,402 objectives, 25,919 slides, about 18 slides per objective on average (max 77), about 750 chars per slide. Slides 1..N for the largest objective is about 58k chars (≈15k tokens), so the whole covered-so-far text fits in every call.
- Usage: 26 saved transcripts from 8 students since 2026-08-04, against 15 active 2nd/3rd Class subscriptions. The free chat is a minority feature, but the students who use it use it heavily (average 18 messages).
- 4th Class has no tutor. That doesn't change.

**Assumptions (confirm):**
- A1. Check-in recaps can be machine-generated and spot-checked, not hand-written. 1,402 objectives × ~4 check-ins is roughly 6,000 cards.
- A2. The existing checkpoint cadence (every 4 slides plus `checkpoint_after`) is the right place for check-ins.
- A3. Free questions stay, as "Ask about this slide", rather than being removed entirely.

## 3. Constraints

- Production DB rules: generation and backfills run against `fsa_agent_scratch` first, with a backup before any production write. Tests use `fsa_agent_test` with `POSTGRES_PASSWORD` extracted, never sourced.
- The model is called through OpenRouter from ai-service; keep the per-turn cost in the current range. No direct Anthropic API (see `claude-code-subscription-architecture`).
- Free navigation stays: no gating. Students jump around, so "covered so far" means **slides up to the current one in this objective**, not "slides actually viewed".
- `client-v2` styling rule: lesson-player CSS lives in `index.css`, with no new inline layout objects.
- The student-facing voice is Russ's: no jargon, no em dashes in copy.
- The tutor must not say it displayed something unless the client rendered it.

## 4. Risks and edge cases

| Risk | Mitigation |
|---|---|
| Generated recap misstates a slide (the same class of bug we're fixing) | Recap generation sees only the slides it summarises and must quote or paraphrase them. Spot-check about 50 across papers before launch. Students can flag a card, reusing the `question_flags` pattern. |
| A student jumps to slide 30 without viewing 1–29 | "Covered" = slides 1..current. They chose to skip, and the material is still fair game. |
| A student asks about something on a later slide | It isn't in context, so the tutor says it comes up later in this objective and offers to wait or give a one-line preview. This replaces today's habit of citing other papers. |
| Library background (cross-paper recap) still wanted for prerequisites | Keep `search_library` with `class_prefix`, but only on "Ask" turns that the in-objective context can't answer, labelled "background from <paper>". |
| Restart mid-exercise | Exercise state is rebuilt from DB on every turn (transcript + checkpoint id + slide), with no in-memory dependency. |
| Memory grows unbounded or stores junk | Memory holds a small structured record (preferred name, stated preferences such as "don't use my name so much", up to 10 short notes) written only by an explicit extraction step, not the raw transcript. |
| Lessons re-generated by fsa-lesson-creator shift slide numbers | Check-ins are keyed `(lesson_code, after_slide)` and regenerated by the same pipeline stage. A stale check-in (beyond `max(slide_number)`) is skipped, not rendered. |
| Objectives with no check-in rows yet | Fall back to today's question-only checkpoint card. No empty card. |
| Cost spike from full-context calls | About 15k input tokens worst case, on a flash model, only on opt-in. Log tokens per turn to `usage_events` and alert if the daily total is more than 3× the current baseline. |
| Mobile | Check-ins render inside the content panel as an inserted card. The tutor tab becomes a slide-up drawer, opened only on demand. |

## 5. Options considered

**A. Fix the chat in place.** Stop clearing on slide change, persist state, render `display_update`, and give it the covered-so-far context.
- Smallest change, and fixes the bugs.
- Keeps an idle 40% panel that 8 of roughly 15 students have ever typed into.
- Doesn't deliver the guided check-ins Russ wants.
- The orchestrator activity machine stays as the main complexity.

**B. Scripted check-ins + opt-in exercise + Ask (recommended).**
- Every student gets guided recaps for free.
- The live model is used only when someone opts in, with a fully specified context.
- The orchestrator's lesson-mode activity machine is retired rather than fixed.
- More work: new table, generation script, two client components, two endpoints.

**C. Fully scripted, no live AI in lessons.**
- Cheapest and most predictable.
- Removes the thing she called "one of a kind" and the feature 8 students actively use.
- Rejected.

## 6. Recommended approach

**Option B**, shipped as independent slices so the bug-fixing parts land first and the old UI keeps working until the flag flips.

Key design decisions:

1. **Context is deterministic, not retrieved.** Every lesson-mode AI call gets: the objective title, the full text (title + body + narration) of slides 1..current, the check-in script if any, the student memory record, and the objective transcript (last 20 turns).
   - In-lesson FTS is no longer used for lesson mode.
   - Later slides are absent from context, so the model can't jump ahead.
2. **One renderer for questions.** In an exercise, the model returns structured output `{message, question?: {text, options[4], correct_index, explanation}}`. The client renders `question` as a card inside the exercise thread.
   - If there is no `question`, there is no card.
   - The prompt forbids referring to "the panel", "above" or "on screen".
   - Answer checking is done client-side against `correct_index`, then echoed to the model as "student picked B (correct/incorrect)", so the model never reveals an answer before the student picks.
3. **Stateless ai-service for lessons.** The Node API loads transcript + memory + slides from Postgres and posts them to a new ai-service endpoint, so a restart can't wipe a session. Exams and chapter quizzes keep the current orchestrator for now (out of scope).
4. **Check-ins are content, generated like slides.** A new `lesson_checkins` table, filled by a batch script (later an fsa-lesson-creator stage) using the same model. Reviewed by sampling. Served by the existing `/api/v2/checkpoint`, extended to return `{checkin, question}`.
5. **Memory is per student, cross-objective.** A `tutor_memory` row, updated by a cheap extraction pass every 3 exchanges (the same cadence as the current transcript save). The prompt is told to honour it, for example the preferred name and "use my name sparingly".

## 7. Implementation plan

Each slice is shippable on its own. Slices 1–2 also improve the current UI.

**Slice 1: memory and transcript reload (backend only)**
1. Migration `025_tutor_memory.sql`: `tutor_memory(user_email PK, preferred_name text, preferences jsonb default '[]', notes jsonb default '[]', updated_at)`.
2. `researcher.get_chat_history(user, lesson_code)` and `get_tutor_memory` / `upsert_tutor_memory`.
3. Orchestrator init: seed `chat_history` / `full_transcript` from the DB row, and inject memory into the system prompt (`tutor_prompt.py`). Use `preferred_name` over `first_name`.
4. Extraction pass in the `_should_save_progress` path: a short model call returns `{preferred_name?, preferences_add[], notes_add[]}`, merged and capped.
5. Tests: a restart (fresh `Orchestrator`) resumes the transcript, and "call me Garlock" in objective A is honoured in objective B.

**Slice 2: covered-so-far context (backend + one client field)**
1. The client sends `slideNumber` (current `sections[sectionIndex].slide_number`) with every `/api/chat` call in lesson mode. The server passes it through.
2. `researcher.get_slides_through(lesson_code, slide_number)` replaces `get_relevant_chunks` for lesson mode.
3. Prompt section "COVERED SO FAR (slides 1–N of M)" plus the later-slides rule.
4. Delete the lesson-mode `display_update` question emission and the activity routing that produces it. Lesson mode becomes plain Q&A.
5. Replay evals: add Katelyn's 4 transcripts as cases in `ai-service/evals/`. In particular, the nuclear question at slide 22 of 2B1-1-1 must yield "four-casing cross compound", and "more questions" must not claim a panel.

**Slice 3: check-in content**
1. Migration `026_lesson_checkins.sql`: `lesson_checkins(id, lesson_code, after_slide, recap_points jsonb, exercise_prompt text, model text, generated_at, reviewed_at, flagged_count int default 0, UNIQUE(lesson_code, after_slide))`.
2. Generation script `server/scripts/generate-checkins.js` (or Python in ai-service, matching the model client).
   - For each objective, compute the check-in positions using the same rule as the client (every 4th slide plus `checkpoint_after`).
   - Send slides 1..pos and ask for 3–5 recap bullets drawn only from those slides, plus one exercise opener.
   - Run against scratch, dump 50 random cards for Russ to review, then run on production with a backup first.
3. Extend `/api/v2/checkpoint` to return `{checkin, question}`. `checkin` is null when there's no row.

**Slice 4: client (behind a flag)**
1. Flag: `platform_users.feature_flags` jsonb, or the `TUTOR_V2_EMAILS` env allow-list to start (unknown: does a per-user flag mechanism already exist? check before adding one).
2. `CheckInCard` (in `ContentPanel`, between slides): recap bullets, the practice question if any (the existing `QuestionCard`), and two buttons: **Quick exercise with the tutor** and **Continue**.
3. `TutorDrawer`: replaces the 40% panel. Opened by "Ask about this slide" (a button in the slide footer) or by starting an exercise. Its thread persists for the objective (loaded from the transcript) and isn't cleared on slide change. Desktop: right-side drawer; mobile: bottom sheet, replacing the tab toggle.
4. Remove the `BETWEEN_MESSAGES` rotation.

**Slice 5: exercise endpoint**
1. `POST /api/v2/tutor/turn` `{lesson_code, slide_number, mode: 'ask'|'exercise', checkin_id?, message}`. The Node API assembles context from the DB and calls a new ai-service `/tutor/lesson-turn`, which is stateless.
2. Structured output schema (above). Validate server-side: exactly 4 options and `correct_index` in range. Drop the question (keep the message) if it's invalid.
3. Exercise length: the model is told 2–4 questions, then wrap up with one line on what to revisit. The client shows "Back to the lesson".
4. Keep the calculator guard for numeric turns.
5. Log tokens per turn to `usage_events`.

**Slice 6: rollout**
1. russ@ only, run one full objective per class level.
2. Turn it on for Katelyn and the other 7 tutor users, and send Katelyn a personal note from Russ saying what changed.
3. Turn it on for all, after 14 days with no regressions.
4. Delete the old `TutorPanel` chat path and the orchestrator lesson-mode activity machine.

## 8. Validation checklist

- [ ] The eval replay of all 4 Katelyn transcripts passes: correct nuclear answer, nickname honoured across objectives, no "panel above", no answer revealed before a pick, no 3rd Class citations.
- [ ] Restarting ai-service mid-exercise, then sending the next turn, keeps the context.
- [ ] A slide-22 question in a 49-slide objective: the context contains slides 1–22 only (asserted in a unit test on the context builder).
- [ ] An objective with no `lesson_checkins` rows behaves exactly like today's question-only checkpoint.
- [ ] A stale check-in (`after_slide` > the last slide) isn't rendered.
- [ ] Mobile at 375px: the check-in card and the drawer are usable, with no horizontal scroll.
- [ ] 4th Class: no check-in AI buttons, no drawer.
- [ ] 50-card recap sample reviewed by Russ, with no factual errors against the slides.
- [ ] Token logging is present, and a day's cost is compared against the pre-launch baseline.
- [ ] Test suites run against `fsa_agent_test` / scratch only.

## 9. Rollback and recovery

- Slices 4–6 sit behind the flag. Rollback is removing the email from the allow-list (or unsetting the env var) and restarting the api. The old `TutorPanel` stays in the bundle until slice 6.4.
- Slices 1–2 are backend changes to the existing chat. Revert the commit and redeploy ai-service. `tutor_memory` is additive and harmless if unused.
- `lesson_checkins` is additive. A bad generation run is wiped with `DELETE FROM lesson_checkins WHERE model = '<run>'` (scoped, never unscoped) after a backup.
- Don't drop the old orchestrator lesson-mode code until the 14-day window passes.

## Decisions (Russ, 2026-10-13)

1. Keep "Ask about this slide": yes.
2. Recaps generated and sampled (50 cards), not approved one by one: yes.
3. Exercises are multiple choice only.
4. Check-in cadence: section breaks if they are reliably detectable, otherwise every 4-5 slides. Checked 2026-10-13: they are not.
   - `lesson_chunks.checkpoint_after` is set on 0 of 1,402 objectives.
   - Runs of repeated slide titles give usable sections on only 485 (35%); 786 have a unique title on every slide.
   - fsa-lesson-creator does build slides per subsection (`stage5-content-N.json`), but only 674 objectives have job directories, and the boundary is never written to the DB.
   - So check-ins stay on the existing every-4-slides rule (`CHECKPOINT_INTERVAL = 4`, about 4 per 18-slide objective). Revisit if lesson-creator starts writing `checkpoint_after` at subsection boundaries; the client already honours it.

## Implementation notes (slices 1-2)

- **Deviation from §6.1:** the objective's `source_content` (capped at 12k chars, p95 ~13k) is sent along with the covered slides. It is the same text on every slide row and is the only place formulas exist as text; slide bodies show them as images. It covers the whole objective, so the prompt tells the tutor not to raise later topics from it unprompted.
- `/api/chat` now takes the student from the session (`req.user.email`), not the body. With saved transcripts and memory readable through the tutor, a body-supplied `user` would have let one student read another's conversations.
- The lesson-mode activity machine (`_route_activity`, `_load_next_question`, staged problems, `display_update` emission) is unreachable from the lesson player now but not deleted, per §9.
- The chat thread persists across slides and resets on a new objective; the tutor itself remembers the old objective's conversation. Showing the saved transcript in the panel is slice 4.

## Implementation notes (slice 3)

- Cards are generated by `ai-service/scripts/generate_checkins.py`. They go to `data/checkins/checkins.jsonl` (gitignored), not straight into a database: scratch is rebuilt nightly, and the file is what gets reviewed and later loaded. The `load` command refuses any database except scratch without `--allow-production`.
- Each card recaps only the slides since the previous checkpoint. Earlier slides are passed as titles alone, so the model can't drift outside the segment. Positions mirror `CHECKPOINT_INTERVAL = 4`, i.e. cards at slide indexes 3, 7, 11 and so on: 5,786 cards across the 929 objectives long enough to reach a checkpoint. The other 473 have 4 slides or fewer.
- `after_slide` is the last slide a card covers. `/api/v2/checkpoint` returns the latest card with `after_slide < last_section` (not an exact match, because the player's checkpoint counter drifts when students go back and forth) as `checkin`, next to `question`. If the lookup fails, it degrades to `checkin: null` and the question is still served.
- Model `google/gemini-3-flash-preview` with low reasoning effort costs about $0.0025 a card (≈ $14 for the full set). Replies are validated: 2 to 6 points, length caps, no CJK, and em dashes rewritten.
- `server/scripts/apply-026-checkins.sh` is the production step: backup, migration, api deploy, load. Run it only after the sample has been reviewed.
- Shipped 2026-10-14. Russ reviewed the 50-card sample (seed 20261013) and approved the set; those 50 rows have `reviewed_at` set, and the rest are NULL. An automated check found 388 numbers in 219 cards that don't appear as digits in their slides or the source text. Six were checked by hand, and all were either written out in words on the slides or worked from slide values.
