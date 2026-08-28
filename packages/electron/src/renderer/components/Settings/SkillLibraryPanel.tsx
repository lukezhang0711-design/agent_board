import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_DISPATCH_SKILL_BUNDLES,
  DISPATCH_SKILL_SETTINGS_KEY,
  filterEnabledDispatchSkills,
  readDispatchSkillSettings,
  sanitizeDispatchSkillSettingsForLibrary,
  type DispatchSkillBundle,
  type DispatchSkillDescriptor,
  type DispatchSkillSettings,
} from '../../utils/dispatchSkillLibrary';
import { MaterialSymbol } from '@nimbalyst/runtime';

interface SkillLibraryPanelProps {
  workspacePath?: string;
}

const ENGINE_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

const SCOPE_LABELS: Record<string, string> = {
  global: '全局',
  project: '项目',
  plugin: '插件',
  config: '配置',
};

function makeBundleId(name: string): string {
  return `bundle-${name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '') || Date.now()}`;
}

function ensureBundleNames(settings: DispatchSkillSettings): DispatchSkillSettings {
  if (settings.bundles.length > 0) {
    return settings;
  }
  return {
    ...settings,
    bundles: DEFAULT_DISPATCH_SKILL_BUNDLES.map((bundle) => ({ ...bundle })),
  };
}

export function SkillLibraryPanel({ workspacePath }: SkillLibraryPanelProps) {
  const [skills, setSkills] = useState<DispatchSkillDescriptor[]>([]);
  const [settings, setSettings] = useState<DispatchSkillSettings>(() =>
    ensureBundleNames(readDispatchSkillSettings(undefined)),
  );
  const [selectedBundleId, setSelectedBundleId] = useState<string>('construction');
  const [newBundleName, setNewBundleName] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  const persistSettings = useCallback(async (next: DispatchSkillSettings) => {
    setSettings(next);
    setSaveState('saving');
    try {
      await window.electronAPI.invoke('app-settings:set', DISPATCH_SKILL_SETTINGS_KEY, next);
      setSaveState('saved');
    } catch {
      setSaveState('failed');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatus('loading');
      try {
        const [listResult, stored] = await Promise.all([
          window.electronAPI.invoke('dispatch-skills:list', workspacePath),
          window.electronAPI.invoke('app-settings:get', DISPATCH_SKILL_SETTINGS_KEY),
        ]);
        if (cancelled) {
          return;
        }
        const discovered = Array.isArray(listResult?.skills) ? listResult.skills : [];
        const normalized = sanitizeDispatchSkillSettingsForLibrary(
          ensureBundleNames(readDispatchSkillSettings(stored)),
          discovered,
        );
        setSkills(discovered);
        setSettings(normalized);
        setSelectedBundleId(normalized.bundles[0]?.id ?? 'construction');
        setStatus('ready');
      } catch {
        if (!cancelled) {
          setStatus('failed');
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  const enabledSkills = useMemo(() => filterEnabledDispatchSkills(skills, settings), [skills, settings]);
  const selectedBundle = settings.bundles.find((bundle) => bundle.id === selectedBundleId)
    ?? settings.bundles[0]
    ?? null;
  const groupedSkills = useMemo(() => {
    const groups = new Map<string, DispatchSkillDescriptor[]>();
    for (const skill of skills) {
      const key = skill.engine;
      groups.set(key, [...(groups.get(key) ?? []), skill]);
    }
    return Array.from(groups.entries());
  }, [skills]);

  const updateSettings = (updater: (current: DispatchSkillSettings) => DispatchSkillSettings) => {
    void persistSettings(updater(settings));
  };

  const toggleDisabled = (skillId: string, disabled: boolean) => {
    updateSettings((current) => {
      const disabledSet = new Set(current.disabledSkillIds);
      if (disabled) {
        disabledSet.add(skillId);
      } else {
        disabledSet.delete(skillId);
      }
      return {
        disabledSkillIds: Array.from(disabledSet),
        bundles: current.bundles.map((bundle) => ({
          ...bundle,
          skillIds: disabled ? bundle.skillIds.filter((id) => id !== skillId) : bundle.skillIds,
        })),
      };
    });
  };

  const updateSelectedBundle = (updater: (bundle: DispatchSkillBundle) => DispatchSkillBundle) => {
    if (!selectedBundle) {
      return;
    }
    updateSettings((current) => ({
      ...current,
      bundles: current.bundles.map((bundle) =>
        bundle.id === selectedBundle.id ? updater(bundle) : bundle,
      ),
    }));
  };

  const addBundle = () => {
    const name = newBundleName.trim();
    if (!name) {
      return;
    }
    const id = makeBundleId(name);
    const nextBundle = { id, name, skillIds: [] };
    setNewBundleName('');
    setSelectedBundleId(id);
    updateSettings((current) => ({
      ...current,
      bundles: [...current.bundles, nextBundle],
    }));
  };

  const deleteSelectedBundle = () => {
    if (!selectedBundle) {
      return;
    }
    updateSettings((current) => {
      const bundles = current.bundles.filter((bundle) => bundle.id !== selectedBundle.id);
      setSelectedBundleId(bundles[0]?.id ?? '');
      return { ...current, bundles };
    });
  };

  const toggleBundleSkill = (skillId: string, checked: boolean) => {
    updateSelectedBundle((bundle) => {
      const ids = new Set(bundle.skillIds);
      if (checked) {
        ids.add(skillId);
      } else {
        ids.delete(skillId);
      }
      return { ...bundle, skillIds: Array.from(ids) };
    });
  };

  return (
    <div className="skill-library-panel flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--nim-text)] mb-2">技能库</h2>
        <p className="text-sm text-[var(--nim-text-muted)] max-w-[72ch]">
          只列本机已存在的技能。库级禁用后，该技能会从所有包移除，也不会出现在派发可选清单里。
        </p>
      </div>

      {status === 'failed' && (
        <div className="rounded-md border border-[var(--nim-danger)] px-3 py-2 text-sm text-[var(--nim-danger)]">
          技能库读取失败。
        </div>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-[var(--nim-text)]">本机技能</h3>
          <span className="text-xs text-[var(--nim-text-muted)]">
            {status === 'loading' ? '读取中' : `${enabledSkills.length}/${skills.length} 可授予`}
          </span>
        </div>
        <div className="overflow-hidden rounded-lg border border-[var(--nim-border)]">
          {groupedSkills.length === 0 && status !== 'loading' ? (
            <div className="px-4 py-6 text-sm text-[var(--nim-text-muted)]">未发现本机技能。</div>
          ) : (
            groupedSkills.map(([engine, engineSkills]) => (
              <div key={engine} className="border-b border-[var(--nim-border)] last:border-b-0">
                <div className="flex items-center gap-2 bg-[var(--nim-bg-subtle)] px-4 py-2 text-xs font-semibold uppercase text-[var(--nim-text-muted)]">
                  <MaterialSymbol icon="school" size={16} />
                  {ENGINE_LABELS[engine] ?? engine}
                </div>
                {engineSkills.map((skill) => {
                  const disabled = settings.disabledSkillIds.includes(skill.id);
                  return (
                    <label key={skill.id} className="flex items-start justify-between gap-4 border-t border-[var(--nim-border-subtle)] px-4 py-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[var(--nim-text)]">{skill.name}</span>
                        <span className="mt-1 block text-xs text-[var(--nim-text-muted)]">
                          {SCOPE_LABELS[skill.scope] ?? skill.scope} · {skill.source}
                          {skill.description ? ` · ${skill.description}` : ''}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--nim-text-muted)]">
                        启用
                        <input
                          type="checkbox"
                          checked={!disabled}
                          onChange={(event) => toggleDisabled(skill.id, !event.currentTarget.checked)}
                        />
                      </span>
                    </label>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-[var(--nim-text)]">技能包</h3>
          <div className="flex flex-col overflow-hidden rounded-lg border border-[var(--nim-border)]">
            {settings.bundles.map((bundle) => (
              <button
                key={bundle.id}
                type="button"
                className={`flex items-center justify-between gap-3 px-3 py-2 text-left text-sm ${bundle.id === selectedBundle?.id ? 'bg-[var(--nim-bg-subtle)] text-[var(--nim-text)]' : 'text-[var(--nim-text-muted)]'}`}
                onClick={() => setSelectedBundleId(bundle.id)}
              >
                <span className="truncate">{bundle.name}</span>
                <span className="text-xs">{bundle.skillIds.length}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg)] px-2 py-1.5 text-sm text-[var(--nim-text)]"
              value={newBundleName}
              onChange={(event) => setNewBundleName(event.currentTarget.value)}
              placeholder="新包名"
            />
            <button type="button" className="rounded-md border border-[var(--nim-border)] px-3 py-1.5 text-sm text-[var(--nim-text)]" onClick={addBundle}>
              新建
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--nim-border)] p-4">
          {selectedBundle ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg)] px-2 py-1.5 text-sm font-medium text-[var(--nim-text)]"
                  value={selectedBundle.name}
                  onChange={(event) => updateSelectedBundle((bundle) => ({ ...bundle, name: event.currentTarget.value }))}
                />
                <button type="button" className="rounded-md border border-[var(--nim-border)] px-3 py-1.5 text-sm text-[var(--nim-text)]" onClick={deleteSelectedBundle}>
                  删除
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {enabledSkills.map((skill) => (
                  <label key={skill.id} className="flex min-w-0 items-start gap-2 rounded-md border border-[var(--nim-border-subtle)] px-3 py-2 text-sm text-[var(--nim-text)]">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selectedBundle.skillIds.includes(skill.id)}
                      onChange={(event) => toggleBundleSkill(skill.id, event.currentTarget.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate">{skill.name}</span>
                      <span className="block text-xs text-[var(--nim-text-muted)]">{ENGINE_LABELS[skill.engine] ?? skill.engine} · {SCOPE_LABELS[skill.scope] ?? skill.scope}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-sm text-[var(--nim-text-muted)]">选择或新建一个技能包。</div>
          )}
        </div>
      </section>

      <div className="text-xs text-[var(--nim-text-muted)]">
        {saveState === 'saving' ? '保存中' : saveState === 'failed' ? '保存失败' : saveState === 'saved' ? '已保存' : ''}
      </div>
    </div>
  );
}
