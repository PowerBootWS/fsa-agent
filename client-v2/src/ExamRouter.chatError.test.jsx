import { describe, it, expect } from 'vitest';
import { chatErrorMessage } from './ExamRouter';

describe('chatErrorMessage', () => {
  it('tells a free-exam lead their session expired on 401/403', () => {
    expect(chatErrorMessage({ status: 401 }, { leadMagnet: true })).toMatch(/practice exam session has expired/);
    expect(chatErrorMessage({ status: 403 }, { leadMagnet: true })).toMatch(/support@fullsteamahead\.ca/);
  });

  it('tells a signed-in student to sign in again on 401', () => {
    expect(chatErrorMessage({ status: 401 }, { leadMagnet: false })).toMatch(/Sign in again/);
  });

  it('asks for a retry on other failures', () => {
    expect(chatErrorMessage({ status: 500 })).toMatch(/select your answer again/);
    expect(chatErrorMessage(new TypeError('Failed to fetch'))).toMatch(/select your answer again/);
  });
});
