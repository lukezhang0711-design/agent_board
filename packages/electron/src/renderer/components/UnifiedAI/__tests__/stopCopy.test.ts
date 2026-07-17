import { describe, expect, it } from 'vitest';
import {
  STOP_CLEAR_QUEUE_STATUS,
  STOP_KEEP_QUEUE_ARIA_LABEL,
  STOP_KEEP_QUEUE_TITLE,
  getStopRequestStatusMessage,
} from '../stopCopy';

describe('stop action copy', () => {
  it('tells the small stop action that queued messages are kept', () => {
    expect(STOP_KEEP_QUEUE_TITLE).toContain('keep queued messages');
    expect(STOP_KEEP_QUEUE_ARIA_LABEL).toContain('keep queued messages');
  });

  it('tells the clear-queue action that queued messages are cleared', () => {
    expect(STOP_CLEAR_QUEUE_STATUS).toContain('clears queued messages');
    expect(STOP_CLEAR_QUEUE_STATUS).not.toContain('keeps queued messages');
  });

  it('distinguishes the two actions after a stop request is sent', () => {
    expect(getStopRequestStatusMessage('pause')).toContain('queued messages will be kept');
    expect(getStopRequestStatusMessage('clear')).toContain('queued messages will be cleared');
  });
});
