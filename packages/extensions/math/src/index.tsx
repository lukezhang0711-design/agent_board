/**
 * Math extension entry.
 *
 * Owns LaTeX math rendering for Nimbalyst. v1 wires the transcript via
 * `TranscriptMathHost`; the Lexical-side math integration will live in this
 * same package (see plan-transcript-extension-contributions.md, open
 * question "Should the same built-in extension own both Lexical math and
 * transcript math?" -- answered yes).
 */

import { TranscriptMathHost } from './TranscriptMathHost';

export async function activate(): Promise<void> {
  // Registration happens inside TranscriptMathHost so it follows the host
  // component's mount/unmount lifecycle; there is no work to do here.
}

export async function deactivate(): Promise<void> {
  // Same -- the host component cleans up its own contributions on unmount.
}

export const hostComponents = {
  TranscriptMathHost,
};
