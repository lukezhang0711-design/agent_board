import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CODEX_SKILL_CONTROL_NOTICE,
  DEFAULT_DISPATCH_SKILL_BUNDLES,
  DISPATCH_SKILL_SETTINGS_KEY,
  filterEnabledDispatchSkills,
  formatTokenCount,
  groupSkillsByCategory,
  mergeSkillsByName,
  readDispatchSkillSettings,
  sanitizeDispatchSkillSettingsForLibrary,
  type DispatchSkillBundle,
  type DispatchSkillDescriptor,
  type DispatchSkillSettings,
  type MergedSkillCard,
  type SkillCategory,
} from '../../utils/dispatchSkillLibrary';
import { MaterialSymbol } from '@nimbalyst/runtime';

interface SkillLibraryPanelProps {
  workspacePath?: string;
}

const SCOPE_LABELS: Record<string, string> = {
  global: '全局',
  project: '项目',
  plugin: '插件',
  config: '配置',
};

const SOURCE_LABELS: Record<string, string> = {
  user: '用户',
  project: '项目',
  plugin: '插件',
  builtin: '内置',
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
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<SkillCategory | null>(null);
  const [expandedCardNames, setExpandedCardNames] = useState<Set<string>>(new Set());
  const [scanErrors, setScanErrors] = useState<string[]>([]);
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
      setScanErrors([]);
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

        if (Array.isArray(listResult?.errors) && listResult.errors.length > 0) {
          setScanErrors(listResult.errors);
        } else if (typeof listResult?.error === 'string' && listResult.error.trim()) {
          setScanErrors([listResult.error.trim()]);
        }

        setSkills(discovered);
        setSettings(normalized);
        setSelectedBundleId(normalized.bundles[0]?.id ?? 'construction');
        setStatus('ready');
      } catch (err: any) {
        if (!cancelled) {
          setStatus('failed');
          const message = err?.message || '技能库读取失败。';
          setScanErrors([message]);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  const enabledSkills = useMemo(() => filterEnabledDispatchSkills(skills, settings), [skills, settings]);

  const mergedCards = useMemo(() => mergeSkillsByName(skills, settings), [skills, settings]);

  const totalSkills = mergedCards.length;
  const totalTokens = useMemo(
    () => mergedCards.reduce((sum, card) => sum + card.estimatedTokens, 0),
    [mergedCards],
  );

  const filteredCards = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return mergedCards;
    return mergedCards.filter(
      (card) =>
        card.name.toLowerCase().includes(query)
        || card.summaryZh.toLowerCase().includes(query)
        || (card.rawDescription && card.rawDescription.toLowerCase().includes(query)),
    );
  }, [mergedCards, searchQuery]);

  const categoryGroups = useMemo(() => groupSkillsByCategory(mergedCards), [mergedCards]);
  const searchGroups = useMemo(
    () => (searchQuery.trim() ? groupSkillsByCategory(filteredCards).filter((g) => g.cards.length > 0) : []),
    [filteredCards, searchQuery],
  );

  const hasCodexSkills = useMemo(
    () => skills.some((s) => s.engine === 'codex'),
    [skills],
  );

  const selectedBundle = settings.bundles.find((bundle) => bundle.id === selectedBundleId)
    ?? settings.bundles[0]
    ?? null;

  const updateSettings = (updater: (current: DispatchSkillSettings) => DispatchSkillSettings) => {
    void persistSettings(updater(settings));
  };

  const toggleSkillDisabled = (card: MergedSkillCard, disabled: boolean) => {
    const cardDescriptorIds = new Set(card.descriptors.map((d) => d.id));
    updateSettings((current) => {
      const disabledSet = new Set(current.disabledSkillIds);
      if (disabled) {
        for (const id of cardDescriptorIds) {
          disabledSet.add(id);
        }
      } else {
        for (const id of cardDescriptorIds) {
          disabledSet.delete(id);
        }
      }
      return {
        disabledSkillIds: Array.from(disabledSet),
        bundles: current.bundles.map((bundle) => ({
          ...bundle,
          skillIds: disabled
            ? bundle.skillIds.filter((id) => !cardDescriptorIds.has(id))
            : bundle.skillIds,
        })),
      };
    });
  };

  const toggleCardExpanded = (cardName: string) => {
    setExpandedCardNames((prev) => {
      const next = new Set(prev);
      if (next.has(cardName)) {
        next.delete(cardName);
      } else {
        next.add(cardName);
      }
      return next;
    });
  };

  const renderCard = (card: MergedSkillCard) => {
    const isExpanded = expandedCardNames.has(card.name);
    return (
      <div
        key={card.name}
        data-testid={`skill-card-${card.name}`}
        className={`flex flex-col justify-between gap-3 rounded-lg border p-3.5 transition-all duration-150 bg-[var(--nim-bg)] ${
          card.disabled
            ? 'border-[var(--nim-border-subtle)] opacity-70'
            : 'border-[var(--nim-border)] hover:border-[var(--nim-border-strong)] shadow-xs'
        }`}
      >
        <div className="flex flex-col gap-2.5">
          {/* Card Top: Name & Switch */}
          <label className="flex items-start justify-between gap-2 cursor-pointer">
            <span className="font-semibold text-sm text-[var(--nim-text)] leading-snug break-words">
              {card.name}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--nim-text-muted)] select-none">
              启用
              <input
                type="checkbox"
                checked={!card.disabled}
                onChange={(e) => toggleSkillDisabled(card, !e.currentTarget.checked)}
              />
            </span>
          </label>

          {/* Engine Badges & Content Comparison Badge */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`px-1.5 py-0.5 rounded text-[11px] font-mono border ${
                card.engines.claude
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                  : 'bg-[var(--nim-bg-subtle)] text-[var(--nim-text-muted)] border-[var(--nim-border-subtle)]'
              }`}
            >
              Claude {card.engines.claude ? '✓' : '✗'}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[11px] font-mono border ${
                card.engines.codex
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                  : 'bg-[var(--nim-bg-subtle)] text-[var(--nim-text-muted)] border-[var(--nim-border-subtle)]'
              }`}
            >
              Codex {card.engines.codex ? '✓' : '✗'}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[11px] font-mono border ${
                card.engines.gemini
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                  : 'bg-[var(--nim-bg-subtle)] text-[var(--nim-text-muted)] border-[var(--nim-border-subtle)]'
              }`}
            >
              Gemini {card.engines.gemini ? '✓' : '✗'}
            </span>

            {card.contentMatch === 'same' && (
              <span className="px-1.5 py-0.5 rounded text-[11px] bg-[var(--nim-bg-subtle)] text-[var(--nim-text-muted)] border border-[var(--nim-border-subtle)]">
                内容一致
              </span>
            )}
            {card.contentMatch === 'different' && (
              <span className="px-1.5 py-0.5 rounded text-[11px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-medium">
                两家内容不一样
              </span>
            )}
          </div>

          {/* One-sentence Chinese summary */}
          <div className="text-xs text-[var(--nim-text)] leading-relaxed">
            {card.hasDescription ? (
              card.enrichmentFailed ? (
                <span className="text-amber-600 dark:text-amber-400">
                  [生成未成功] {card.summaryZh}
                </span>
              ) : (
                <span>{card.summaryZh}</span>
              )
            ) : (
              <span className="text-[var(--nim-text-muted)] italic">这个技能没有自带说明</span>
            )}
          </div>

          {/* Expanded full description */}
          {isExpanded && card.rawDescription && (
            <div className="mt-1 rounded-md bg-[var(--nim-bg-subtle)] p-2.5 text-xs text-[var(--nim-text-muted)] font-mono whitespace-pre-wrap max-h-48 overflow-y-auto border border-[var(--nim-border-subtle)]">
              {card.rawDescription}
            </div>
          )}
        </div>

        {/* Card Footer: Metadata & Expand button */}
        <div className="pt-2 border-t border-[var(--nim-border-subtle)] flex flex-col gap-1.5 text-[11px] text-[var(--nim-text-muted)]">
          <div className="flex items-center justify-between gap-2">
            <span>约 {card.estimatedTokens} token (估算)</span>
            {card.hasDescription && (
              <button
                type="button"
                className="text-[11px] text-[var(--nim-primary)] hover:underline cursor-pointer border-none bg-transparent p-0"
                onClick={() => toggleCardExpanded(card.name)}
              >
                {isExpanded ? '收起说明' : '展开说明'}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>
              {card.scopes.map((s) => SCOPE_LABELS[s] ?? s).join('/')} · {card.sources.map((s) => SOURCE_LABELS[s] ?? s).join('/')}
            </span>
            <span>·</span>
            <span>
              {card.bundleNames.length > 0 ? `在「${card.bundleNames.join('」「')}」中` : '未加入包'}
            </span>
          </div>
        </div>
      </div>
    );
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
      {/* Header with Title and Overview */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
          <h2 className="text-lg font-semibold text-[var(--nim-text)]">技能库</h2>
          {status !== 'loading' && (
            <div className="text-xs font-semibold text-[var(--nim-text-muted)] tracking-wide">
              {totalSkills} 个技能 · 约 {formatTokenCount(totalTokens)} token
            </div>
          )}
        </div>
        <p className="text-sm text-[var(--nim-text-muted)] max-w-[72ch]">
          库级禁用后，该技能会从所有包移除，也不会出现在派发可选清单里。
        </p>
      </div>

      {/* Verbatim Scan Errors */}
      {scanErrors.length > 0 && (
        <div className="rounded-md border border-[var(--nim-danger)] bg-[var(--nim-danger-subtle)] p-3 text-sm text-[var(--nim-danger)] flex flex-col gap-1">
          <div className="font-semibold flex items-center gap-1.5">
            <MaterialSymbol icon="warning" size={16} />
            <span>扫描发现异常：</span>
          </div>
          {scanErrors.map((err, idx) => (
            <div key={idx} className="font-mono text-xs whitespace-pre-wrap pl-5">{err}</div>
          ))}
        </div>
      )}

      {status === 'failed' && scanErrors.length === 0 && (
        <div className="rounded-md border border-[var(--nim-danger)] bg-[var(--nim-danger-subtle)] px-3 py-2 text-sm text-[var(--nim-danger)]">
          技能库读取失败。
        </div>
      )}

      {/* Codex Notice */}
      {hasCodexSkills && (
        <div className="rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-subtle)] px-3 py-2 text-xs text-[var(--nim-text-muted)] flex items-center gap-2">
          <MaterialSymbol icon="info" size={16} className="text-[var(--nim-text-muted)] shrink-0" />
          <span>{CODEX_SKILL_CONTROL_NOTICE}</span>
        </div>
      )}

      {/* Search Bar */}
      <div className="relative">
        <MaterialSymbol
          icon="search"
          size={18}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nim-text-muted)] pointer-events-none"
        />
        <input
          type="text"
          className="w-full rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg)] pl-9 pr-3 py-2 text-sm text-[var(--nim-text)] placeholder-[var(--nim-text-muted)] focus:outline-none focus:border-[var(--nim-primary)]"
          placeholder="搜索技能名称或说明..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--nim-text-muted)] hover:text-[var(--nim-text)] cursor-pointer"
            onClick={() => setSearchQuery('')}
          >
            清空
          </button>
        )}
      </div>

      {/* Cards Section with Taxonomy Grouping & Default Collapsed View */}
      <section className="flex flex-col gap-4">
        {status === 'loading' ? (
          <div className="py-8 text-center text-sm text-[var(--nim-text-muted)]">读取中...</div>
        ) : searchQuery.trim() ? (
          searchGroups.length === 0 ? (
            <div className="rounded-lg border border-[var(--nim-border)] px-4 py-8 text-center text-sm text-[var(--nim-text-muted)]">
              没有找到匹配的技能。
            </div>
          ) : (
            searchGroups.map((group) => (
              <div key={group.category} className="flex flex-col gap-2 rounded-lg border border-[var(--nim-border)] p-3 bg-[var(--nim-bg-subtle)]">
                <div className="flex items-center justify-between gap-2 px-1 py-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-[var(--nim-text)]">{group.category}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--nim-bg)] text-[var(--nim-text-muted)] border border-[var(--nim-border-subtle)] font-mono">
                      {group.cards.length}
                    </span>
                    <span className="text-xs text-[var(--nim-text-muted)]">
                      {group.representativeUsage}
                    </span>
                  </div>
                  <span className="text-xs text-[var(--nim-text-muted)] font-mono">
                    约 {formatTokenCount(group.totalTokens)} token
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3 pt-1">
                  {group.cards.map((card) => renderCard(card))}
                </div>
              </div>
            ))
          )
        ) : categoryGroups.length === 0 ? (
          <div className="rounded-lg border border-[var(--nim-border)] px-4 py-8 text-center text-sm text-[var(--nim-text-muted)]">
            未发现本机技能。
          </div>
        ) : (
          categoryGroups.map((group) => {
            const isExpanded = expandedCategory === group.category;
            return (
              <div key={group.category} className="flex flex-col gap-2 rounded-lg border border-[var(--nim-border)] p-3 bg-[var(--nim-bg-subtle)]">
                {/* Category Row Header */}
                <button
                  type="button"
                  className="flex items-center justify-between gap-2 px-1 py-1 text-left cursor-pointer border-none bg-transparent hover:text-[var(--nim-text)]"
                  onClick={() => setExpandedCategory(isExpanded ? null : group.category)}
                >
                  <div className="flex items-center gap-2">
                    <MaterialSymbol
                      icon={isExpanded ? 'expand_more' : 'chevron_right'}
                      size={18}
                      className="text-[var(--nim-text-muted)]"
                    />
                    <span className="font-semibold text-sm text-[var(--nim-text)]">{group.category}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--nim-bg)] text-[var(--nim-text-muted)] border border-[var(--nim-border-subtle)] font-mono">
                      {group.cards.length}
                    </span>
                    <span className="text-xs text-[var(--nim-text-muted)]">
                      {group.representativeUsage}
                    </span>
                  </div>
                  <span className="text-xs text-[var(--nim-text-muted)] font-mono">
                    约 {formatTokenCount(group.totalTokens)} token
                  </span>
                </button>

                {/* Cards in Category (rendered ONLY when expanded) */}
                {isExpanded && (
                  <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3 pt-1">
                    {group.cards.map((card) => renderCard(card))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      {/* Bundles Section */}
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
                <span className="text-xs font-mono">{bundle.skillIds.length}</span>
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
            <button type="button" className="rounded-md border border-[var(--nim-border)] px-3 py-1.5 text-sm text-[var(--nim-text)] cursor-pointer hover:bg-[var(--nim-bg-subtle)]" onClick={addBundle}>
              新建
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--nim-border)] p-4 bg-[var(--nim-bg)]">
          {selectedBundle ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-subtle)] px-2 py-1.5 text-sm font-medium text-[var(--nim-text)]"
                  value={selectedBundle.name}
                  onChange={(event) => updateSelectedBundle((bundle) => ({ ...bundle, name: event.currentTarget.value }))}
                />
                <button type="button" className="rounded-md border border-[var(--nim-border)] px-3 py-1.5 text-sm text-[var(--nim-text)] cursor-pointer hover:bg-[var(--nim-bg-subtle)]" onClick={deleteSelectedBundle}>
                  删除
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {enabledSkills.map((skill) => (
                  <label key={skill.id} className="flex min-w-0 items-start gap-2 rounded-md border border-[var(--nim-border-subtle)] p-2.5 text-sm text-[var(--nim-text)] hover:bg-[var(--nim-bg-subtle)] cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 shrink-0"
                      checked={selectedBundle.skillIds.includes(skill.id)}
                      onChange={(event) => toggleBundleSkill(skill.id, event.currentTarget.checked)}
                    />
                    <span className="min-w-0 flex flex-col gap-0.5">
                      <span className="block truncate font-medium">{skill.name}</span>
                      <span className="block text-xs text-[var(--nim-text-muted)]">
                        {skill.engine} · {SCOPE_LABELS[skill.scope] ?? skill.scope}
                        {skill.description ? ` · ${skill.description.slice(0, 50)}...` : ''}
                      </span>
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
