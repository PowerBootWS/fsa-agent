import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import useScreenView, { resolveScreen } from './useScreenView';
import { track } from '../utils/usage';

vi.mock('../utils/usage', () => ({ track: vi.fn() }));

function Probe() {
  useScreenView();
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('fsa_user', JSON.stringify({ email: 'a@test.example' }));
});

describe('resolveScreen', () => {
  it('resolves a static route to its own pattern', () => {
    expect(resolveScreen('/lobby')).toEqual({ screen: '/lobby', params: {} });
  });

  it('resolves a dynamic route to the PATTERN, with the id in params', () => {
    expect(resolveScreen('/lesson/2A1-3-2')).toEqual({
      screen: '/lesson/:lessonCode',
      params: { lessonCode: '2A1-3-2' },
    });
  });

  it('returns null for an unlisted route', () => {
    expect(resolveScreen('/login')).toBeNull();
    expect(resolveScreen('/free-practice-exam')).toBeNull();
    expect(resolveScreen('/admin/usage')).toBeNull();
  });
});

describe('useScreenView', () => {
  it('tracks the pattern, not the raw path', () => {
    render(
      <MemoryRouter initialEntries={['/lesson/2A1-3-2']}>
        <Probe />
      </MemoryRouter>
    );
    expect(track).toHaveBeenCalledWith('screen_view', {
      screen: '/lesson/:lessonCode',
      props: { lessonCode: '2A1-3-2' },
    });
  });

  it('does not track an unlisted route', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Probe />
      </MemoryRouter>
    );
    expect(track).not.toHaveBeenCalled();
  });
});
