# Mini Lessons — design

Date: 2026-11-10 · Owner: Russ · Repos: `fsa-agent` (primary), `fsa-lesson-creator`, `fsa-business-agent` (FSA agent instructions)

## Intent

Somebody posts on Facebook, Reddit or LinkedIn that one specific thing in their textbook has them stumped. Russ replies with a link. The link opens a free, standalone **mini lesson** that answers exactly that question, in the same look and voice as an FSA objective lesson. It has step-by-step slides with narration, then 2–3 practice questions, then a soft invitation to try the full course for that paper.

Why: it's the most useful reply Russ can give, and it shows the product working on the reader's own problem. This is help first and marketing second.

Pilot: Jeffrey Hsu's Facebook comment on the 2B3 errata post:

> Chapter 1, p.44 of 2B3, Obj 7, example 5: the calculated reactance X is stated to be −80 ohms but when calculating reactive power, it suddenly became positive 80 ohms with no explanation.

The existing course lesson `2B3-1-7` already teaches this exact example (slides 41–48: 500 V, R 60 Ω, X_L 30 Ω, X_C 110 Ω → X = −80 Ω). Its narration explains the sign: "the negative sign … only shows the type of reactance, capacitive in this case … used here as a magnitude of eighty ohms." The mini lesson zooms in on that step, and the pitch can truthfully say "this is how the full course explains it."

## Goals

1. **One link, no friction.** Completely open: no login, no email, no account. Works well on a phone opened from a Facebook tap.
2. **Same experience as the platform.** Slides and Azure narration play in the existing `ContentPanel` look. The practice questions are staged multi-step MCQs in the platform's style.
3. **Focused.** The lesson covers exactly the asker's confusion, not the whole objective. Rough target: 6–12 slides, 3–6 minutes.
4. **Trustworthy without Russ checking the math.** Russ can't hand-verify second-class calculations and won't try. Correctness has to come from the system (see Safeguards).
5. **Hands-off after the pilot.** Russ forwards a post to the FSA agent on Telegram, or pastes it into a Claude Code session. The mini lesson builds, checks itself, goes live, and the link arrives on Telegram ready to post.
6. **Reusable.** Each mini lesson keeps a permanent link, so the same question asked again later gets the same link.

## Non-goals

- No AI tutor panel in mini lessons.
- No email capture, lead form, nurture enrollment or GHL anything.
- Not listed anywhere: not in the course lobby, not on the marketing site, not in the sitemap. Pages are `noindex` (revisit later if they turn out to be good SEO).
- No progress tracking or student accounts.
- No new admin UI. Status changes happen through the CLI/script.
- Not a replacement for the course lessons. Mini lessons don't feed the tutor's library search.

## Anti-goals (failure even if it "works")

- **Wrong math goes out under Russ's name.** That is the single worst outcome. Any doubt means hold, never publish.
- **The public endpoint leaks paid content.** `fsachat.*` was an open door to the entire paid library until 2026-08-16, and paid `/media` was publicly scrapeable until the same day. The mini-lesson endpoints must be structurally unable to serve course lessons, course questions or course media.
- **A hard sell.** The pitch is one calm card at the end, in Russ's voice, with no countdowns or discount language. It contains no em dashes, because anything Russ sends as himself must not carry the AI tell.
- **Reproducing the textbook.** Content is original wording grounded in the textbook (the same rule as course slides). It must not copy the book's figures or reproduce its worked example verbatim. Naming the page and example number is fine and expected.
- **Guessing the source.** If the system can't confidently tell which objective the post is about, it stops and asks Russ. It never builds from a guess.

## Student experience

1. Russ replies on social with `https://learn.fullsteamahead.ca/explained/<slug>`, e.g. `/explained/2b3-negative-reactance`.
2. The link preview on Facebook, LinkedIn and Reddit shows a real title, a one-line description and an image. That needs server-side Open Graph tags for `/explained/*`, because client-v2 is an SPA and crawlers don't run JS.
3. The page opens directly into the lesson. A small header shows the FSA brand, the lesson title and a one-line "From 2B3 Chapter 1, Objective 7" context line. There's no app shell or sidebar.
4. The slides play like the platform: `ContentPanel` with narration, word timing, next/back and autoplay on next. They reuse the `InlineLessonPlayer` behaviour.
5. After the last slide, the practice questions appear one at a time. Each is staged: the student picks an answer for step 1, sees right/wrong plus the explanation, then moves to step 2, and so on. This needs a new staged-question component. Today only single-answer `QuestionCard`s render anywhere in client-v2, and the 4 staged questions in `2B3-1-7` are not shown by any screen.
6. A closing card carries the soft pitch, e.g. "This is how every objective in the full 2B3 course is taught: slides, narration, practice questions and an AI tutor when you're stuck." One button links to the website's 2nd Class enrollment page with `utm_source=mini-lesson&utm_campaign=<slug>`. **No price is stated on the card**, because prices live only in `fsa-website/pricing.js` and a second copy would drift. The button target and copy are generated per paper's certification level. For 4th Class there's **no AI tutor**, so the 4th-Class copy must not mention one.

## Content build

A new entry point in `fsa-lesson-creator` (e.g. `mini_lesson.py`) takes the pasted post text and runs end to end, unattended:

1. **Understand the ask.** Extract paper, chapter, objective, page or example reference, and the specific confusion in one sentence.
2. **Locate the source.** If the paper, chapter and objective are explicit, use them. Otherwise run a full-text search over `lesson_chunks` (the same approach as the tutor's `search_library`) and pick the objective. **Confidence gate:** if there's no single clear match, hold and message Russ with the top candidates and the question "which one?". Don't build.
3. **Ground.** Pull the objective's stored textbook text (`lesson_chunks.source_content`), plus the existing course slides for that objective for consistency of explanation. Every claim in the mini lesson must be supported by the source text, the same rule and prompt guidance as course slide generation. Ideas the textbook doesn't teach stay out, even if true. For example, if the book never discusses negative Q, the lesson doesn't introduce it.
4. **Write slides.** Reuse the stage 5 slide format, prompts and voice rules, focused on the one confusion. Use our own numbers for any new worked example. Revisiting the book's own example numbers to explain the specific step the asker named is allowed, because that is the question; reproducing the book's page is not.
5. **Diagrams and images.** Reuse stage 6 (code-drawn diagrams for circuits and phasors, LaTeX for formulas, flattened to white). Not every slide needs one.
6. **Narration.** Reuse stage 7 (Azure TTS, same voice as the course, word timing).
7. **Practice questions.** Write 2–3 staged MCQs in the existing `step_data` shape (`steps[] { type, context, question, options[], correct, explanation }`). They follow the existing question rules: options never empty, self-contained, never naming a table or figure. At least one must exercise the exact confusion, e.g. a question where X comes out negative and the student must carry the magnitude into Q.
8. **Verify** (see Safeguards).
9. **Publish** (see Publish path).
10. **Notify** Russ on Telegram with the link (or the hold reason).

Text generation uses the `claude-cli` backend on the Max subscription, the same as the 2B3 rebuild (`LESSON_LLM_BACKEND=claude-cli`).

## Safeguards

### Math (all lessons with calculations)

- **Numbers are computed, never written.** Every calculation in a slide or question step comes with a small executable worked solution (Python). The pipeline runs it, and the slide or step text is filled from or checked against its output. Free-typed numbers that don't trace to computed values fail the build.
- **Independent re-solve.** A separate verifier pass gets only the problem statement and the textbook source, *not* the generated solution. It solves every calculation (each slide example and each step of each staged question) as its own executable code. The two answers must agree within stated rounding. Disagreement means hold.
- **MCQ sanity.** The `correct` option equals the computed value; no distractor equals or rounds to the correct value; exactly one option is correct per step; units are present and right.
- **Convention check.** Sign conventions and formula forms match the source text, e.g. X = X_L − X_C, and Q = I²X using the magnitude as the book does.

### Textbook errors (decided by Russ)

The safeguards anchor to the raw book text (`lesson_chunks.source_content`), so a real error in the book would pass every check. Rules:

- **Already corrected in our course:** where the course slides fix a book error (the 2B1/2B3 rebuild fixes, e.g. `scripts/fix_2b3_slide_text.py`, `scripts/fix_2b1_slide_text.py`), the corrected slides beat the raw book text. The grounding, the convention check and the verifier all get the correction as an input.
- **The lesson says so plainly:** when the asker's confusion comes from a book error, the lesson names it ("the book has a mistake here") and shows the correct version.
- **Not yet corrected in our course:** a possible book error the course slides don't already fix is a **hold reason**. The lesson is never auto-published, and Russ gets a message saying what looks wrong. The pipeline must actively check for this, by comparing the source text against the course slides and the verifier's own solution, not just ground against it.

### Non-math lessons

No extra layer. These rely on the same grounding the course slides use, which Russ trusts from months of tuning and student feedback.

### Playthrough (every lesson)

After publishing in a **pending** state (reachable only with a preview token), a Playwright run against the public `learn.` URL:

- loads the page on a phone-sized viewport with no cookies
- confirms every slide renders with its image and its narration audio returns 200
- answers every step of every practice question correctly and incorrectly, and confirms the marking and explanations
- confirms the pitch card and its link
- confirms the Open Graph tags are present

Any failure means the lesson stays pending (held) and Russ gets the reason.

### Release rule

- **Pilot (Jeffrey's lesson):** built through the same pipeline but held for Russ's approval. He gets the link, watches it, asks for changes or says go. A `--hold-for-approval` flag does this. After approval, Russ posts the link himself.
- **Every later lesson:** if all checks pass, it flips live automatically and the link goes to Russ on Telegram. If any check fails, it's held, and the message says what failed. Russ never receives a broken or unverified link.

### Holds, changes and retries (Claude's call)

- **Change request** (pilot, or any later lesson Russ wants different): rerun the whole pipeline with Russ's feedback added to the input. Every safeguard runs again; a change never skips verification. The lesson keeps its slug.
- **"Which one?" gate:** Russ's answer (the objective) is passed back as an explicit input and the build reruns from the start.
- **No manual override of a failed check.** Russ will not hand-check math, so a lesson held for a failed math or playthrough check can't be flipped live by hand. It can be retried by a rerun, optionally with feedback. Statuses: `pending → live`, `pending → held`, `held → pending` (rerun) only. The internal endpoint refuses `held → live`.
- **Pilot approval:** the only manual `pending → live` transition is the pilot's `--hold-for-approval` release, and it is allowed only when every check has passed.

## Publish path and security

- **Separate storage.** New tables, e.g. `mini_lessons` (slug, title, paper, source `lesson_code`, request text, status `pending|live|held`, preview token, timestamps), `mini_lesson_slides` and `mini_lesson_questions`. They're separate from `lessons`, `lesson_chunks` and `questions`, so the public endpoint has no query path to course content and the tutor's library search never sees mini lessons.
- **Separate media.** The files go in their own directory (e.g. `$FSA_MEDIA_DIR/mini/<slug>/`, or a sibling directory), served by a public static route that is scoped to that directory only. Course `/media` stays exactly as gated as it is.
- **Public read endpoint.** `GET /api/explained/:slug` returns only rows with status `live`, or `pending` with a valid preview token. It is read-only, rate-limited and has no auth.
- **Narrow write path.** The build script publishes by calling an internal fsa-agent endpoint (e.g. `POST /api/internal/mini-lessons`) with a dedicated token. The token is a new env var in `fsa-agent/.env` and the lesson-creator `.env`, and it can only create or update mini-lesson rows and flip their status. No agent session needs production DB access to publish. That matters because Claude Code auto mode refuses agent-run production writes, which is why course cutovers are owner-run scripts today.
- **Tests** follow the fsa-agent DB safety rules (`fsa_agent_test`, explicit env, never production). Include a test proving that `/api/explained/*` cannot return a course `lesson_code`'s content, and that the public media route cannot reach a course media folder (path traversal included).

## Triggers

- **FSA agent (`agent@fsa`, `fsa-business-agent`):** Russ forwards or pastes a post on Telegram ("make a mini lesson for this"). Russ called this "Olivia" in conversation; since 2026-11-08 Olivia is the corp supervisor and FSA's own Telegram agent is the one that talks to him directly, so the FSA agent is the primary trigger. A corp task run from Olivia uses the same script. The FSA agent runs the build script in the background, then the result message (link or hold reason) goes to Russ on Telegram. Before building, it checks for an existing live mini lesson on the same paper/objective and confusion, and offers that link instead. The FSA agent's persona/instructions in `fsa-business-agent/instances/fsa/persona.md` get a short section describing this.
- **Claude Code session:** the same script, run by hand.
- A build can take a while (narration, diagrams), so it must not block the FSA agent's conversation.

## Decided by Russ

- Completely open, no email.
- Soft pitch for the full course at the end.
- Triggered by forwarding the post to the FSA agent (or Olivia, via a task run) or a Claude Code session.
- Pilot is held for his approval. After that, auto-publish when checks pass, with the link sent to him on Telegram.
- Extra automated math verification on top of the normal process. Non-math lessons rely on the existing course-slide grounding, with no extra layer.
- He will not hand-check math.
- Book errors: corrected course slides beat raw book text; the lesson names the error; an error our slides haven't already fixed is held, never auto-published.

## My calls (Claude), open to correction

- URL shape `/explained/<slug>`, `noindex`, not listed anywhere.
- No price on the pitch card; links to the website enrollment page with UTM tags.
- Separate tables and media directory rather than reusing `lesson_chunks`.
- Token-scoped internal publish endpoint rather than direct DB writes.
- Pending state plus preview token, so the playthrough runs on the real URL before go-live.
- Server-side Open Graph tags for link previews.
- Confidence gate on locating the source objective.
- Same Azure narration voice as the course.

## Left to the builder

- Exact table columns and migration, and whether mini lessons get a DB-backed `step_data` validator.
- Staged-question component design, within the existing lesson-player styling (`index.css` classes, co-located CSS for the new page, mobile at ≤768px).
- How Open Graph tags are injected (Express template on `/explained/*` vs. a prerender).
- The OG image (code-drawn title card, a slide image, or a fixed branded card).
- Slug generation.
- How the verifier is prompted and how rounding tolerance is set per quantity.
- Whether the build reuses `jobs/` state and `state.db` resumability or keeps a simpler per-build directory.
- How the FSA agent runs the long build in the background and reports back (existing reminder and notify patterns: `notifyOwner` via fsa-common).

## Done looks like

- Jeffrey's mini lesson is live (approved by Russ), reachable at its link on a phone, with no login.
- The build-to-link flow works end to end from a pasted post, from both the FSA agent and a session, with every safeguard running.
- A deliberately wrong number injected in a test build is caught and held.
- Wiki updated: `wiki/projects/fsa-agent.md`, `wiki/projects/fsa-lesson-creator.md`, `wiki/log.md`.
