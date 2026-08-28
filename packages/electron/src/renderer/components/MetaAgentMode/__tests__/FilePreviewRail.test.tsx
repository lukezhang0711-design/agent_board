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
const runtimeMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
}));

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span data-material-icon={icon} />,
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
  copyToClipboard: runtimeMocks.copyToClipboard,
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
  runtimeMocks.copyToClipboard.mockReset();
  runtimeMocks.copyToClipboard.mockResolvedValue(undefined);
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

  it('opens the previewed file with the system app and does not render the retired FILES-page exit', () => {
    renderRail();

    fireEvent.click(screen.getByTestId('file-preview-open-system'));
    expect(invoke).toHaveBeenCalledWith('open-in-default-app', '/ws/plans/a.md');
    expect(screen.queryByTestId('file-preview-open-in-files')).toBeNull();
  });

  it('FC green: renders the preview header as a compact icon toolbar and retires the FILES-page exit', () => {
    renderRail({ filePath: '/ws/dashboard.html' });

    const toolbar = screen.getByTestId('file-preview-toolbar');
    expect(screen.queryByTestId('file-preview-open-in-files')).toBeNull();
    expect(toolbar.querySelectorAll('button')).toHaveLength(6);
    expect(screen.getByTestId('file-preview-view-toggle').getAttribute('title')).toBe('查看源码');
    expect(screen.getByTestId('file-preview-find-toggle').getAttribute('title')).toBe('查找');
    expect(screen.getByTestId('file-preview-open-system').getAttribute('title')).toBe('用系统打开');
    expect(screen.getByTestId('file-preview-copy').getAttribute('title')).toBe('复制文件全文');
    expect(screen.getByTestId('file-preview-rail-maximize').getAttribute('title')).toBe('最大化');
    expect(screen.getByTestId('file-preview-rail-close').getAttribute('title')).toBe('关闭');
  });

  it('FC green: copies text files as full content and images as absolute paths with feedback', async () => {
    invoke.mockImplementation((channel: string, ...args: unknown[]) => {
      if (channel === 'read-file-content') {
        const target = args[0];
        if (target === '/ws/checks.sql') {
          return Promise.resolve({ success: true, content: 'SELECT count(*) FROM sessions;', isBinary: false });
        }
        return Promise.resolve({ success: true, content: 'iVBORw0KGgo=', isBinary: true });
      }
      return Promise.resolve({ success: true });
    });

    renderRail({ filePath: '/ws/checks.sql' });
    await screen.findByTestId('file-preview-code');
    invoke.mockClear();

    fireEvent.click(screen.getByTestId('file-preview-copy'));
    await vi.waitFor(() => {
      expect(runtimeMocks.copyToClipboard).toHaveBeenCalledWith('SELECT count(*) FROM sessions;');
    });
    expect(invoke).toHaveBeenCalledWith('read-file-content', '/ws/checks.sql', { binary: false });
    expect(screen.getByTestId('file-preview-copy').getAttribute('title')).toBe('已复制');

    cleanup();
    invoke.mockClear();
    runtimeMocks.copyToClipboard.mockClear();
    renderRail({ filePath: '/ws/shot.png' });
    await screen.findByTestId('file-preview-image');
    invoke.mockClear();

    fireEvent.click(screen.getByTestId('file-preview-copy'));
    await vi.waitFor(() => {
      expect(runtimeMocks.copyToClipboard).toHaveBeenCalledWith('/ws/shot.png');
    });
    expect(invoke).not.toHaveBeenCalledWith('read-file-content', '/ws/shot.png', expect.anything());
    await vi.waitFor(() => {
      expect(screen.getByTestId('file-preview-copy').getAttribute('title')).toBe('已复制');
    });
    expect(screen.getByTestId('file-preview-copy-feedback').textContent).toBe('已复制');
  });

  it('FC green: filters the artifact shelf by filename substring, including Chinese', () => {
    const shelf: ArtifactShelfItem[] = [
      { relativePath: 'reports/2026-08-28-地图批-核对.sql', absolutePath: '/ws/reports/2026-08-28-地图批-核对.sql', sessionTitles: ['地图模块'] },
      { relativePath: 'reports/2026-08-28-auth-check.md', absolutePath: '/ws/reports/2026-08-28-auth-check.md', sessionTitles: ['Auth'] },
    ];
    renderRail({ filePath: null, shelfItems: shelf });

    const input = screen.getByTestId('file-preview-shelf-search-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '地图' } });
    expect(Array.from(screen.getAllByTestId('file-preview-shelf-item')).map((item) => item.getAttribute('data-file-path'))).toEqual([
      'reports/2026-08-28-地图批-核对.sql',
    ]);

    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getAllByTestId('file-preview-shelf-item')).toHaveLength(2);

    fireEvent.change(input, { target: { value: '不存在' } });
    expect(screen.queryAllByTestId('file-preview-shelf-item')).toHaveLength(0);
    expect(screen.getByTestId('file-preview-shelf-no-matches').textContent).toContain('没有匹配的文件');
  });

  it('FC green: finds text inside the preview, highlights matches, and supports Cmd+F plus next/previous', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'read-file-content') {
        return Promise.resolve({ success: true, content: 'SELECT one;\nSELECT two;', isBinary: false });
      }
      return Promise.resolve({ success: true });
    });
    renderRail({ filePath: '/ws/checks.sql' });

    const rail = screen.getByTestId('file-preview-rail');
    rail.focus();
    fireEvent.keyDown(rail, { key: 'f', metaKey: true });
    const input = await screen.findByTestId('file-preview-find-input');
    fireEvent.change(input, { target: { value: 'SELECT' } });

    await vi.waitFor(() => {
      expect(screen.getAllByTestId('file-preview-search-hit')).toHaveLength(2);
    });
    expect(screen.getByTestId('file-preview-find-count').textContent).toBe('1/2');

    fireEvent.click(screen.getByTestId('file-preview-find-next'));
    expect(screen.getByTestId('file-preview-find-count').textContent).toBe('2/2');
    expect(screen.getAllByTestId('file-preview-search-hit')[1].className).toContain('file-preview-search-hit-active');

    fireEvent.click(screen.getByTestId('file-preview-find-previous'));
    expect(screen.getByTestId('file-preview-find-count').textContent).toBe('1/2');
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
