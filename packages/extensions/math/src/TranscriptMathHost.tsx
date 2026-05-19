/**
 * TranscriptMathHost is mounted by the host as a Nimbalyst `hostComponent`.
 *
 * On mount it contributes `remark-math` / `rehype-katex` and the KaTeX
 * stylesheet to the transcript markdown registry; on unmount it clears its
 * own registrations. Disabling the extension at runtime unmounts this
 * component, which removes both the plugins and the `<style>` tag from
 * subsequent transcript renders.
 */

import { useEffect } from 'react';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import katexCss from 'katex/dist/katex.min.css?inline';
import {
  clearTranscriptMarkdownContributions,
  setTranscriptMarkdownContributions,
} from '@nimbalyst/runtime';

const SOURCE = 'com.nimbalyst.math';

// Defense-in-depth against KaTeX's history of XSS / DoS advisories. Agent-
// supplied math is untrusted, so disable anything that can elevate it
// (\href, \url, custom macros) and bound the work the renderer can be
// coerced into doing on a single equation. Mirrors the constraints that
// previously lived in `MarkdownRenderer.tsx`.
const KATEX_SAFE_OPTIONS = {
  trust: false,
  strict: 'ignore' as const,
  throwOnError: false,
  output: 'html' as const,
  maxSize: 25,
  maxExpand: 100,
  macros: {},
};

export function TranscriptMathHost(): null {
  useEffect(() => {
    setTranscriptMarkdownContributions(SOURCE, {
      remarkPlugins: [remarkMath],
      rehypePlugins: [[rehypeKatex, KATEX_SAFE_OPTIONS]],
      styles: [
        {
          type: 'css-text',
          id: 'com.nimbalyst.math.katex',
          cssText: katexCss as unknown as string,
        },
      ],
    });
    return () => {
      clearTranscriptMarkdownContributions(SOURCE);
    };
  }, []);
  return null;
}
