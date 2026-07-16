import { describe, expect, it, vi } from 'vitest';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/types';

vi.mock('virtua', () => ({ VList: () => null }));
vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/MessageSegment', () => ({
  MessageSegment: () => null,
}));
vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/MarkdownRenderer', () => ({
  MarkdownRenderer: () => null,
}));
vi.mock('@nimbalyst/runtime/ui/icons/ProviderIcons', () => ({ ProviderIcon: () => null }));
vi.mock('@nimbalyst/runtime/ui/icons/MaterialSymbol', () => ({ MaterialSymbol: () => null }));
vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/JSONViewer', () => ({
  JSONViewer: () => null,
}));
vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/EditToolResultCard', () => ({
  EditToolResultCard: () => null,
}));
vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/TranscriptSearchBar', () => ({
  TranscriptSearchBar: () => null,
}));
vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets', () => ({
  getCustomToolWidget: () => null,
  ToolWidgetErrorBoundary: ({ children }: { children: unknown }) => children,
}));
vi.mock('@nimbalyst/runtime/ui/AgentTranscript/contributions', () => ({
  useTranscriptToolWidgetRegistryVersion: () => 0,
}));
vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/ToolCallChanges', () => ({
  ToolCallChanges: () => null,
}));

import { isHistoricalChildSessionUpdateMessage } from '@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView';

function message(
  type: TranscriptViewMessage['type'],
  text: string,
): TranscriptViewMessage {
  return {
    id: 1,
    sequence: 1,
    createdAt: new Date('2026-07-16T00:00:00.000Z'),
    type,
    text,
    subagentId: null,
  };
}

describe('historical child session update filtering', () => {
  it('hides only user messages whose content starts with the legacy prefix', () => {
    expect(isHistoricalChildSessionUpdateMessage(
      message('user_message', '[Child Session Update]\nEvent: session:completed'),
    )).toBe(true);
    expect(isHistoricalChildSessionUpdateMessage(
      message('assistant_message', '[Child Session Update]\nHandled'),
    )).toBe(false);
    expect(isHistoricalChildSessionUpdateMessage(
      message('user_message', 'Context before [Child Session Update]'),
    )).toBe(false);
    expect(isHistoricalChildSessionUpdateMessage(
      message('user_message', 'Ordinary user prompt'),
    )).toBe(false);
  });
});
