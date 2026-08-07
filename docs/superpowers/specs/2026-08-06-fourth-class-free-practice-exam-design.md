# 4th Class Free Practice Exam — Lead Magnet Extension

**Date:** 2026-08-06
**Status:** Approved, ready for implementation plan
**Scope:** Cross-project — `fsa-agent` (backend + frontend), `fsa-website` (landing page), social announcement (manual draft + auto-scheduled)

## Problem

The Free Practice Exam lead magnet (built 2026-07-27, merged to `fsa-agent` master) currently only offers 2nd and 3rd class. 4th class content (course_ids `4A`/`4B`) is fully authored in the DB and already wired into the authenticated platform (`papersForClass.js` has `fourth_a`/`fourth_b` entries; AI service orchestrator already handles `FOURTH_CLASS_COURSES` with reduced-AI debrief behavior) — but the unauthenticated free-exam funnel (`practiceExam.js`, `FreePracticeExamPage.jsx`, `fsa-website/free-practice-exam.html`) never got extended to it.

Separately, auditing the current gate (`practice_exam_attempts`, `UNIQUE(email, paper_code)`) revealed it only blocks *retaking the same paper* — nothing today stops a lead from free-attempting multiple different papers (e.g. 2A1 then 3A1). This design closes that gap as part of the 4th-class rollout, since 4th class makes the gap concrete (a lead could otherwise "sample" both 4A and 4B for free, undermining the two-separate-products model).

## Structural note: 4th class is not like 2nd/3rd

- 2nd class (`class_code='second'`): one subscription, 6 papers (2A1–2B3) — lead picks a class, then picks *one paper* from a grid.
- 3rd class (`class_code='third'`): one subscription, 4 papers (3A1–3B2) — same picker pattern.
- 4th class: **two independently-purchasable subscriptions**, `fourth_a` (paper `4A`) and `fourth_b` (paper `4B`). Each is a whole exam, not a sub-paper of a shared subscription. Picking "4th Class – Part A" *is* picking the paper — no second picker step.

## Changes

### A. Backend — `fsa-agent/server/src/routes/practiceExam.js`

1. Replace the local `PAPERS_SECOND`/`PAPERS_THIRD` arrays/validation with `PAPERS_BY_CLASS` and `FOURTH_CLASS_CODES` imported from `../config/papersForClass.js` (already exists, already used by `platform.js`). Accepted `classCode` values become `second | third | fourth_a | fourth_b`.
2. **New cross-class exclusivity check** in `POST /request-code`, before the existing `(email, paper_code)` lookup:
   ```sql
   SELECT paper_code, completed_at FROM practice_exam_attempts WHERE email = $1 LIMIT 1
   ```
   - No row → proceed as today.
   - Row exists with `paper_code` matching the requested one → fall through to existing same-paper logic (handles resend-code / already-completed-this-paper cases unchanged).
   - Row exists with a **different** `paper_code` → return `{ success: false, already_used: true, paper_code: <existing paper_code> }` regardless of whether that other attempt was completed (any attempt blocks — a started-but-abandoned attempt still counts, per the "single free exam" intent).
3. `verify-code` / `chat` / `complete` are unchanged — already scoped correctly by `(email, paper_code)` match once a paper is picked.
4. `preview.js` (old v1 lead magnet, superseded) is left untouched.

No DB schema change — `class_code`/`paper_code` are free-text `VARCHAR` and already generalize to `fourth_a`/`4A` and `fourth_b`/`4B`.

### B. Frontend — `fsa-agent/client-v2/src/pages/FreePracticeExamPage.jsx`

1. `CLASS_OPTIONS` gains two entries: `fourth_a` ("4th Class – Part A"), `fourth_b` ("4th Class – Part B") — matching the paid subscription naming so the free exam maps 1:1 to what a lead would go on to subscribe to.
2. Selecting a 4th-class option skips the paper-grid step entirely (class selection sets `paper_code` directly: `fourth_a` → `4A`, `fourth_b` → `4B`) and proceeds straight to email capture.
3. The `already_used` handling (three call sites: request-code, verify-code, chat) becomes generic: message reads "You've already used your free practice exam ({existing paper_code})." instead of any hardcoded class assumption. Backend now returns the existing `paper_code` in the `already_used` response for this (see A.2).

### C. Website — `fsa-website/free-practice-exam.html`

1. New class card(s) for "4th Class" in the Step 1 picker. Given 4A/4B are each a full standalone product, present as **two separate class cards** — "4th Class – Part A" and "4th Class – Part B" — sitting alongside the existing "2nd Class" / "3rd Class" cards, rather than one "4th Class" card that opens a sub-picker. This keeps the picker UX consistent: for 2nd/3rd, card → paper grid; for 4th, card → deep link directly (no grid needed, matches B.2's "class is the paper" model).
2. Deep link generation is already class-agnostic (`?class=<class>&paper=<paper>[&am_id=...]`) — the 4th-class cards link straight to `class=fourth_a&paper=4A` / `class=fourth_b&paper=4B`, no JS changes required beyond wiring the new cards into `selectClass`/`updateCta`.
3. Copy updates: title, meta description, OG tags, and FAQ section change "2nd & 3rd Class" → "2nd, 3rd & 4th Class" throughout.

### D. Social announcement

1. **Manual draft** — ready-to-post copy for r/PowerEngineering and the FB groups Russ has access to, in his voice, announcing 4th class free practice exams are now live. Delivered as a copy-paste block (same shape as `reddit-post-draft` skill output).
2. **Auto-scheduled** — one LinkedIn (company page) + one FB Page post via `social-planner`/GHL, slotted into the existing content cadence, announcing the same.
3. Both point to `fsa-website/free-practice-exam.html`.

## Out of scope

- `diagnostic.js` (Paper Planner Diagnostic) — explicitly excluded per its existing code comment; 4th class has no diagnostic funnel and this design doesn't change that.
- `preview.js` (old v1 practice-preview lead magnet) — superseded by the flow this design extends; not touched.
- `fsa-lead-capture` Worker — already class-agnostic (`/practice-exam` handler doesn't branch on `classCode`/`paperCode`), no changes needed.
- Any change to the paid/authenticated 4th-class platform experience (`platform.js`, lobby, AI orchestrator) — already fully built and unaffected by this work.

## Testing / verification

- Request a code for `4A`, complete the exam → confirm `completed_at` set, `AI-service` debrief is stats-only (reduced-AI path, per existing `is_fourth_class` orchestrator logic — should apply automatically since it keys off `course_id` alone).
- From the same email, attempt to request a code for `4B` (or `second`/`third`) → confirm `already_used: true` with the correct existing `paper_code` in the response, and that the frontend surfaces it.
- Confirm an email with zero prior rows can freely pick any of `second` / `third` / `fourth_a` / `fourth_b`.
- Confirm 2nd/3rd class flows are unaffected (paper grid still shows, existing same-paper retry gate still works).
- Visual check of new website cards in both light/dark (site doesn't currently theme-switch — confirm existing card styling, not a new concern).
