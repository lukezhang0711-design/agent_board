import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { parseTrackerYAML } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';

describe('work-order built-in tracker schema', () => {
  it('defines the dispatch fields and first-batch workflow states', () => {
    const schemaPath = fileURLToPath(new URL(
      '../../../../../runtime/src/plugins/TrackerPlugin/models/builtins/work-order.yaml',
      import.meta.url,
    ));
    const model = parseTrackerYAML(readFileSync(schemaPath, 'utf8'));

    expect(model.type).toBe('work-order');
    expect(model.sync).toEqual({ mode: 'local', scope: 'project' });
    expect(model.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'childSessionId', type: 'string', required: true }),
      expect.objectContaining({ name: 'taskSummary', type: 'text', required: true }),
      expect.objectContaining({ name: 'dispatchedAt', type: 'datetime', required: true }),
    ]));

    const statusField = model.fields.find((field) => field.name === 'status');
    expect(statusField?.options?.map((option) => option.value)).toEqual([
      'dispatched',
      'running',
      'waiting',
      'interrupted',
      'completed',
      'failed',
    ]);
  });
});
