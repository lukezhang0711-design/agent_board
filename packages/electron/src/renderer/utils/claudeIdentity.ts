import type { ClaudeAuthState } from '../store/atoms/claudeAuthAtoms';

export type ClaudeIdentityBadge = {
  label: string;
  guidance?: string;
};

const NOT_LOGGED_IN_GUIDANCE = '请登录 Claude，或在设置中配置 API Key';

export function getClaudeIdentityBadge(
  authState: Pick<ClaudeAuthState, 'status' | 'email'> | null | undefined,
  apiKeys: Record<string, string> | null | undefined,
): ClaudeIdentityBadge {
  if (authState?.status === 'logged-in') {
    return {
      label: authState.email ? `订阅 · ${authState.email}` : '订阅',
    };
  }

  const hasClaudeApiKey = [apiKeys?.anthropic, apiKeys?.['claude-code']]
    .some((key) => typeof key === 'string' && key.trim().length > 0);
  if (hasClaudeApiKey) {
    return { label: 'API' };
  }

  return {
    label: '未登录',
    guidance: NOT_LOGGED_IN_GUIDANCE,
  };
}
