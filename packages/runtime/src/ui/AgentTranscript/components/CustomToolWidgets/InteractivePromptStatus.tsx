import React, { useCallback, useEffect, useState } from 'react';
import type {
  InteractivePromptAvailability,
  InteractivePromptStatusQuery,
  InteractivePromptType,
} from '../../types';

export type InteractivePromptViewStatus = InteractivePromptAvailability | 'checking';

interface UseInteractivePromptStatusResult {
  status: InteractivePromptViewStatus;
  markUnavailable: () => void;
}

/**
 * Resolve prompt liveness without making a transient missing host look like a
 * dead prompt. A host-less card stays in `checking` until the renderer can ask
 * the main process; once the main process says the durable/provider route is
 * gone, controls are replaced by the explicit invalid state.
 */
export function useInteractivePromptStatus(
  query: InteractivePromptStatusQuery | undefined,
  promptId: string,
  promptType: InteractivePromptType,
  isPending: boolean,
  fallbackStatus: InteractivePromptViewStatus = 'checking',
): UseInteractivePromptStatusResult {
  const [status, setStatus] = useState<InteractivePromptViewStatus>(fallbackStatus);

  useEffect(() => {
    let disposed = false;

    if (!isPending) {
      setStatus('resolved');
      return () => {
        disposed = true;
      };
    }

    if (!query || !promptId) {
      setStatus(fallbackStatus);
      return () => {
        disposed = true;
      };
    }

    setStatus('checking');
    void query(promptId, promptType)
      .then((result) => {
        if (!disposed) setStatus(result.status);
      })
      .catch(() => {
        // A failed liveness read is not permission to leave a clickable card
        // on screen. The user gets the same recovery path as an explicit
        // unavailable result.
        if (!disposed) setStatus('unavailable');
      });

    return () => {
      disposed = true;
    };
  }, [fallbackStatus, isPending, promptId, promptType, query]);

  const markUnavailable = useCallback(() => setStatus('unavailable'), []);

  return { status, markUnavailable };
}

export function InteractivePromptStatusCard({
  testId,
  title,
  status,
  detail,
}: {
  testId: string;
  title: string;
  status: Exclude<InteractivePromptViewStatus, 'available' | 'checking'>;
  detail?: string;
}) {
  const isInvalid = status === 'unavailable';
  return (
    <div
      data-testid={testId}
      data-state={isInvalid ? 'invalid' : 'resolved'}
      className="interactive-prompt-status-card rounded-lg border border-nim bg-nim-secondary overflow-hidden opacity-85"
    >
      <div className="flex items-center gap-2 py-3 px-4 bg-nim-tertiary">
        <span className={`text-sm font-semibold flex-1 ${isInvalid ? 'text-nim-error' : 'text-nim-muted'}`}>
          {isInvalid ? '已失效' : '已处理'}
        </span>
        <span className="text-xs text-nim-muted">{title}</span>
      </div>
      <div className="px-4 py-3 text-xs text-nim-muted">
        {detail || (isInvalid ? '供应端已失效。' : '该请求已处理。')}
        {' '}
        <span className="font-medium text-nim">重新发送消息继续</span>
      </div>
    </div>
  );
}
