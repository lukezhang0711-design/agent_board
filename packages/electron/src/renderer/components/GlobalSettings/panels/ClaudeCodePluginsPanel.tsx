import React, { useState, useEffect, useCallback } from 'react';
import { usePostHog } from 'posthog-js/react';
import { PageHeader } from '../../common/PageHeader';
import { ErrorBoundary } from '../../ErrorBoundary';
import { useTheme } from '../../../hooks/useTheme';

// Marketplace plugin from the official registry
interface MarketplacePlugin {
  name: string;
  description: string;
  author: string;
  homepage?: string;
  source: string;
  category: string;
}

// Installed plugin from local system
interface InstalledPlugin {
  name: string;
  source: string;
  path: string;
  scope: 'user' | 'project';
  projectPath?: string;
  enabled: boolean;
}

// Marketplace data structure from GitHub
interface MarketplaceData {
  plugins: MarketplacePlugin[];
  categories: string[];
  lastUpdated?: string;
}

type ViewState = 'installed' | 'discover';

// Icon configuration for plugin templates
type IconConfig =
  | { type: 'simple-icons'; slug: string }
  | { type: 'material-symbol'; icon: string };

// Icons that are dark/black and need a light color override in dark mode
const DARK_ICONS_NEEDING_LIGHT_OVERRIDE = new Set(['github', 'notion']);

// Map plugin names/categories to icons
const PLUGIN_ICON_CONFIG: Record<string, IconConfig> = {
  // Brand icons
  github: { type: 'simple-icons', slug: 'github' },
  linear: { type: 'simple-icons', slug: 'linear' },
  slack: { type: 'simple-icons', slug: 'slack' },
  notion: { type: 'simple-icons', slug: 'notion' },
  asana: { type: 'simple-icons', slug: 'asana' },
  figma: { type: 'simple-icons', slug: 'figma' },
  vercel: { type: 'simple-icons', slug: 'vercel' },
  sentry: { type: 'simple-icons', slug: 'sentry' },
  stripe: { type: 'simple-icons', slug: 'stripe' },
  firebase: { type: 'simple-icons', slug: 'firebase' },
  supabase: { type: 'simple-icons', slug: 'supabase' },
  pinecone: { type: 'simple-icons', slug: 'pinecone' },
  playwright: { type: 'simple-icons', slug: 'playwright' },
  typescript: { type: 'simple-icons', slug: 'typescript' },
  python: { type: 'simple-icons', slug: 'python' },
  go: { type: 'simple-icons', slug: 'go' },
  rust: { type: 'simple-icons', slug: 'rust' },
  swift: { type: 'simple-icons', slug: 'swift' },
  kotlin: { type: 'simple-icons', slug: 'kotlin' },
  java: { type: 'simple-icons', slug: 'oracle' },
  php: { type: 'simple-icons', slug: 'php' },
  lua: { type: 'simple-icons', slug: 'lua' },
  gitlab: { type: 'simple-icons', slug: 'gitlab' },
  atlassian: { type: 'simple-icons', slug: 'atlassian' },
  huggingface: { type: 'simple-icons', slug: 'huggingface' },

  // Generic icons by category
  development: { type: 'material-symbol', icon: 'code' },
  productivity: { type: 'material-symbol', icon: 'task_alt' },
  database: { type: 'material-symbol', icon: 'storage' },
  testing: { type: 'material-symbol', icon: 'science' },
  security: { type: 'material-symbol', icon: 'shield' },
  learning: { type: 'material-symbol', icon: 'school' },
  design: { type: 'material-symbol', icon: 'brush' },
  monitoring: { type: 'material-symbol', icon: 'monitoring' },
  deployment: { type: 'material-symbol', icon: 'cloud_upload' },
  external: { type: 'material-symbol', icon: 'extension' },
};

// Category labels for display
const CATEGORY_LABELS: Record<string, string> = {
  development: 'Development',
  productivity: 'Productivity',
  database: 'Database',
  testing: 'Testing',
  security: 'Security',
  learning: 'Learning',
  design: 'Design',
  monitoring: 'Monitoring',
  deployment: 'Deployment',
  external: 'External / Community',
};

const CATEGORY_ORDER = [
  'development',
  'productivity',
  'database',
  'testing',
  'security',
  'learning',
  'design',
  'monitoring',
  'deployment',
  'external',
];

// Component to render plugin icon
function PluginIcon({ pluginName, category, isDark }: { pluginName: string; category: string; isDark: boolean }) {
  // Try to find icon by plugin name first
  const nameKey = pluginName.toLowerCase().replace(/[^a-z0-9]/g, '');
  let config = PLUGIN_ICON_CONFIG[nameKey];

  // Fall back to category icon
  if (!config) {
    const categoryKey = category.toLowerCase();
    config = PLUGIN_ICON_CONFIG[categoryKey] || { type: 'material-symbol', icon: 'extension' };
  }

  if (config.type === 'simple-icons') {
    const needsLightOverride = isDark && DARK_ICONS_NEEDING_LIGHT_OVERRIDE.has(config.slug);
    const iconUrl = needsLightOverride
      ? `https://cdn.simpleicons.org/${config.slug}/ffffff`
      : `https://cdn.simpleicons.org/${config.slug}`;

    return (
      <>
        <img
          src={iconUrl}
          alt=""
          className="plugin-icon-img w-5 h-5 object-contain"
          loading="lazy"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            const fallback = target.nextElementSibling as HTMLElement;
            if (fallback) fallback.style.display = 'flex';
          }}
        />
        <span className="plugin-icon-fallback text-ui-body font-semibold text-[var(--nim-text-muted)] items-center justify-center w-full h-full hidden">{pluginName[0]}</span>
      </>
    );
  }

  if (config.type === 'material-symbol') {
    return (
      <span className="material-symbols-outlined plugin-icon-material text-ui-title text-[var(--nim-text-muted)]">
        {config.icon}
      </span>
    );
  }

  return <span className="plugin-icon-fallback text-ui-body font-semibold text-[var(--nim-text-muted)] flex items-center justify-center w-full h-full">{pluginName[0]}</span>;
}

interface ClaudeCodePluginsPanelProps {
  scope?: 'user' | 'workspace';
  workspacePath?: string;
}

// Marketplace plugins don't carry a source attribution that matches the
// installed_plugins.json key directly. Best-effort extraction lets us produce a
// stable `name@source` key for marketplace cards too.
//
// This mirrors how the install handler derives `sourceName` from the
// marketplace URL, so the value we use to test `isPluginInstalled` matches the
// `name@source` key the installer writes to `installed_plugins.json`.
function extractMarketplaceSourceName(plugin: MarketplacePlugin): string {
  const sourceField = (plugin.source || '').trim();
  if (!/^https?:/i.test(sourceField)) {
    return 'claude-plugins-official';
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(sourceField);
  } catch {
    parsed = null;
  }

  if (!parsed || !/(^|\.)github\.com$/i.test(parsed.hostname)) {
    return 'claude-plugins-official';
  }

  // Pathname looks like "/owner/repo" or "/owner/repo/tree/...". We only care
  // about the first two segments. Strip a trailing `.git` so URLs that come
  // straight from `git clone` examples produce the same key as the marketplace
  // installer.
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    return 'claude-plugins-official';
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');
  return `${owner}-${repo}`;
}

function ClaudeCodePluginsPanelInner({ scope = 'user', workspacePath }: ClaudeCodePluginsPanelProps) {
  const posthog = usePostHog();
  const { theme } = useTheme();
  const isDark = theme === 'dark' || theme === 'crystal-dark';

  const [viewState, setViewState] = useState<ViewState>('discover');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marketplace, setMarketplace] = useState<MarketplaceData | null>(null);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlugin, setSelectedPlugin] = useState<MarketplacePlugin | null>(null);
  const [installStatus, setInstallStatus] = useState<Record<string, 'idle' | 'installing' | 'installed' | 'error'>>({});
  const [installMessage, setInstallMessage] = useState<string>('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch marketplace data and installed plugins in parallel
      const [marketplaceResult, installedResult] = await Promise.all([
        window.electronAPI.invoke('claude-plugin:fetch-marketplace'),
        window.electronAPI.invoke('claude-plugin:list-installed', { workspacePath }),
      ]);

      if (marketplaceResult.success) {
        setMarketplace(marketplaceResult.data);
      } else {
        setError(marketplaceResult.error || 'Failed to load marketplace');
      }

      if (installedResult.success) {
        setInstalledPlugins(installedResult.data || []);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load plugin data';
      console.error('Failed to load plugin data:', err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  // Reload when the active workspace changes so project-scoped plugins
  // appear or disappear with the current project.
  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleInstall = async (plugin: MarketplacePlugin) => {
    setInstallStatus(prev => ({ ...prev, [plugin.name]: 'installing' }));
    setInstallMessage(`Installing ${plugin.name}...`);

    try {
      // Pass both plugin name and source to the install handler
      const result = await window.electronAPI.invoke('claude-plugin:install', plugin.name, plugin.source);

      if (result.success) {
        setInstallStatus(prev => ({ ...prev, [plugin.name]: 'installed' }));
        setInstallMessage(`${plugin.name} installed successfully`);

        // Track analytics
        posthog?.capture('claude_plugin_installed', {
          pluginName: plugin.name,
          category: plugin.category,
          source: plugin.source,
        });

        // Refresh installed plugins
        const installedResult = await window.electronAPI.invoke('claude-plugin:list-installed', { workspacePath });
        if (installedResult.success) {
          setInstalledPlugins(installedResult.data || []);
        }
      } else {
        setInstallStatus(prev => ({ ...prev, [plugin.name]: 'error' }));
        setInstallMessage(result.error || 'Installation failed');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Installation failed';
      setInstallStatus(prev => ({ ...prev, [plugin.name]: 'error' }));
      setInstallMessage(errorMessage);
    }

    // Clear message after a few seconds
    setTimeout(() => {
      setInstallMessage('');
    }, 5000);
  };

  interface UninstallTarget {
    name: string;
    source?: string;
    scope?: 'user' | 'project';
    projectPath?: string;
  }

  const handleUninstall = async (target: UninstallTarget) => {
    const label = target.source ? `${target.name}@${target.source}` : target.name;
    if (!confirm(`Uninstall ${label}?`)) {
      return;
    }

    try {
      const result = await window.electronAPI.invoke('claude-plugin:uninstall', target);

      if (result.success) {
        setInstallStatus(prev => ({ ...prev, [target.name]: 'idle' }));
        setInstallMessage(`${label} uninstalled`);

        // Refresh installed plugins
        const installedResult = await window.electronAPI.invoke('claude-plugin:list-installed', { workspacePath });
        if (installedResult.success) {
          setInstalledPlugins(installedResult.data || []);
        }
      } else {
        setInstallMessage(result.error || 'Uninstall failed');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Uninstall failed';
      setInstallMessage(errorMessage);
    }

    setTimeout(() => {
      setInstallMessage('');
    }, 5000);
  };

  const isPluginInstalled = (plugin: MarketplacePlugin): boolean => {
    const expectedSource = extractMarketplaceSourceName(plugin).toLowerCase();
    const expectedName = plugin.name.toLowerCase();
    return installedPlugins.some(p =>
      p.name.toLowerCase() === expectedName && p.source.toLowerCase() === expectedSource
    );
  };

  // Filter plugins by search query
  const filteredPlugins = marketplace?.plugins.filter(plugin => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      plugin.name.toLowerCase().includes(query) ||
      plugin.description.toLowerCase().includes(query) ||
      plugin.author.toLowerCase().includes(query) ||
      plugin.category.toLowerCase().includes(query)
    );
  }) || [];

  // Group plugins by category
  const pluginsByCategory: Record<string, MarketplacePlugin[]> = {};
  filteredPlugins.forEach(plugin => {
    const category = plugin.category.toLowerCase();
    if (!pluginsByCategory[category]) {
      pluginsByCategory[category] = [];
    }
    pluginsByCategory[category].push(plugin);
  });

  if (loading) {
    return (
      <div className="provider-panel flex flex-col">
        <div className="plugin-loading p-8 text-center text-[var(--nim-text-muted)]">Loading Claude Code plugins...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="provider-panel flex flex-col">
        <div className="plugin-error p-8 text-center text-[var(--nim-error)]">
          Error: {error}
          <button onClick={loadData} className="plugin-retry-button ml-4 px-4 py-2 bg-[var(--nim-primary)] text-white border-none rounded-ui-base cursor-pointer">Retry</button>
        </div>
      </div>
    );
  }

  const renderDiscover = () => (
    <div className="plugin-discover" role="main" aria-label="Plugin discovery">
      {/* Search Bar */}
      <div className="plugin-search relative mb-6" role="search">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search plugins..."
          className="plugin-search-input w-full py-3 pl-4 pr-10 border border-[var(--nim-border)] rounded-ui-lg bg-[var(--nim-bg)] text-[var(--nim-text)] text-ui-subhead outline-none focus:border-[var(--nim-primary)] placeholder:text-[var(--nim-text-faint)]"
          aria-label="Search Claude Code plugins"
          autoFocus
        />
        {searchQuery && (
          <button
            className="plugin-search-clear absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 border-none rounded-ui-full bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] text-ui-compact cursor-pointer flex items-center justify-center hover:bg-[var(--nim-text-faint)] hover:text-[var(--nim-bg)]"
            onClick={() => setSearchQuery('')}
            aria-label="Clear search"
            title="Clear search"
          >
            x
          </button>
        )}
      </div>

      {/* Plugins by Category */}
      {CATEGORY_ORDER.map(category => {
        const plugins = pluginsByCategory[category];
        if (!plugins || plugins.length === 0) return null;

        return (
          <div key={category} className="plugin-category mb-6">
            <h4 className="plugin-category-title text-ui-compact font-semibold uppercase tracking-wider text-[var(--nim-text-faint)] m-0 mb-3 pb-2 border-b border-[var(--nim-border)]">{CATEGORY_LABELS[category] || category}</h4>
            <div className="plugin-grid grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 @container" role="list" aria-label={CATEGORY_LABELS[category] || category}>
              {plugins.map((plugin) => {
                const installed = isPluginInstalled(plugin);
                const status = installStatus[plugin.name] || 'idle';

                return (
                  <div
                    key={plugin.name}
                    className={`plugin-card flex flex-col p-4 border rounded-ui-lg cursor-pointer transition-all duration-150 ${installed ? 'installed border-nim-success-subtle bg-nim-success-subtle' : 'border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]'} hover:border-[var(--nim-primary)] hover:bg-[var(--nim-bg-hover)]`}
                    onClick={() => setSelectedPlugin(plugin)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedPlugin(plugin);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${plugin.name} by ${plugin.author} - ${plugin.description}`}
                  >
                    <div className="plugin-card-header flex items-center gap-3 mb-2">
                      <div className="plugin-card-icon w-8 h-8 rounded-ui-base bg-[var(--nim-bg-tertiary)] flex items-center justify-center text-ui-subhead shrink-0 overflow-hidden" aria-hidden="true">
                        <PluginIcon pluginName={plugin.name} category={plugin.category} isDark={isDark} />
                      </div>
                      <div className="plugin-card-name font-semibold text-ui-subhead text-[var(--nim-text)]">{plugin.name}</div>
                    </div>
                    <div className="plugin-card-description text-ui-body text-[var(--nim-text-muted)] leading-relaxed mb-3 flex-1 line-clamp-2">{plugin.description}</div>
                    <div className="plugin-card-footer flex items-center justify-between gap-2">
                      <span className="plugin-card-author text-ui-compact text-[var(--nim-text-faint)]">by {plugin.author}</span>
                      {installed ? (
                        <span className="plugin-card-badge installed inline-flex items-center px-2 py-1 rounded-ui-base text-ui-caption font-semibold uppercase tracking-tight bg-nim-success-subtle text-[var(--nim-success)]">Installed</span>
                      ) : (
                        <button
                          className={`plugin-install-button py-2 px-3 border-none rounded-ui-base bg-[var(--nim-primary)] text-white text-ui-compact font-medium cursor-pointer transition-opacity duration-150 hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed ${status === 'installing' ? 'installing bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInstall(plugin);
                          }}
                          disabled={status === 'installing'}
                        >
                          {status === 'installing' ? 'Installing...' : 'Install'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* No results */}
      {filteredPlugins.length === 0 && searchQuery && (
        <div className="plugin-no-results p-8 text-center text-[var(--nim-text-faint)] text-ui-subhead" role="status" aria-live="polite">
          No plugins match "{searchQuery}"
        </div>
      )}
    </div>
  );

  const renderInstalled = () => (
    <div className="plugin-installed-view" role="main" aria-label="Installed plugins">
      {installedPlugins.length === 0 ? (
        <div className="plugin-empty-state flex flex-col items-center justify-center py-12 px-6 text-center text-[var(--nim-text-faint)]">
          <span className="plugin-empty-icon material-symbols-outlined text-ui-display mb-4 opacity-50">extension_off</span>
          <p className="m-0 mb-6 text-ui-subhead">No plugins installed yet</p>
          <button
            className="plugin-empty-cta py-3 px-5 rounded-ui-base border-none bg-[var(--nim-primary)] text-white text-ui-body font-medium cursor-pointer transition-opacity duration-150 hover:opacity-90"
            onClick={() => setViewState('discover')}
          >
            Browse Plugins
          </button>
        </div>
      ) : (
        <div className="plugin-installed-list flex flex-col gap-2" role="list">
          {installedPlugins.map((plugin) => {
            const isProjectScope = plugin.scope === 'project';
            const itemKey = `${plugin.name}@${plugin.source}@${plugin.projectPath ?? 'user'}`;
            return (
              <div key={itemKey} className="plugin-installed-item flex items-center justify-between p-4 border border-[var(--nim-border)] rounded-ui-lg bg-[var(--nim-bg-secondary)]" role="listitem">
                <div className="plugin-installed-info flex items-center gap-3 flex-1 min-w-0">
                  <div className="plugin-installed-icon w-9 h-9 rounded-ui-base bg-[var(--nim-bg-tertiary)] flex items-center justify-center shrink-0 overflow-hidden">
                    <PluginIcon pluginName={plugin.name} category="external" isDark={isDark} />
                  </div>
                  <div className="plugin-installed-details flex-1 min-w-0">
                    <div className="plugin-installed-name flex items-center gap-2 font-medium text-ui-subhead text-[var(--nim-text)] mb-1">
                      <span>{plugin.name}</span>
                      {plugin.source && (
                        <span className="plugin-installed-source text-ui-compact text-[var(--nim-text-faint)] font-normal">@{plugin.source}</span>
                      )}
                      <span
                        className={`plugin-installed-scope inline-flex items-center px-2 py-0.5 rounded-ui-base text-ui-caption font-semibold uppercase tracking-tight ${
                          isProjectScope
                            ? 'bg-nim-primary-subtle text-[var(--nim-primary)]'
                            : 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]'
                        }`}
                        title={isProjectScope ? plugin.projectPath : 'Available in every workspace'}
                      >
                        {isProjectScope ? 'Project' : 'User'}
                      </span>
                      {!plugin.enabled && (
                        <span className="plugin-installed-disabled inline-flex items-center px-2 py-0.5 rounded-ui-base text-ui-caption font-semibold uppercase tracking-tight bg-nim-error-subtle text-[var(--nim-error)]" title="Disabled for this scope">
                          Disabled
                        </span>
                      )}
                    </div>
                    <div className="plugin-installed-path text-ui-compact text-[var(--nim-text-faint)] overflow-hidden text-ellipsis whitespace-nowrap">{plugin.path}</div>
                  </div>
                </div>
                <div className="plugin-installed-actions flex gap-2">
                  <button
                    className="plugin-uninstall-button py-2 px-3 border border-[var(--nim-error)] rounded-ui-base bg-transparent text-[var(--nim-error)] text-ui-compact font-medium cursor-pointer transition-all duration-150 hover:bg-[var(--nim-error)] hover:text-white"
                    onClick={() => handleUninstall({
                      name: plugin.name,
                      source: plugin.source,
                      scope: plugin.scope,
                      projectPath: plugin.projectPath,
                    })}
                    aria-label={`Uninstall ${plugin.name}`}
                  >
                    Uninstall
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderPluginDetails = () => {
    if (!selectedPlugin) return null;

    const installed = isPluginInstalled(selectedPlugin);
    const status = installStatus[selectedPlugin.name] || 'idle';

    return (
      <div className="plugin-details-overlay fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-4" onClick={() => setSelectedPlugin(null)}>
        <div className="plugin-details-modal bg-[var(--nim-bg)] rounded-ui-lg p-6 max-w-[500px] w-full max-h-[80vh] overflow-y-auto relative shadow-[0_20px_40px_rgba(0,0,0,0.3)]" onClick={(e) => e.stopPropagation()}>
          <button
            className="plugin-details-close absolute top-4 right-4 w-7 h-7 border-none rounded-ui-full bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] text-ui-subhead cursor-pointer flex items-center justify-center transition-all duration-150 hover:bg-[var(--nim-text-faint)] hover:text-[var(--nim-bg)]"
            onClick={() => setSelectedPlugin(null)}
            aria-label="Close"
          >
            x
          </button>

          <div className="plugin-details-header flex items-center gap-4 mb-4">
            <div className="plugin-details-icon w-12 h-12 rounded-ui-lg bg-[var(--nim-bg-tertiary)] flex items-center justify-center shrink-0 overflow-hidden">
              <PluginIcon pluginName={selectedPlugin.name} category={selectedPlugin.category} isDark={isDark} />
            </div>
            <div className="plugin-details-title">
              <h3 className="m-0 mb-1 text-ui-title font-semibold text-[var(--nim-text)]">{selectedPlugin.name}</h3>
              <span className="plugin-details-author text-ui-body text-[var(--nim-text-faint)]">by {selectedPlugin.author}</span>
            </div>
          </div>

          <p className="plugin-details-description text-ui-subhead text-[var(--nim-text-muted)] leading-relaxed m-0 mb-5">{selectedPlugin.description}</p>

          <div className="plugin-details-meta flex flex-col gap-2 mb-6 p-3 bg-[var(--nim-bg-secondary)] rounded-ui-lg">
            <div className="plugin-details-meta-item flex items-center gap-2 text-ui-body">
              <span className="plugin-details-meta-label text-[var(--nim-text-faint)]">Category:</span>
              <span className="plugin-details-meta-value text-[var(--nim-text)] font-medium">{CATEGORY_LABELS[selectedPlugin.category.toLowerCase()] || selectedPlugin.category}</span>
            </div>
            {selectedPlugin.homepage && (
              <div className="plugin-details-meta-item flex items-center gap-2 text-ui-body">
                <span className="plugin-details-meta-label text-[var(--nim-text-faint)]">Homepage:</span>
                <a
                  href={selectedPlugin.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="plugin-details-link text-[var(--nim-primary)] no-underline cursor-pointer hover:underline"
                  onClick={() => window.electronAPI.openExternal(selectedPlugin.homepage!)}
                >
                  View Documentation
                </a>
              </div>
            )}
          </div>

          <div className="plugin-details-actions flex items-center gap-3">
            {installed ? (
              <>
                <span className="plugin-details-installed-badge inline-flex items-center py-2 px-3 rounded-ui-base bg-nim-success-subtle text-[var(--nim-success)] text-ui-body font-medium">Installed</span>
                <button
                  className="plugin-uninstall-button py-2 px-3 border border-[var(--nim-error)] rounded-ui-base bg-transparent text-[var(--nim-error)] text-ui-compact font-medium cursor-pointer transition-all duration-150 hover:bg-[var(--nim-error)] hover:text-white"
                  onClick={() => {
                    // Modal originates from a marketplace card, so we only
                    // know name+derived source. The server-side uninstall
                    // handler will refuse ambiguous matches; users on a
                    // multi-marketplace install must uninstall from the
                    // Installed tab where the source is explicit.
                    handleUninstall({
                      name: selectedPlugin.name,
                      source: extractMarketplaceSourceName(selectedPlugin),
                    });
                    setSelectedPlugin(null);
                  }}
                >
                  Uninstall
                </button>
              </>
            ) : (
              <button
                className={`plugin-details-install-button flex-1 py-3 px-6 border-none rounded-ui-base bg-[var(--nim-primary)] text-white text-ui-subhead font-medium cursor-pointer transition-opacity duration-150 hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed ${status === 'installing' ? 'installing bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]' : ''}`}
                onClick={() => handleInstall(selectedPlugin)}
                disabled={status === 'installing'}
              >
                {status === 'installing' ? 'Installing...' : 'Install Plugin'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="provider-panel flex flex-col">
      <PageHeader
        icon="extension"
        title="Claude Code Plugins"
        count={installedPlugins.length}
      />

      {/* View Switcher */}
      <div className="plugin-view-switcher flex gap-1 mb-4 p-1 bg-[var(--nim-bg-tertiary)] rounded-ui-lg w-fit">
        <button
          className={`plugin-view-button py-2 px-4 border-none rounded-ui-base text-ui-body font-medium cursor-pointer transition-all duration-150 ${
            viewState === 'discover'
              ? 'bg-[var(--nim-primary)] text-white shadow-sm'
              : 'bg-transparent text-[var(--nim-text-muted)] hover:text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]'
          }`}
          onClick={() => setViewState('discover')}
        >
          Discover
        </button>
        <button
          className={`plugin-view-button py-2 px-4 border-none rounded-ui-base text-ui-body font-medium cursor-pointer transition-all duration-150 ${
            viewState === 'installed'
              ? 'bg-[var(--nim-primary)] text-white shadow-sm'
              : 'bg-transparent text-[var(--nim-text-muted)] hover:text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]'
          }`}
          onClick={() => setViewState('installed')}
        >
          Installed ({installedPlugins.length})
        </button>
      </div>

      {/* Status Message */}
      {installMessage && (
        <div className="plugin-status-message py-3 px-4 mb-4 bg-nim-primary-subtle border border-nim-primary-subtle rounded-ui-base text-ui-body text-[var(--nim-text)]" role="status" aria-live="polite">
          {installMessage}
        </div>
      )}

      {/* Content */}
      <div className="plugin-content [container-type:inline-size] [container-name:plugin-content]">
        {viewState === 'discover' && renderDiscover()}
        {viewState === 'installed' && renderInstalled()}
      </div>

      {/* Plugin Details Modal */}
      {selectedPlugin && renderPluginDetails()}
    </div>
  );
}

export function ClaudeCodePluginsPanel(props: ClaudeCodePluginsPanelProps) {
  return (
    <ErrorBoundary
      fallback={
        <div className="provider-panel flex flex-col" role="alert" aria-live="assertive">
          <div className="plugin-error p-8 text-center">
            <h3 className="mt-0 mb-4">Unable to load Claude Code Plugins</h3>
            <p className="mb-6 text-[var(--nim-text-muted)]">
              An unexpected error occurred while loading the plugins panel.
              Please try refreshing the application.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="plugin-retry-button py-2 px-4 bg-[var(--nim-primary)] text-white border-none rounded-ui-base cursor-pointer"
            >
              Reload Application
            </button>
          </div>
        </div>
      }
    >
      <ClaudeCodePluginsPanelInner {...props} />
    </ErrorBoundary>
  );
}
