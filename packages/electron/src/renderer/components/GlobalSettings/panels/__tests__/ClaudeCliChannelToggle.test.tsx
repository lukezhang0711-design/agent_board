// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeCliChannelToggle } from '../ClaudeCliChannelToggle';

describe('ClaudeCliChannelToggle', () => {
  it('defaults off and persists the user choice through the settings atom', async () => {
    const settingsSet = vi.fn().mockResolvedValue({ ok: true });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { settingsSet },
    });

    render(<ClaudeCliChannelToggle />);

    expect(screen.getByTestId('show-claude-cli-channel-toggle')).toBeTruthy();
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);

    await waitFor(() => expect(settingsSet).toHaveBeenCalledWith('ai.showClaudeCliChannel', true));
  });
});
