// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FilePreviewBody } from '../FilePreviewBody';
import { PREVIEW_HTML_SANDBOX } from '../filePreviewFormat';

const invoke = vi.fn();

/** An HTML fixture that tries to pull a script off the network. */
const HOSTILE_HTML = [
  '<!doctype html>',
  '<html><head><title>Report</title>',
  '<script src="https://evil.example.com/beacon.js"></script>',
  '</head>',
  '<body><h1>Quarterly report</h1></body></html>',
].join('\n');

// jsdom ships neither observer; the transcript markdown renderer uses them to
// lazily measure long code blocks.
class StubObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

let files: Record<string, { content: string; isBinary?: boolean } | null>;

beforeEach(() => {
  const globals = globalThis as unknown as {
    IntersectionObserver: unknown;
    ResizeObserver: unknown;
  };
  globals.IntersectionObserver = StubObserver;
  globals.ResizeObserver = StubObserver;
  files = {};
  invoke.mockReset();
  invoke.mockImplementation((channel: string, ...args: unknown[]) => {
    if (channel === 'read-file-content') {
      const entry = files[args[0] as string];
      if (!entry) return Promise.resolve(null);
      return Promise.resolve({ success: true, content: entry.content, isBinary: !!entry.isBinary });
    }
    return Promise.resolve({ success: true });
  });
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { invoke },
  });
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.clearAllMocks();
});

function renderBody(
  filePath: string,
  onOpenWithSystem = vi.fn(),
  props: Partial<React.ComponentProps<typeof FilePreviewBody>> = {},
) {
  render(<FilePreviewBody filePath={filePath} onOpenWithSystem={onOpenWithSystem} {...props} />);
  return onOpenWithSystem;
}

describe('FilePreviewBody formats', () => {
  it('renders markdown instead of showing its source', async () => {
    files['/ws/report.md'] = { content: '# Quarterly report\n\nBody text.' };
    renderBody('/ws/report.md');

    const container = await screen.findByTestId('file-preview-markdown');
    const heading = container.querySelector('h1');
    expect(heading?.textContent).toBe('Quarterly report');
    expect(container.textContent).not.toContain('# Quarterly report');
  });

  it('syntax-highlights code, including .sql', async () => {
    files['/ws/checks.sql'] = { content: 'SELECT count(*) FROM sessions;' };
    renderBody('/ws/checks.sql');

    const container = await screen.findByTestId('file-preview-code');
    expect(container.dataset.language).toBe('sql');
    expect(container.textContent).toContain('SELECT count(*) FROM sessions;');
    // react-syntax-highlighter emits Prism token spans; a dead <pre> would not.
    await waitFor(() => expect(container.querySelectorAll('.token').length).toBeGreaterThan(0));
  });

  it('shows an image inline', async () => {
    // 1x1 transparent PNG.
    files['/ws/shot.png'] = {
      content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      isBinary: true,
    };
    renderBody('/ws/shot.png');

    const image = await screen.findByTestId('file-preview-image');
    expect(image.getAttribute('src') ?? '').toMatch(/^(blob:|data:image\/png;base64,)/);
    expect(invoke).toHaveBeenCalledWith('read-file-content', '/ws/shot.png', { binary: true });
  });

  it('renders HTML inside a locked-down sandbox and can flip to source', async () => {
    files['/ws/dashboard.html'] = { content: HOSTILE_HTML };
    const onOpenWithSystem = vi.fn();
    const { rerender } = render(
      <FilePreviewBody filePath="/ws/dashboard.html" onOpenWithSystem={onOpenWithSystem} htmlView="render" />,
    );

    const frame = (await screen.findByTestId('file-preview-html-frame')) as HTMLIFrameElement;

    // Reverse assertions: the frame may not run scripts, may not claim the
    // host's origin, and may not navigate the window around the user.
    expect(frame.getAttribute('sandbox')).toBe(PREVIEW_HTML_SANDBOX);
    expect(frame.getAttribute('sandbox')).toBe('');
    const sandbox = frame.getAttribute('sandbox') ?? '';
    expect(sandbox).not.toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    expect(sandbox).not.toContain('allow-top-navigation');
    expect(sandbox).not.toContain('allow-popups');
    expect(sandbox).not.toContain('allow-forms');

    // Second lock: the injected CSP refuses every outbound request, so the
    // fixture's external script cannot be fetched even if the sandbox is
    // loosened later by mistake.
    const srcDoc = frame.getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('Content-Security-Policy');
    expect(srcDoc).toContain("default-src 'none'");
    expect(srcDoc).toContain("script-src 'none'");
    expect(srcDoc).toContain("frame-ancestors 'none'");
    // The CSP is injected ahead of the page's own script reference.
    expect(srcDoc.indexOf('Content-Security-Policy')).toBeLessThan(
      srcDoc.indexOf('https://evil.example.com/beacon.js'),
    );

    rerender(<FilePreviewBody filePath="/ws/dashboard.html" onOpenWithSystem={onOpenWithSystem} htmlView="source" />);
    const source = await screen.findByTestId('file-preview-html-source');
    expect(source.textContent).toContain('https://evil.example.com/beacon.js');
    expect(screen.queryByTestId('file-preview-html-frame')).toBeNull();

    rerender(<FilePreviewBody filePath="/ws/dashboard.html" onOpenWithSystem={onOpenWithSystem} htmlView="render" />);
    expect(await screen.findByTestId('file-preview-html-frame')).toBeTruthy();
  });

  it('says so, visibly, when the file is not on disk', async () => {
    renderBody('/ws/vanished.md');

    const missing = await screen.findByTestId('file-preview-missing');
    expect(missing.textContent).toContain('文件不存在或已移动');
    expect(missing.textContent).toContain('/ws/vanished.md');
  });

  it('offers the system app for a format it cannot preview', async () => {
    const onOpenWithSystem = renderBody('/ws/bundle.zip');

    const card = await screen.findByTestId('file-preview-unsupported');
    expect(card.textContent).toContain('/ws/bundle.zip');
    // An unpreviewable file is never slurped into the renderer.
    expect(invoke).not.toHaveBeenCalledWith('read-file-content', '/ws/bundle.zip', expect.anything());

    fireEvent.click(screen.getByTestId('file-preview-open-system-fallback'));
    expect(onOpenWithSystem).toHaveBeenCalledWith('/ws/bundle.zip');
  });

  it('falls back to the system app when a PDF cannot be embedded', async () => {
    files['/ws/spec.pdf'] = { content: 'JVBERi0xLjQK', isBinary: true };
    const onOpenWithSystem = renderBody('/ws/spec.pdf');

    // jsdom has no blob URL support, which is exactly the "cannot embed" path.
    const fallback = await screen.findByTestId('file-preview-pdf-fallback');
    expect(fallback.textContent).toContain('/ws/spec.pdf');
    fireEvent.click(screen.getByTestId('file-preview-open-system-fallback'));
    expect(onOpenWithSystem).toHaveBeenCalledWith('/ws/spec.pdf');
  });
});
