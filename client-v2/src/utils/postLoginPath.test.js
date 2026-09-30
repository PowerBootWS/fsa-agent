import { describe, it, expect } from 'vitest';
import { postLoginPath } from './postLoginPath';

describe('postLoginPath', () => {
  it('honours a safe next', () => {
    expect(postLoginPath({ class_code: 'second', active_paper: '2A1' }, '/jobs/capture?token=x')).toBe('/jobs/capture?token=x');
  });
  it('ignores protocol-relative next', () => {
    expect(postLoginPath({}, '//evil.example')).toBe('/home');
  });
  it('sends a 2nd/3rd Class student with no paper to the picker', () => {
    expect(postLoginPath({ class_code: 'third', active_paper: null }, null)).toBe('/select-paper');
  });
  it('sends everyone else to /home', () => {
    expect(postLoginPath({ class_code: 'second', active_paper: '2A3' }, null)).toBe('/home');
    expect(postLoginPath({ class_code: 'fourth_a', active_paper: null }, null)).toBe('/home');
    expect(postLoginPath({ class_code: null, active_paper: null }, null)).toBe('/home');
  });
});
