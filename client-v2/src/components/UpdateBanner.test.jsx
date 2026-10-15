import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { UpdateBanner } from './UpdateBanner';
import { runningBundle, CHECK_EVERY_MS } from '../utils/appVersion';

const shell = js => `<!doctype html><html><head><script type="module" crossorigin src="/v2/assets/${js}"></script></head></html>`;

function setRunning(js) {
  document.head.querySelectorAll('script[data-test]').forEach(s => s.remove());
  if (!js) return;
  const s = document.createElement('script');
  s.type = 'module';
  s.setAttribute('src', `/v2/assets/${js}`);
  s.dataset.test = '1';
  document.head.appendChild(s);
}

async function tick() {
  await act(async () => { vi.advanceTimersByTime(CHECK_EVERY_MS); });
  await act(async () => {});
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); setRunning(null); });

describe('UpdateBanner', () => {
  it('reads the bundle this tab is running', () => {
    setRunning('index-AAA.js');
    expect(runningBundle()).toBe('/v2/assets/index-AAA.js');
  });

  it('stays hidden while the server names the same bundle', async () => {
    setRunning('index-AAA.js');
    globalThis.fetch = vi.fn(async () => ({ ok: true, text: async () => shell('index-AAA.js') }));
    render(<UpdateBanner />);
    await tick();
    expect(globalThis.fetch).toHaveBeenCalledWith('/', expect.objectContaining({ cache: 'no-store' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers a refresh once a new bundle is deployed, and can be dismissed', async () => {
    setRunning('index-AAA.js');
    globalThis.fetch = vi.fn(async () => ({ ok: true, text: async () => shell('index-BBB.js') }));
    render(<UpdateBanner />);
    await tick();
    expect(screen.getByText(/new version/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does nothing in dev, where there is no hashed bundle', async () => {
    globalThis.fetch = vi.fn();
    render(<UpdateBanner />);
    await tick();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('ignores a failed check', async () => {
    setRunning('index-AAA.js');
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); });
    render(<UpdateBanner />);
    await tick();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
