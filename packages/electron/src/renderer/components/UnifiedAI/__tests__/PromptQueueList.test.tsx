// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PromptQueueList } from '../PromptQueueList';

afterEach(() => {
  cleanup();
});

describe('PromptQueueList', () => {
  it('keeps send-now unavailable while a plan awaits review', () => {
    const onSendNow = vi.fn();
    render(
      <PromptQueueList
        queue={[{ id: 'queued-1', prompt: 'Start the next task', timestamp: 1 }]}
        onCancel={vi.fn()}
        onSendNow={onSendNow}
        sendNowDisabledMessage="Please approve or reject the plan first."
      />,
    );

    const sendNow = screen.getByRole('button', { name: 'Please approve or reject the plan first.' });
    expect(sendNow.hasAttribute('disabled')).toBe(true);
    fireEvent.click(sendNow);
    expect(onSendNow).not.toHaveBeenCalled();
  });

  it('preserves send-now for sessions without a pending plan approval', () => {
    const onSendNow = vi.fn();
    render(
      <PromptQueueList
        queue={[{ id: 'queued-1', prompt: 'Start the next task', timestamp: 1 }]}
        onCancel={vi.fn()}
        onSendNow={onSendNow}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Interrupt and send now' }));
    expect(onSendNow).toHaveBeenCalledWith('queued-1', 'Start the next task');
  });
});
