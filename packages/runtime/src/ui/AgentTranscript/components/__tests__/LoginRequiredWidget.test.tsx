import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginRequiredWidget } from '../LoginRequiredWidget';

describe('LoginRequiredWidget', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({
      authState: 'logged-out',
      isLoggedIn: false,
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { invoke },
    });
  });

  it('reads the shared TTL-backed Claude status without forcing a check when mounted', async () => {
    render(<LoginRequiredWidget />);

    await waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(invoke).toHaveBeenCalledWith('claude-code:check-login');
  });

  it('forces the shared status only when the user asks to refresh', async () => {
    render(<LoginRequiredWidget />);
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    invoke.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Check Status' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledOnce();
    });
    expect(invoke).toHaveBeenCalledWith('claude-code:check-login', { forceRefresh: true });
  });

  it('shows success only from the authoritative logged-in auth state', async () => {
    invoke.mockResolvedValue({
      authState: 'logged-in',
      isLoggedIn: false,
    });
    render(<LoginRequiredWidget />);

    expect(await screen.findByText('You are logged in and can continue your conversation')).toBeDefined();
  });

  it('shows logged out even when the legacy boolean conflicts', async () => {
    invoke.mockResolvedValue({
      authState: 'logged-out',
      isLoggedIn: true,
    });
    render(<LoginRequiredWidget />);

    expect(await screen.findByText('Not logged in. Please complete the authentication flow.')).toBeDefined();
    expect(screen.queryByText('You are logged in and can continue your conversation')).toBeNull();
  });

  it('shows check-failed distinctly instead of treating it as logged out', async () => {
    invoke.mockResolvedValue({
      authState: 'check-failed',
      isLoggedIn: true,
      error: 'auth status timed out',
    });
    render(<LoginRequiredWidget />);

    expect(await screen.findByText('Failed to check Claude login status: auth status timed out')).toBeDefined();
    expect(screen.queryByText(/Not logged in/)).toBeNull();
  });

  it('shows unknown distinctly instead of treating it as logged out', async () => {
    invoke.mockResolvedValue({
      authState: 'unknown',
      isLoggedIn: true,
    });
    render(<LoginRequiredWidget />);

    expect(await screen.findByText('Claude login status is unknown. Please try again.')).toBeDefined();
    expect(screen.queryByText(/Not logged in/)).toBeNull();
  });
});
