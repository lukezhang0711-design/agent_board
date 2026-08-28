// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FilePreviewRail, type ArtifactShelfItem } from '../FilePreviewRail';
import {
  PREVIEW_RAIL_MAX_WIDTH,
  PREVIEW_RAIL_MIN_WIDTH,
  PREVIEW_RAIL_SPLIT_MIN_WINDOW_WIDTH,
} from '../filePreviewFormat';

const invoke = vi.fn();

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span data-material-icon={icon} />,
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

function setWindowWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ success: true, content: '# hi', isBinary: false });
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { invoke } });
  setWindowWidth(1440);
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.clearAllMocks();
});

const SHELF: ArtifactShelfItem[] = [
  { relativePath: 'plans/a.md', absolutePath: '/ws/plans/a.md', sessionTitles: ['Module 1'] },
];

function renderRail(overrides: Partial<React.ComponentProps<typeof FilePreviewRail>> = {}) {
  const props = {
    open: true,
    filePath: '/ws/plans/a.md' as string | null,
    width: 420,
    onWidthChange: vi.fn(),
    onOpen: vi.fn(),
    onClose: vi.fn(),
    shelfItems: SHELF,
    onSelectShelfItem: vi.fn(),
    onShowShelf: vi.fn(),
    onOpenInFiles: vi.fn(),
  };
  render(<FilePreviewRail {...props} {...overrides} />);
  return props;
}

describe('FilePreviewRail chrome', () => {
  it('takes no space when collapsed, and opens from the edge handle', () => {
    const props = renderRail({ open: false });

    expect(screen.queryByTestId('file-preview-rail')).toBeNull();
    fireEvent.click(screen.getByTestId('file-preview-rail-toggle'));
    expect(props.onOpen).toHaveBeenCalled();
  });

  it('sits side by side with the conversation on a wide window', () => {
    renderRail();

    const rail = screen.getByTestId('file-preview-rail');
    expect(rail.dataset.mode).toBe('split');
    expect(rail.className).toContain('shrink-0');
    expect(rail.className).not.toContain('absolute');
    expect(rail.style.width).toBe('420px');
  });

  it('floats over the conversation once the window is too narrow to split', () => {
    renderRail();
    expect(screen.getByTestId('file-preview-rail').dataset.mode).toBe('split');

    setWindowWidth(PREVIEW_RAIL_SPLIT_MIN_WINDOW_WIDTH - 1);

    const rail = screen.getByTestId('file-preview-rail');
    expect(rail.dataset.mode).toBe('overlay');
    expect(rail.className).toContain('absolute');
  });

  it('maximizes and restores', () => {
    renderRail();

    fireEvent.click(screen.getByTestId('file-preview-rail-maximize'));
    let rail = screen.getByTestId('file-preview-rail');
    expect(rail.dataset.maximized).toBe('true');
    expect(rail.style.width).toBe('100%');

    fireEvent.click(screen.getByTestId('file-preview-rail-maximize'));
    rail = screen.getByTestId('file-preview-rail');
    expect(rail.dataset.maximized).toBe('false');
    expect(rail.style.width).toBe('420px');
  });

  it('reports a dragged width, clamped to the readable range', () => {
    const props = renderRail();
    const resizer = screen.getByTestId('file-preview-rail-resizer');

    fireEvent.mouseDown(resizer, { clientX: 1000 });
    fireEvent.mouseMove(document, { clientX: 900 });
    expect(props.onWidthChange).toHaveBeenLastCalledWith(520);

    // Dragged past the right edge: never narrower than the minimum.
    fireEvent.mouseMove(document, { clientX: 1600 });
    expect(props.onWidthChange).toHaveBeenLastCalledWith(PREVIEW_RAIL_MIN_WIDTH);

    // Dragged far left: never wider than the maximum.
    fireEvent.mouseMove(document, { clientX: -2000 });
    expect(props.onWidthChange).toHaveBeenLastCalledWith(PREVIEW_RAIL_MAX_WIDTH);

    fireEvent.mouseUp(document);
    props.onWidthChange.mockClear();
    fireEvent.mouseMove(document, { clientX: 100 });
    expect(props.onWidthChange).not.toHaveBeenCalled();
  });

  it('closes from the button and from Escape, but leaves Escape alone inside a text field', () => {
    const props = renderRail();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('file-preview-rail-close'));
    expect(props.onClose).toHaveBeenCalledTimes(2);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(2);
    input.remove();
  });

  it('ignores Escape while collapsed', () => {
    const props = renderRail({ open: false });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('offers both exits for the previewed file', () => {
    const props = renderRail();

    fireEvent.click(screen.getByTestId('file-preview-open-system'));
    expect(invoke).toHaveBeenCalledWith('open-in-default-app', '/ws/plans/a.md');

    fireEvent.click(screen.getByTestId('file-preview-open-in-files'));
    expect(props.onOpenInFiles).toHaveBeenCalledWith('/ws/plans/a.md');
  });

  it('offers a way back to the shelf from a previewed file', () => {
    const props = renderRail();

    fireEvent.click(screen.getByTestId('file-preview-show-shelf'));
    expect(props.onShowShelf).toHaveBeenCalled();
  });

  it('shows the artifact shelf when opened with no file, and says so when it is empty', () => {
    const props = renderRail({ filePath: null });

    const item = screen.getByTestId('file-preview-shelf-item');
    expect(item.getAttribute('data-file-path')).toBe('plans/a.md');
    expect(item.textContent).toContain('Module 1');
    fireEvent.click(item);
    expect(props.onSelectShelfItem).toHaveBeenCalledWith(SHELF[0]);

    cleanup();
    renderRail({ filePath: null, shelfItems: [] });
    expect(screen.getByTestId('file-preview-shelf-empty')).toBeTruthy();
  });
});
