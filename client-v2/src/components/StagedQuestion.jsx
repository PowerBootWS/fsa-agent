import { useState, useEffect } from 'react';
import { MathContent } from './MathContent';
import './StagedQuestion.css';

/**
 * Staged multi-step practice question. Each step is a single-answer MCQ;
 * picking locks the step and reveals the answer plus explanation.
 */
export function StagedQuestion({ question, number, total, onDone }) {
  const steps = question?.step_data?.steps || [];
  const [stepIdx, setStepIdx] = useState(0);
  const [picked, setPicked] = useState(null);
  const [correctCount, setCorrectCount] = useState(0);

  // The page reuses this component for questions 2 and 3.
  useEffect(() => {
    setStepIdx(0);
    setPicked(null);
    setCorrectCount(0);
  }, [question]);

  const step = steps[stepIdx];
  if (!step) return null;

  const answered = picked !== null;
  const isLastStep = stepIdx === steps.length - 1;
  const isCorrect = answered && picked === step.correct;

  function pick(i) {
    if (answered) return;
    setPicked(i);
    if (i === step.correct) setCorrectCount(c => c + 1);
  }

  function next() {
    if (!isLastStep) {
      setStepIdx(stepIdx + 1);
      setPicked(null);
    } else {
      onDone({ stepsCorrect: correctCount, steps: steps.length });
    }
  }

  const doneLabel = number === total ? 'Finish' : 'Next question';

  return (
    <div className="sq-card">
      <div className="sq-label">Question {number} of {total}</div>
      <div className="sq-text"><MathContent text={question.question_text || ''} /></div>
      <div className="sq-step-label">Step {stepIdx + 1} of {steps.length}</div>
      {step.context ? (
        <div className="sq-context"><MathContent text={step.context} /></div>
      ) : null}
      <div className="sq-prompt"><MathContent text={step.question} /></div>
      <div className="sq-options">
        {step.options.map((opt, i) => {
          const cls = ['sq-option'];
          if (answered && i === step.correct) cls.push('sq-correct');
          if (answered && i === picked && i !== step.correct) cls.push('sq-wrong');
          return (
            <button
              key={i}
              type="button"
              className={cls.join(' ')}
              disabled={answered}
              onClick={() => pick(i)}
            >
              <MathContent text={opt} />
            </button>
          );
        })}
      </div>
      {answered && (
        <div className="sq-feedback" role="status">
          <div className={`sq-verdict ${isCorrect ? 'sq-verdict-ok' : 'sq-verdict-bad'}`}>
            {isCorrect ? 'Correct' : 'Not quite'}
          </div>
          <div className="sq-explanation"><MathContent text={step.explanation || ''} /></div>
          <button type="button" className="sq-next" onClick={next}>
            {isLastStep ? doneLabel : 'Next step'}
          </button>
        </div>
      )}
    </div>
  );
}

export default StagedQuestion;
