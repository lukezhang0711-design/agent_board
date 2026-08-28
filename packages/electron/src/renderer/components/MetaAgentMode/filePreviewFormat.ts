/**
 * Pure helpers for the Head workbench file-preview rail.
 *
 * Kept free of React and IPC so the security-critical parts (the HTML sandbox
 * document, in particular) can be asserted directly in unit tests.
 */

export type PreviewKind = 'markdown' | 'code' | 'html' | 'image' | 'pdf' | 'other';

export interface PreviewClassification {
  kind: PreviewKind;
  /** Fence language for `code` (and for the HTML source view). */
  language?: string;
  /** MIME type used to build the data URL for `image` / `pdf`. */
  mime?: string;
  /** True when the file must be read as base64 rather than text. */
  binary: boolean;
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

/**
 * Extension -> fence language for the syntax-highlighted view. Anything not
 * listed here still previews as plain text when it looks textual (see
 * `TEXT_EXTENSIONS`); the highlighter simply gets no language hint.
 */
const CODE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  sql: 'sql',
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  diff: 'diff',
  patch: 'diff',
  xml: 'xml',
  svgz: 'xml',
  graphql: 'graphql',
  proto: 'protobuf',
  ini: 'ini',
  conf: 'ini',
  env: 'bash',
};

/** Textual formats with no language mapping — still safe to show as text. */
const TEXT_EXTENSIONS = new Set(['txt', 'log', 'csv', 'tsv', 'text', 'lock', 'gitignore', 'editorconfig']);

export function fileExtension(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

/** Decide how a path should be previewed. Extension-based, no disk access. */
export function classifyPreviewFile(filePath: string): PreviewClassification {
  const ext = fileExtension(filePath);

  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return { kind: 'markdown', binary: false };
  }
  if (ext === 'html' || ext === 'htm') {
    return { kind: 'html', language: 'markup', binary: false };
  }
  if (ext === 'pdf') {
    return { kind: 'pdf', mime: 'application/pdf', binary: true };
  }
  // SVG is an image, but it is also text — preview it as an image, which is
  // what the reader means by "open the picture".
  if (IMAGE_MIME_BY_EXTENSION[ext]) {
    return { kind: 'image', mime: IMAGE_MIME_BY_EXTENSION[ext], binary: true };
  }
  if (CODE_LANGUAGE_BY_EXTENSION[ext]) {
    return { kind: 'code', language: CODE_LANGUAGE_BY_EXTENSION[ext], binary: false };
  }
  if (TEXT_EXTENSIONS.has(ext) || ext === '') {
    return { kind: 'code', binary: false };
  }
  return { kind: 'other', binary: false };
}

/**
 * Wrap file content in a markdown fence long enough to survive backtick runs
 * inside the content itself, so a code file can be handed to the transcript's
 * markdown renderer (and its highlighter) without escaping surprises.
 */
export function toFencedCodeBlock(content: string, language?: string): string {
  let longestRun = 0;
  let currentRun = 0;
  for (const char of content) {
    if (char === '`') {
      currentRun += 1;
      if (currentRun > longestRun) longestRun = currentRun;
    } else {
      currentRun = 0;
    }
  }
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${language ?? ''}\n${content}\n${fence}`;
}

/**
 * Content-Security-Policy for previewed HTML.
 *
 * `default-src 'none'` is the whole point: a previewed page may not fetch a
 * script, stylesheet, font, image, or XHR from anywhere off the machine, and
 * `frame-ancestors`/`form-action` keep it from reaching back at the host.
 * Inline styles and data: images stay allowed so an ordinary report still
 * looks like itself.
 */
export const PREVIEW_HTML_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * Build the document handed to the sandboxed preview iframe.
 *
 * Two independent locks, on purpose:
 *   1. the iframe carries `sandbox=""` (see `PREVIEW_HTML_SANDBOX`), which
 *      already denies scripts, same-origin access, forms, and any navigation
 *      of the host window;
 *   2. this CSP denies every outbound request even if the sandbox attribute
 *      is ever loosened by mistake.
 *
 * The author's markup is otherwise left untouched — the preview should show
 * the file as written, not a rewritten copy of it.
 */
export function buildSandboxedHtmlDoc(source: string): string {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_HTML_CSP}">`;
  const baseStyle =
    '<style>html,body{margin:0;padding:12px;background:#fff;color:#111;'
    + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}</style>';
  const head = `${cspMeta}${baseStyle}`;

  // Inject at the top of <head> when the file has one, so the CSP is parsed
  // before any of the document's own resource references.
  const headMatch = /<head\b[^>]*>/i.exec(source);
  if (headMatch) {
    const insertAt = headMatch.index + headMatch[0].length;
    return source.slice(0, insertAt) + head + source.slice(insertAt);
  }
  const htmlMatch = /<html\b[^>]*>/i.exec(source);
  if (htmlMatch) {
    const insertAt = htmlMatch.index + htmlMatch[0].length;
    return `${source.slice(0, insertAt)}<head>${head}</head>${source.slice(insertAt)}`;
  }
  return `<!doctype html><html><head>${head}</head><body>${source}</body></html>`;
}

/**
 * Sandbox token list for the preview iframe. Deliberately empty: no scripts,
 * no same-origin, no forms, no top-level navigation. Exported so the reverse
 * assertion in the tests names the same constant the component uses.
 */
export const PREVIEW_HTML_SANDBOX = '';

// ============================================================
// Rail geometry
// ============================================================

/** Rail width bounds (px). */
export const PREVIEW_RAIL_MIN_WIDTH = 320;
export const PREVIEW_RAIL_MAX_WIDTH = 900;
export const PREVIEW_RAIL_DEFAULT_WIDTH = 420;

/**
 * Below this window width the rail stops taking a column of its own and
 * floats over the conversation instead.
 *
 * Derived from the narrowest split that still reads: session history at its
 * 240px default + ~500px of conversation (the transcript's own comfortable
 * floor — narrower and message text starts wrapping every few words) +
 * the rail's 320px minimum + ~40px of chrome and dividers ≈ 1100px.
 */
export const PREVIEW_RAIL_SPLIT_MIN_WINDOW_WIDTH = 1100;

export function clampPreviewRailWidth(width: number): number {
  if (!Number.isFinite(width)) return PREVIEW_RAIL_DEFAULT_WIDTH;
  return Math.max(PREVIEW_RAIL_MIN_WIDTH, Math.min(PREVIEW_RAIL_MAX_WIDTH, Math.round(width)));
}

/** True when the window is wide enough for a genuine side-by-side split. */
export function shouldSplitAtWindowWidth(windowWidth: number): boolean {
  return windowWidth >= PREVIEW_RAIL_SPLIT_MIN_WINDOW_WIDTH;
}
