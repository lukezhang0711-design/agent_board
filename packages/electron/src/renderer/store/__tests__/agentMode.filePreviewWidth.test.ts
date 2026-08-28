// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@nimbalyst/runtime/store';
import {
  filePreviewWidthAtom,
  initAgentModeLayout,
  setFilePreviewWidthAtom,
} from '../atoms/agentMode';
import { activeWorkspacePathAtom } from '../atoms/openProjects';
import {
  PREVIEW_RAIL_DEFAULT_WIDTH,
  PREVIEW_RAIL_MAX_WIDTH,
  PREVIEW_RAIL_MIN_WIDTH,
} from '../../components/MetaAgentMode/filePreviewFormat';

const invoke = vi.fn();
/** Last blob written to workspace state, keyed by workspace path. */
let saved = new Map<string, Record<string, unknown>>();
/** What `workspace:get-state` should answer, keyed by workspace path. */
let onDisk = new Map<string, Record<string, unknown>>();

// The module-level jotai store is shared by every test in this file, so each
// case uses its own workspace path (that is also how the app keeps one layout
// slot per open project).
let pathCounter = 0;
function freshWorkspace(): string {
  pathCounter += 1;
  const path = `/ws/preview-width-${pathCounter}`;
  store.set(activeWorkspacePathAtom, path);
  return path;
}

beforeEach(() => {
  saved = new Map();
  onDisk = new Map();
  invoke.mockReset();
  invoke.mockImplementation((channel: string, ...args: unknown[]) => {
    if (channel === 'workspace:get-state') {
      return Promise.resolve(onDisk.get(args[0] as string));
    }
    if (channel === 'workspace:update-state') {
      saved.set(args[0] as string, args[1] as Record<string, unknown>);
      return Promise.resolve({ success: true });
    }
    return Promise.resolve({ success: true });
  });
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { invoke } });
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.clearAllMocks();
});

describe('file-preview rail width persistence', () => {
  it('starts at the default width', () => {
    freshWorkspace();
    expect(store.get(filePreviewWidthAtom)).toBe(PREVIEW_RAIL_DEFAULT_WIDTH);
  });

  it('writes a resized rail to workspace state', async () => {
    const workspace = freshWorkspace();
    vi.useFakeTimers();

    store.set(setFilePreviewWidthAtom, 560);
    expect(store.get(filePreviewWidthAtom)).toBe(560);

    await vi.advanceTimersByTimeAsync(600);

    expect(saved.get(workspace)).toEqual(
      expect.objectContaining({
        agenticCodingWindowState: expect.objectContaining({ filePreviewWidth: 560 }),
      }),
    );
  });

  it('restores the persisted width the next time the workspace is opened', async () => {
    const firstRun = freshWorkspace();
    vi.useFakeTimers();
    store.set(setFilePreviewWidthAtom, 610);
    await vi.advanceTimersByTimeAsync(600);
    vi.useRealTimers();

    // Next launch: a fresh layout slot, seeded from exactly the blob the
    // resize wrote to disk.
    const nextRun = freshWorkspace();
    onDisk.set(nextRun, saved.get(firstRun)!);
    expect(store.get(filePreviewWidthAtom)).toBe(PREVIEW_RAIL_DEFAULT_WIDTH);

    await initAgentModeLayout(nextRun);

    expect(store.get(filePreviewWidthAtom)).toBe(610);
  });

  it('clamps a width that is out of range, both when set and when restored', async () => {
    freshWorkspace();
    store.set(setFilePreviewWidthAtom, 5000);
    expect(store.get(filePreviewWidthAtom)).toBe(PREVIEW_RAIL_MAX_WIDTH);

    store.set(setFilePreviewWidthAtom, 10);
    expect(store.get(filePreviewWidthAtom)).toBe(PREVIEW_RAIL_MIN_WIDTH);

    const restored = freshWorkspace();
    onDisk.set(restored, { agenticCodingWindowState: { filePreviewWidth: 12000 } });
    await initAgentModeLayout(restored);
    expect(store.get(filePreviewWidthAtom)).toBe(PREVIEW_RAIL_MAX_WIDTH);
  });

  it('falls back to the default for state written before the rail existed', async () => {
    const legacy = freshWorkspace();
    onDisk.set(legacy, { agenticCodingWindowState: { filesEditedWidth: 300 } });

    await initAgentModeLayout(legacy);

    expect(store.get(filePreviewWidthAtom)).toBe(PREVIEW_RAIL_DEFAULT_WIDTH);
  });
});
