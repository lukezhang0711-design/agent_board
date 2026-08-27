import React, { useEffect, useMemo, useState } from 'react';
import { MarkdownRenderer } from '@nimbalyst/runtime';

import {
  PREVIEW_HTML_SANDBOX,
  buildSandboxedHtmlDoc,
  classifyPreviewFile,
  fileName,
  toFencedCodeBlock,
} from './filePreviewFormat';

interface FilePreviewBodyProps {
  /** Absolute path of the file being previewed. */
  filePath: string;
  /** Hands the file to the OS default application. */
  onOpenWithSystem: (filePath: string) => void;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; content: string };

async function readPreviewFile(filePath: string, binary: boolean): Promise<LoadState> {
  const result = await window.electronAPI.invoke('read-file-content', filePath, { binary });
  // The handler answers `null` for a path that is not on disk (or a virtual
  // path). That is the "gone or moved" case, not an error.
  if (result === null || result === undefined) {
    return { phase: 'missing' };
  }
  if (result.success === false) {
    return { phase: 'error', message: result.error || '读取失败' };
  }
  return { phase: 'ready', content: typeof result.content === 'string' ? result.content : '' };
}

/** Chromium renders PDFs from a blob URL; a data: URL is not reliable here. */
function useObjectUrl(base64: string | null, mime: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!base64 || !mime) {
      setUrl(null);
      return undefined;
    }
    let objectUrl: string | null = null;
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      setUrl(objectUrl);
    } catch (error) {
      console.warn('[FilePreviewBody] Failed to build an object URL for the preview:', error);
      setUrl(null);
      return undefined;
    }
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [base64, mime]);

  return url;
}

function OpenWithSystemButton({
  filePath,
  onOpenWithSystem,
  label = '用系统打开',
}: {
  filePath: string;
  onOpenWithSystem: (filePath: string) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="nim-btn-secondary rounded px-2.5 py-1 text-xs"
      onClick={() => onOpenWithSystem(filePath)}
      data-testid="file-preview-open-system-fallback"
    >
      {label}
    </button>
  );
}

export const FilePreviewBody: React.FC<FilePreviewBodyProps> = ({ filePath, onOpenWithSystem }) => {
  const classification = useMemo(() => classifyPreviewFile(filePath), [filePath]);
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [htmlView, setHtmlView] = useState<'render' | 'source'>('render');

  useEffect(() => {
    setHtmlView('render');
  }, [filePath]);

  useEffect(() => {
    let disposed = false;
    setState({ phase: 'loading' });

    // `other` files are never read: the point of that branch is to say "this
    // format has no preview, open it outside" without slurping a binary blob
    // into the renderer.
    if (classification.kind === 'other') {
      setState({ phase: 'ready', content: '' });
      return () => { disposed = true; };
    }

    readPreviewFile(filePath, classification.binary)
      .then((next) => { if (!disposed) setState(next); })
      .catch((error) => {
        if (disposed) return;
        console.error('[FilePreviewBody] Failed to read', filePath, error);
        setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
      });

    return () => { disposed = true; };
  }, [classification.binary, classification.kind, filePath]);

  const readyContent = state.phase === 'ready' ? state.content : null;
  const binaryUrl = useObjectUrl(
    classification.binary && readyContent ? readyContent : null,
    classification.mime,
  );

  if (state.phase === 'loading') {
    return (
      <div className="px-4 py-6 text-sm text-[var(--nim-text-muted)]" data-testid="file-preview-loading">
        正在读取 {fileName(filePath)}…
      </div>
    );
  }

  if (state.phase === 'missing') {
    return (
      <div
        className="file-preview-body file-preview-missing select-text m-3 rounded-lg border border-dashed border-[var(--nim-warning)] px-4 py-4 text-sm text-[var(--nim-warning)]"
        data-testid="file-preview-missing"
      >
        <div className="font-medium">文件不存在或已移动：</div>
        <div className="mt-1 break-all font-mono text-xs">{filePath}</div>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div
        className="file-preview-body file-preview-error select-text m-3 rounded-lg border border-[var(--nim-error)] px-4 py-4 text-sm text-[var(--nim-error)]"
        data-testid="file-preview-error"
      >
        <div className="font-medium">无法读取这个文件：</div>
        <div className="mt-1 break-all font-mono text-xs">{filePath}</div>
        <div className="mt-1">{state.message}</div>
        <div className="mt-3">
          <OpenWithSystemButton filePath={filePath} onOpenWithSystem={onOpenWithSystem} />
        </div>
      </div>
    );
  }

  const content = state.content;

  if (classification.kind === 'markdown') {
    return (
      <div className="file-preview-body markdown-content select-text px-4 py-3 text-sm" data-testid="file-preview-markdown">
        <MarkdownRenderer content={content} />
      </div>
    );
  }

  if (classification.kind === 'image') {
    return (
      <div className="file-preview-body file-preview-body-image flex h-full items-start justify-center overflow-auto p-3">
        <img
          src={binaryUrl ?? `data:${classification.mime};base64,${content}`}
          alt={fileName(filePath)}
          className="max-w-full"
          data-testid="file-preview-image"
        />
      </div>
    );
  }

  if (classification.kind === 'pdf') {
    if (!binaryUrl) {
      return (
        <div className="file-preview-body select-text m-3 rounded-lg border border-nim px-4 py-4 text-sm text-[var(--nim-text-muted)]" data-testid="file-preview-pdf-fallback">
          <div>这份 PDF 没法在面板里渲染。</div>
          <div className="mt-1 break-all font-mono text-xs">{filePath}</div>
          <div className="mt-3">
            <OpenWithSystemButton filePath={filePath} onOpenWithSystem={onOpenWithSystem} />
          </div>
        </div>
      );
    }
    return (
      <iframe
        title={fileName(filePath)}
        src={binaryUrl}
        className="h-full w-full border-0"
        data-testid="file-preview-pdf"
      />
    );
  }

  if (classification.kind === 'html') {
    return (
      <div className="file-preview-body file-preview-body-html flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b border-nim px-3 py-1.5">
          <button
            type="button"
            className={`rounded px-2 py-0.5 text-xs ${htmlView === 'render' ? 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)]' : 'text-[var(--nim-text-muted)]'}`}
            onClick={() => setHtmlView('render')}
            data-testid="file-preview-html-mode-render"
            data-active={htmlView === 'render' ? 'true' : 'false'}
          >
            渲染
          </button>
          <button
            type="button"
            className={`rounded px-2 py-0.5 text-xs ${htmlView === 'source' ? 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)]' : 'text-[var(--nim-text-muted)]'}`}
            onClick={() => setHtmlView('source')}
            data-testid="file-preview-html-mode-source"
            data-active={htmlView === 'source' ? 'true' : 'false'}
          >
            源码
          </button>
          <span className="ml-2 text-[11px] text-[var(--nim-text-faint)]" data-testid="file-preview-html-sandbox-note">
            沙箱渲染：脚本与外联资源已禁用
          </span>
        </div>
        {htmlView === 'render' ? (
          <iframe
            title={fileName(filePath)}
            sandbox={PREVIEW_HTML_SANDBOX}
            referrerPolicy="no-referrer"
            srcDoc={buildSandboxedHtmlDoc(content)}
            className="min-h-0 flex-1 border-0 bg-white"
            data-testid="file-preview-html-frame"
          />
        ) : (
          <div className="file-preview-body markdown-content select-text min-h-0 flex-1 overflow-auto px-3 py-2 text-sm" data-testid="file-preview-html-source">
            <MarkdownRenderer content={toFencedCodeBlock(content, 'markup')} />
          </div>
        )}
      </div>
    );
  }

  if (classification.kind === 'code') {
    return (
      <div
        className="file-preview-body markdown-content select-text px-3 py-2 text-sm"
        data-testid="file-preview-code"
        data-language={classification.language ?? ''}
      >
        <MarkdownRenderer content={toFencedCodeBlock(content, classification.language)} />
      </div>
    );
  }

  return (
    <div className="file-preview-body file-preview-unsupported select-text m-3 rounded-lg border border-nim px-4 py-4 text-sm text-[var(--nim-text-muted)]" data-testid="file-preview-unsupported">
      <div>这个格式没法在面板里预览。</div>
      <div className="mt-1 break-all font-mono text-xs">{filePath}</div>
      <div className="mt-3">
        <OpenWithSystemButton filePath={filePath} onOpenWithSystem={onOpenWithSystem} />
      </div>
    </div>
  );
};
