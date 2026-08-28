import fs from 'fs';
import os from 'os';
import path from 'path';
import * as childProcess from 'child_process';
import {
  createDispatchSkillId,
  type DispatchSkillDescriptor,
  type DispatchSkillEngine,
  type DispatchSkillScope,
  type DispatchSkillSource,
} from '@nimbalyst/runtime/ai/server';
import { parseSkillFile } from './CommandFileParser';

type FileSkillSource = Extract<DispatchSkillSource, 'user' | 'project' | 'plugin' | 'builtin'>;

interface SkillRoot {
  engine: DispatchSkillEngine;
  source: FileSkillSource;
  scope: DispatchSkillScope;
  rootPath: string;
}

const GEMINI_CONFIG_KEYS = new Set([
  'skills',
  'skillIds',
  'enabledSkills',
  'include_only',
  'includeOnly',
]);

function addUniqueSkill(
  output: DispatchSkillDescriptor[],
  seen: Set<string>,
  skill: DispatchSkillDescriptor,
): void {
  if (seen.has(skill.id)) {
    return;
  }
  seen.add(skill.id);
  output.push(skill);
}

function safeReadDir(dirPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function collectSkillFiles(rootPath: string): string[] {
  const results: string[] = [];
  const visit = (currentPath: string) => {
    for (const entry of safeReadDir(currentPath)) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        results.push(fullPath);
      }
    }
  };

  if (fs.existsSync(rootPath)) {
    visit(rootPath);
  }
  return results;
}

function parseFileSkill(root: SkillRoot, filePath: string): DispatchSkillDescriptor | null {
  const relativePath = path.relative(root.rootPath, filePath);
  const parserSource: 'project' | 'user' | 'plugin' =
    root.source === 'project' || root.source === 'plugin' ? root.source : 'user';
  const parsed = parseSkillFile(filePath, parserSource, relativePath);
  if (!parsed) {
    return null;
  }
  return {
    id: createDispatchSkillId(root.engine, root.source, parsed.name),
    name: parsed.name,
    engine: root.engine,
    source: root.source,
    scope: root.scope,
    description: parsed.description,
    path: filePath,
  };
}

function collectGeminiConfigSkillNames(value: unknown, output: Set<string>, parentKey?: string): void {
  if (typeof value === 'string') {
    if (parentKey && GEMINI_CONFIG_KEYS.has(parentKey) && value.trim()) {
      output.add(value.trim());
    }
    return;
  }
  if (Array.isArray(value)) {
    if (parentKey && GEMINI_CONFIG_KEYS.has(parentKey)) {
      for (const entry of value) {
        if (typeof entry === 'string' && entry.trim()) {
          output.add(entry.trim());
        } else if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>;
          const name = record.name ?? record.id;
          if (typeof name === 'string' && name.trim()) {
            output.add(name.trim());
          }
        }
      }
    }
    for (const entry of value) {
      collectGeminiConfigSkillNames(entry, output, parentKey);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectGeminiConfigSkillNames(child, output, key);
  }
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

function normalizeSource(value: unknown): DispatchSkillSource {
  return value === 'user'
    || value === 'project'
    || value === 'plugin'
    || value === 'builtin'
    || value === 'config'
    ? value
    : 'config';
}

function normalizeScope(value: unknown): DispatchSkillScope {
  return value === 'global'
    || value === 'project'
    || value === 'plugin'
    || value === 'config'
    ? value
    : 'config';
}

function readRecordString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function parseCodexCliJson(value: unknown): DispatchSkillDescriptor[] {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Array.isArray((value as Record<string, unknown>).skills)
        ? (value as Record<string, unknown>).skills as unknown[]
        : Object.entries(value as Record<string, unknown>).map(([name, detail]) =>
            detail && typeof detail === 'object'
              ? { name, ...(detail as Record<string, unknown>) }
              : name,
          )
      : [];

  return entries.flatMap((entry): DispatchSkillDescriptor[] => {
    if (typeof entry === 'string' && entry.trim()) {
      const name = entry.trim();
      return [{
        id: createDispatchSkillId('codex', 'config', name),
        name,
        engine: 'codex',
        source: 'config',
        scope: 'config',
      }];
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const name = readRecordString(record, ['name', 'id', 'title']);
    if (!name) return [];
    const source = normalizeSource(record.source);
    return [{
      id: createDispatchSkillId('codex', source, name),
      name,
      engine: 'codex',
      source,
      scope: normalizeScope(record.scope),
      ...(readRecordString(record, ['description', 'summary'])
        ? { description: readRecordString(record, ['description', 'summary']) }
        : {}),
      ...(readRecordString(record, ['path', 'filePath'])
        ? { path: readRecordString(record, ['path', 'filePath']) }
        : {}),
    }];
  });
}

function parseCodexCliText(stdout: string): DispatchSkillDescriptor[] {
  return stdout
    .split(/\r?\n/)
    .flatMap((line): DispatchSkillDescriptor[] => {
      const trimmed = line.trim().replace(/^[-*]\s+/, '');
      if (!trimmed || /^(name|skill|skills)\b/i.test(trimmed)) return [];
      const match = /^([^\s:]+)(?:\s*[-:]\s*(.*))?$/.exec(trimmed);
      if (!match) return [];
      const name = match[1].trim();
      if (!name) return [];
      const description = match[2]?.trim();
      return [{
        id: createDispatchSkillId('codex', 'config', name),
        name,
        engine: 'codex',
        source: 'config',
        scope: 'config',
        ...(description ? { description } : {}),
      }];
    });
}

function listCodexCliSkills(): DispatchSkillDescriptor[] {
  const tryList = (args: string[]) => {
    try {
      return childProcess.spawnSync('codex', args, {
        encoding: 'utf8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      return null;
    }
  };

  const jsonResult = tryList(['skills', 'list', '--json']);
  if (jsonResult?.status === 0 && typeof jsonResult.stdout === 'string' && jsonResult.stdout.trim()) {
    try {
      return parseCodexCliJson(JSON.parse(jsonResult.stdout));
    } catch {
      return parseCodexCliText(jsonResult.stdout);
    }
  }

  const textResult = tryList(['skills', 'list']);
  if (textResult?.status === 0 && typeof textResult.stdout === 'string' && textResult.stdout.trim()) {
    return parseCodexCliText(textResult.stdout);
  }

  return [];
}

export class DispatchSkillLibraryService {
  listSkills(workspacePath?: string): DispatchSkillDescriptor[] {
    const home = os.homedir();
    const roots: SkillRoot[] = [
      {
        engine: 'claude',
        source: 'user',
        scope: 'global',
        rootPath: path.join(home, '.claude', 'skills'),
      },
      ...(workspacePath
        ? [{
            engine: 'claude' as const,
            source: 'project' as const,
            scope: 'project' as const,
            rootPath: path.join(workspacePath, '.claude', 'skills'),
          }]
        : []),
      {
        engine: 'claude',
        source: 'plugin',
        scope: 'plugin',
        rootPath: path.join(home, '.claude', 'plugins'),
      },
      {
        engine: 'codex',
        source: 'user',
        scope: 'global',
        rootPath: path.join(home, '.codex', 'skills'),
      },
      {
        engine: 'codex',
        source: 'user',
        scope: 'global',
        rootPath: path.join(home, '.agents', 'skills'),
      },
      ...(workspacePath
        ? [{
            engine: 'codex' as const,
            source: 'project' as const,
            scope: 'project' as const,
            rootPath: path.join(workspacePath, '.codex', 'skills'),
          }, {
            engine: 'codex' as const,
            source: 'project' as const,
            scope: 'project' as const,
            rootPath: path.join(workspacePath, '.agents', 'skills'),
          }]
        : []),
      {
        engine: 'gemini',
        source: 'builtin',
        scope: 'global',
        rootPath: path.join(home, '.gemini', 'antigravity-cli', 'builtin', 'skills'),
      },
    ];

    const skills: DispatchSkillDescriptor[] = [];
    const seen = new Set<string>();
    for (const root of roots) {
      for (const filePath of collectSkillFiles(root.rootPath)) {
        const skill = parseFileSkill(root, filePath);
        if (skill) {
          addUniqueSkill(skills, seen, skill);
        }
      }
    }

    for (const skill of listCodexCliSkills()) {
      addUniqueSkill(skills, seen, skill);
    }

    for (const skill of this.listGeminiConfigSkills(home, workspacePath)) {
      addUniqueSkill(skills, seen, skill);
    }

    return skills.sort((a, b) =>
      a.engine.localeCompare(b.engine)
      || a.scope.localeCompare(b.scope)
      || a.name.localeCompare(b.name),
    );
  }

  private listGeminiConfigSkills(home: string, workspacePath?: string): DispatchSkillDescriptor[] {
    const configFiles = [
      path.join(home, '.gemini', 'settings.json'),
      path.join(home, '.gemini', 'config', 'config.json'),
      path.join(home, '.gemini', 'antigravity-cli', 'settings.json'),
      ...(workspacePath ? [path.join(workspacePath, '.gemini', 'settings.json')] : []),
    ];
    const names = new Set<string>();
    for (const filePath of configFiles) {
      collectGeminiConfigSkillNames(readJsonFile(filePath), names);
    }

    return Array.from(names).map((name) => ({
      id: createDispatchSkillId('gemini', 'config', name),
      name,
      engine: 'gemini',
      source: 'config',
      scope: 'config',
    }));
  }
}

export const dispatchSkillLibraryService = new DispatchSkillLibraryService();
