import { build, createServer } from 'vite';
import { resolveConfig } from 'electron-vite';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const electronPackageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function buildWorkerBundle() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['build/build-worker.js'], {
      cwd: electronPackageDir,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Worker bundle build exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}.`));
    });
  });
}

await buildWorkerBundle();

// Reuse the real Electron Vite configuration, but do not call electron-vite's
// `dev` command: it also launches an Electron instance, which would race the
// instance owned by this Playwright spec.
process.env.NODE_ENV_ELECTRON_VITE = 'development';
const { config } = await resolveConfig(
  {
    root: electronPackageDir,
    configFile: path.join(electronPackageDir, 'electron.vite.config.ts'),
  },
  'serve',
  'development',
);

if (!config?.main || !config.preload || !config.renderer) {
  throw new Error('The collaboration E2E server requires main, preload, and renderer Vite configuration.');
}

await build(config.main);
await build(config.preload);

const rendererServer = await createServer({
  ...config.renderer,
  server: {
    ...config.renderer.server,
    host: '127.0.0.1',
    port: 5273,
    strictPort: true,
  },
});

if (!rendererServer.httpServer) {
  throw new Error('The collaboration E2E renderer server did not expose an HTTP server.');
}

await rendererServer.listen();
rendererServer.printUrls();

let closing = false;
const closeServer = async () => {
  if (closing) return;
  closing = true;
  try {
    await rendererServer.close();
  } finally {
    process.exit(0);
  }
};

process.once('SIGINT', () => void closeServer());
process.once('SIGTERM', () => void closeServer());

await new Promise(() => undefined);
