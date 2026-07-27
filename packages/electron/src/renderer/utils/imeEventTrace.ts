export type ImeTraceSurface = 'AIInput' | 'AgenticInput';

type ImeTraceRecord = {
  timestamp: string;
  surface: ImeTraceSurface;
  event: string;
  defaultPrevented: boolean;
  value: string;
  branch?: string;
  key?: string;
  keyCode?: number;
  isComposing?: boolean;
  inputType?: string;
  data?: string | null;
};

/**
 * IME tracing is compiled into development builds only and must also be
 * explicitly enabled when that build starts. The renderer Vite config replaces
 * both values with literals, so production builds do not register trace-only
 * event listeners or emit trace logs.
 */
export const IME_EVENT_TRACE_ENABLED =
  typeof process !== 'undefined'
  && process.env.IS_DEV_MODE === 'true'
  && process.env.NIMBALYST_IME_EVENT_TRACE === 'true';

function writeImeTrace(record: ImeTraceRecord): void {
  if (!IME_EVENT_TRACE_ENABLED) return;
  console.info(`[IME_TRACE] ${JSON.stringify(record)}`);
}

export function traceImeCompositionEvent(
  surface: ImeTraceSurface,
  event: CompositionEvent,
  value: string,
): void {
  writeImeTrace({
    timestamp: new Date().toISOString(),
    surface,
    event: event.type,
    defaultPrevented: event.defaultPrevented,
    value,
    branch: event.type,
    data: event.data,
  });
}

export function traceImeKeyDown(
  surface: ImeTraceSurface,
  event: KeyboardEvent,
  value: string,
  branch: string,
): void {
  writeImeTrace({
    timestamp: new Date().toISOString(),
    surface,
    event: event.type,
    defaultPrevented: event.defaultPrevented,
    value,
    branch,
    key: event.key,
    keyCode: event.keyCode,
    isComposing: event.isComposing,
  });
}

export function traceImeBeforeInput(
  surface: ImeTraceSurface,
  event: InputEvent,
  value: string,
): void {
  writeImeTrace({
    timestamp: new Date().toISOString(),
    surface,
    event: event.type,
    defaultPrevented: event.defaultPrevented,
    value,
    branch: 'beforeinput',
    inputType: event.inputType,
    data: event.data,
    isComposing: event.isComposing,
  });
}

export function traceImeInput(
  surface: ImeTraceSurface,
  event: InputEvent,
  value: string,
): void {
  writeImeTrace({
    timestamp: new Date().toISOString(),
    surface,
    event: event.type,
    defaultPrevented: event.defaultPrevented,
    value,
    branch: 'input',
    inputType: event.inputType,
    data: event.data,
    isComposing: event.isComposing,
  });
}
