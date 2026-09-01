import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CODEX_SKILL_CONTROL_NOTICE,
  DISPATCH_SKILL_SETTINGS_KEY,
  formatTokenCount,
  groupSkillsByCategory,
  mergeSkillsByName,
  readDispatchSkillSettings,
  sanitizeDispatchSkillSettingsForLibrary,
  type DispatchSkillBundle,
  type DispatchSkillDescriptor,
  type DispatchSkillSettings,
  type MergedSkillCard,
} from '../../utils/dispatchSkillLibrary';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { getEffectiveSkillTaxonomy } from '../../../shared/skillTaxonomy';

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

export function SkillLibraryPanel({ workspacePath }: SkillLibraryPanelProps) {
  const [skills, setSkills] = useState<DispatchSkillDescriptor[]>([]);
  const [settings, setSettings] = useState<DispatchSkillSettings>(() =>
    readDispatchSkillSettings(undefined),
  );
  const [editingBundleId, setEditingBundleId] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
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
          readDispatchSkillSettings(stored),
          discovered,
        );

        if (Array.isArray(listResult?.errors) && listResult.errors.length > 0) {
          setScanErrors(listResult.errors);
        } else if (typeof listResult?.error === 'string' && listResult.error.trim()) {
          setScanErrors([listResult.error.trim()]);
        }

        setSkills(discovered);
        setSettings(normalized);
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

  useEffect(() => {
    const unsubscribe = window.electronAPI?.on?.('dispatch-skill-library:changed', (payload) => {
      const nextSettings = sanitizeDispatchSkillSettingsForLibrary(
        readDispatchSkillSettings(payload?.settings ?? payload),
        skills,
      );
      setSettings(nextSettings);
      setSaveState('saved');
    });
    return () => unsubscribe?.();
  }, [skills]);

  const mergedCards = useMemo(() => mergeSkillsByName(skills, settings), [skills, settings]);
  const activeTaxonomy = useMemo(
    () => getEffectiveSkillTaxonomy(settings.taxonomy),
    [settings.taxonomy],
  );

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

  const categoryGroups = useMemo(
    () => groupSkillsByCategory(mergedCards, activeTaxonomy.categories),
    [activeTaxonomy.categories, mergedCards],
  );
  const searchGroups = useMemo(
    () => (searchQuery.trim()
      ? groupSkillsByCategory(filteredCards, activeTaxonomy.categories).filter((g) => g.cards.length > 0)
      : []),
    [activeTaxonomy.categories, filteredCards, searchQuery],
  );

  const hasCodexSkills = useMemo(
    () => skills.some((s) => s.engine === 'codex'),
    [skills],
  );

  const editingBundle = useMemo(
    () => settings.bundles.find((bundle) => bundle.id === editingBundleId) ?? null,
    [settings.bundles, editingBundleId],
  );

  const updateSettings = (updater: (current: DispatchSkillSettings) => DispatchSkillSettings) => {
    void persistSettings(updater(settings));
  };

  const handleCreateBundle = () => {
    const baseName = '新技能包';
    let name = baseName;
    let counter = 1;
    const existingNames = new Set(settings.bundles.map((b) => b.name));
    while (existingNames.has(name)) {
      counter += 1;
      name = `${baseName} ${counter}`;
    }
    const id = makeBundleId(name);
    const nextBundle: DispatchSkillBundle = { id, name, skillIds: [] };
    updateSettings((current) => ({
      ...current,
      bundles: [...current.bundles, nextBundle],
    }));
    setEditingBundleId(id);
    setRenameValue(name);
    setIsRenaming(true);
  };

  const handleSaveRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && editingBundle) {
      updateSettings((current) => ({
        ...current,
        bundles: current.bundles.map((bundle) =>
          bundle.id === editingBundle.id ? { ...bundle, name: trimmed } : bundle,
        ),
      }));
    }
    setIsRenaming(false);
  };

  const handleDeleteBundle = () => {
    if (!editingBundle) return;
    updateSettings((current) => ({
      ...current,
      bundles: current.bundles.filter((bundle) => bundle.id !== editingBundle.id),
    }));
    setEditingBundleId(null);
    setIsRenaming(false);
  };

  const toggleBundleSkillForCard = (card: MergedSkillCard, checked: boolean) => {
    if (!editingBundle) return;
    const descriptorIds = card.descriptors.map((d) => d.id);
    updateSettings((current) => ({
      ...current,
      bundles: current.bundles.map((bundle) => {
        if (bundle.id !== editingBundle.id) return bundle;
        const ids = new Set(bundle.skillIds);
        if (checked) {
          for (const id of descriptorIds) ids.add(id);
        } else {
          for (const id of descriptorIds) ids.delete(id);
        }
        return { ...bundle, skillIds: Array.from(ids) };
      }),
    }));
  };

  const handleSaveSearchToBundle = () => {
    if (filteredCards.length === 0) return;
    const query = searchQuery.trim();
    const baseName = query ? `${query}包` : '新技能包';
    let name = baseName;
    let counter = 1;
    const existingNames = new Set(settings.bundles.map((b) => b.name));
    while (existingNames.has(name)) {
      counter += 1;
      name = `${baseName} ${counter}`;
    }
    const id = makeBundleId(name);
    const skillIds = Array.from(
      new Set(filteredCards.flatMap((card) => card.descriptors.map((d) => d.id))),
    );
    const nextBundle: DispatchSkillBundle = { id, name, skillIds };
    updateSettings((current) => ({
      ...current,
      bundles: [...current.bundles, nextBundle],
    }));
    setEditingBundleId(id);
    setIsRenaming(false);
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
        ...current,
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
    const isCardInEditingBundle = editingBundle
      ? card.descriptors.some((d) => editingBundle.skillIds.includes(d.id))
      : false;

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
          {/* Card Top: Name (with bundle checkbox in editing mode) & Switch */}
          <div className="flex items-start justify-between gap-2">
            {editingBundle ? (
              <label className="flex items-center gap-2 cursor-pointer select-none min-w-0">
                <input
                  type="checkbox"
                  data-testid={`bundle-skill-checkbox-${card.name}`}
                  checked={isCardInEditingBundle}
                  onChange={(e) => toggleBundleSkillForCard(card, e.target.checked)}
                  className="rounded text-[var(--nim-primary)] cursor-pointer mt-0.5"
                />
                <span className="font-semibold text-sm text-[var(--nim-text)] leading-snug break-words">
                  {card.name}
                </span>
              </label>
            ) : (
              <span className="font-semibold text-sm text-[var(--nim-text)] leading-snug break-words">
                {card.name}
              </span>
            )}

            <label className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--nim-text-muted)] cursor-pointer select-none">
              启用
              <input
                type="checkbox"
                checked={!card.disabled}
                onChange={(e) => toggleSkillDisabled(card, !e.currentTarget.checked)}
              />
            </label>
          </div>

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

          {/* One-sentence Chinese summary or untranslated notice */}
          <div className="text-xs text-[var(--nim-text)] leading-relaxed">
            {card.hasDescription ? (
              card.enrichmentFailed ? (
                <span className="text-amber-600 dark:text-amber-400">
                  [未翻译] {card.summaryZh}
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

      {/* Bundles Section - Above the skill cards wall */}
      <div className="flex flex-col gap-3">
        {settings.bundles.length === 0 ? (
          <div
            data-testid="bundle-empty-guide"
            className="flex items-center justify-between gap-3 p-3 rounded-lg border border-[var(--nim-border)] bg-[var(--nim-bg-subtle)] text-sm text-[var(--nim-text-muted)]"
          >
            <span>选中几个技能，存成一个包</span>
            <button
              type="button"
              data-testid="create-bundle-btn"
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-text)] hover:bg-[var(--nim-bg-subtle)] cursor-pointer"
              onClick={handleCreateBundle}
            >
              + 新建
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2" data-testid="bundle-tags-list">
            {settings.bundles.map((bundle) => {
              const isEditing = editingBundleId === bundle.id;
              return (
                <button
                  key={bundle.id}
                  type="button"
                  data-testid={`bundle-tag-${bundle.id}`}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                    isEditing
                      ? 'bg-[var(--nim-primary)] text-white border-[var(--nim-primary)]'
                      : 'bg-[var(--nim-bg)] text-[var(--nim-text)] border-[var(--nim-border)] hover:border-[var(--nim-border-strong)]'
                  }`}
                  onClick={() => {
                    if (isEditing) {
                      setEditingBundleId(null);
                      setIsRenaming(false);
                    } else {
                      setEditingBundleId(bundle.id);
                      setIsRenaming(false);
                    }
                  }}
                >
                  <span>{bundle.name}</span>
                  <span
                    className={`px-1.5 py-0.2 text-[10px] rounded-full font-mono ${
                      isEditing
                        ? 'bg-white/20 text-white'
                        : 'bg-[var(--nim-bg-subtle)] text-[var(--nim-text-muted)]'
                    }`}
                  >
                    {bundle.skillIds.length}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              data-testid="create-bundle-btn"
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs border border-dashed border-[var(--nim-border)] text-[var(--nim-text-muted)] hover:text-[var(--nim-text)] hover:border-[var(--nim-border-strong)] cursor-pointer bg-transparent"
              onClick={handleCreateBundle}
            >
              + 新建
            </button>
          </div>
        )}

        {/* Persistent Editing Banner */}
        {editingBundle && (
          <div
            data-testid="bundle-editing-bar"
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-[var(--nim-primary)]/40 bg-[var(--nim-primary)]/5"
          >
            <div className="flex items-center gap-2 min-w-0">
              {isRenaming ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    autoFocus
                    data-testid="bundle-rename-input"
                    className="rounded border border-[var(--nim-primary)] bg-[var(--nim-bg)] px-2 py-1 text-sm font-medium text-[var(--nim-text)] focus:outline-none"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSaveRename();
                      } else if (e.key === 'Escape') {
                        setIsRenaming(false);
                      }
                    }}
                  />
                  <button
                    type="button"
                    data-testid="bundle-rename-save-btn"
                    className="text-xs px-2 py-1 rounded bg-[var(--nim-primary)] text-white cursor-pointer border-none"
                    onClick={handleSaveRename}
                  >
                    保存
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-medium text-[var(--nim-text)] truncate">
                    正在编辑「{editingBundle.name}」· 已选 {editingBundle.skillIds.length}
                  </span>
                  <button
                    type="button"
                    data-testid="bundle-rename-btn"
                    aria-label="改名"
                    title="改名"
                    className="p-1 rounded text-[var(--nim-text-muted)] hover:text-[var(--nim-text)] hover:bg-[var(--nim-bg-subtle)] cursor-pointer border-none bg-transparent flex items-center"
                    onClick={() => {
                      setRenameValue(editingBundle.name);
                      setIsRenaming(true);
                    }}
                  >
                    <MaterialSymbol icon="edit" size={16} />
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="bundle-delete-btn"
                className="px-2.5 py-1 text-xs rounded border border-[var(--nim-border)] text-[var(--nim-danger)] hover:bg-[var(--nim-danger-subtle)] cursor-pointer bg-transparent"
                onClick={handleDeleteBundle}
              >
                删除
              </button>
              <button
                type="button"
                data-testid="bundle-finish-btn"
                className="px-3 py-1 text-xs rounded font-medium bg-[var(--nim-primary)] text-white hover:opacity-90 cursor-pointer border-none"
                onClick={() => {
                  setEditingBundleId(null);
                  setIsRenaming(false);
                }}
              >
                完成
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Search Bar + Save Search to Bundle action */}
      <div className="flex flex-col gap-2">
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
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--nim-text-muted)] hover:text-[var(--nim-text)] cursor-pointer border-none bg-transparent"
              onClick={() => setSearchQuery('')}
            >
              清空
            </button>
          )}
        </div>

        {searchQuery.trim() && filteredCards.length > 0 && (
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-xs text-[var(--nim-text-muted)]">
              找到 {filteredCards.length} 个技能
            </span>
            <button
              type="button"
              data-testid="save-search-to-bundle-btn"
              className="px-2.5 py-1 text-xs rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-text)] hover:bg-[var(--nim-bg-subtle)] cursor-pointer"
              onClick={handleSaveSearchToBundle}
            >
              把这 {filteredCards.length} 个存成技能包
            </button>
          </div>
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
            searchGroups.map((group) => {
              const selectedCountInGroup = editingBundle
                ? group.cards.filter((card) =>
                    card.descriptors.some((d) => editingBundle.skillIds.includes(d.id)),
                  ).length
                : 0;

              return (
                <div key={group.category} className="flex flex-col gap-2 rounded-lg border border-[var(--nim-border)] p-3 bg-[var(--nim-bg-subtle)]">
                  <div className="flex items-center justify-between gap-2 px-1 py-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-[var(--nim-text)]">{group.category}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--nim-bg)] text-[var(--nim-text-muted)] border border-[var(--nim-border-subtle)] font-mono">
                        {group.cards.length}
                      </span>
                      {editingBundle && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--nim-primary)]/10 text-[var(--nim-primary)] border border-[var(--nim-primary)]/20 font-medium">
                          已选 {selectedCountInGroup}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-[var(--nim-text-muted)] font-mono">
                      约 {formatTokenCount(group.totalTokens)} token
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3 pt-1">
                    {group.cards.map((card) => renderCard(card))}
                  </div>
                </div>
              );
            })
          )
        ) : categoryGroups.length === 0 ? (
          <div className="rounded-lg border border-[var(--nim-border)] px-4 py-8 text-center text-sm text-[var(--nim-text-muted)]">
            未发现本机技能。
          </div>
        ) : (
          categoryGroups.map((group) => {
            const isExpanded = expandedCategory === group.category;
            const selectedCountInGroup = editingBundle
              ? group.cards.filter((card) =>
                  card.descriptors.some((d) => editingBundle.skillIds.includes(d.id)),
                ).length
              : 0;

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
                    {editingBundle && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--nim-primary)]/10 text-[var(--nim-primary)] border border-[var(--nim-primary)]/20 font-medium">
                        已选 {selectedCountInGroup}
                      </span>
                    )}
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

      <div className="text-xs text-[var(--nim-text-muted)]">
        {saveState === 'saving' ? '保存中' : saveState === 'failed' ? '保存失败' : saveState === 'saved' ? '已保存' : ''}
      </div>
    </div>
  );
}
