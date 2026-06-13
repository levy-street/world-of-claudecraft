import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const viteUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronCommand = process.platform === 'win32' ? 'electron.cmd' : 'electron';

let shuttingDown = false;

const vite = spawn(npmCommand, ['run', 'dev', '--', '--host', '127.0.0.1', '--strictPort'], {
  env: { ...process.env, BROWSER: 'none' },
  stdio: 'inherit',
});

function stopAll(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!vite.killed) vite.kill();
  process.exit(code);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

vite.on('exit', (code) => {
  if (!shuttingDown) stopAll(code ?? 0);
});

async function waitForVite() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const res = await fetch(viteUrl);
      if (res.ok) return;
    } catch {
      // Keep waiting until Vite accepts connections.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${viteUrl}`);
}

try {
  await waitForVite();
  const electron = spawn(electronCommand, ['.'], {
    env: { ...process.env, VITE_DEV_SERVER_URL: viteUrl },
    stdio: 'inherit',
  });

  electron.on('exit', (code) => stopAll(code ?? 0));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  stopAll(1);
}
