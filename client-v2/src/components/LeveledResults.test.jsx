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
});
