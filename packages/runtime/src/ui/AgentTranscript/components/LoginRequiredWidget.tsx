import React, { useState, useEffect, useCallback, useSyncExternalStore } from 'react';

type ClaudeAuthStateKind = 'logged-in' | 'logged-out' | 'check-failed' | 'unknown';

interface ClaudeAuthSnapshot {
  status: ClaudeAuthStateKind;
  source: 'claude-cli-auth-status';
  checkedAt: number | null;
  email?: string;
  organization?: string;
  subscriptionType?: string;
  error?: string;
}

interface StatusMessage {
  message: string;
  success: boolean;
}

const CLAUDE_AUTH_STATE_UPDATED_EVENT = 'claude-auth:state-updated';
const UNKNOWN_CLAUDE_AUTH_STATE: ClaudeAuthSnapshot = {
  status: 'unknown',
  source: 'claude-cli-auth-status',
  checkedAt: null,
};

type RuntimeAuthWindow = Window & {
  __nimbalystClaudeAuthState?: ClaudeAuthSnapshot;
  __nimbalystRefreshClaudeAuthState?: () => Promise<unknown>;
};

function readClaudeAuthState(): ClaudeAuthSnapshot {
  if (typeof window === 'undefined') return UNKNOWN_CLAUDE_AUTH_STATE;
  return (window as RuntimeAuthWindow).__nimbalystClaudeAuthState ?? UNKNOWN_CLAUDE_AUTH_STATE;
}

function subscribeToClaudeAuthState(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CLAUDE_AUTH_STATE_UPDATED_EVENT, onStoreChange);
  return () => window.removeEventListener(CLAUDE_AUTH_STATE_UPDATED_EVENT, onStoreChange);
}

function useClaudeAuthState(): ClaudeAuthSnapshot {
  return useSyncExternalStore(
    subscribeToClaudeAuthState,
    readClaudeAuthState,
    () => UNKNOWN_CLAUDE_AUTH_STATE,
  );
}

function statusMessageFor(authState: ClaudeAuthSnapshot): StatusMessage | null {
  if (authState.status === 'logged-in') return null;
  if (authState.status === 'logged-out') {
    return {
      message: authState.error || 'Not logged in. Please complete the authentication flow.',
      success: false,
    };
  }
  if (authState.status === 'check-failed') {
    return {
      message: authState.error
        ? `Failed to check Claude login status: ${authState.error}`
        : 'Failed to check Claude login status. Please try again.',
      success: false,
    };
  }
  return {
    message: authState.error
      ? `Claude login status is unknown: ${authState.error}`
      : 'Claude login status is unknown. Please try again.',
    success: false,
  };
}

// Inject login widget styles once (for color-mix patterns)
const injectLoginWidgetStyles = () => {
  const styleId = 'login-required-widget-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .login-required-widget {
      background-color: color-mix(in srgb, var(--nim-error) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--nim-error) 25%, transparent);
    }
    .login-required-widget.logged-in {
      background-color: color-mix(in srgb, var(--nim-success) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--nim-success) 40%, transparent);
    }
    .login-status-message.success {
      background-color: color-mix(in srgb, var(--nim-success) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--nim-success) 40%, transparent);
    }
    .login-status-message.error {
      background-color: color-mix(in srgb, var(--nim-error) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--nim-error) 25%, transparent);
    }
    .login-required-widget.logged-in .login-account-info {
      color: color-mix(in srgb, var(--nim-success) 80%, var(--nim-text-muted));
    }
  `;
  document.head.appendChild(style);
};

export const LoginRequiredWidget: React.FC = () => {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [actionStatus, setActionStatus] = useState<StatusMessage | null>(null);
  const authState = useClaudeAuthState();

  // Inject styles on mount
  useEffect(() => {
    injectLoginWidgetStyles();
  }, []);

  const handleRefreshStatus = useCallback(async () => {
    setIsChecking(true);
    setActionStatus(null);

    try {
      const runtimeWindow = window as RuntimeAuthWindow;
      if (runtimeWindow.__nimbalystRefreshClaudeAuthState) {
        await runtimeWindow.__nimbalystRefreshClaudeAuthState();
        return;
      }
      if (!window.electronAPI?.invoke) {
        setActionStatus({
          message: 'Cannot access Electron API. Please restart the application.',
          success: false
        });
        return;
      }

      // The centralized renderer listener receives and mirrors the response
      // broadcast. This action requests a recheck but never owns auth state.
      await window.electronAPI.invoke('claude-code:check-login', { forceRefresh: true });
    } catch (error: any) {
      setActionStatus({
        message: `Failed to check status: ${error.message || 'Unknown error'}`,
        success: false
      });
    } finally {
      setIsChecking(false);
    }
  }, []);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setActionStatus(null);

    try {
      // Check if we have the electronAPI available
      if (!window.electronAPI?.invoke) {
        setActionStatus({
          message: 'Cannot access Electron API. Please restart the application.',
          success: false
        });
        setIsLoggingIn(false);
        return;
      }

      const result = await window.electronAPI.invoke('claude-code:login');

      if (!result.success) {
        setActionStatus({
          message: result.error || 'Login failed. Please try again.',
          success: false
        });
      }
    } catch (error: any) {
      setActionStatus({
        message: `Login failed: ${error.message || 'Unknown error'}`,
        success: false
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const isLoggedIn = authState.status === 'logged-in';
  const authStatusMessage = statusMessageFor(authState);
  const loginButtonLabel = isLoggingIn
    ? 'Opening Login...'
    : isLoggedIn
      ? 'Log In Again'
      : 'Log In';
  const statusButtonLabel = isChecking ? 'Checking...' : 'Check Status';

  return (
    <div className={`login-required-widget my-4 p-4 rounded-lg flex flex-col gap-4 ${isLoggedIn ? 'logged-in' : ''}`}>
      <div className="login-required-message text-[var(--nim-text)] text-sm leading-relaxed flex items-center gap-2">
        {isLoggedIn ? (
          <>
            <span className="login-status-icon success text-lg font-bold text-[var(--nim-success)]">&#10003;</span>
            <span className="font-medium text-[var(--nim-success)]">You are logged in and can continue your conversation</span>
          </>
        ) : (
          <>
            <span>An Anthropic account is required to use Claude Agent. Please login or create an account.</span>
            <span>Claude 命令行未登录订阅账号——请在终端运行 claude /login 登录后重试</span>
          </>
        )}
      </div>

      {isLoggedIn && (authState.email || authState.organization) && (
        <div className={`login-account-info text-xs flex flex-col gap-1 ${isLoggedIn ? 'pl-0' : 'pl-6'} text-[var(--nim-text-muted)]`}>
          {authState.email && (
            <div>Account: {authState.email}</div>
          )}
          {authState.organization && (
            <div>Organization: {authState.organization}</div>
          )}
        </div>
      )}

      {actionStatus && !actionStatus.success && (
        <div className="login-status-message error text-[0.85rem] p-4 rounded-md flex flex-col gap-2 leading-relaxed text-[var(--nim-error)]">
          <div className="login-status-header flex items-center gap-2">
            <span className="login-status-icon text-base">&#9888;</span>
            <span>{actionStatus.message}</span>
          </div>
        </div>
      )}

      {authStatusMessage && !authStatusMessage.success && (
        <div className="login-status-message error text-[0.85rem] p-4 rounded-md flex flex-col gap-2 leading-relaxed text-[var(--nim-error)]">
          <div className="login-status-header flex items-center gap-2">
            <span className="login-status-icon text-base">&#9888;</span>
            <span>{authStatusMessage.message}</span>
          </div>
        </div>
      )}

      <div className="login-actions grid gap-3 w-full" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <button
          onClick={handleLogin}
          disabled={isLoggingIn}
          className="login-button w-full py-3 px-5 rounded-md text-sm font-semibold cursor-pointer transition-all border-none bg-[var(--nim-primary)] text-white whitespace-nowrap hover:bg-[var(--nim-primary-hover)] disabled:cursor-not-allowed disabled:bg-[var(--nim-text-faint)] disabled:opacity-60"
        >
          {loginButtonLabel}
        </button>

        <button
          onClick={() => { void handleRefreshStatus(); }}
          disabled={isChecking}
          className="status-button w-full py-3 px-5 rounded-md text-sm font-semibold cursor-pointer transition-all border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] text-[var(--nim-text)] whitespace-nowrap hover:bg-[var(--nim-bg-hover)] disabled:cursor-not-allowed disabled:bg-[var(--nim-bg-tertiary)] disabled:opacity-60"
        >
          {statusButtonLabel}
        </button>
      </div>
    </div>
  );
};
