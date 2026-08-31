import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSkillFile } from '../CommandFileParser';

describe('CommandFileParser', () => {
  let tmpDir: string | null = null;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-test-'));
  });

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it('绿①: parses single-line YAML description accurately', () => {
    const filePath = path.join(tmpDir!, 'single-skill', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      `---
name: single-skill
description: This is a single line description.
---
# Skill Content
`,
      'utf8',
    );

    const result = parseSkillFile(filePath, 'user');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('single-skill');
    expect(result?.description).toBe('This is a single line description.');
  });

  it('绿①: parses multi-line YAML block description (description: |) accurately without returning pipe "|"', () => {
    const filePath = path.join(tmpDir!, 'multiline-skill', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      `---
name: multiline-skill
description: |
  This is a multiline description.
  It spans multiple lines.
  And has paragraphs.
---
# Skill Content
`,
      'utf8',
    );

    const result = parseSkillFile(filePath, 'user');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('multiline-skill');
    expect(result?.description).not.toBe('|');
    expect(result?.description).toContain('This is a multiline description.');
    expect(result?.description).toContain('It spans multiple lines.');
  });

  it('绿①: parses folded multi-line YAML description (description: >) accurately', () => {
    const filePath = path.join(tmpDir!, 'folded-skill', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      `---
name: folded-skill
description: >
  Folded paragraph one.
  Folded paragraph two.
---
# Skill Content
`,
      'utf8',
    );

    const result = parseSkillFile(filePath, 'user');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('folded-skill');
    expect(result?.description).toContain('Folded paragraph one.');
  });
});
