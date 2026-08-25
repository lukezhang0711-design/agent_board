// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { resolveEquivalentModelIdMigration } from '../../../../main/services/ai/modelIdMigration';
import { getEffortConfigurationForModel, type EffortLevel } from '../../../utils/modelUtils';
import { EffortLevelSelector } from '../EffortLevelSelector';

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: () => null,
}));

interface EffortCatalogModel {
  id: string;
  supportedEffortLevels: EffortLevel[];
  defaultEffortLevel?: EffortLevel;
}

const FABLE_MODEL: EffortCatalogModel = {
  id: 'claude-code:claude-fable-5[1m]',
  supportedEffortLevels: ['low', 'medium', 'high'] as EffortLevel[],
  defaultEffortLevel: 'medium' as EffortLevel,
};

function SessionEffortFixture({
  sessionModel,
  model = FABLE_MODEL,
}: {
  sessionModel: string;
  model?: EffortCatalogModel;
}) {
  const configuration = getEffortConfigurationForModel(
    { 'claude-code': [model] },
    sessionModel,
  );

  return configuration.supportedEffortLevels.length > 0 ? (
    <EffortLevelSelector
      level={configuration.defaultEffortLevel}
      onLevelChange={vi.fn()}
      supportedLevels={configuration.supportedEffortLevels}
    />
  ) : null;
}

describe('persisted model ID effort controls', () => {
  it('RED ES: a pre-migration claude-fable-5-1m session has no thought-level control', () => {
    render(<SessionEffortFixture sessionModel="claude-code:claude-fable-5-1m" />);

    expect(screen.queryByTestId('effort-level-selector')).toBeNull();
  });

  it('GREEN ES: the migrated session renders exactly the live row declared levels', () => {
    const migration = resolveEquivalentModelIdMigration(
      'claude-code:claude-fable-5-1m',
      [{ id: FABLE_MODEL.id, resolvedModel: 'claude-fable-5[1m]' }],
    );
    render(<SessionEffortFixture sessionModel={migration?.to ?? 'claude-code:claude-fable-5-1m'} />);

    expect(screen.getByTestId('effort-level-selector').getAttribute('aria-label'))
      .toBe('Effort level: Medium');
  });

  it('GREEN ES: a live Haiku declaration has no thought-level control', () => {
    render(
      <SessionEffortFixture
        sessionModel="claude-code:haiku"
        model={{ id: 'claude-code:haiku', supportedEffortLevels: [] }}
      />,
    );

    expect(screen.queryByTestId('effort-level-selector')).toBeNull();
  });
});
