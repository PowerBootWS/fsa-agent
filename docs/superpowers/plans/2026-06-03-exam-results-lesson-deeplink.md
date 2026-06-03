# Exam Results → Lesson Deep-Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Review this Lesson →" button to every missed-objective card in the exam results panel, opening the `client-v2` lesson player in a new tab at the exact objective.

**Architecture:** Thread a `user` prop down from `PracticeExamRouter` → `QuizExamDisplaySection` → `ResultsPanel` → `TeachingNotes`. In `TeachingNotes`, render a button per card that calls `window.open('/v2/?lesson={lesson_code}&user={email}', '_blank')`. Add matching CSS. No server changes.

**Tech Stack:** React (Vite), CSS, Docker (fsa-agent api service)

---

## File Map

| File | Change |
|------|--------|
| `client/src/index.css` | Add `.teaching-card-lesson-btn` and `.teaching-card-actions` CSS |
| `client/src/TeachingNotes.jsx` | Add `user` prop; render lesson-review button; wrap buttons in `.teaching-card-actions` |
| `client/src/App.jsx` | Add `user` to `QuizExamDisplaySection` signature + call site; add `user` to `ResultsPanel` signature + both call sites; pass `user` to `TeachingNotes` |

---

### Task 1: Add CSS for lesson-review button

**Files:**
- Modify: `client/src/index.css` (after line 1391)

- [ ] **Step 1: Add CSS after the existing `.teaching-card-quiz-btn:hover` rule**

Open `client/src/index.css`. Find the line:
```css
.teaching-card-quiz-btn:hover { background: #eef2ff; }
```
Insert immediately after it:
```css

.teaching-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.25rem;
}
.teaching-card-lesson-btn {
  font-size: 0.85rem;
  font-weight: 600;
  color: #0f766e;
  background: none;
  border: 1px solid #99f6e4;
  border-radius: 6px;
  padding: 0.4rem 0.75rem;
  cursor: pointer;
  transition: background 0.15s;
}
.teaching-card-lesson-btn:hover { background: #f0fdfa; }
.teaching-card-lesson-btn:disabled,
.teaching-card-quiz-btn:disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 2: Commit**

```bash
git add client/src/index.css
git commit -m "style: add teaching-card-lesson-btn CSS"
```

---

### Task 2: Update TeachingNotes with user prop and lesson-review button

**Files:**
- Modify: `client/src/TeachingNotes.jsx`

Context: The file currently has no wrapper div around the quiz button — just the `{showQuizBtn && (...)}` block rendered directly after the `<p>` tip. We'll wrap both buttons in a `.teaching-card-actions` div.

- [ ] **Step 1: Replace the full TeachingNotes component**

Replace the entire contents of `client/src/TeachingNotes.jsx` from line 14 to line 55 (the `export function TeachingNotes` block only — leave `NextAttemptPreview` intact):

Old signature:
```jsx
export function TeachingNotes({ objectiveBreakdowns, chapterStats, onSelectChapter, leadMagnetMode }) {
```

New file content for the `TeachingNotes` export (lines 14–55 replaced):
```jsx
export function TeachingNotes({ objectiveBreakdowns, chapterStats, onSelectChapter, leadMagnetMode, user }) {
  if (!objectiveBreakdowns || objectiveBreakdowns.length === 0) return null;

  const chapterPctMap = {};
  (chapterStats || []).forEach(c => { chapterPctMap[c.chapter] = c.pct; });

  return (
    <div className="teaching-notes">
      <h2 className="teaching-notes-heading">Where to focus</h2>
      {objectiveBreakdowns.map((obj, i) => {
        const chapterPct = chapterPctMap[obj.chapter_id] ?? 100;
        const showQuizBtn = chapterPct < 50;
        return (
          <div key={i} className="teaching-card">
            <div className="teaching-card-header">
              <span className="teaching-card-location">
                Chapter {obj.chapter_num} · Objective {obj.objective_num}
              </span>
              {obj.topic && (
                <span className="teaching-card-topic">{obj.topic}</span>
              )}
            </div>
            <p className="teaching-card-tip"><MathContent text={obj.teaching_tip} /></p>
            <div className="teaching-card-actions">
              {obj.lesson_code && (
                leadMagnetMode
                  ? <button disabled className="teaching-card-lesson-btn teaching-card-lesson-btn--locked">🔒 Lesson Review — Unlock with Full Access</button>
                  : (
                    <button
                      className="teaching-card-lesson-btn"
                      onClick={() => window.open(`/v2/?lesson=${obj.lesson_code}&user=${encodeURIComponent(user || '')}`, '_blank')}
                    >
                      📖 Review this Lesson →
                    </button>
                  )
              )}
              {showQuizBtn && (
                leadMagnetMode
                  ? <button disabled className="teaching-card-quiz-btn teaching-card-quiz-btn--locked">🔒 Chapter Quizzes — Unlock with Full Access</button>
                  : (onSelectChapter && (
                      <button
                        className="teaching-card-quiz-btn"
                        onClick={() => onSelectChapter(obj.chapter_id)}
                      >
                        📝 Try the Chapter Quiz instead →
                      </button>
                    ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/TeachingNotes.jsx
git commit -m "feat: add lesson-review button to TeachingNotes"
```

---

### Task 3: Thread user prop through App.jsx

**Files:**
- Modify: `client/src/App.jsx` (5 targeted edits)

**Edit 1 — `QuizExamDisplaySection` function signature (line ~871)**

Old:
```jsx
function QuizExamDisplaySection({ displayContent, onAnswer, isExam, mode, onSelectChapter, leadMagnetMode }) {
```
New:
```jsx
function QuizExamDisplaySection({ displayContent, onAnswer, isExam, mode, onSelectChapter, leadMagnetMode, user }) {
```

**Edit 2 — `QuizExamDisplaySection` call site inside `QuizExamView` (line ~515)**

Old:
```jsx
          <QuizExamDisplaySection
            displayContent={displayContent}
            onAnswer={sendAnswer}
            mode={mode}
            isExam={isExam}
            onSelectChapter={onSelectChapter}
            leadMagnetMode={leadMagnetMode}
          />
```
New:
```jsx
          <QuizExamDisplaySection
            displayContent={displayContent}
            onAnswer={sendAnswer}
            mode={mode}
            isExam={isExam}
            onSelectChapter={onSelectChapter}
            leadMagnetMode={leadMagnetMode}
            user={user}
          />
```

**Edit 3 — `ResultsPanel` call inside `QuizExamDisplaySection` (line ~885)**

Old:
```jsx
      <ResultsPanel
        displayContent={displayContent}
        isExam={isExam}
        onRetry={isExam ? () => onAnswer('yes') : null}
        onSelectChapter={onSelectChapter}
        leadMagnetMode={leadMagnetMode}
      />
```
New:
```jsx
      <ResultsPanel
        displayContent={displayContent}
        isExam={isExam}
        onRetry={isExam ? () => onAnswer('yes') : null}
        onSelectChapter={onSelectChapter}
        leadMagnetMode={leadMagnetMode}
        user={user}
      />
```

**Edit 4 — `ResultsPanel` call inside `PracticeExamRouter` phase=results (line ~335)**

Old:
```jsx
              <ResultsPanel
                displayContent={reviewDebrief.display_update}
                isExam={true}
                onRetry={null}
                onSelectChapter={handleSelectChapter}
              />
```
New:
```jsx
              <ResultsPanel
                displayContent={reviewDebrief.display_update}
                isExam={true}
                onRetry={null}
                onSelectChapter={handleSelectChapter}
                user={user}
              />
```

**Edit 5 — `ResultsPanel` function signature (line ~941) and its `TeachingNotes` call (line ~979)**

Old signature:
```jsx
function ResultsPanel({ displayContent, isExam, onRetry, onSelectChapter, leadMagnetMode }) {
```
New signature:
```jsx
function ResultsPanel({ displayContent, isExam, onRetry, onSelectChapter, leadMagnetMode, user }) {
```

Old `TeachingNotes` call (inside `ResultsPanel`, line ~979):
```jsx
          <TeachingNotes
            objectiveBreakdowns={objective_breakdowns}
            chapterStats={chapter_stats}
            onSelectChapter={onSelectChapter}
            leadMagnetMode={leadMagnetMode}
          />
```
New:
```jsx
          <TeachingNotes
            objectiveBreakdowns={objective_breakdowns}
            chapterStats={chapter_stats}
            onSelectChapter={onSelectChapter}
            leadMagnetMode={leadMagnetMode}
            user={user}
          />
```

- [ ] **Step 1: Apply Edit 1** (QuizExamDisplaySection signature)
- [ ] **Step 2: Apply Edit 2** (QuizExamDisplaySection call site — add `user={user}`)
- [ ] **Step 3: Apply Edit 3** (ResultsPanel call inside QuizExamDisplaySection — add `user={user}`)
- [ ] **Step 4: Apply Edit 4** (ResultsPanel call inside PracticeExamRouter — add `user={user}`)
- [ ] **Step 5: Apply Edit 5a** (ResultsPanel function signature — add `user`)
- [ ] **Step 6: Apply Edit 5b** (TeachingNotes call inside ResultsPanel — add `user={user}`)
- [ ] **Step 7: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat: thread user prop to ResultsPanel and TeachingNotes"
```

---

### Task 4: Build, deploy, and verify

**Files:** none (build + deploy steps)

- [ ] **Step 1: Build `client/`**

Run from `/home/debian/projects/fsa/fsa-agent/`:
```bash
cd client && npm run build
```
Expected: build completes with no errors. Output in `client/dist/`.

- [ ] **Step 2: Rebuild and redeploy the API container**

Run from `/home/debian/projects/fsa/`:
```bash
docker compose --env-file /home/debian/projects/fsa/.env -f fsa-agent/docker-compose.yml build api && \
docker compose --env-file /home/debian/projects/fsa/.env -f fsa-agent/docker-compose.yml up -d api
```
Expected: build succeeds, container restarts.

- [ ] **Step 3: Verify the lesson-review button appears**

Open in browser (replace with a real learner email):
```
https://fsachat.fullsteamahead.ca/?lesson=2A1&user=YOUR_EMAIL
```
Complete a short practice exam session. On the results screen, confirm:
- Each missed-objective card in "Where to focus" shows a `📖 Review this Lesson →` button
- Clicking it opens a new tab at `/v2/?lesson=2A1-X-Y&user=YOUR_EMAIL` showing the correct objective
- Cards where the chapter score is below 50% show both the lesson and chapter-quiz buttons side by side

- [ ] **Step 4: Commit and update wiki log**

```bash
git -C /home/debian/projects/fsa/fsa-agent add -A
git -C /home/debian/projects/fsa/fsa-agent commit -m "feat: lesson deep-link from exam results — TeachingNotes lesson-review button"
```

Append to `wiki/log.md`:
```
## [2026-06-03] feat | fsa-agent client: exam results → lesson deep-link — "Review this Lesson →" button on each missed-objective card in TeachingNotes, opens client-v2 lesson player in new tab
```
