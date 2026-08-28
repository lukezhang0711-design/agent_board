import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

import { FilePreviewBody } from './FilePreviewBody';
import {
  PREVIEW_RAIL_MAX_WIDTH,
  PREVIEW_RAIL_MIN_WIDTH,
  clampPreviewRailWidth,
  fileName,
  shouldSplitAtWindowWidth,
} from './filePreviewFormat';

/** One file delivered (or edited) by a worker under this Head. */
export interface ArtifactShelfItem {
  /** Workspace-relative path, as recorded on the work order. */
  relativePath: string;
  /** Absolute path used for reading and for OS/editor hand-off. */
  absolutePath: string;
  /** Titles of the child sessions that touched this file. */
  sessionTitles: string[];
}

interface FilePreviewRailProps {
  open: boolean;
  /** Absolute path currently previewed; `null` shows the artifact shelf. */
  filePath: string | null;
  width: number;
  onWidthChange: (width: number) => void;
  onOpen: () => void;
  onClose: () => void;
  shelfItems: ArtifactShelfItem[];
  /** True while the Head's child sessions are still being fetched. */
  shelfLoading?: boolean;
  onSelectShelfItem: (item: ArtifactShelfItem) => void;
  /** Drops back from a previewed file to the artifact shelf. */
  onShowShelf: () => void;
  /** Hands the file to the FILES page for editing. */
  onOpenInFiles?: (absolutePath: string) => void;
}

/**
 * True when the keystroke came from somewhere that owns Escape itself
 * (a text field, a rename box). The rail must not eat those.
 */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

function useIsSplitLayout(): boolean {
  const [isSplit, setIsSplit] = useState(() =>
    shouldSplitAtWindowWidth(typeof window === 'undefined' ? Number.MAX_SAFE_INTEGER : window.innerWidth),
  );

  useEffect(() => {
    const onResize = () => setIsSplit(shouldSplitAtWindowWidth(window.innerWidth));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return isSplit;
}

export const FilePreviewRail: React.FC<FilePreviewRailProps> = ({
  open,
  filePath,
  width,
  onWidthChange,
  onOpen,
  onClose,
  shelfItems,
  shelfLoading = false,
  onSelectShelfItem,
  onShowShelf,
  onOpenInFiles,
}) => {
  const [maximized, setMaximized] = useState(false);
  const isSplit = useIsSplitLayout();
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Escape collapses the rail. The last previewed file is kept by the parent,
  // so reopening lands back on the same file rather than on an empty shelf.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isTextEntryTarget(event.target)) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) setMaximized(false);
  }, [open]);

  const handleResizeStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    dragStateRef.current = { startX: event.clientX, startWidth: width };

    const onMove = (moveEvent: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      // The rail is anchored right: dragging left widens it.
      onWidthChange(clampPreviewRailWidth(drag.startWidth + (drag.startX - moveEvent.clientX)));
    };
    const onUp = () => {
      dragStateRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [onWidthChange, width]);

  const handleOpenWithSystem = useCallback((target: string) => {
    void window.electronAPI.invoke('open-in-default-app', target).catch((error: unknown) => {
      console.error('[FilePreviewRail] Failed to open file with the system app:', error);
    });
  }, []);

  if (!open) {
    // Fully collapsed: the rail takes no column and no space. The only trace
    // is a slim edge handle floating over the conversation's right border.
    return (
      <button
        type="button"
        className="file-preview-rail-toggle absolute right-0 top-1/2 z-20 -translate-y-1/2 rounded-l-md border border-r-0 border-nim bg-[var(--nim-bg-secondary)] px-1 py-3 text-[var(--nim-text-muted)] hover:text-[var(--nim-text)]"
        onClick={onOpen}
        title="打开文件预览"
        aria-label="打开文件预览"
        data-testid="file-preview-rail-toggle"
      >
        <MaterialSymbol icon="chevron_left" size={16} />
      </button>
    );
  }

  const railStyle: React.CSSProperties = maximized
    ? { width: '100%' }
    : { width: `${clampPreviewRailWidth(width)}px` };

  const railClassName = [
    'file-preview-rail flex min-h-0 flex-col bg-[var(--nim-bg-secondary)]',
    isSplit && !maximized ? 'relative shrink-0 border-l border-nim' : '',
    !isSplit || maximized ? 'absolute inset-y-0 right-0 z-30 border-l border-nim shadow-2xl' : '',
  ].filter(Boolean).join(' ');

  return (
    <aside
      className={railClassName}
      style={railStyle}
      data-testid="file-preview-rail"
      data-mode={isSplit && !maximized ? 'split' : 'overlay'}
      data-maximized={maximized ? 'true' : 'false'}
      data-width={clampPreviewRailWidth(width)}
      aria-label="文件预览"
    >
      {/* A maximized rail has no width to drag. */}
      {!maximized && (
        <div
          className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-[var(--nim-primary)]"
          onMouseDown={handleResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整预览面板宽度"
          data-testid="file-preview-rail-resizer"
        />
      )}

      <header className="shrink-0 border-b border-nim px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[var(--nim-text)]" data-testid="file-preview-title">
              {filePath ? fileName(filePath) : '本会话产物架'}
            </div>
            <div className="truncate text-[11px] text-[var(--nim-text-faint)]" data-testid="file-preview-path">
              {filePath ?? '本 Head 名下工人交付或改过的文件'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="rounded p-1 text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-tertiary)] hover:text-[var(--nim-text)]"
              onClick={() => setMaximized((current) => !current)}
              title={maximized ? '还原' : '最大化'}
              aria-label={maximized ? '还原' : '最大化'}
              data-testid="file-preview-rail-maximize"
            >
              <MaterialSymbol icon={maximized ? 'close_fullscreen' : 'open_in_full'} size={16} />
            </button>
            <button
              type="button"
              className="rounded p-1 text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-tertiary)] hover:text-[var(--nim-text)]"
              onClick={onClose}
              title="收起"
              aria-label="收起文件预览"
              data-testid="file-preview-rail-close"
            >
              <MaterialSymbol icon="close" size={16} />
            </button>
          </div>
        </div>

        {filePath && (
          <div className="mt-2 flex items-center gap-2">
            {/* Without this, the shelf is unreachable once a file has been
                previewed: reopening the rail restores the last file. */}
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-xs text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-tertiary)] hover:text-[var(--nim-text)]"
              onClick={onShowShelf}
              title="回到本会话产物架"
              data-testid="file-preview-show-shelf"
            >
              产物架
            </button>
            <button
              type="button"
              className="nim-btn-secondary rounded px-2 py-0.5 text-xs"
              onClick={() => handleOpenWithSystem(filePath)}
              data-testid="file-preview-open-system"
            >
              用系统打开
            </button>
            <button
              type="button"
              className="nim-btn-secondary rounded px-2 py-0.5 text-xs disabled:opacity-50"
              onClick={() => onOpenInFiles?.(filePath)}
              disabled={!onOpenInFiles}
              data-testid="file-preview-open-in-files"
            >
              在 FILES 页打开
            </button>
          </div>
        )}
      </header>

      <div className="file-preview-rail-content min-h-0 flex-1 overflow-auto">
        {filePath ? (
          <FilePreviewBody
            key={filePath}
            filePath={filePath}
            onOpenWithSystem={handleOpenWithSystem}
          />
        ) : (
          <div className="file-preview-shelf select-text p-3" data-testid="file-preview-shelf">
            {shelfLoading && shelfItems.length === 0 ? (
              <div className="px-3 py-4 text-sm text-[var(--nim-text-muted)]" data-testid="file-preview-shelf-loading">
                正在读取本会话的产物…
              </div>
            ) : shelfItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-nim px-3 py-4 text-sm text-[var(--nim-text-muted)]" data-testid="file-preview-shelf-empty">
                这个 Head 还没有工人交付的文件。工人改过或写出的文件会自动排到这里。
              </div>
            ) : (
              <ul className="space-y-1">
                {shelfItems.map((item) => (
                  <li key={item.relativePath}>
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-1.5 text-left hover:bg-[var(--nim-bg-tertiary)]"
                      onClick={() => onSelectShelfItem(item)}
                      data-testid="file-preview-shelf-item"
                      data-file-path={item.relativePath}
                    >
                      <div className="truncate text-xs text-[var(--nim-text)]">{item.relativePath}</div>
                      {item.sessionTitles.length > 0 && (
                        <div className="truncate text-[11px] text-[var(--nim-text-faint)]">
                          {item.sessionTitles.join(' · ')}
                        </div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-nim px-3 py-1 text-[10px] text-[var(--nim-text-faint)]">
        宽度 {clampPreviewRailWidth(width)}px（{PREVIEW_RAIL_MIN_WIDTH}–{PREVIEW_RAIL_MAX_WIDTH}）· Esc 收起
      </footer>
    </aside>
  );
};
