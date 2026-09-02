import React from 'react';

export interface SettingsSectionProps {
  /** Section title */
  title: React.ReactNode;
  /** Optional single-sentence explanation/description */
  description?: React.ReactNode;
  /** Content area (e.g. toggles, rows, inputs) */
  children: React.ReactNode;
  /** Whether to render bottom divider border (default: true) */
  hasDivider?: boolean;
  /** Additional container CSS class */
  className?: string;
  /** Test ID for assertions */
  testId?: string;
}

/**
 * SettingsSection - Standardized outer shell for grouping related settings controls.
 *
 * Pattern:
 *   - Section header: Subhead title + optional one-sentence description
 *   - Content container: Children (toggles, form controls)
 *   - Bottom divider: Standard 1px border separator
 *
 * Pure display component: no state management, no data fetching.
 */
export const SettingsSection: React.FC<SettingsSectionProps> = ({
  title,
  description,
  children,
  hasDivider = true,
  className = '',
  testId = 'settings-section',
}) => {
  return (
    <section
      className={`settings-section flex flex-col ${
        hasDivider ? 'pb-6 mb-6 border-b border-[var(--nim-border)]' : 'mb-6'
      } ${className}`.trim()}
      data-testid={testId}
    >
      <div className="settings-section-header flex flex-col gap-1 mb-3">
        <h3
          className="settings-section-title m-0 text-ui-subhead font-semibold text-[var(--nim-text)]"
          data-testid="settings-section-title"
        >
          {title}
        </h3>
        {description && (
          <p
            className="settings-section-description m-0 text-ui-compact text-[var(--nim-text-muted)] leading-normal"
            data-testid="settings-section-description"
          >
            {description}
          </p>
        )}
      </div>

      <div
        className="settings-section-content flex flex-col gap-3"
        data-testid="settings-section-content"
      >
        {children}
      </div>
    </section>
  );
};
