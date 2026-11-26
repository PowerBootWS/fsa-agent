import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LeveledResults from './LeveledResults';

const data = {
  topics: [
    { topic_key: 'a', name: 'Boilers', weight: 30, level: 2, level_name: 'Core', new_level: 3, new_level_name: 'Exam-Level', correct: 13, total: 15 },
    { topic_key: 'b', name: 'Pumps', weight: 10, level: 2, level_name: 'Core', new_level: 1, new_level_name: 'Foundation', correct: 1, total: 5 },
    { topic_key: 'c', name: 'Piping', weight: 10, level: 3, level_name: 'Exam-Level', new_level: 3, new_level_name: 'Exam-Level', correct: 3, total: 5 },
  ],
  predicted_pct: 62.5, band: 'close', message: 'You could pass, but it would be close.',
  holding_back: ['Pumps', 'Piping'], pass_pct: 65,
};

describe('LeveledResults', () => {
  it('shows each topic with its level and score', () => {
    render(<LeveledResults data={data} />);
    expect(screen.getByText('Boilers')).toBeInTheDocument();
    expect(screen.getByText('13/15')).toBeInTheDocument();
    expect(screen.getByText('Core → Exam-Level')).toBeInTheDocument();
    expect(screen.getByText('Core → Foundation')).toBeInTheDocument();
    expect(screen.getAllByText('Exam-Level').length).toBeGreaterThan(0);   // unchanged level shown once
  });

  it('shows the verdict word for word and the predicted score against the pass mark', () => {
    render(<LeveledResults data={data} />);
    expect(screen.getByText('You could pass, but it would be close.')).toBeInTheDocument();
    expect(screen.getByText(/62\.5%/)).toBeInTheDocument();
    expect(screen.getByText(/65%/)).toBeInTheDocument();
  });

  it('names the topics holding the student back and never says chapter', () => {
    const { container } = render(<LeveledResults data={data} />);
    expect(screen.getByText(/Pumps, Piping/)).toBeInTheDocument();
    expect(container.textContent.toLowerCase()).not.toContain('chapter');
  });

  it('omits the holding-back line when nothing is', () => {
    render(<LeveledResults data={{ ...data, holding_back: [] }} />);
    expect(screen.queryByText(/holding you back/i)).not.toBeInTheDocument();
  });

  it('shows the time, how far over, and how far the student got by the limit', () => {
    render(<LeveledResults data={{ ...data, timing: { limit_s: 9000, max_count: 30, taken_s: 10500, over_s: 1500,
      answered_in_time: 44, correct_in_time: 35, total: 50 } }} />);
    expect(screen.getByText(/You took 2 h 55 min of your 2 h 30 min/)).toBeInTheDocument();
    expect(screen.getByText(/25 min over/)).toBeInTheDocument();
    expect(screen.getByText(/By the time limit you had answered 44 of 50 \(35 correct\)/)).toBeInTheDocument();
    expect(screen.getByText(/extra time for 30 Max-level questions/)).toBeInTheDocument();
    expect(screen.getByText(/Understanding comes first/)).toBeInTheDocument();
  });

  it('says so when the student finished inside the limit', () => {
    render(<LeveledResults data={{ ...data, timing: { limit_s: 4500, max_count: 0, taken_s: 4000, over_s: 0,
      answered_in_time: 50, correct_in_time: 40, total: 50 } }} />);
    expect(screen.getByText(/You finished in 1 h 7 min of your 1 h 15 min/)).toBeInTheDocument();
    expect(screen.queryByText(/over/)).not.toBeInTheDocument();
  });

  it('shows no time section for an untimed exam', () => {
    const { container } = render(<LeveledResults data={data} />);
    expect(container.querySelector('.lr-time')).toBeNull();
  });
});
