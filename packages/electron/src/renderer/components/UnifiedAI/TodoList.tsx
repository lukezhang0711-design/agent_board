import React from 'react';
import { PageHeader } from '../common/PageHeader';

export interface Todo {
  status: 'pending' | 'in_progress' | 'completed';
  content: string;
  activeForm: string;
}

export interface TodoListProps {
  todos: Todo[];
  sessionId: string;
}

export function TodoList({ todos, sessionId }: TodoListProps) {
  console.log(`[TodoList] Rendering with ${todos?.length || 0} todos for session ${sessionId}`);

  if (!todos || todos.length === 0) {
    console.log('[TodoList] No todos, returning null');
    return null;
  }

  console.log('[TodoList] Rendering todo list:', todos);

  return (
    <div
      className="todo-list fixed bottom-4 right-4 w-80 max-w-[calc(100vw-32px)] rounded-ui-lg border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] shadow-[0_4px_12px_rgba(0,0,0,0.15)] z-[1000] animate-[fadeIn_0.2s_ease-in]"
      data-session-id={sessionId}
    >
      <PageHeader
        title="Tasks"
        count={`${todos.filter(t => t.status === 'completed').length}/${todos.length}`}
        className="todo-list-header px-3 py-2 bg-[var(--nim-bg-tertiary)] rounded-ui-lg-t border-b border-[var(--nim-border)]"
        testId="todo-list-header"
      />
      <div className="todo-list-items nim-scrollbar p-2 max-h-[300px] overflow-y-auto">
        {todos.map((todo, index) => (
          <TodoItem key={index} todo={todo} />
        ))}
      </div>
    </div>
  );
}

interface TodoItemProps {
  todo: Todo;
}

function TodoItem({ todo }: TodoItemProps) {
  const displayText = todo.status === 'in_progress' ? todo.activeForm : todo.content;

  const statusClasses = {
    pending: 'todo-item-pending bg-transparent',
    in_progress: 'todo-item-in-progress bg-[var(--nim-bg-hover)] animate-[pulse_2s_ease-in-out_infinite]',
    completed: 'todo-item-completed opacity-60 animate-[fadeOut_0.3s_ease-out]',
  };

  return (
    <div
      className={`todo-item flex items-start gap-2 p-2 mb-1 last:mb-0 rounded-ui-base transition-all duration-200 ${statusClasses[todo.status]}`}
      data-status={todo.status}
    >
      <div className="todo-item-icon shrink-0 w-4 h-4 flex items-center justify-center mt-1">
        {todo.status === 'pending' && (
          <span className="todo-icon-pending text-[var(--nim-text-faint)] text-sm">○</span>
        )}
        {todo.status === 'in_progress' && (
          <span className="todo-icon-in-progress text-[var(--nim-primary)] text-sm relative">
            <span className="spinner inline-block w-3 h-3 border-2 border-[var(--nim-bg-tertiary)] border-t-[var(--nim-primary)] rounded-ui-full animate-spin" />
          </span>
        )}
        {todo.status === 'completed' && (
          <span className="todo-icon-completed text-[var(--nim-success)] text-sm">●</span>
        )}
      </div>
      <div
        className={`todo-item-text flex-1 text-ui-body leading-[1.4] break-words ${
          todo.status === 'completed'
            ? 'line-through text-[var(--nim-text-muted)]'
            : 'text-[var(--nim-text)]'
        }`}
      >
        {displayText}
      </div>
    </div>
  );
}
