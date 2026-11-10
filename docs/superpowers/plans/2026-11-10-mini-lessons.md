# Mini Lessons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a pasted social post ("I'm stuck on X") into a free, public, verified mini lesson at `learn.fullsteamahead.ca/explained/<slug>`. A mini lesson is slides, narration, 2–3 staged practice questions and a soft pitch. The link is sent to Russ on Telegram.

**Architecture:**
- **fsa-agent:**
  - New tables, `mini_lessons` and children, kept completely separate from `lessons`, `lesson_chunks` and `questions`.
  - A public read route, a public media route scoped to its own directory, and a token-guarded internal publish route.
  - Server-injected Open Graph tags.
  - A client page that reuses `ContentPanel` plus a new staged-question component.
- **fsa-lesson-creator:** a new `mini_lesson/` package that runs intake → locate source → write → verify math → render media → publish pending → Playwright playthrough → go live or hold → notify.
- **FSA agent (Telegram):** triggers the build through a CLI.

**Tech Stack:**
- Node/Express, jest, and Playwright (already a devDependency in `fsa-agent/server`)
- React and vitest (`client-v2`)
- Python 3, pytest, and the lesson-creator `venv`
- PostgreSQL in `fsa-postgres`, Azure TTS, and `claude -p` (`LESSON_LLM_BACKEND=claude-cli`)

**Spec:** `fsa-agent/docs/superpowers/specs/2026-11-10-mini-lessons-design.md`. Read it before any task.

## Global Constraints

- **Branches:** work on `feature/mini-lessons` in both `fsa-agent` and `fsa-lesson-creator`, plus `fsa-business-agent` for Task 11. Check the branch before every commit, because other sessions switch branches.
- **No merging, deploying, production migrations or production writes by implementers.** Production steps are owner-run scripts (Task 11). The only exception is the pilot build in Task 12, which is run by the orchestrating session.
- **Test databases:**
  - fsa-agent tests run only with `POSTGRES_DB=fsa_agent_test POSTGRES_HOST=localhost POSTGRES_PORT=5434 POSTGRES_PASSWORD=$(grep -m1 '^POSTGRES_PASSWORD=' /home/debian/.env.shared | cut -d= -f2-)`.
  - Never `source` `.env.shared`.
  - Re-run `bash server/scripts/rebuild-test-db.sh` after the migration is written.
  - lesson-creator tests never touch a database. They use fixtures and mocks.
- **Content and copy rules:**
  - The public page, the pitch copy, and anything else in Russ's voice contains **no em dashes**.
  - The pitch card states **no price**.
  - 4th Class copy never mentions an AI tutor.
  - Pitch link: `https://fullsteamahead.ca/enroll?class=<second|third|fourth_a|fourth_b>&utm_source=mini-lesson&utm_campaign=<slug>`. Paper prefix `2` → `second`, `3` → `third`, `4A` → `fourth_a`, `4B` → `fourth_b`.
- **Question rules:**
  - `options` are never empty.
  - Questions are self-contained, never name a table or figure, and use LaTeX `$...$` / `$$...$$` with no nested delimiters.
  - Calculation questions are staged multi-step MCQs in `step_data.steps[] {type, context, question, options[], correct, explanation}`.
  - Options are shuffled with `fsa-agent/scripts/option_order.shuffle_options` before publish.
- **Statuses:** `pending | awaiting_approval | live | held`. Allowed transitions are listed below; the internal API refuses everything else, and specifically `held → live`.

  | From | To |
  |---|---|
  | (new) / any | `pending`, via upsert |
  | `pending` | `live` |
  | `pending` | `awaiting_approval` |
  | `pending` | `held` |
  | `awaiting_approval` | `live` |
  | `awaiting_approval` | `held` |

- **Status rules:**
  - The public API serves `live` to anyone, and `pending`/`awaiting_approval` only with the matching `?preview=<token>`. It never serves `held`.
  - `→ live` and `→ awaiting_approval` require `checks_passed = true` on the row.
- **Media:**
  - Host dir `/home/debian/media-mini`, env `FSA_MINI_MEDIA_DIR`, mounted read-only at `/srv/fsa-mini-media`.
  - Served at `/explained-media/<slug>/<file>`.
  - Course `/media` is unchanged.
- **Env vars:**
  - `MINI_LESSON_PUBLISH_TOKEN` goes in `fsa-agent/.env` and `fsa-lesson-creator/.env`.
  - `MINI_LESSON_API_BASE=https://learn.fullsteamahead.ca` goes in the lesson-creator `.env`.
  - The internal route reads header `x-mini-lesson-token`.
- **Owner notification:** `bash /home/debian/fsa-marketing/scripts/remind.sh "<text>"` (fsa-common `notifyOwner` via the agent outbox).
- **Text generation:** uses `lib/ai.complete` / `complete_json` with `LESSON_LLM_BACKEND=claude-cli`.

## Review Focus

1. **Paid content via the public surfaces.** If the slug is a course lesson code (`2B3-1-7`), contains `..`, or has encoded traversal (`%2e%2e`), the result must be a 404 every time. Pinned in Task 2.
2. **Preview token misuse.** A wrong token, an empty token, or a token belonging to another slug must give a 404, never the pending lesson. Pinned in Task 2.
3. **The verifier's own code fails.** If the verifier's re-solve code raises, times out (over 20 s) or prints nothing, the result is a hold, never a pass. Pinned in Task 8.
4. **Rounding.** A slide shows `256.6 Ω` and the computed value is `256.55…`, which must pass. A slide shows `257 Ω` against a computed `256.55`, which must also pass, because it is correct to the shown precision. A slide shows `265.6 Ω`, which must be held. Pinned in Task 8.
5. **A rebuild of an existing slug while it's live.** The old version stays served until the new one passes. A failed rebuild must not take down the live lesson. Pinned in Tasks 3 and 9.

---

### Task 1: fsa-agent — migration and data access

**Files:**
- Create: `server/migrations/035_mini_lessons.sql`
- Create: `server/src/services/miniLessons.js`
- Test: `server/tests/miniLessons.test.js`

**Interfaces:**
- Produces, for the tables:
  - `mini_lessons(id serial pk, slug varchar(80) unique not null, title text not null, description text not null, paper_code varchar(10) not null, source_lesson_code varchar(20), source_label text not null, request_text text not null, status varchar(20) not null default 'pending' check in (pending, awaiting_approval, live, held), preview_token varchar(64) not null, checks_passed boolean not null default false, hold_reason text, og_image_url text, version int not null default 1, created_at, updated_at, published_at)`
  - `mini_lesson_slides(id, mini_lesson_id fk on delete cascade, version int, slide_number int, chunk_type, title, body, narration, audio_url, image_url, narration_timing jsonb, unique(mini_lesson_id, version, slide_number))`
  - `mini_lesson_questions(id, mini_lesson_id fk cascade, version int, position int, question_text text not null, step_data jsonb not null, explanation text)`
  - Columns `live_version int` and `draft_version int` on `mini_lessons`. The public read serves `live_version` to anyone and `draft_version` with a preview token. That is what keeps a live lesson up during a rebuild (Review Focus 5).
- Produces, for the service in `miniLessons.js`:
  - `getPublic(slug: string, previewToken: string|null) → Promise<PublicMiniLesson|null>`
  - `upsertDraft(payload: PublishPayload) → Promise<{slug, status, preview_token, version}>`
  - `setStatus(slug, to, {holdReason, checksPassed}) → Promise<{slug, status}>`, which throws `TransitionError` on a disallowed transition
  - `list() → Promise<Array<{slug, title, paper_code, source_lesson_code, status, updated_at}>>`
- `PublicMiniLesson`: `{slug, title, description, paper_code, class_code, source_label, og_image_url, sections: [{slide_number, chunk_type, title, body, narration, audio_url, image_url, narration_timing}], questions: [{position, question_text, step_data}]}`. The section field names match `getV2Lesson` so `ContentPanel` accepts them unchanged.
- `PublishPayload`: `{slug, title, description, paper_code, source_lesson_code, source_label, request_text, og_image_url, slides: [...section fields], questions: [{position, question_text, step_data, explanation}]}`

- [ ] **Step 1:** Write `miniLessons.test.js` (it requires `testPool`). The tests:
  - `upsertDraft` on a new slug gives `status 'pending'`, version 1, and a 64-hex `preview_token`.
  - `getPublic(slug, null)` while pending gives `null`. With the right token it returns the draft sections in slide order.
  - `setStatus(slug,'live')` while `checks_passed=false` throws `TransitionError`.
  - After `setStatus(slug,'live',{checksPassed:true})`, `getPublic(slug,null)` returns version 1.
  - A second `upsertDraft` (version 2) while v1 is live: `getPublic(slug,null)` still returns v1 content, and `getPublic(slug, token)` returns v2.
  - `setStatus` from `held` to `live` throws.
  - `class_code` is `'second'` for `2B3`, `'third'` for `3A1`, `'fourth_a'` for `4A`, `'fourth_b'` for `4B`.
  - Fixtures are scoped to slugs prefixed `test-mini-` and cleaned by slug, never unscoped.
- [ ] **Step 2:** Run `cd server && <test env> npx jest tests/miniLessons.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3:** Write the migration, apply it to `fsa_agent_test` only (`bash server/scripts/rebuild-test-db.sh` reads production schema, so also apply 035 to the test DB directly with `docker exec -i fsa-postgres psql -U postgres -d fsa_agent_test -v ON_ERROR_STOP=1 < server/migrations/035_mini_lessons.sql`), and implement the service. `upsertDraft` runs in one transaction. It inserts children at `version = coalesce(max version,0)+1`, sets `draft_version`, `status='pending'`, `checks_passed=false`, `hold_reason=null`, and keeps `live_version` and `preview_token`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mini-lessons): schema + data access`.

### Task 2: fsa-agent — public read API and public media

**Files:**
- Create: `server/src/routes/explained.js`
- Modify: `server/src/index.js`, mounting it next to the other unauthenticated routes (`/api/practice-exam`). It sits under the existing `/api` limiter and `requireLearnHost`. Mount the media route before the `/media` block.
- Modify: `docker-compose.yml`, adding the api volume `${FSA_MINI_MEDIA_DIR}:/srv/fsa-mini-media:ro`
- Test: `server/tests/explainedPublic.test.js`

**Interfaces:**
- Consumes: `miniLessons.getPublic`
- Produces:
  - `GET /api/explained/:slug?preview=<token>` → 200 `PublicMiniLesson` | 404 `{error:'Not found'}`
  - `GET /explained-media/:slug/:file` → the file from `MINI_MEDIA_DIR` (env, default `/srv/fsa-mini-media`), with `Cache-Control: public, max-age=3600`
  - The media route only serves slugs that `getPublic(slug, req.query.preview||null)` would serve. When the API serves a draft via its preview token, it appends `?preview=<token>` to every `audio_url`, `image_url` and `og_image_url` in the response, so `ContentPanel` can load draft media unchanged. Test this.

- [ ] **Step 1:** Write the tests (mirror the `mediaAuth.test.js` setup with a temp `MINI_MEDIA_DIR` and a temp course `MEDIA_DIR` containing `2B3-1-7/slide-001.mp3`):
  - A live slug gives 200 and the expected shape.
  - A pending slug with no token gives 404; with the right token, 200; with an empty token, 404; with another slug's token, 404.
  - `/api/explained/2B3-1-7` gives 404, even if a `lesson_chunks` row exists for it.
  - `/explained-media/<live-slug>/slide-001.mp3` gives 200. `/explained-media/..%2f2B3-1-7/slide-001.mp3`, `/explained-media/<live-slug>/..%2f..%2f2B3-1-7%2fslide-001.mp3` and `/explained-media/2B3-1-7/slide-001.mp3` all give 404.
  - Media for a pending slug gives 404 without `?preview`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Validate `:slug` against `^[a-z0-9]+(-[a-z0-9]+)*$` and `:file` against `^slide-\d{3}\.(mp3|png)$|^og\.png$` before touching disk or the database. Serve with `res.sendFile(file, {root: path.join(MINI_MEDIA_DIR, slug)})`.
- [ ] **Step 4:** Run. Expected: PASS. Also run `tests/mediaAuth.test.js` and `tests/legacyHostBypass.test.js`. Expected: PASS, unchanged.
- [ ] **Step 5:** Commit: `feat(mini-lessons): public read API + scoped media route`.

### Task 3: fsa-agent — internal publish API

**Files:**
- Create: `server/src/routes/miniLessonInternal.js`, mounted at `/api/internal/mini-lessons`
- Test: `server/tests/miniLessonInternal.test.js`

**Interfaces:**
- Consumes: `miniLessons.upsertDraft`, `setStatus`, `list`
- Produces, all requiring header `x-mini-lesson-token === process.env.MINI_LESSON_PUBLISH_TOKEN` (401 otherwise, and 401 when the env var is unset):
  - `PUT /api/internal/mini-lessons/:slug` with body `PublishPayload` → 200 `{slug, status, preview_token, version}` | 400 `{error, details[]}`
  - `POST /api/internal/mini-lessons/:slug/status` with body `{to, hold_reason?, checks_passed?}` → 200 | 409 `{error:'transition not allowed'}`
  - `GET /api/internal/mini-lessons` → `list()`

- [ ] **Step 1:** Write the tests:
  - No header gives 401; a wrong token gives 401; the env var unset gives 401, even with an empty header.
  - Payload validation gives 400 when:
    - `slides` is empty
    - a question step has fewer than 2 options
    - `correct` is out of range
    - `step_data.steps` is empty
    - `paper_code` isn't in `papersForClass`
    - `slug` fails the regex
    - any text field contains `—` (an em dash)
  - `held → live` gives 409.
  - `pending → live` with `checks_passed:true` gives 200.
  - A rebuild of a live slug goes to `pending` with `live_version` unchanged (Review Focus 5).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Map `TransitionError` to 409.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mini-lessons): token-guarded internal publish API`.

### Task 4: fsa-agent — Open Graph tags

**Files:**
- Create: `server/src/services/explainedOg.js`
- Modify: `server/src/index.js`, adding `app.get('/explained/:slug', …)` before the SPA catch-all
- Test: `server/tests/explainedOg.test.js`

**Interfaces:**
- Produces: `renderExplainedHtml(indexHtml: string, lesson: PublicMiniLesson|null, baseUrl: string) → string`. For a lesson, it injects `og:title`, `og:description`, `og:image` (absolute `/explained-media/<slug>/og.png` when `og_image_url` is set, else `https://learn.fullsteamahead.ca/pwa-512.png`), `og:url`, `og:type=article`, `twitter:card=summary_large_image` and `<meta name="robots" content="noindex">`. For `null`, it injects only robots `noindex`. All values are HTML-escaped.
- The route serves `index.html` with status 200 for both cases, so the SPA renders its own not-found state.

- [ ] **Step 1:** Write the tests:
  - The tags are present and escaped, with a title containing `<script>` and `"`.
  - A preview-token request for a pending lesson gets real tags.
  - An unknown slug gets `noindex` and no `og:title`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Read `index.html` once at startup, the same way `CLIENT_V2_BUILD` does.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mini-lessons): server-side Open Graph tags`.

### Task 5: client-v2 — staged question component

**Files:**
- Create: `client-v2/src/components/StagedQuestion.jsx` (+ `StagedQuestion.css`)
- Test: `client-v2/src/components/StagedQuestion.test.jsx`

**Interfaces:**
- Produces: `<StagedQuestion question={{question_text, step_data}} number={1} total={3} onDone={(result: {stepsCorrect:number, steps:number}) => void} />`
- Behaviour:
  - It shows `question_text`, then step 1's `context` and `question` with its options. Text is rendered through `MathContent`.
  - Picking an option locks the step, marks the pick right or wrong, reveals the correct option, and shows the `explanation`.
  - **Next step** advances. After the last step, it shows **Next question** (or **Finish** when `number === total`), which calls `onDone`.
  - Mobile: options are full-width tap targets of at least 44 px at ≤768px.

- [ ] **Step 1:** Write the vitest tests:
  - It renders step 1 only.
  - Clicking a wrong option shows the explanation, marks the correct option, and disables the other options.
  - **Next step** shows step 2.
  - Finishing all 3 steps with one wrong calls `onDone({stepsCorrect:2, steps:3})`.
  - The button reads **Finish** when `number === total`.
- [ ] **Step 2:** Run `cd client-v2 && npx vitest run src/components/StagedQuestion.test.jsx`. Expected: FAIL.
- [ ] **Step 3:** Implement. Use a co-located CSS file with the class prefix `sq-`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mini-lessons): staged question component`.

### Task 6: client-v2 — the `/explained/:slug` page

**Files:**
- Create: `client-v2/src/pages/ExplainedPage.jsx` (+ `ExplainedPage.css`, prefix `ex-`)
- Create: `client-v2/src/components/MiniLessonPitch.jsx`
- Modify: `client-v2/src/App.jsx`, adding a public `<Route path="/explained/:slug" element={<ExplainedPage />} />` with no `ProtectedRoute` and no `AppShell`
- Test: `client-v2/src/pages/ExplainedPage.test.jsx`

**Interfaces:**
- Consumes: `GET /api/explained/:slug?preview=` (forward `preview` from the page URL), `ContentPanel` (same props as in `InlineLessonPlayer`), and `StagedQuestion`
- Produces:
  - Phases: `lesson → questions → pitch`.
  - A header with the FSA mark, the lesson title and the `source_label` ("From 2B3 Chapter 1, Objective 7").
  - **Practice questions →** appears on the last slide.
  - `MiniLessonPitch({classCode, slug})` renders the copy and the enrollment link built per Global Constraints.

  Pitch copy (exact; no em dashes):
  - Heading: "Want the rest of {paperLabel} explained like this?"
  - Body for `second` and `third`: "This is how every objective in the full course is taught: step-by-step slides, narration, practice questions, and an AI tutor when you get stuck."
  - Body for `fourth_a` and `fourth_b`: "The full course gives you unlimited chapter tests and practice exams, with a breakdown of exactly where you're weak."
  - Button: "See the full course"
  - Small print: "Free lesson from Full Steam Ahead. No sign-up needed."

  For `paperLabel`, use `the {paper_code} course` when `paper_code` is a 2nd or 3rd Class paper, and `4th Class Part A` / `Part B` for `4A`/`4B`.
- On 404 it shows "This lesson isn't available." with a link to `https://fullsteamahead.ca`.

- [ ] **Step 1:** Write the tests:
  - With a mocked fetch, it plays the slides with next/back.
  - **Practice questions** appears only on the last slide.
  - Answering all questions shows the pitch.
  - The link is `https://fullsteamahead.ca/enroll?class=second&utm_source=mini-lesson&utm_campaign=2b3-negative-reactance` for a 2B3 lesson.
  - A `fourth_a` lesson's pitch contains no "tutor" (case-insensitive).
  - No rendered text contains `—`.
  - `?preview=abc` is forwarded to the fetch URL.
  - A 404 shows the not-available message.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Reuse the `InlineLessonPlayer` navigation logic (`goNext` sets autoplay). Do not call `track()`.
- [ ] **Step 4:** Run the page tests plus the full client suite (`npx vitest run`). Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mini-lessons): public explained page + pitch`.

### Task 7: fsa-lesson-creator — intake and source location

**Files:**
- Create: `mini_lesson/__init__.py`, `mini_lesson/intake.py`, `mini_lesson/locate.py`, `prompts/mini_intake.md`
- Test: `tests/test_mini_intake.py`, `tests/test_mini_locate.py`

**Interfaces:**
- Produces:
  - `intake.parse_request(post_text: str, feedback: str|None=None) -> Ask`, where `Ask` is a dataclass: `paper_code: str|None, chapter: int|None, objective: int|None, page_ref: str|None, example_ref: str|None, confusion: str, is_math: bool`. One `complete_json` call.
  - `locate.find_objective(ask: Ask, db: Db, forced_lesson_code: str|None=None) -> Located | NeedsChoice`, where:
    - `Located(lesson_code, title)`
    - `NeedsChoice(candidates: list[tuple[lesson_code, title]])`
  - `Db` is a small protocol (`fetch_lesson`, `search_chunks(query, paper_prefix, limit) -> list[(lesson_code, title, rank)]`), so the tests use a fake.
- Rules:
  - When paper, chapter and objective are explicit and the lesson exists, return `Located`.
  - When `forced_lesson_code` is set, return `Located` for it.
  - Otherwise, full-text search (an OR tsquery like the tutor's `_build_or_tsquery`) restricted to the paper prefix when known. Return `Located` only when the top rank is at least 1.5× the second; otherwise `NeedsChoice` with the top 3.

- [ ] **Step 1:** Write the tests:
  - Jeffrey's post text, with a mocked `complete_json` returning `{paper_code:'2B3', chapter:1, objective:7, …}`, gives `Located('2B3-1-7', …)`.
  - A vague post where the fake search returns ranks `[0.4, 0.35, 0.1]` gives `NeedsChoice` with 3 candidates.
  - Ranks `[0.9, 0.3]` give `Located`.
  - `forced_lesson_code` wins over the search.
  - An explicit code that doesn't exist falls back to the search.
- [ ] **Step 2:** Run `venv/bin/pytest tests/test_mini_intake.py tests/test_mini_locate.py`. Expected: FAIL.
- [ ] **Step 3:** Implement. The real `Db` reads production read-only via `localhost:5434` (`POSTGRES_HOST=localhost POSTGRES_PORT=5434`).
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(mini-lessons): intake + confident source location`.

### Task 8: fsa-lesson-creator — grounding, writing, and math verification

**Files:**
- Create: `mini_lesson/ground.py`, `mini_lesson/write.py`, `mini_lesson/verify.py`
- Create: `prompts/mini_slides.md`, `prompts/mini_questions.md`, `prompts/mini_verifier.md`, `prompts/mini_book_error.md`
- Test: `tests/test_mini_verify.py`, `tests/test_mini_ground.py`

**Interfaces:**
- Produces:
  - `ground.load(lesson_code, db) -> Grounding`. `Grounding` is `{source_text: str, course_slides: list[dict], corrections: list[{wrong, right}]}`. The corrections are the exact replacements recorded in `scripts/fix_2b3_slide_text.py` / `scripts/fix_2b1_slide_text.py` that apply to that lesson's source. Extract their replacement tables into importable data rather than duplicating them.
  - `write.slides(ask, grounding) -> list[Slide]`. Each `Slide` has `{slide_index, chunk_type, title, body, narration, latex[], calc: Calc|None}`.
  - `write.questions(ask, grounding, n=3) -> list[Question]`. Each step carries `calc`.
  - `Calc` is `{code: str, outputs: {name: {value: float, shown: str, unit: str}}}`. `code` is Python that prints a JSON dict of named results. `shown` is the exact string that appears in the slide, step or option.
  - `verify.check(ask, grounding, slides, questions) -> Verdict`. `Verdict` is `{ok: bool, hold_reasons: list[str]}`.
- The checks in `verify.check`, all required for `ok`:
  1. **Executable solutions:** every `Calc.code` runs under `python -I` in a temp dir with a 20 s timeout and prints parseable JSON with every named output. A non-zero exit, a timeout or missing JSON is a hold (Review Focus 3).
  2. **Traceable numbers:** every number with a unit in slide `body`/`narration`, step `context`/`options`/`explanation` and `question_text` matches some computed output to its shown precision.
     - Rule: `round(computed, decimals_of(shown)) == float(shown)`, or within 0.5 of the shown last significant digit for integers shown without decimals.
     - Given values taken from the problem statement are exempt when they appear verbatim in `question_text` or the slide's problem text.
  3. **Independent re-solve:** one `complete_json` call per calculation, with `prompts/mini_verifier.md`. It receives only the problem statement and `grounding`, never the generated solution, and returns its own `code`. The code is run the same way, and every output must agree within the shown precision.
  4. **MCQ sanity per step:** `options[correct]` equals the computed value at the shown precision; no other option does; units are present on numeric options; there are at least 2 options.
  5. **Book errors:** one `complete_json` call with `prompts/mini_book_error.md`. It compares the asker's confusion and the source text against `course_slides` and the verifier's solutions, and returns `{book_error: bool, covered_by_corrections: bool, detail: str}`. If `book_error` and not `covered_by_corrections`, that's a hold with reason `possible book error not yet corrected in the course: <detail>`. If covered, `write.slides` must have stated it plainly. Assert that the slide text contains the corrected value and the phrase "the book".
  6. **Copy:** no `—` anywhere.
- Prompts: `mini_slides.md` adapts `slide_generator.md` and keeps the same categories and voice rules. It adds:
  - Focus on exactly `ask.confusion`, in 6–12 slides.
  - Use only `grounding`; ideas not in the source stay out.
  - Corrected slides win over the raw source text.
  - Never reproduce the book's page. The book's own example numbers may be used only to explain the step the asker named.
  - Every calculation slide includes `calc`.

  `mini_questions.md`: 2–3 staged questions, at least one exercising the exact confusion, following the existing question rules.

- [ ] **Step 1:** Write `test_mini_verify.py` with hand-written fixtures (no LLM; mock `complete_json`). The cases:
  - The correct 2B3-style lesson (X = 30 − 110 = −80 Ω; I = 500/100 = 5 A; Q = 25 × 80 = 2000 VAR) gives `ok`.
  - The same lesson with one slide showing `2100 VAR` gives a hold that names the slide.
  - A step whose `options[correct]` is `2000 VAR` and another option is `2000.0 VAR` gives a hold.
  - Calc code that raises, sleeps 25 s, or prints `""` gives a hold (Review Focus 3).
  - Rounding: `256.6 Ω` vs. computed 256.55 passes; `257 Ω` vs. 256.55 passes; `265.6 Ω` is held (Review Focus 4).
  - A verifier mock returning 1900 for Q gives a hold.
  - A book-error mock returning `{book_error:true, covered_by_corrections:false}` gives a hold with the "possible book error" reason.
  - A slide containing `—` gives a hold.
- [ ] **Step 2:** Write `test_mini_ground.py`: `load('2B3-x-y')` against a fake DB returns the corrections that `fix_2b3_slide_text.py` applies to that lesson, and none for a lesson with no fixes.
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Implement, including the extraction of the replacement tables from both `fix_*` scripts so that the scripts and `ground.py` share them. Re-run the `fix_*` scripts' existing behaviour check with `--help` / `--dry-run` to confirm they still import.
- [ ] **Step 5:** Run the whole suite, `venv/bin/pytest`. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(mini-lessons): grounded writing + math verification`.

### Task 9: fsa-lesson-creator — media, publish, playthrough, CLI

**Files:**
- Create: `mini_lesson/media.py`, `mini_lesson/publish.py`, `mini_lesson.py` (CLI)
- Create (in fsa-agent): `server/scripts/mini-lesson-playthrough.js`
- Test: `tests/test_mini_publish.py`, `tests/test_mini_cli.py`

**Interfaces:**
- Produces:
  - `media.render(slug, slides, paper_code) -> list[Slide]`. It reuses stage 6 (code-drawn diagrams, LaTeX, flattened to white) and stage 7 (Azure narration with word timing) on a per-build job dir `jobs/_mini/<slug>/v<N>/`. It copies the files to `$FSA_MINI_MEDIA_DIR/<slug>/slide-NNN.{mp3,png}` and an `og.png` (a code-drawn title card: FSA mark, lesson title, paper), and fills `audio_url=/explained-media/<slug>/slide-NNN.mp3` (and `image_url` likewise). Drive the stages through the same `objective`/`state` arguments `run.py` uses, with `objective_number=1`.
  - `publish.Client(base, token)` with:
    - `.put(slug, payload) -> {status, preview_token, version}`
    - `.status(slug, to, checks_passed=None, hold_reason=None)`
    - `.list()`
  - `mini-lesson-playthrough.js <url>` exits 0 or 1 and prints a JSON report `{ok, failures[]}`. It runs Chromium with a 390×844 viewport and no cookies, and it:
    - checks every slide renders, every `image_url` and `audio_url` returns 200, and the Open Graph tags are present in the raw HTML
    - answers each step wrong on one pass and right on another, confirming the marking and the explanation text
    - checks the pitch link equals the expected URL
- `mini_lesson.py` subcommands:
  - `build --post-file PATH [--objective CODE] [--feedback TEXT] [--slug SLUG] [--hold-for-approval]` exits 0 when live or awaiting approval, 2 when held or a choice is needed, and 1 on error.
  - `approve SLUG` moves `awaiting_approval → live` and refuses anything else.
  - `list`
  - `--dry-run` writes nothing remote.
- `build` flow:
  1. parse
  2. locate. On `NeedsChoice`, notify Russ with the 3 candidates and the exact rerun command hint, then exit 2.
  3. ground
  4. write
  5. verify. On a hold, notify and exit 2. Nothing is published, so a live version stays up (Review Focus 5).
  6. media
  7. `put`
  8. playthrough on `https://learn.fullsteamahead.ca/explained/<slug>?preview=<token>`. On failure, `status held` with the report summary, notify, exit 2.
  9. `status awaiting_approval` (with `--hold-for-approval`) or `status live` with `checks_passed=true`
  10. notify Russ: `Mini lesson ready: <title>\n<link>`. The live link has no token; the awaiting-approval link includes `?preview=`.

  The slug comes from an existing live mini lesson on the same `lesson_code` with matching confusion when `--slug` is given. Otherwise it's `<paper>-<3–5 keyword slug>`, lowercase, de-duplicated with `-2`.

- [ ] **Step 1:** Write `test_mini_publish.py` with `responses`/a mocked `requests`: the header `x-mini-lesson-token` is sent, a 409 raises `TransitionRefused`, and a 400 raises with the details.
- [ ] **Step 2:** Write `test_mini_cli.py` with every stage function mocked:
  - Verify-hold calls notify and never calls `put`.
  - Playthrough failure calls `status held` and exits 2.
  - `--hold-for-approval` ends in `awaiting_approval`.
  - `approve` on a `held` slug exits non-zero.
  - `NeedsChoice` notifies with the candidates and exits 2.
- [ ] **Step 3:** Run. Expected: FAIL.
- [ ] **Step 4:** Implement. Notification goes through `subprocess.run(['bash','/home/debian/fsa-marketing/scripts/remind.sh', text])`, wrapped as `notify(text)` so the tests mock it.
- [ ] **Step 5:** Run the full suite. Expected: PASS. Then do a `--dry-run` build on Jeffrey's post with real LLM calls. Expected: it prints `Located 2B3-1-7` and verify `ok`, and writes nothing remote.
- [ ] **Step 6:** Commit in both repos: `feat(mini-lessons): media, publish, playthrough, CLI`.

### Task 10: Whole-branch review and test-DB rebuild

- [ ] **Step 1:** In fsa-agent, run the full server suite (with the test env) and the client suite. Expected: PASS, with no new failures compared with `master`. Record any pre-existing failures by name.
- [ ] **Step 2:** In fsa-lesson-creator, run the full suite. Expected: PASS.
- [ ] **Step 3:** Review against the spec: the security anti-goals (Task 2 tests), the release rules, and the book-error rules. Fix findings in the owning task's files.

### Task 11: Owner-run production rollout, FSA agent instructions and wiki

**Files:**
- Create: `fsa-agent/server/scripts/apply-035-mini-lessons.sh`. It follows the `apply-028-checkin-once.sh` pattern:
  1. `fsa-backup.sh daily`
  2. apply 035 to `fsa_agent`
  3. verify that the tables exist
  4. `mkdir -p /home/debian/media-mini`
  5. append `FSA_MINI_MEDIA_DIR=/home/debian/media-mini` and a generated `MINI_LESSON_PUBLISH_TOKEN` (`openssl rand -hex 32`) to `fsa-agent/.env` only if they're absent, and write the same token and `MINI_LESSON_API_BASE` to `fsa-lesson-creator/.env` if absent
  6. build the client and api; `docker compose up -d api`
  7. `rebuild-test-db.sh`
  8. curl checks: `/explained/does-not-exist` gives 200 with `noindex`; `/api/explained/2B3-1-7` gives 404
  9. confirm the container can read the dir: `docker compose exec api ls /srv/fsa-mini-media`
- Modify: `fsa-business-agent/instances/fsa/persona.md`, adding a short **Mini lessons** section:
  - When Russ forwards a stumped person's post and asks for a mini lesson, run `mini_lesson.py list` first and offer an existing live link on the same objective and confusion.
  - Otherwise, write the post to a temp file and start `cd /home/debian/fsa-lesson-creator && LESSON_LLM_BACKEND=claude-cli nohup venv/bin/python mini_lesson.py build --post-file <file> > jobs/_mini/<ts>.log 2>&1 &`.
  - Tell Russ it's building and the link will arrive here.
  - "Which one?" answers rerun with `--objective`. Change requests rerun with `--slug <slug> --feedback "<his words>"`.
  - Never publish by hand.
- Modify: `wiki/projects/fsa-agent.md` (routes, tables, security notes), `wiki/projects/fsa-lesson-creator.md` (the mini-lesson CLI and its safeguards), `wiki/log.md`, and `wiki/index.md` if a page is added.

- [ ] **Step 1:** Write the script and the persona and wiki changes. Commit them on the feature branches. Commit the wiki in its own repo.
- [ ] **Step 2:** **Stop. Ask Russ** to approve merging both feature branches and to run `! bash /home/debian/fsa-agent/server/scripts/apply-035-mini-lessons.sh`. Merge only after a yes. Then verify the script's output lines.
- [ ] **Step 3:** After the persona merge, ask Russ to approve `sudo systemctl restart agent@fsa`.

### Task 12: Pilot — Jeffrey's lesson

- [ ] **Step 1:** Write Jeffrey's comment (quoted in the spec) to `jobs/_mini/jeffrey-post.txt`. Run `mini_lesson.py build --post-file jobs/_mini/jeffrey-post.txt --objective 2B3-1-7 --hold-for-approval`. If auto mode blocks the production publish call, give Russ the exact command to run with `!`.
- [ ] **Step 2:** Expected: exit 0, status `awaiting_approval`, and a Telegram message with the preview link. If the lesson was held instead, report the hold reason verbatim and fix the cause, without bypassing any check.
- [ ] **Step 3:** Russ watches it. Changes go through `build --slug <slug> --feedback "<his words>" --hold-for-approval`. On his go, run `mini_lesson.py approve <slug>` and send him the clean link along with the Facebook reply draft (in his voice, no em dashes).
- [ ] **Step 4:** Append to `wiki/log.md`: `## [YYYY-MM-DD] launch | First mini lesson live (2B3 negative reactance)`.
