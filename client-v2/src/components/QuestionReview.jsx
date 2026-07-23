import { MathContent } from './MathContent.jsx';

function QuestionReviewItem({ item, index }) {
  const { question_text, options, correct_index, selected_index, correct, explanation } = item;

  return (
    <div className={`qr-item${correct ? ' qr-item--correct' : ' qr-item--wrong'}`}>
      <div className="qr-item-header">
        <span className="qr-item-num">Q{index + 1}</span>
        <span className={correct ? 'qr-badge-pass' : 'qr-badge-fail'}>
          {correct ? 'Correct' : 'Incorrect'}
        </span>
      </div>
      <div className="qr-item-question">
        <MathContent text={question_text} />
      </div>
      <div className="qr-item-options">
        {(options || []).map((opt, i) => {
          const isCorrect = i === correct_index;
          const isSelected = i === selected_index;
          const cls = [
            'qr-option',
            isCorrect ? 'qr-option--correct' : '',
            isSelected && !isCorrect ? 'qr-option--selected-wrong' : '',
          ].filter(Boolean).join(' ');
          return (
            <div key={i} className={cls}>
              <span className="qr-option-label">{String.fromCharCode(65 + i)}.</span>
              <span className="qr-option-text"><MathContent text={opt} /></span>
              {isSelected && <span className="qr-option-tag">Your answer</span>}
              {isCorrect && <span className="qr-option-tag qr-option-tag--correct">Correct answer</span>}
            </div>
          );
        })}
      </div>
      {!correct && explanation && (
        <div className="qr-item-explanation">{explanation}</div>
      )}
    </div>
  );
}

export function QuestionReview({ questions }) {
  if (!questions || questions.length === 0) return null;
  return (
    <div className="qr-list">
      {questions.map((q, i) => (
        <QuestionReviewItem key={i} item={q} index={i} />
      ))}
    </div>
  );
}

export function QuestionReviewModal({ questions, onClose }) {
  return (
    <div className="qr-modal-overlay" onClick={onClose}>
      <div className="qr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="qr-modal-header">
          <span className="qr-modal-title">All Questions ({(questions || []).length})</span>
          <button className="qr-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="qr-modal-body">
          <QuestionReview questions={questions} />
        </div>
      </div>
    </div>
  );
}
