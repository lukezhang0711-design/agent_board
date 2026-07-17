export type StopQueueAction = 'pause' | 'clear';

export const STOP_KEEP_QUEUE_TITLE = 'Stop and keep queued messages (Esc)';
export const STOP_KEEP_QUEUE_ARIA_LABEL = 'Stop and keep queued messages';
export const STOP_CLEAR_QUEUE_STATUS = 'Stop & clear queue stops the session and clears queued messages';

export function getStopRequestStatusMessage(action: StopQueueAction): string {
  return action === 'clear'
    ? 'Stop & clear request sent; queued messages will be cleared when it takes effect…'
    : 'Stop request sent; queued messages will be kept when it takes effect…';
}
