import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';

function LoginProbe() {
  const loc = useLocation();
  return <div data-testid="login">{loc.pathname + loc.search}</div>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/affiliate" element={<ProtectedRoute requirePaper={false}><div>secret</div></ProtectedRoute>} />
        <Route path="/jobs" element={<ProtectedRoute requirePaper={false}><div>secret</div></ProtectedRoute>} />
        <Route path="/home" element={<ProtectedRoute requirePaper={false}><div>secret</div></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => localStorage.clear());

  it('logged-out visit to /affiliate redirects to /login?next=%2Faffiliate', () => {
    renderAt('/affiliate');
    expect(screen.getByTestId('login').textContent).toBe('/login?next=%2Faffiliate');
  });

  it('logged-out visit keeps the query string', () => {
    renderAt('/jobs?x=1');
    expect(screen.getByTestId('login').textContent).toBe('/login?next=%2Fjobs%3Fx%3D1');
  });

  it('logged-out visit to /home redirects to plain /login', () => {
    renderAt('/home');
    expect(screen.getByTestId('login').textContent).toBe('/login');
  });

  it('logged-in user sees the children', () => {
    localStorage.setItem('fsa_user', JSON.stringify({ class_code: 'second', active_paper: '2A1' }));
    renderAt('/affiliate');
    expect(screen.getByText('secret')).toBeTruthy();
  });
});
