import { useState } from 'react';
import { postJson } from '../utils/api';

// "This question is wrong" for chapter quizzes and practice exams (2026-10-21).
// Until now only the lesson checkpoint card had it, and those are not where
// students meet most questions — question_flags had zero rows. A mis-keyed 2A1
// question went unreported because there was nowhere to report it.
// Same endpoint and copy as the checkpoint card (TutorPanel).
export default function FlagQuestion({ questionId, lessonCode }) {
  const [state, setState] = useState('idle');
  const [reason, setReason] = useState('');
  if (!questionId) return null;

  async function send() {
    setState('sent');
    try {
      await postJson('/api/v2/question-flag', {
        question_id: questionId,
        lesson_code: lessonCode || null,
        reason,
      });
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="q-flag">
      {state === 'idle' && (
        <button type="button" className="q-flag-open" onClick={() => setState('open')}>
          Think this question is wrong? Tell us
        </button>
      )}
      {state === 'open' && (
        <div className="q-flag-form">
          <textarea
            className="q-flag-reason"
            rows={2}
            value={reason}
            placeholder="What looks wrong? (optional)"
            onChange={e => setReason(e.target.value)}
          />
          <div className="q-flag-actions">
            <button type="button" className="q-flag-send" onClick={send}>Report it</button>
            <button type="button" className="q-flag-cancel" onClick={() => setState('idle')}>Cancel</button>
          </div>
        </div>
      )}
      {state === 'sent' && <div className="q-flag-done">Thanks — Russ will look at this one personally.</div>}
      {state === 'failed' && (
        <div className="q-flag-done">We could not record that. Email support@fullsteamahead.ca and we will fix it.</div>
      )}
    </div>
  );
}
