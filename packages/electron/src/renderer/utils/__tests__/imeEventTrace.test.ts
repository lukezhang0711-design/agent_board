// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('IME event trace switch', () => {
  it('is off by default and writes nothing', async () => {
    vi.stubEnv('IS_DEV_MODE', 'false');
    vi.stubEnv('NIMBALYST_IME_EVENT_TRACE', 'true');
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { IME_EVENT_TRACE_ENABLED, traceImeKeyDown } = await import('../imeEventTrace');

    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    traceImeKeyDown('AIInput', event, '中文短句', 'send');

    expect(IME_EVENT_TRACE_ENABLED).toBe(false);
    expect(consoleInfo).not.toHaveBeenCalled();
  });

  it('writes a single JSON record only when both development flags are enabled', async () => {
    vi.stubEnv('IS_DEV_MODE', 'true');
    vi.stubEnv('NIMBALYST_IME_EVENT_TRACE', 'true');
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { traceImeKeyDown } = await import('../imeEventTrace');

    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    Object.defineProperty(event, 'isComposing', { value: true });
    Object.defineProperty(event, 'keyCode', { value: 229 });
    traceImeKeyDown('AgenticInput', event, '中文短句', 'ime-composition-guard');

    expect(consoleInfo).toHaveBeenCalledTimes(1);
    const [message] = consoleInfo.mock.calls[0];
    expect(typeof message).toBe('string');
    expect(JSON.parse((message as string).replace('[IME_TRACE] ', ''))).toMatchObject({
      surface: 'AgenticInput',
      event: 'keydown',
      value: '中文短句',
      key: 'Enter',
      keyCode: 229,
      isComposing: true,
      defaultPrevented: false,
      branch: 'ime-composition-guard',
    });
  });

  it('keeps composition, beforeinput, and input records distinguishable', async () => {
    vi.stubEnv('IS_DEV_MODE', 'true');
    vi.stubEnv('NIMBALYST_IME_EVENT_TRACE', 'true');
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    const {
      traceImeBeforeInput,
      traceImeCompositionEvent,
      traceImeInput,
    } = await import('../imeEventTrace');

    traceImeCompositionEvent(
      'AIInput',
      new CompositionEvent('compositionupdate', { data: 'zhong' }),
      'zhong',
    );
    traceImeBeforeInput(
      'AIInput',
      new InputEvent('beforeinput', { data: '中', inputType: 'insertCompositionText' }),
      '中',
    );
    traceImeInput(
      'AIInput',
      new InputEvent('input', { data: '中', inputType: 'insertText' }),
      '中文',
    );

    const records = consoleInfo.mock.calls.map(([message]) => JSON.parse((message as string).replace('[IME_TRACE] ', '')));
    expect(records).toEqual([
      expect.objectContaining({
        event: 'compositionupdate',
        branch: 'compositionupdate',
        data: 'zhong',
        value: 'zhong',
      }),
      expect.objectContaining({
        event: 'beforeinput',
        branch: 'beforeinput',
        inputType: 'insertCompositionText',
        data: '中',
        value: '中',
      }),
      expect.objectContaining({
        event: 'input',
        branch: 'input',
        inputType: 'insertText',
        data: '中',
        value: '中文',
      }),
    ]);
  });
});
