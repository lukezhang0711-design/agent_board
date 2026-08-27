import { describe, expect, it } from 'vitest';
import { resolveTranscriptFilePathFromHref } from '../MarkdownRenderer';

describe('resolveTranscriptFilePathFromHref', () => {
  it('resolves unix absolute file paths', () => {
    expect(resolveTranscriptFilePathFromHref('/Users/test/project/src/file.ts')).toBe(
      '/Users/test/project/src/file.ts'
    );
  });

  it('strips line and column suffixes from file paths', () => {
    expect(resolveTranscriptFilePathFromHref('/Users/test/project/src/file.ts:42:7')).toBe(
      '/Users/test/project/src/file.ts'
    );
  });

  it('resolves file:// links and decodes path segments', () => {
    expect(resolveTranscriptFilePathFromHref('file:///Users/test/My%20Project/prompt.ts')).toBe(
      '/Users/test/My Project/prompt.ts'
    );
  });

  it('returns null for external web links', () => {
    expect(resolveTranscriptFilePathFromHref('https://nimbalyst.com/docs')).toBeNull();
  });

  // A bare path written in prose has always been clickable (the autolink
  // plugin marks it and the renderer joins it against the session's working
  // directory). The same path written as a markdown link used to be dead,
  // which is what made Head-written file links unopenable.
  it('resolves workspace-relative link targets', () => {
    expect(resolveTranscriptFilePathFromHref('src/ai/prompt.ts')).toBe('src/ai/prompt.ts');
    expect(resolveTranscriptFilePathFromHref('./docs/guide.md')).toBe('./docs/guide.md');
    expect(resolveTranscriptFilePathFromHref('report.sql')).toBe('report.sql');
    expect(resolveTranscriptFilePathFromHref('src/ai/prompt.ts:42')).toBe('src/ai/prompt.ts');
  });

  it('decodes a relative target whose segments are percent-encoded', () => {
    expect(resolveTranscriptFilePathFromHref('%E8%AF%8A%E6%96%AD%E6%8A%A5%E5%91%8A/a.sql')).toBe(
      '诊断报告/a.sql',
    );
  });

  it('still leaves in-document and extension-less link targets alone', () => {
    expect(resolveTranscriptFilePathFromHref('#section')).toBeNull();
    expect(resolveTranscriptFilePathFromHref('docs')).toBeNull();
    expect(resolveTranscriptFilePathFromHref('mailto:someone@example.com')).toBeNull();
    expect(resolveTranscriptFilePathFromHref('//cdn.example.com/x.js')).toBeNull();
  });

  // Claude Code emits markdown links with an `/abs/path/` prefix on
  // top of the real filesystem path. The reporter on #240 confirmed
  // these links failed to open on Windows because the literal path
  // does not exist. Strip the prefix before the absolute-path check
  // so the IPC handler receives the real on-disk path.
  it('strips /abs/path/ prefix on Windows-style paths', () => {
    expect(
      resolveTranscriptFilePathFromHref('/abs/path/C:/Users/test/project/src/file.ts')
    ).toBe('C:/Users/test/project/src/file.ts');
  });

  it('strips /abs/path/ prefix and line:column suffix on Windows-style paths', () => {
    expect(
      resolveTranscriptFilePathFromHref('/abs/path/C:/Users/test/project/src/file.ts:236')
    ).toBe('C:/Users/test/project/src/file.ts');
  });

  it('strips /abs/path/ prefix on macOS-style paths', () => {
    expect(
      resolveTranscriptFilePathFromHref('/abs/path//Users/test/project/src/file.ts')
    ).toBe('/Users/test/project/src/file.ts');
  });

  it('strips /abs/path/ prefix with line:column on macOS-style paths', () => {
    expect(
      resolveTranscriptFilePathFromHref('/abs/path//Users/test/project/src/file.ts:42:7')
    ).toBe('/Users/test/project/src/file.ts');
  });

  it('returns null when /abs/path/ wraps a non-absolute remainder', () => {
    // After stripping the prefix we have `relative/file.ts` which is not
    // an absolute filesystem path, so the renderer should leave it for
    // the default link handler rather than route it through workspace
    // file-open.
    expect(
      resolveTranscriptFilePathFromHref('/abs/path/relative/file.ts')
    ).toBeNull();
  });

  it('leaves non-/abs/path/ absolute paths untouched', () => {
    expect(
      resolveTranscriptFilePathFromHref('/Users/test/normal/file.ts')
    ).toBe('/Users/test/normal/file.ts');
  });
});
