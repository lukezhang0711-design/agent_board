// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { UpdateAvailableToast } from '../UpdateAvailableToast';

afterEach(cleanup);

describe('UpdateAvailableToast notification-only policy', () => {
  it('shows upstream notes and review guidance without download controls', () => {
    render(
      <UpdateAvailableToast
        version="0.68.1"
        releaseNotes="Upstream fixes and improvements."
        onRemindLater={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText('This is a customized build; updates are review-and-merge, not auto-installed.')).toBeTruthy();
    expect(screen.getByTestId('update-release-notes').textContent).toContain('Upstream fixes and improvements.');
    expect(screen.queryByTestId('update-now-btn')).toBeNull();
    expect(screen.queryByTestId('release-notes-btn')).toBeNull();
  });
});
