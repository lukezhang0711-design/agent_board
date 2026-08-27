import { describe, expect, it } from 'vitest';
import {
  PREVIEW_HTML_CSP,
  PREVIEW_HTML_SANDBOX,
  PREVIEW_RAIL_DEFAULT_WIDTH,
  PREVIEW_RAIL_MAX_WIDTH,
  PREVIEW_RAIL_MIN_WIDTH,
  PREVIEW_RAIL_SPLIT_MIN_WINDOW_WIDTH,
  buildSandboxedHtmlDoc,
  clampPreviewRailWidth,
  classifyPreviewFile,
  fileName,
  shouldSplitAtWindowWidth,
  toFencedCodeBlock,
} from '../filePreviewFormat';

describe('classifyPreviewFile', () => {
  it('routes each format the work order names', () => {
    expect(classifyPreviewFile('/ws/plan.md').kind).toBe('markdown');
    expect(classifyPreviewFile('/ws/README.markdown').kind).toBe('markdown');
    expect(classifyPreviewFile('/ws/report.html').kind).toBe('html');
    expect(classifyPreviewFile('/ws/report.HTM').kind).toBe('html');
    expect(classifyPreviewFile('/ws/spec.pdf')).toMatchObject({ kind: 'pdf', binary: true });
    expect(classifyPreviewFile('/ws/shot.png')).toMatchObject({ kind: 'image', binary: true, mime: 'image/png' });
    expect(classifyPreviewFile('/ws/logo.svg')).toMatchObject({ kind: 'image', mime: 'image/svg+xml' });
    expect(classifyPreviewFile('/ws/bundle.zip').kind).toBe('other');
  });

  it('gives code files a highlighter language', () => {
    expect(classifyPreviewFile('/ws/checks.sql')).toMatchObject({ kind: 'code', language: 'sql' });
    expect(classifyPreviewFile('/ws/a.ts')).toMatchObject({ kind: 'code', language: 'typescript' });
    expect(classifyPreviewFile('/ws/a.json')).toMatchObject({ kind: 'code', language: 'json' });
    expect(classifyPreviewFile('/ws/run.log').kind).toBe('code');
    expect(classifyPreviewFile('/ws/run.log').language).toBeUndefined();
    expect(classifyPreviewFile('/ws/Makefile')).toMatchObject({ kind: 'code' });
  });

  it('never reads an unpreviewable format as binary', () => {
    expect(classifyPreviewFile('/ws/bundle.zip').binary).toBe(false);
  });

  it('reads the name off either separator', () => {
    expect(fileName('/ws/plans/a.md')).toBe('a.md');
    expect(fileName('C:\\ws\\plans\\a.md')).toBe('a.md');
    expect(fileName('a.md')).toBe('a.md');
  });
});

describe('toFencedCodeBlock', () => {
  it('tags the fence with the language', () => {
    expect(toFencedCodeBlock('SELECT 1;', 'sql')).toBe('```sql\nSELECT 1;\n```');
  });

  it('outgrows any backtick run inside the file', () => {
    const content = 'text\n```js\ncode\n```\nmore';
    const fenced = toFencedCodeBlock(content, 'markdown');
    expect(fenced.startsWith('````markdown\n')).toBe(true);
    expect(fenced.endsWith('\n````')).toBe(true);
    expect(fenced).toContain(content);
  });

  it('handles a file with no language hint', () => {
    expect(toFencedCodeBlock('plain', undefined)).toBe('```\nplain\n```');
  });
});

describe('buildSandboxedHtmlDoc', () => {
  const HOSTILE = '<html><head><script src="https://evil.example.com/x.js"></script></head><body>hi</body></html>';

  it('locks the sandbox down to nothing', () => {
    expect(PREVIEW_HTML_SANDBOX).toBe('');
    for (const capability of [
      'allow-scripts',
      'allow-same-origin',
      'allow-top-navigation',
      'allow-popups',
      'allow-forms',
      'allow-modals',
    ]) {
      expect(PREVIEW_HTML_SANDBOX).not.toContain(capability);
    }
  });

  it('refuses every outbound request in the policy itself', () => {
    expect(PREVIEW_HTML_CSP).toContain("default-src 'none'");
    expect(PREVIEW_HTML_CSP).toContain("script-src 'none'");
    expect(PREVIEW_HTML_CSP).toContain("frame-ancestors 'none'");
    expect(PREVIEW_HTML_CSP).toContain("form-action 'none'");
    expect(PREVIEW_HTML_CSP).toContain("base-uri 'none'");
    // Only inline styling and embedded data are allowed through.
    expect(PREVIEW_HTML_CSP).toContain("img-src data:");
    expect(PREVIEW_HTML_CSP).not.toContain('https:');
    expect(PREVIEW_HTML_CSP).not.toContain('*');
  });

  it('injects the policy ahead of the page own resources', () => {
    const doc = buildSandboxedHtmlDoc(HOSTILE);
    expect(doc.indexOf('Content-Security-Policy')).toBeGreaterThan(-1);
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('evil.example.com'));
  });

  it('adds a head when the file has an <html> but no <head>', () => {
    const doc = buildSandboxedHtmlDoc('<html><body>hi</body></html>');
    expect(doc).toContain('<head>');
    expect(doc).toContain('Content-Security-Policy');
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<body>'));
  });

  it('wraps a bare fragment', () => {
    const doc = buildSandboxedHtmlDoc('<p>fragment</p>');
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('Content-Security-Policy');
    expect(doc).toContain('<p>fragment</p>');
  });

  it('leaves the author markup otherwise intact', () => {
    expect(buildSandboxedHtmlDoc(HOSTILE)).toContain('<script src="https://evil.example.com/x.js"></script>');
  });
});

describe('rail geometry', () => {
  it('clamps to the readable range', () => {
    expect(clampPreviewRailWidth(200)).toBe(PREVIEW_RAIL_MIN_WIDTH);
    expect(clampPreviewRailWidth(5000)).toBe(PREVIEW_RAIL_MAX_WIDTH);
    expect(clampPreviewRailWidth(500.4)).toBe(500);
    expect(clampPreviewRailWidth(Number.NaN)).toBe(PREVIEW_RAIL_DEFAULT_WIDTH);
  });

  it('splits only when the window can hold a sidebar, a conversation, and the rail', () => {
    expect(shouldSplitAtWindowWidth(PREVIEW_RAIL_SPLIT_MIN_WINDOW_WIDTH)).toBe(true);
    expect(shouldSplitAtWindowWidth(PREVIEW_RAIL_SPLIT_MIN_WINDOW_WIDTH - 1)).toBe(false);
    expect(shouldSplitAtWindowWidth(1920)).toBe(true);
    expect(shouldSplitAtWindowWidth(900)).toBe(false);
  });
});
