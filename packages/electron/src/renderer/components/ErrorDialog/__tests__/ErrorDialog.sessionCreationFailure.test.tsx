// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorDialog } from '../ErrorDialog';

describe('ErrorDialog session creation failure recovery', () => {
  it('FB-109 RED: keeps the original creation error visible and exposes a model-reselection control', () => {
    const onReselectModel = vi.fn();
    const originalError = '已保存的模型“not-a-real-model”不再属于当前目录，请重新选择模型。';

    render(
      <ErrorDialog
        isOpen
        onClose={vi.fn()}
        title="创建会话失败"
        message={originalError}
        recovery={(
          <button type="button" onClick={onReselectModel}>
            重新选择模型
          </button>
        )}
      />,
    );

    expect(screen.getByText(originalError)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新选择模型' }));
    expect(onReselectModel).toHaveBeenCalledOnce();
  });
});
