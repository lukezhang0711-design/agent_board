import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { describe, expect, it, vi } from 'vitest';

type AboutElement = {
  textContent: string;
  addEventListener: ReturnType<typeof vi.fn>;
};

function createAboutHarness(buildInfo: unknown) {
  const elements = new Map<string, AboutElement>([
    ['about-version', { textContent: 'Version', addEventListener: vi.fn() }],
    ['about-build', { textContent: 'Build unknown', addEventListener: vi.fn() }],
    ['nimbalyst-link', { textContent: '', addEventListener: vi.fn() }],
    ['third-party-notices-link', { textContent: '', addEventListener: vi.fn() }],
    ['support-id', { textContent: '', addEventListener: vi.fn() }],
    ['support-id-text', { textContent: 'Loading...', addEventListener: vi.fn() }],
    ['copy-feedback', { textContent: 'Copied!', addEventListener: vi.fn() }],
  ]);
  const invoke = vi.fn().mockResolvedValue(buildInfo);
  const electronAPI = {
    onThemeChange: vi.fn(),
    getTheme: vi.fn().mockResolvedValue('light'),
    getAppVersion: vi.fn().mockResolvedValue('0.65.4'),
    invoke,
    analytics: { getDistinctId: vi.fn().mockResolvedValue('support-id') },
  };
  const html = fs.readFileSync(path.resolve(__dirname, '../../../../about.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('about.html has no inline script');

  vm.runInNewContext(script, {
    window: { electronAPI },
    document: {
      body: {
        dataset: {},
        classList: { add: vi.fn(), remove: vi.fn() },
      },
      getElementById: (id: string) => elements.get(id) ?? null,
    },
    navigator: { clipboard: { writeText: vi.fn() } },
    console,
    setTimeout: vi.fn(),
  });

  return { elements, invoke };
}

async function settleInlineScripts(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('About build information', () => {
  it('shows short commit, dirty state, and UTC timestamp under Version', async () => {
    const buildInfo = {
      commit: 'a'.repeat(40),
      shortCommit: 'aaaaaaa',
      dirty: false,
      builtAtUtc: '2026-07-30T12:00:00.000Z',
    };
    const { elements, invoke } = createAboutHarness(buildInfo);

    await settleInlineScripts();

    expect(invoke).toHaveBeenCalledWith('get-build-info');
    expect(elements.get('about-version')?.textContent).toBe('Version 0.65.4');
    expect(elements.get('about-build')?.textContent).toBe(
      'Build aaaaaaa · clean · UTC 2026-07-30T12:00:00.000Z',
    );
  });

  it('keeps the unknown fallback when build-info.json is unavailable', async () => {
    const { elements } = createAboutHarness(null);

    await settleInlineScripts();

    expect(elements.get('about-build')?.textContent).toBe('Build unknown');
  });
});
