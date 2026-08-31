// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

export type CancelFeedbackPhase = 'idle' | 'requesting' | 'awaiting-terminal' | 'stopped' | 'failed';

export interface CancelFeedbackState {
  phase: CancelFeedbackPhase;
  error?: string;
  action?: 'pause' | 'clear';
  pausedCount?: number;
  queueAction?: 'resume' | 'clear';
  queueError?: {
    action: 'resume' | 'clear';
    message: string;
  };
}

/** Pure reducer matching the useEffect in SessionTranscript.tsx */
export function reduceCancelFeedback(
  current: CancelFeedbackState,
  isProcessing: boolean,
  isInterrupted: boolean,
): CancelFeedbackState {
  if (
    !isProcessing
    && (current.phase === 'requesting'
      || current.phase === 'awaiting-terminal'
      || current.phase === 'failed')
  ) {
    if (isInterrupted || (current.pausedCount !== undefined && current.pausedCount > 0)) {
      return { ...current, phase: 'stopped' };
    }
    return { phase: 'idle' };
  }
  if (
    isProcessing
    && current.phase === 'stopped'
    && current.queueAction === undefined
  ) {
    return { phase: 'idle' };
  }
  return current;
}

describe('FB-102: SessionTranscript cancel feedback transition (真中止 vs 未中止成)', () => {
  it('GREEN ③a: When user clicks stop and session was TRULY interrupted, transitions to stopped', () => {
    const requestingState: CancelFeedbackState = { phase: 'requesting', action: 'pause' };

    // When processing ends and isInterrupted is true:
    const nextState = reduceCancelFeedback(requestingState, false, true);
    expect(nextState.phase).toBe('stopped');
  });

  it('GREEN ③b: When user clicks stop but turn naturally COMPLETED (isInterrupted=false, no paused queue), transitions to idle', () => {
    const requestingState: CancelFeedbackState = { phase: 'requesting', action: 'pause' };

    // When processing ends and isInterrupted is false (turn finished on its own):
    const nextState = reduceCancelFeedback(requestingState, false, false);
    expect(nextState.phase).toBe('idle');
  });

  it('GREEN ③c: When stop request had paused queued messages, transitions to stopped even if turn was finishing', () => {
    const requestingState: CancelFeedbackState = { phase: 'requesting', action: 'pause', pausedCount: 2 };

    const nextState = reduceCancelFeedback(requestingState, false, false);
    expect(nextState.phase).toBe('stopped');
    expect(nextState.pausedCount).toBe(2);
  });
});
