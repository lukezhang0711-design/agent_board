import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';

const {
  getBuildInfo,
  isFullCommitSha,
  writeBuildInfo,
} = require('../../../../build/build-worker.js') as {
  getBuildInfo: (options: {
    environment: Record<string, string | undefined>;
    now: () => Date;
    runGitCommand: (args: string[]) => string;
  }) => { commit: string; shortCommit: string; dirty: boolean; builtAtUtc: string };
  isFullCommitSha: (value: unknown) => boolean;
  writeBuildInfo: (
    outDir: string,
    options: {
      environment: Record<string, string | undefined>;
      now: () => Date;
      runGitCommand: (args: string[]) => string;
    },
  ) => { commit: string; shortCommit: string; dirty: boolean; builtAtUtc: string };
};

const CI_SHA = 'a'.repeat(40);
const LOCAL_SHA = 'b'.repeat(40);
const BUILT_AT = new Date('2026-07-30T12:00:00.000Z');

describe('build-worker build info', () => {
  it('uses the CI SHA before git and records a clean build', () => {
    const runGitCommand = vi.fn((args: string[]) => {
      expect(args).toEqual(['status', '--porcelain']);
      return '';
    });

    expect(getBuildInfo({
      environment: { GITHUB_SHA: CI_SHA },
      now: () => BUILT_AT,
      runGitCommand,
    })).toEqual({
      commit: CI_SHA,
      shortCommit: 'aaaaaaa',
      dirty: false,
      builtAtUtc: BUILT_AT.toISOString(),
    });
  });

  it('falls back to the local commit and reports dirty worktrees', () => {
    const runGitCommand = vi.fn((args: string[]) => {
      if (args[0] === 'rev-parse') return LOCAL_SHA;
      if (args[0] === 'status') return ' M packages/electron/about.html';
      throw new Error(`Unexpected git command: ${args.join(' ')}`);
    });

    expect(getBuildInfo({
      environment: {},
      now: () => BUILT_AT,
      runGitCommand,
    })).toMatchObject({
      commit: LOCAL_SHA,
      shortCommit: 'bbbbbbb',
      dirty: true,
    });
    expect(runGitCommand).toHaveBeenNthCalledWith(1, ['rev-parse', 'HEAD']);
    expect(runGitCommand).toHaveBeenNthCalledWith(2, ['status', '--porcelain']);
  });

  it('writes the exact About payload to out/build-info.json', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbalyst-build-info-'));
    const runGitCommand = vi.fn((args: string[]) => {
      if (args[0] === 'rev-parse') return LOCAL_SHA;
      return '';
    });

    try {
      const expected = writeBuildInfo(outDir, {
        environment: {},
        now: () => BUILT_AT,
        runGitCommand,
      });
      const written = JSON.parse(fs.readFileSync(path.join(outDir, 'build-info.json'), 'utf8'));

      expect(written).toEqual(expected);
      expect(isFullCommitSha(written.commit)).toBe(true);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
