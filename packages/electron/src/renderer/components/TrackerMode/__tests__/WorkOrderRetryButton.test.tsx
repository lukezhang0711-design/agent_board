// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkOrderRetryButton } from '../WorkOrderRetryButton';

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span data-material-icon={icon}>{icon}</span>,
}));

describe('WorkOrderRetryButton', () => {
  it('authorizes the owner retry and disables duplicate clicks while running', () => {
    const onRetry = vi.fn();
    const view = render(<WorkOrderRetryButton onRetry={onRetry} />);

    const button = screen.getByTestId('work-order-retry');
    expect(button.textContent).toContain('重试');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);

    view.rerender(<WorkOrderRetryButton onRetry={onRetry} retrying />);
    const retryingButton = screen.getByTestId('work-order-retry') as HTMLButtonElement;
    expect(retryingButton.disabled).toBe(true);
    expect(retryingButton.textContent).toContain('重试中…');
  });
});
