// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClaudeIdentityBadge } from '../ClaudeIdentityBadge';

const baseAuthState = {
  source: 'claude-cli-auth-status' as const,
  checkedAt: 1,
};

describe('ClaudeIdentityBadge', () => {
  it('shows the subscription email when embedded Claude login is active', () => {
    render(
      <ClaudeIdentityBadge
        authState={{ ...baseAuthState, status: 'logged-in', email: 'user@example.com' }}
        apiKeys={{}}
      />,
    );

    expect(screen.getByTestId('claude-identity-badge').textContent).toBe('订阅 · user@example.com');
  });

  it('falls back to API when only a Claude API key is configured', () => {
    render(<ClaudeIdentityBadge authState={{ ...baseAuthState, status: 'logged-out' }} apiKeys={{ anthropic: 'sk-ant-fixture' }} />);

    expect(screen.getByTestId('claude-identity-badge').textContent).toBe('API');
  });

  it('shows actionable guidance when neither login nor API key is available', () => {
    render(<ClaudeIdentityBadge authState={{ ...baseAuthState, status: 'logged-out' }} apiKeys={{}} />);

    const badge = screen.getByTestId('claude-identity-badge');
    expect(badge.textContent).toBe('未登录');
    expect(badge.getAttribute('title')).toContain('配置 API Key');
    expect(badge.getAttribute('aria-label')).toContain('请登录 Claude');
  });
});
