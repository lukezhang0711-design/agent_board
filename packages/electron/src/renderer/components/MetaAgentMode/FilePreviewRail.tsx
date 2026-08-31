import React, { useCallback, useEffect, useRef, useState } from 'react';
import { copyToClipboard, MaterialSymbol } from '@nimbalyst/runtime';

import { FilePreviewBody } from './FilePreviewBody';
import {
  PREVIEW_RAIL_MAX_WIDTH,
  PREVIEW_RAIL_MIN_WIDTH,
  clampPreviewRailWidth,
  classifyPreviewFile,
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

type HtmlPreviewView = 'render' | 'source';
type CopyState = 'idle' | 'copied' | 'error';

function PreviewIconButton({
  icon,
  title,
  testId,
  onClick,
  active = false,
  disabled = false,
}: {
  icon: string;
  title: string;
  testId: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`file-preview-toolbar-button inline-flex h-7 w-7 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)]'
          : 'text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-tertiary)] hover:text-[var(--nim-text)]'
      }`}
      onClick={onClick}
      title={title}
      aria-label={title}
      data-testid={testId}
      disabled={disabled}
    >
      <MaterialSymbol icon={icon} size={16} />
    </button>
  );
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
}) => {
  const [maximized, setMaximized] = useState(false);
  const [htmlView, setHtmlView] = useState<HtmlPreviewView>('render');
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(0);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [shelfSearchQuery, setShelfSearchQuery] = useState('');
  const isSplit = useIsSplitLayout();
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);

  const previewClassification = filePath ? classifyPreviewFile(filePath) : null;
  const copyFullText = !!previewClassification
    && !previewClassification.binary
    && previewClassification.kind !== 'other';

  const filteredShelfItems = shelfSearchQuery.trim()
    ? shelfItems.filter((item) =>
        fileName(item.relativePath).toLocaleLowerCase().includes(shelfSearchQuery.trim().toLocaleLowerCase()))
    : shelfItems;

  const clearCopyFeedbackTimer = useCallback(() => {
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }
  }, []);

  const flashCopyState = useCallback((state: CopyState) => {
    setCopyState(state);
    clearCopyFeedbackTimer();
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopyState('idle');
      copyFeedbackTimerRef.current = null;
    }, 2000);
  }, [clearCopyFeedbackTimer]);

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

  useEffect(() => {
    setHtmlView('render');
    setFindQuery('');
    setSearchMatchCount(0);
    setActiveSearchMatchIndex(0);
    setCopyState('idle');
    clearCopyFeedbackTimer();
  }, [clearCopyFeedbackTimer, filePath]);

  useEffect(() => () => clearCopyFeedbackTimer(), [clearCopyFeedbackTimer]);

  useEffect(() => {
    if (!findOpen) return;
    const timer = window.setTimeout(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [findOpen]);

  useEffect(() => {
    setActiveSearchMatchIndex(0);
  }, [findQuery, filePath, htmlView]);

  useEffect(() => {
    if (searchMatchCount > 0 && activeSearchMatchIndex >= searchMatchCount) {
      setActiveSearchMatchIndex(0);
    }
  }, [activeSearchMatchIndex, searchMatchCount]);

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

  const openFindBar = useCallback(() => {
    if (!filePath) return;
    setFindOpen(true);
  }, [filePath]);

  const handleRailKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (!filePath) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'f') {
      event.preventDefault();
      event.stopPropagation();
      openFindBar();
    }
  }, [filePath, openFindBar]);

  const handleCopy = useCallback(async () => {
    if (!filePath) return;
    try {
      let payload = filePath;
      if (copyFullText) {
        const result = await window.electronAPI.invoke('read-file-content', filePath, { binary: false });
        if (result === null || result === undefined || result.success === false) {
          throw new Error(result?.error || '读取失败');
        }
        payload = typeof result.content === 'string' ? result.content : '';
      }
      await copyToClipboard(payload);
      flashCopyState('copied');
    } catch (error) {
      console.error('[FilePreviewRail] Failed to copy preview payload:', error);
      flashCopyState('error');
    }
  }, [copyFullText, filePath, flashCopyState]);

  const goToNextSearchMatch = useCallback(() => {
    if (searchMatchCount <= 0) return;
    setActiveSearchMatchIndex((current) => (current + 1) % searchMatchCount);
  }, [searchMatchCount]);

  const goToPreviousSearchMatch = useCallback(() => {
    if (searchMatchCount <= 0) return;
    setActiveSearchMatchIndex((current) => (current - 1 + searchMatchCount) % searchMatchCount);
  }, [searchMatchCount]);

  const searchCountLabel = findQuery.trim()
    ? searchMatchCount > 0
      ? `${activeSearchMatchIndex + 1}/${searchMatchCount}`
      : '0/0'
    : '';

  const copyTitle = copyState === 'copied'
    ? '已复制'
    : copyState === 'error'
      ? '复制失败'
      : copyFullText
        ? '复制文件全文'
        : '复制文件路径';

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
      tabIndex={-1}
      onKeyDownCapture={handleRailKeyDown}
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

      <header className="relative shrink-0 border-b border-nim px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[var(--nim-text)]" data-testid="file-preview-title">
              {filePath ? fileName(filePath) : '本会话产物架'}
            </div>
            <div className="flex min-w-0 items-center gap-1 text-[11px] text-[var(--nim-text-faint)]" data-testid="file-preview-path-row">
              {filePath ? (
                <>
                  <button
                    type="button"
                    className="file-preview-show-shelf-link shrink-0 rounded-sm hover:text-[var(--nim-text)]"
                    onClick={onShowShelf}
                    title="回到本会话产物架"
                    aria-label="回到本会话产物架"
                    data-testid="file-preview-show-shelf"
                  >
                    产物架
                  </button>
                  <span className="shrink-0">/</span>
                  <span className="truncate" data-testid="file-preview-path">{filePath}</span>
                </>
              ) : (
                <span className="truncate" data-testid="file-preview-path">本 Head 名下工人交付或改过的文件</span>
              )}
            </div>
          </div>
          <div className="file-preview-toolbar flex shrink-0 items-center gap-1" role="toolbar" aria-label="预览操作" data-testid="file-preview-toolbar">
            {filePath && previewClassification?.kind === 'html' && (
              <PreviewIconButton
                icon={htmlView === 'render' ? 'code' : 'preview'}
                title={htmlView === 'render' ? '查看源码' : '查看渲染'}
                testId="file-preview-view-toggle"
                onClick={() => setHtmlView((current) => current === 'render' ? 'source' : 'render')}
                active={htmlView === 'source'}
              />
            )}
            {filePath && (
              <PreviewIconButton
                icon="search"
                title="查找"
                testId="file-preview-find-toggle"
                onClick={openFindBar}
                active={findOpen}
              />
            )}
            {filePath && (
              <PreviewIconButton
                icon="open_in_new"
                title="用系统打开"
                testId="file-preview-open-system"
                onClick={() => handleOpenWithSystem(filePath)}
              />
            )}
            {filePath && (
              <PreviewIconButton
                icon={copyState === 'copied' ? 'done' : 'content_copy'}
                title={copyTitle}
                testId="file-preview-copy"
                onClick={handleCopy}
              />
            )}
            {copyState !== 'idle' && (
              <span
                className="pointer-events-none absolute right-14 top-9 z-10 rounded border border-nim bg-[var(--nim-bg)] px-2 py-0.5 text-[11px] text-[var(--nim-text)] shadow"
                data-testid="file-preview-copy-feedback"
              >
                {copyState === 'copied' ? '已复制' : '复制失败'}
              </span>
            )}
            <PreviewIconButton
              icon={maximized ? 'close_fullscreen' : 'open_in_full'}
              title={maximized ? '还原' : '最大化'}
              testId="file-preview-rail-maximize"
              onClick={() => setMaximized((current) => !current)}
            />
            <PreviewIconButton
              icon="close"
              title="关闭"
              testId="file-preview-rail-close"
              onClick={onClose}
            />
          </div>
        </div>

        {filePath && findOpen && (
          <div className="file-preview-find-bar mt-2 flex items-center gap-1" data-testid="file-preview-find-bar">
            <MaterialSymbol icon="search" size={15} className="shrink-0 text-[var(--nim-text-faint)]" />
            <input
              ref={findInputRef}
              type="search"
              className="min-w-0 flex-1 rounded border border-nim bg-[var(--nim-bg)] px-2 py-1 text-xs text-[var(--nim-text)] outline-none focus:border-[var(--nim-border-focus)]"
              placeholder="查找文件内容"
              value={findQuery}
              onChange={(event) => setFindQuery(event.currentTarget.value)}
              data-testid="file-preview-find-input"
            />
            <span className="w-10 text-center text-[11px] text-[var(--nim-text-faint)]" data-testid="file-preview-find-count">
              {searchCountLabel}
            </span>
            <PreviewIconButton
              icon="keyboard_arrow_up"
              title="上一个"
              testId="file-preview-find-previous"
              onClick={goToPreviousSearchMatch}
              disabled={searchMatchCount === 0}
            />
            <PreviewIconButton
              icon="keyboard_arrow_down"
              title="下一个"
              testId="file-preview-find-next"
              onClick={goToNextSearchMatch}
              disabled={searchMatchCount === 0}
            />
            <PreviewIconButton
              icon="close"
              title="关闭查找"
              testId="file-preview-find-close"
              onClick={() => {
                setFindOpen(false);
                setFindQuery('');
              }}
            />
          </div>
        )}
      </header>

      <div className="file-preview-rail-content min-h-0 flex-1 overflow-auto">
        {filePath ? (
          <FilePreviewBody
            key={filePath}
            filePath={filePath}
            onOpenWithSystem={handleOpenWithSystem}
            htmlView={htmlView}
            searchQuery={findQuery}
            activeSearchMatchIndex={activeSearchMatchIndex}
            onSearchMatchCountChange={setSearchMatchCount}
          />
        ) : (
          <div className="file-preview-shelf select-text p-3" data-testid="file-preview-shelf">
            {shelfLoading && shelfItems.length === 0 ? (
              <div className="px-3 py-4 text-sm text-[var(--nim-text-muted)]" data-testid="file-preview-shelf-loading">
                正在读取本会话的产物…
              </div>
            ) : shelfItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-nim px-3 py-4 text-sm text-[var(--nim-text-muted)]" data-testid="file-preview-shelf-empty">
                这个 Head 还没有工人交付的文件。
              </div>
            ) : (
              <>
                <div className="file-preview-shelf-search mb-2 flex items-center gap-1 rounded border border-nim bg-[var(--nim-bg)] px-2 py-1">
                  <MaterialSymbol icon="search" size={15} className="shrink-0 text-[var(--nim-text-faint)]" />
                  <input
                    type="search"
                    className="min-w-0 flex-1 bg-transparent text-xs text-[var(--nim-text)] outline-none"
                    placeholder="按文件名搜索"
                    value={shelfSearchQuery}
                    onChange={(event) => setShelfSearchQuery(event.currentTarget.value)}
                    data-testid="file-preview-shelf-search-input"
                  />
                </div>
                {filteredShelfItems.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-nim px-3 py-4 text-sm text-[var(--nim-text-muted)]" data-testid="file-preview-shelf-no-matches">
                    没有匹配的文件
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {filteredShelfItems.map((item) => (
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
              </>
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
