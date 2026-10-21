import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ClassSwitcher from './ClassSwitcher';

const respond = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

function setup(classes, current) {
  globalThis.fetch = vi.fn(async (url, opts) => {
    if (String(url).endsWith('/classes')) return respond({ classes, current });
    if (String(url).endsWith('/active-class')) return respond({ ok: true });
    if (String(url).endsWith('/me')) return respond({ class_code: 'fourth_a', active_paper: null });
    return respond({});
  });
  const onSwitched = vi.fn();
  render(<ClassSwitcher onSwitched={onSwitched} />);
  return onSwitched;
}

describe('ClassSwitcher', () => {
  it('stays hidden for a student with one class', async () => {
    setup([{ key: 'third', label: '3rd Class' }], 'third');
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole('group', { name: 'Choose course' })).toBeNull();
  });

  it('switches class and refreshes the cached account', async () => {
    localStorage.setItem('fsa_user', JSON.stringify({ email: 's@x', class_code: 'third', active_paper: '3A1' }));
    const onSwitched = setup([{ key: 'third', label: '3rd Class' }, { key: 'fourth', label: '4th Class' }], 'third');
    fireEvent.click(await screen.findByRole('button', { name: '4th Class' }));
    await vi.waitFor(() => expect(onSwitched).toHaveBeenCalledWith('fourth'));
    const post = globalThis.fetch.mock.calls.find(([u]) => String(u).endsWith('/active-class'));
    expect(JSON.parse(post[1].body)).toEqual({ key: 'fourth' });
    expect(JSON.parse(localStorage.getItem('fsa_user')).class_code).toBe('fourth_a');
  });
});
