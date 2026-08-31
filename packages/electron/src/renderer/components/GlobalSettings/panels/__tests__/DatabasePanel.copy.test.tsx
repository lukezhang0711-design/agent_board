// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span aria-label={icon} />,
}));

import { DatabasePanel } from '../DatabasePanel';

beforeEach(() => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      invoke: vi.fn((channel: string) => {
        if (channel === 'db:migration:get-status') {
          return Promise.resolve({
            success: true,
            activeBackend: 'pglite',
            pgliteDirExists: true,
            sqliteDirExists: false,
            migratedDirs: [],
            running: false,
            runningDryRun: false,
          });
        }
        if (channel === 'db:migration:dry-run-status') {
          return Promise.resolve({
            success: true,
            available: true,
            completedAt: new Date().toISOString(),
            totalRows: 42,
          });
        }
        return Promise.resolve({ success: true });
      }),
      on: vi.fn(),
      off: vi.fn(),
    },
  });
});

afterEach(() => {
  cleanup();
  delete (window as any).electronAPI;
});

describe('DatabasePanel dry-run copy', () => {
  it('RED FO: tells users that a successful dry-run copy is retained for adoption', async () => {
    render(<DatabasePanel />);

    expect(await screen.findByText(/keeps a successful copy so you can switch later/)).toBeTruthy();
    expect(screen.queryByText(/then deletes the temporary copy/)).toBeNull();
  });
});
