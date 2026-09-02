/**
 * GitHubAccountPanel — choose which `gh` CLI account the PR review feature
 * uses (issue #307). Follows the global-default + per-project-override pattern.
 *
 * - User scope: pick the GLOBAL default account.
 * - Project scope: pick an OVERRIDE for this project (or fall back to default).
 *
 * Nimbalyst stores only the chosen login; the token is resolved from gh's
 * keyring per request and never persisted.
 */

import { useCallback, useEffect, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { SettingsScope } from '../SettingsView';
import { getPullRequestService } from '../../../services/RendererPullRequestService';
import { PageHeader } from '../../common/PageHeader';

interface GitHubAccountPanelProps {
  scope: SettingsScope;
  workspacePath?: string;
}

interface GhAccount {
  login: string;
  host: string;
  active: boolean;
}

export function GitHubAccountPanel({ scope, workspacePath }: GitHubAccountPanelProps): JSX.Element {
  const [accounts, setAccounts] = useState<GhAccount[]>([]);
  const [defaultAccount, setDefaultAccount] = useState<string | null>(null);
  const [override, setOverride] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const service = getPullRequestService();
  const isProject = scope === 'project' && !!workspacePath;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accs, config] = await Promise.all([
        service.listAccounts(),
        service.getAccountConfig(workspacePath),
      ]);
      setAccounts(accs);
      setDefaultAccount(config.defaultAccount);
      setOverride(config.override);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load GitHub accounts');
    } finally {
      setLoading(false);
    }
  }, [service, workspacePath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleDefaultChange = useCallback(
    async (login: string | null) => {
      setDefaultAccount(login);
      await service.setDefaultAccount(login);
    },
    [service],
  );

  const handleOverrideChange = useCallback(
    async (login: string | null) => {
      if (!workspacePath) return;
      setOverride(login);
      await service.setAccountOverride(workspacePath, login);
    },
    [service, workspacePath],
  );

  const noAccounts = !loading && accounts.length === 0;

  return (
    <div className="github-account-panel provider-panel flex flex-col" data-testid="github-account-panel">
      <PageHeader icon="account_circle" title="GitHub Account" className="mb-5" />

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-[var(--nim-text-muted)] text-sm">
          <div className="spinner w-4 h-4 border-[2px] border-[var(--nim-bg-secondary)] border-t-[var(--nim-primary)] rounded-ui-full animate-spin" />
          Loading accounts…
        </div>
      ) : error ? (
        <div className="flex flex-col items-start gap-2 py-4 text-[var(--nim-error)] text-sm">
          <span>{error}</span>
          <button className="text-xs text-[var(--nim-primary)] hover:underline" onClick={() => void reload()}>
            Retry
          </button>
        </div>
      ) : noAccounts ? (
        <div className="flex items-start gap-3 p-3 bg-[color-mix(in_srgb,var(--nim-primary)_8%,transparent)] border border-[color-mix(in_srgb,var(--nim-primary)_20%,transparent)] rounded-ui-lg text-ui-body text-[var(--nim-text-muted)]">
          <MaterialSymbol icon="info" size={16} className="text-[var(--nim-primary)] shrink-0 mt-1" />
          <div>
            No GitHub CLI accounts found. Run <code className="text-ui-caption bg-[var(--nim-code-bg)] px-1 py-0.5 rounded-ui-base">gh auth login</code> in your terminal, then reload.
          </div>
        </div>
      ) : (
        <div className="provider-panel-section py-2">
          <label className="block text-ui-body font-medium text-[var(--nim-text)] mb-2">
            {isProject ? 'Account for this project' : 'Default account'}
          </label>
          <select
            data-testid="github-account-select"
            className="w-full max-w-sm px-3 py-2 text-ui-body bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded-ui-base text-[var(--nim-text)] outline-none focus:border-[var(--nim-primary)] transition-colors"
            value={isProject ? override ?? '' : defaultAccount ?? ''}
            onChange={(e) => {
              const value = e.target.value || null;
              if (isProject) void handleOverrideChange(value);
              else void handleDefaultChange(value);
            }}
          >
            <option value="">
              {isProject
                ? `Use default${defaultAccount ? ` (${defaultAccount})` : ''}`
                : 'Active gh account (no preference)'}
            </option>
            {accounts.map((acc) => (
              <option key={`${acc.host}:${acc.login}`} value={acc.login}>
                {acc.login}
                {acc.host !== 'github.com' ? ` — ${acc.host}` : ''}
                {acc.active ? ' (active)' : ''}
              </option>
            ))}
          </select>

        </div>
      )}
    </div>
  );
}
