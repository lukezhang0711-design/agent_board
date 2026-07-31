#!/usr/bin/env node

/**
 * Build script to bundle the PGLite worker with its dependencies
 * This creates a self-contained worker file that can run outside app.asar
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i;
const CI_COMMIT_ENV_NAMES = [
  'GITHUB_SHA',
  'CI_COMMIT_SHA',
  'BUILDKITE_COMMIT',
  'GIT_COMMIT',
];

function isFullCommitSha(value) {
  return typeof value === 'string' && FULL_COMMIT_SHA.test(value.trim());
}

function runGit(args) {
  return execFileSync('git', args, {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  }).trim();
}

/**
 * Prefer the immutable CI SHA when it is available. Local builds resolve the
 * current checkout so About can still identify a developer-built package.
 */
function getBuildInfo({
  environment = process.env,
  now = () => new Date(),
  runGitCommand = runGit,
} = {}) {
  const ciCommit = CI_COMMIT_ENV_NAMES
    .map((name) => environment[name])
    .find(isFullCommitSha);
  const commit = (ciCommit || runGitCommand(['rev-parse', 'HEAD'])).trim();

  if (!isFullCommitSha(commit)) {
    throw new Error(`Expected a 40-character commit SHA, received: ${commit || '(empty)'}`);
  }

  return {
    commit,
    shortCommit: commit.slice(0, 7),
    dirty: runGitCommand(['status', '--porcelain']).length > 0,
    builtAtUtc: now().toISOString(),
  };
}

function writeBuildInfo(outDir, options) {
  const buildInfo = getBuildInfo(options);
  const buildInfoPath = path.join(outDir, 'build-info.json');
  fs.writeFileSync(buildInfoPath, `${JSON.stringify(buildInfo, null, 2)}\n`, 'utf8');
  console.log(`Build info created successfully at ${buildInfoPath}`);
  return buildInfo;
}

async function buildWorker() {
  const outDir = path.join(__dirname, '../out');

  // Ensure output directory exists
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, '../src/main/database/worker.js')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      outfile: path.join(outDir, 'worker.bundle.js'),
      external: [
        'electron',
        'worker_threads',
        'path',
        'fs',
        'crypto'
      ],
      minify: false,
      sourcemap: false,
      format: 'cjs',
      loader: {
        '.node': 'file',
        '.data': 'binary',  // Embed .data files as binary
        '.wasm': 'binary',  // Embed .wasm files as binary
      },
      define: {
        // Make sure process.env is available
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
      },
    });

    // ------------------------------------------------------------------------
    // SQLite worker bundle — hosts better-sqlite3 + WriteCoordinator +
    // Instrumentation + SQLiteBackupService in a worker_threads worker so the
    // main process never blocks on a synchronous SQLite call.
    //
    // `better-sqlite3` and `electron` stay external: the binary lives in
    // node_modules at runtime and the worker shouldn't drag Electron into
    // the bundle. Schema .sql files are loaded from disk at runtime via
    // MigrationRunner so we don't embed them.
    // ------------------------------------------------------------------------
    await esbuild.build({
      entryPoints: [
        path.join(__dirname, '../src/main/database/sqlite/worker/sqliteWorker.ts'),
      ],
      bundle: true,
      platform: 'node',
      target: 'node18',
      outfile: path.join(outDir, 'sqlite-worker.bundle.js'),
      external: [
        'electron',
        'worker_threads',
        'path',
        'fs',
        'fs/promises',
        'crypto',
        'better-sqlite3',
      ],
      minify: false,
      sourcemap: process.env.NODE_ENV !== 'production',
      format: 'cjs',
      loader: { '.node': 'file' },
      // PGLite's ESM build references its WASM/data files via
      // `new URL("./pglite.wasm", import.meta.url)`. When esbuild bundles ESM
      // into CJS it emits `var import_meta = {}`, making `import_meta.url`
      // undefined and the `new URL(...)` call throw `Invalid URL` the first
      // time PGLite is constructed in the packaged app. Force resolution to
      // PGLite's CJS bundle, which uses an internal `__filename`-based polyfill
      // for `import.meta.url` and resolves `pglite.wasm` / `pglite.data` from
      // the same directory as the worker bundle (where we copy them below).
      alias: {
        '@electric-sql/pglite': path.join(
          __dirname,
          '../../../node_modules/@electric-sql/pglite/dist/index.cjs',
        ),
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
      },
    });

    console.log('Worker bundle created successfully at out/worker.bundle.js');
    console.log('SQLite worker bundle created successfully at out/sqlite-worker.bundle.js');

    // Copy PGLite runtime files that are loaded dynamically at runtime
    // The binary loader embeds some files, but PGLite loads these via fs.readFile
    const pgliteDistDir = path.join(__dirname, '../../../node_modules/@electric-sql/pglite/dist');
    const filesToCopy = ['pglite.data', 'pglite.wasm'];

    for (const file of filesToCopy) {
      const src = path.join(pgliteDistDir, file);
      const dest = path.join(outDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`Copied ${file} to out/`);
      } else {
        console.warn(`Warning: ${file} not found at ${src}`);
      }
    }

    writeBuildInfo(outDir);
  } catch (error) {
    console.error('Failed to build worker bundle:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  buildWorker();
}

module.exports = {
  getBuildInfo,
  isFullCommitSha,
  writeBuildInfo,
};
