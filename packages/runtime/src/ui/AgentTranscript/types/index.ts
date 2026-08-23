/**
 * Agent Transcript types for UI display
 * Extends core runtime types for rich transcript rendering
 */

import type { SessionData } from '../../../ai/server/types';

// Re-export core runtime types
export type { SessionData, DocumentContext, TranscriptViewMessage } from '../../../ai/server/types';
export type { AIProviderType } from '../../../ai/server/types';

/**
 * UI-specific settings for transcript display
 */
export interface TranscriptSettings {
  showToolCalls: boolean;
  showThinking: boolean;
  compactMode: boolean;
  collapseTools: boolean;
  showSessionInit: boolean;
}

/**
 * Native interactive prompt kinds whose renderer needs to know whether the
 * response supplier can still receive a click after a restart or mode switch.
 */
export type InteractivePromptType =
  | 'ask_user_question'
  | 'request_user_input'
  | 'exit_plan_mode'
  | 'tool_permission'
  | 'git_commit';

export type InteractivePromptAvailability = 'available' | 'unavailable' | 'resolved';

export interface InteractivePromptStatusResult {
  status: InteractivePromptAvailability;
  reason?: string;
}

export type InteractivePromptStatusQuery = (
  promptId: string,
  promptType: InteractivePromptType,
) => Promise<InteractivePromptStatusResult>;

/**
 * Prompt marker for navigation sidebar
 */
export interface PromptMarker {
  id: number;
  sessionId: string;
  promptText: string;
  outputIndex: number;
  outputLine?: number;
  timestamp: string;
  completionTimestamp?: string;
}

/**
 * Extended session data for agentic coding sessions
 * Includes plan references, file edits, and todo tracking
 */
export interface AgenticSessionData extends SessionData {
  metadata?: SessionData['metadata'] & {
    planDocumentPath?: string;
    fileEdits?: FileEditSummary[];
    todos?: TodoItem[];
    sessionType?: 'agentic-coding' | 'chat';
  };
}

/**
 * File edit summary for displaying in transcript
 */
export interface FileEditSummary {
  filePath: string;
  linkType?: 'edited' | 'referenced' | 'read';
  operation?: 'create' | 'edit' | 'delete' | 'rename';
  linesAdded?: number;
  linesRemoved?: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * TODO item for task tracking in agentic sessions
 */
export interface TodoItem {
  id: string;
  content: string;
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed';
  timestamp?: string;
}
