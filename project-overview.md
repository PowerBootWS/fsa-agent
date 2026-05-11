# FSA Agent — Project Overview

## Purpose

fsa-agent is the AI tutoring engine that powers the interactive learning experience inside every Full Steam Ahead (FSA) Power Engineering course. It runs as an iframe-embedded web application at `fsachat.fullsteamahead.ca`, loaded directly within GoHighLevel (GHL) lesson pages after each instructional video.

Its core job is to turn passive video watching into an active learning session — presenting the lesson transcript, asking practice questions, running chapter quizzes and full practice exams, and coaching the student through worked problems using a conversational AI tutor. A fourth standalone mode, the **Paper Planner Diagnostic**, functions as a free lead magnet that prospective subscribers use to benchmark their readiness across all six Second Class papers before purchasing.

---

## How It Is Invoked

The parent domain (GHL) authenticates the student, then loads the iframe with two query parameters:

```
https://fsachat.fullsteamahead.ca/?user={{contact.email}}&lesson={lessonId}
```

- `user` — the student's email address, resolved at render time by GHL's `{{contact.email}}` merge field.
- `lesson` — the lesson identifier, which determines which mode the application enters.

A special diagnostic mode bypasses both parameters:

```
https://fsachat.fullsteamahead.ca/?mode=diagnostic
```

All requests are validated by the Express API before any lesson content or agent session is initialized. The Python AI service is never exposed to the internet — all traffic flows through the Express backend.

---

## Operation Modes

The application detects its operating mode from the shape of the `lesson` parameter at startup.

| Lesson ID Format | Mode | Example |
|---|---|---|
| `{COURSE}-{CHAPTER}-{OBJECTIVE}` | Lesson tutoring | `2B1-3-2` |
| `{COURSE}-{CHAPTER}` | Chapter quiz | `2B1-3` |
| `{COURSE}` | Practice exam | `2B1` |
| `?mode=diagnostic` | Paper Planner Diagnostic | — |

This means the same application, served from the same URL, renders four functionally distinct experiences based solely on the parameters GHL injects at load time.

---

## Lesson Tutoring Mode

When a student finishes watching a lesson video in GHL, the tutor iframe beneath it opens in **lesson mode**. The interface has two tabs:

### Tab 1 — Transcript

A clean, scroll-friendly view of the full lesson narration, broken into slides. Each slide has a title and its narration script. Students use this to review key content between questions or re-read anything the tutor references.

### Tab 2 — Interactive Lesson

A split-panel interface:

**Top — Context Panel**
Displays dynamic content managed by the Display Agent: a lesson summary with key points on load, practice questions when the student enters practice mode, review snippets when reviewing concepts, or hints. The panel can be collapsed. A layout toggle switches between stacked (default) and side-by-side arrangement.

**Bottom — AI Chat**
The primary interaction surface. The Tutor Agent greets the student, then guides them through a choice of activities: practice questions, concept review, or open discussion. The student types answers, asks questions, or responds to prompts from the tutor. Responses animate with a typewriter effect. Full chat history can be shown or hidden. Math expressions render inline using KaTeX.

### Lesson Activities

- **Practice questions** — multiple-choice questions drawn from the question bank, matched to the student's current complexity level. Multi-step calculation problems walk the student through formula selection, substitution, and final answer as separate steps.
- **Concept review** — the tutor surfaces key points from the lesson one at a time, with follow-up discussion.
- **Free discussion** — open-ended questions about the lesson content.

Up to five questions are presented per session. The tutor provides real-time feedback after each answer — confirming correct reasoning, correcting misconceptions, and referencing specific lesson content when guiding a student who chose the wrong option.

---

## Chapter Quiz Mode

Accessed by a lesson ID in the format `{COURSE}-{CHAPTER}` (e.g., `2B1-3`). The tab interface is replaced by a full-screen split layout.

Eight questions are drawn from the chapter quiz question bank for that chapter. Questions are presented one at a time via clickable option cards on the left panel. After each answer, the tutor provides immediate feedback on the right — confirming correct answers with an explanation, or identifying the correct answer and explaining the reasoning on wrong ones. A progress bar tracks completion.

At the end of all eight questions, the tutor delivers a chapter-level summary: overall score, strongest topics, and specific areas to revisit before the practice exam. Missed topics collected during the session inform this debrief.

---

## Practice Exam Mode

Accessed by a lesson ID in the format `{COURSE}` (e.g., `2B1`). This is the full fifty-question practice exam for a paper.

Questions are loaded with adaptive chapter weighting — chapters where the student has historically struggled appear more frequently. Questions are presented silently, one at a time, with no per-question feedback. The student works through the exam at their own pace with only a progress bar and question counter visible. The chat panel is hidden during the answering phase.

When all fifty questions are answered, the Orchestrator aggregates results by chapter and passes them to the Tutor Agent, which generates a warm, personalized debrief:

- Overall score with percentage
- Chapter-by-chapter breakdown (Strong / Developing / Needs Review)
- Named callouts for the strongest and weakest chapters
- Specific recommendation to revisit lesson content in weak areas
- A note that the student's next exam attempt will weight toward their weak chapters

After the debrief is delivered, the chat panel re-opens so the student can ask follow-up questions.

---

## Multi-Agent System

All AI logic runs in a Python Flask service that is proxied through the Express API. Four agents coordinate every student interaction.

| Agent | Role |
|---|---|
| **Orchestrator** | Central state machine. Routes every message, manages session mode, tracks progress, triggers other agents, persists to database. |
| **Tutor Agent** | Generates all conversational output. Adapts tone and content to the current activity, complexity level, and lesson context provided by the Orchestrator. |
| **Researcher** | Queries PostgreSQL for lesson content, practice questions, user progress, and chapter weights. Performs full-text search across lesson chunks to surface relevant content for the current conversation. |
| **Display Agent** | Generates structured payloads for the context panel — summaries, key point lists, question cards. Responds to Orchestrator directives about what to show. |

### Message Flow

Every student message passes through the same pipeline:

1. Express API receives the message and proxies it to the Python service.
2. **Orchestrator** loads or resumes the in-memory session state for this `user:lesson` pair.
3. **Researcher** fetches lesson context and current user progress from PostgreSQL.
4. Orchestrator classifies the student's intent using a lightweight LLM call (with keyword fallback) and advances the activity state machine.
5. **Researcher** performs a focused chunk retrieval based on the current activity and conversation context.
6. **Tutor Agent** generates a conversational response using the full context: lesson content, chat history, current question, complexity level, and Orchestrator instructions.
7. **Display Agent** determines whether the context panel needs updating.
8. Orchestrator persists progress to the database at defined intervals and on question completions.
9. The response is returned to the Express API and forwarded to the React frontend.

### Intent Classification

In lesson mode, the Orchestrator classifies each student message into one of seven intents: `select_practice`, `select_review`, `select_discussion`, `provide_answer`, `continue`, `stop`, or `other`. A fast LLM call via OpenRouter handles ambiguous messages; simple keyword matching handles clear cases (single-letter answers, "stop", "next", etc.).

---

## Progress Tracking and Adaptive Difficulty

The Orchestrator maintains a live session state for each `user:lesson` pair and persists it to PostgreSQL at regular intervals and after each answered question.

**Scoring (0–100 scale)**
- Starts at 100 per session
- Deducted for incorrect answers and hints used
- Bonus for first-try correct answers

**Struggle Tracking**
Topics where a student consistently needs multiple attempts are recorded in a `struggles` array. These surface in the practice exam weighting algorithm and in the exam debrief.

**Complexity Level (1–5)**
The difficulty of practice questions presented adapts continuously:
- Accuracy above 80% with low attempt counts → complexity increases
- Accuracy below 50% or high average attempts → complexity decreases

**Question Response History**
Every answered question (lesson practice, quiz, exam, diagnostic) is recorded in the `question_responses` table with the session type, correctness, and chapter context. This feeds the adaptive exam weighting on subsequent attempts.

---

## Paper Planner Diagnostic

The diagnostic is a standalone lead magnet accessible without a GHL account or subscription. Prospective students visit the diagnostic URL directly — no lesson ID or email is required to start.

### Flow

1. **Intro** — Student selects a 30-question (5 per paper, ~15 minutes) or 60-question (10 per paper, ~30 minutes) diagnostic.
2. **Signup** — First name and email are collected to save results and enroll the user.
3. **Quiz** — Questions from all six Second Class papers are presented one at a time with immediate right/wrong feedback after each answer. A progress bar shows overall position.
4. **Results** — A personalized report shows:
   - Overall score
   - Per-paper scores with a readiness rating (Strong / Building / Needs Foundation)
   - A ranked **Recommended Attack Order** — papers where the student already has a foundation are tackled first to build confidence; papers needing foundational work come later
5. **Call to Action** — A prompt to subscribe to Full Steam Ahead with a direct enrollment link.

Score integrity is enforced server-side: the Express API re-evaluates all submitted answers against the database before computing results, preventing client-side manipulation.

---

## Data Model

All persistent data lives in PostgreSQL.

| Table | Purpose |
|---|---|
| `users` | Student accounts — email and first name |
| `lessons` | Lesson metadata, narration text, summary, and key points |
| `lesson_chunks` | One row per lesson slide — title, body, narration, and LaTeX source. Full-text indexed for vector-style chunk retrieval |
| `questions` | Practice questions for lessons, chapters, and exams. Supports multi-step staged problems via `step_data` JSONB |
| `user_progress` | Per-student, per-lesson score, struggles, attempts, complexity level, and outcome |
| `chat_history` | Full message history per student per lesson |
| `question_responses` | Individual answer records across all session types (lesson, quiz, exam, diagnostic) — used for adaptive weighting |

Questions carry a `question_type` of either `objective_practice` (used in lesson tutoring sessions) or `chapter_quiz` (used in chapter quizzes and practice exams). A `standalone` flag marks questions that are self-contained enough to appear in the diagnostic without lesson context.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React, KaTeX (math rendering), ReactMarkdown |
| Backend API | Express.js (Node.js) |
| AI Service | Python, Flask |
| LLM | OpenRouter API (configurable model, default: DeepSeek) |
| Database | PostgreSQL |
| Deployment | Docker Compose |

---

## Security Model

- The application only loads inside an iframe on the designated parent domain. CORS headers and Content Security Policy headers reject all other origins.
- The Express API validates the `user` and `lesson` parameters on every request before establishing a session.
- PostgreSQL is accessed exclusively through the Express backend — never directly from the browser or exposed to the internet.
- The Python AI service is internal-only, bound to the Docker network, and proxied through Express.
- The diagnostic lead magnet re-scores all answers server-side regardless of what the client sends.
