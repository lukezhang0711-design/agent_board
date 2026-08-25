/** Safe, low-detail classification for the read-only `codex login status`. */
export type CodexCliLoginStatus = 'chatgpt' | 'api-key' | 'logged-out' | 'unknown';

export function classifyCodexCliLoginStatus(
  stdout: string,
  stderr: string,
  exitCode?: number,
  launchError?: string,
): CodexCliLoginStatus {
  const output = `${stdout}\n${stderr}`.trim();
  // A launch/transport failure cannot prove that the user has logged out.
  if (launchError && !/not.?logged.?in|not authenticated|unauthenticated/i.test(output)) {
    return 'unknown';
  }
  if (/logged in using chatgpt/i.test(output)) return 'chatgpt';
  if (/logged in using (?:an )?api key|api key mode/i.test(output)) return 'api-key';
  if (/not.?logged.?in|not authenticated|unauthenticated|please log in/i.test(output)) {
    return 'logged-out';
  }
  // Some CLI versions use a non-zero exit without user-facing auth wording.
  // Treat that as a probe failure, never as evidence of logout.
  void exitCode;
  return 'unknown';
}
