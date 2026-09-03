import React from 'react';
import { PageHeader } from '../common/PageHeader';

export interface IndexBuildDialogProps {
  isOpen: boolean;
  messageCount: number;
  isBuilding: boolean;
  onBuild: () => void;
  onSkip: () => void;
}

export const IndexBuildDialog: React.FC<IndexBuildDialogProps> = ({
  isOpen,
  messageCount,
  isBuilding,
  onBuild,
  onSkip
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="index-build-dialog-overlay nim-overlay"
      onClick={isBuilding ? undefined : onSkip}
    >
      <div
        className="index-build-dialog min-w-[400px] max-w-[500px] rounded-ui-lg p-6 shadow-lg border border-[var(--nim-border)] bg-[var(--nim-bg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <PageHeader
          title="Build Search Index?"
          className="p-0 mb-3 border-none"
          testId="index-build-dialog-header"
        />
        <p className="index-build-dialog-message m-0 mb-6 text-ui-body leading-relaxed text-[var(--nim-text-muted)] [&_strong]:text-[var(--nim-text)]">
          Your session history contains <strong>{messageCount.toLocaleString()}</strong> messages.
          Building a search index will make searches much faster, but may take a few minutes.
        </p>
        {isBuilding ? (
          <div className="index-build-dialog-progress flex items-center gap-3 p-3 rounded-ui-base bg-[var(--nim-bg-secondary)] text-ui-body text-[var(--nim-text-muted)]">
            <div className="index-build-dialog-spinner w-5 h-5 rounded-ui-full border-2 border-[var(--nim-border)] border-t-[var(--nim-primary)] animate-spin" />
            <span>Building index... This may take a few minutes.</span>
          </div>
        ) : (
          <div className="index-build-dialog-buttons flex gap-3 justify-end">
            <button
              className="index-build-dialog-button-skip nim-btn-secondary"
              onClick={onSkip}
            >
              Skip for now
            </button>
            <button
              className="index-build-dialog-button-build nim-btn-primary"
              onClick={onBuild}
            >
              Build Index
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
