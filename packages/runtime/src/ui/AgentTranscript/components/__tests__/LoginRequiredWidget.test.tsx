import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginRequiredWidget } from '../LoginRequiredWidget';

describe('LoginRequiredWidget', () => {
  const invoke = vi.fn();
  const refreshClaudeAuthState = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    refreshClaudeAuthState.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { invoke },
    });
    const runtimeWindow = window as Window & {
      __nimbalystClaudeAuthState?: unknown;
      __nimbalystRefreshClaudeAuthState?: () => Promise<unknown>;
    };
    runtimeWindow.__nimbalystClaudeAuthState = {
      status: 'logged-out',
      source: 'claude-cli-auth-status',
      checkedAt: 100,
    };
    runtimeWindow.__nimbalystRefreshClaudeAuthState = refreshClaudeAuthState;
  });

  it('reads the centrally mirrored Claude state without an independent mount check', () => {
    render(<LoginRequiredWidget />);

    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByText('Not logged in. Please complete the authentication flow.')).toBeDefined();
    expect(screen.getByText('Claude 命令行未登录订阅账号——请在终端运行 claude /login 登录后重试')).toBeDefined();
  });

  it('forces the shared status only when the user asks to refresh', async () => {
    render(<LoginRequiredWidget />);

    fireEvent.click(screen.getByRole('button', { name: 'Check Status' }));

    await waitFor(() => {
      expect(refreshClaudeAuthState).toHaveBeenCalledOnce();
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('shows success only from the authoritative logged-in auth state', async () => {
    (window as Window & { __nimbalystClaudeAuthState?: unknown }).__nimbalystClaudeAuthState = {
      status: 'logged-in',
      source: 'claude-cli-auth-status',
      checkedAt: 100,
    };
    render(<LoginRequiredWidget />);

    expect(screen.getByText('You are logged in and can continue your conversation')).toBeDefined();
  });

  it('shows logged out from the central status without consulting a legacy boolean', () => {
    render(<LoginRequiredWidget />);

    expect(screen.getByText('Not logged in. Please complete the authentication flow.')).toBeDefined();
    expect(screen.queryByText('You are logged in and can continue your conversation')).toBeNull();
  });

  it('shows check-failed distinctly instead of treating it as logged out', () => {
    (window as Window & { __nimbalystClaudeAuthState?: unknown }).__nimbalystClaudeAuthState = {
      status: 'check-failed',
      source: 'claude-cli-auth-status',
      checkedAt: 100,
      error: 'auth status timed out',
    };
    render(<LoginRequiredWidget />);

    expect(screen.getByText('Failed to check Claude login status: auth status timed out')).toBeDefined();
    expect(screen.queryByText(/Not logged in/)).toBeNull();
  });

  it('shows unknown distinctly instead of treating it as logged out', () => {
    (window as Window & { __nimbalystClaudeAuthState?: unknown }).__nimbalystClaudeAuthState = {
      status: 'unknown',
      source: 'claude-cli-auth-status',
      checkedAt: null,
    };
    render(<LoginRequiredWidget />);

    expect(screen.getByText('Claude login status is unknown. Please try again.')).toBeDefined();
    expect(screen.queryByText(/Not logged in/)).toBeNull();
  });

  it('updates when the centralized listener mirrors a new auth state', async () => {
    render(<LoginRequiredWidget />);

    act(() => {
      (window as Window & { __nimbalystClaudeAuthState?: unknown }).__nimbalystClaudeAuthState = {
        status: 'logged-in',
        source: 'claude-cli-auth-status',
        checkedAt: 200,
      };
      window.dispatchEvent(new Event('claude-auth:state-updated'));
    });

    expect(await screen.findByText('You are logged in and can continue your conversation')).toBeDefined();
  });

  it('does not let login action feedback mask a later centralized check failure', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'claude-code:login') return { success: true };
      return undefined;
    });
    render(<LoginRequiredWidget />);

    fireEvent.click(screen.getByRole('button', { name: 'Log In' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('claude-code:login'));

    act(() => {
      (window as Window & { __nimbalystClaudeAuthState?: unknown }).__nimbalystClaudeAuthState = {
        status: 'check-failed',
        source: 'claude-cli-auth-status',
        checkedAt: 200,
        error: 'auth status timed out',
      };
      window.dispatchEvent(new Event('claude-auth:state-updated'));
    });

    expect(await screen.findByText('Failed to check Claude login status: auth status timed out')).toBeDefined();
  });
});
