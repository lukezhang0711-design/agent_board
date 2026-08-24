// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: () => null,
}));

import { EffortLevelSelector } from '../EffortLevelSelector';

describe('EffortLevelSelector dynamic catalog', () => {
  it('GREEN: offers ultra when the selected live model advertises it, without inventing max', () => {
    render(
      <EffortLevelSelector
        level="ultra"
        onLevelChange={vi.fn()}
        supportedLevels={['low', 'ultra']}
      />,
    );

    fireEvent.click(screen.getByTestId('effort-level-selector'));

    expect(screen.getAllByText('Ultra')).toHaveLength(2);
    expect(screen.getByText('Low')).toBeTruthy();
    expect(screen.queryByText('Max')).toBeNull();
  });

  it('GREEN FB-115: renders an unknown engine-declared level without a product enum', () => {
    render(
      <EffortLevelSelector
        level="turbo"
        onLevelChange={vi.fn()}
        supportedLevels={['turbo', 'deep']}
      />,
    );

    fireEvent.click(screen.getByTestId('effort-level-selector'));

    expect(screen.getAllByText('turbo')).toHaveLength(2);
    expect(screen.getByText('deep')).toBeTruthy();
  });

  it('GREEN FB-114: renders no control for a model with no effort declaration', () => {
    const { container } = render(
      <EffortLevelSelector
        level="low"
        onLevelChange={vi.fn()}
        supportedLevels={[]}
      />,
    );

    expect(screen.queryByTestId('effort-level-selector')).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
