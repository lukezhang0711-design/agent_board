// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkOrderRetryButton } from '../WorkOrderRetryButton';

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span data-material-icon={icon}>{icon}</span>,
}));

afterEach(() => {
  delete (window as any).electronAPI;
});

function stubElectronInvoke(invoke: (...args: any[]) => Promise<unknown>): void {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { invoke },
  });
}

describe('WorkOrderRetryButton', () => {
  it('authorizes the owner retry and disables duplicate clicks while running', () => {
    const onRetry = vi.fn();
    const invoke = vi.fn().mockResolvedValue({ success: true, canRetry: true });
    stubElectronInvoke(invoke);
    const view = render(React.createElement(WorkOrderRetryButton, {
      onRetry,
      workspaceId: '/workspace',
      trackerItemId: 'work-order-1',
    } as any));

    const button = screen.getByTestId('work-order-retry');
    expect(button.textContent).toContain('重试');
    return waitFor(() => {
      expect((button as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(button);
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith('meta-agent:can-retry-work-order', {
        workspaceId: '/workspace',
        trackerItemId: 'work-order-1',
      });

      view.rerender(<WorkOrderRetryButton onRetry={onRetry} retrying workspaceId="/workspace" trackerItemId="work-order-1" />);
      const retryingButton = screen.getByTestId('work-order-retry') as HTMLButtonElement;
      expect(retryingButton.disabled).toBe(true);
      expect(retryingButton.textContent).toContain('重试中…');
    });
  });

  it('FB-090 RED→GREEN: disables retry and explains an unavailable owner', async () => {
    const onRetry = vi.fn();
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      canRetry: false,
      reason: '原指挥官会话已不存在，无法重派',
    });
    stubElectronInvoke(invoke);

    render(React.createElement(WorkOrderRetryButton, {
      onRetry,
      workspaceId: '/workspace',
      trackerItemId: 'unresolvable-work-order',
    } as any));

    const button = screen.getByTestId('work-order-retry') as HTMLButtonElement;
    const reason = await screen.findByTestId('work-order-retry-reason');
    expect(button.disabled).toBe(true);
    expect(reason.textContent).toBe('原指挥官会话已不存在，无法重派');
    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
