import React from 'react';
import { useAtom } from 'jotai';
import { usePostHog } from 'posthog-js/react';
import { SettingsToggle } from '../SettingsToggle';
import { PageHeader } from '../../common/PageHeader';
import {
  advancedSettingsAtom,
  setAdvancedSettingsAtom,
} from '../../../store/atoms/appSettings';
import {
  BETA_FEATURES,
  areAllBetaFeaturesEnabled,
  enableAllBetaFeatures as enableAllBetaFeaturesUtil,
  disableAllBetaFeatures,
} from '../../../../shared/betaFeatures';

/**
 * BetaFeaturesPanel - Settings panel for toggling beta features.
 *
 * Always visible in Settings > Advanced > Beta Features.
 * Unlike alpha features (hidden behind release channel), beta features
 * are user-facing and discoverable.
 */
export function BetaFeaturesPanel() {
  const posthog = usePostHog();
  const [settings] = useAtom(advancedSettingsAtom);
  const [, updateSettings] = useAtom(setAdvancedSettingsAtom);
  const { betaFeatures, enableAllBetaFeatures } = settings;

  return (
    <div className="provider-panel flex flex-col">
      <PageHeader icon="science" title="Beta Features" />

      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <div className="p-3 bg-nim-secondary rounded-ui-base border border-nim">
          {/* "Enable All Beta Features" master toggle */}
          <div className="mb-3 pb-3 border-b border-nim">
            <SettingsToggle
              checked={enableAllBetaFeatures}
              onChange={(enabled) => {
                const newFeatures = enabled ? enableAllBetaFeaturesUtil() : disableAllBetaFeatures();
                updateSettings({
                  enableAllBetaFeatures: enabled,
                  betaFeatures: newFeatures,
                });
                posthog?.capture('beta_feature_toggled', {
                  feature_tag: 'all',
                  enabled,
                });
              }}
              name="Enable All Beta Features"
            />
          </div>

          {/* Individual beta feature toggles */}
          {BETA_FEATURES.map((feature) => (
            <div
              key={feature.tag}
              className={`setting-item py-2 ${enableAllBetaFeatures ? 'opacity-60 pointer-events-none' : ''}`}
            >
              <label className="setting-label flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={betaFeatures[feature.tag] ?? false}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    updateSettings({ betaFeatures: { ...betaFeatures, [feature.tag]: checked } });
                    posthog?.capture('beta_feature_toggled', {
                      feature_tag: feature.tag,
                      enabled: checked,
                    });
                  }}
                  className="setting-checkbox w-4 h-4 mt-1 cursor-pointer shrink-0 accent-[var(--nim-primary)]"
                  disabled={enableAllBetaFeatures}
                />
                <div className="setting-text flex flex-col gap-1">
                  <span className="setting-name text-sm font-medium text-[var(--nim-text)] flex items-center gap-2">
                    {feature.icon && (
                      <span className="material-symbols-outlined text-sm">{feature.icon}</span>
                    )}
                    {feature.name}
                  </span>
                  <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
                    {feature.description}
                  </span>
                </div>
              </label>
            </div>
          ))}
        </div>
        <p className="mt-3 p-2 text-ui-body text-[var(--nim-text-muted)] bg-nim-secondary rounded-ui-base border border-nim">
          Some beta features may require restarting Nimbalyst to take effect.
        </p>
      </div>
    </div>
  );
}
