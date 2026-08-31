import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ModelComparisonProps {
  workspaceId?: string;
}

interface ProviderUsageStats {
  provider: string;
  model: string | null;
  sessionCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCacheReadInputTokens: number | null;
  totalCacheCreationInputTokens: number | null;
  cacheHitRate: number | null;
  cacheDataIncomplete: boolean;
}

export const ModelComparison: React.FC<ModelComparisonProps> = ({ workspaceId }) => {
  const [data, setData] = useState<ProviderUsageStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const providers = await window.electronAPI.invoke('usage-analytics:get-usage-by-provider', workspaceId);
        setData(providers);
      } catch (error) {
        console.error('Failed to load model comparison data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [workspaceId]);

  if (loading) {
    return (
      <div className="model-comparison-loading flex items-center justify-center min-h-[400px] text-base text-nim-muted">
        Loading...
      </div>
    );
  }

  const chartData = data.map((item) => ({
    name: `${item.provider}${item.model ? ` (${item.model})` : ''}`,
    'Normal Input': item.totalInputTokens,
    'Cache Read': item.totalCacheReadInputTokens,
    'Cache Creation': item.totalCacheCreationInputTokens,
    Output: item.totalOutputTokens,
    Sessions: item.sessionCount,
  }));
  const cacheDataIncomplete = data.some((item) => item.cacheDataIncomplete
    || item.totalCacheReadInputTokens == null
    || item.totalCacheCreationInputTokens == null);

  return (
    <div className="model-comparison flex flex-col gap-6">
      <h3 className="m-0 text-lg font-semibold text-nim">Usage by Model</h3>

      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--nim-border)" />
            <XAxis dataKey="name" stroke="var(--nim-text-muted)" />
            <YAxis stroke="var(--nim-text-muted)" />
            <Tooltip
              contentStyle={{
                background: 'var(--nim-bg-secondary)',
                border: '1px solid var(--nim-border)',
                borderRadius: '6px',
                color: 'var(--nim-text)',
              }}
            />
            <Legend />
            <Bar dataKey="Normal Input" fill="var(--nim-primary)" />
            <Bar dataKey="Cache Read" fill="#38bdf8" />
            <Bar dataKey="Cache Creation" fill="#f59e0b" />
            <Bar dataKey="Output" fill="#82ca9d" />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="no-data flex items-center justify-center min-h-[400px] text-base text-nim-muted">
          No model usage data available
        </div>
      )}
      {cacheDataIncomplete && (
        <div className="text-[11px] text-[var(--nim-text-muted)]">
          Some engines did not report cache usage; gaps are unavailable data, not zero cache use.
        </div>
      )}
    </div>
  );
};
