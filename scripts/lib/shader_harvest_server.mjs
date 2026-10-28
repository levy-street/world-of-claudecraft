// The harvest owns its Vite child, never whichever process happens to hold a
// port. Execute Vite through Node so Windows needs neither npx.cmd nor a shell.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

export function assertHarvestPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (error) => {
      reject(new Error(`Cannot start shader harvest on 127.0.0.1:${port}: ${error.message}`));
    });
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      probe.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

export function harvestViteCommand(root, port) {
  return {
    command: process.execPath,
    args: [
      path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--force',
      '--port',
      String(port),
      '--strictPort',
      '--host',
      '127.0.0.1',
    ],
  };
}

/** Await termination before removing artifacts. Only the launched child (and
 * its own descendants) can be signalled; an occupied port is never reclaimed. */
export async function stopHarvestVite(child, platform = process.platform) {
  if (child.pid == null || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolve) => child.once('close', resolve));
  let forceKill = null;
  if (platform === 'win32') {
    const killed = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    if (killed.status !== 0) child.kill();
  } else {
    // The child starts in its own process group, including Vite's compiler.
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    forceKill = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, 5_000);
    forceKill.unref();
  }
  try {
    await closed;
  } finally {
    if (forceKill) clearTimeout(forceKill);
  }
}

export async function startHarvestVite(root, port, logFile) {
  await assertHarvestPortAvailable(port);
  for (const dir of ['node_modules/.vite', 'node_modules/.vite-temp']) {
    fs.rmSync(path.join(root, dir), { recursive: true, force: true });
  }
  const { command, args } = harvestViteCommand(root, port);
  const log = fs.openSync(logFile, 'w');
  let child;
  try {
    child = spawn(command, args, {
      cwd: root,
      stdio: ['ignore', log, log],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
  } finally {
    fs.closeSync(log);
  }
  let failure = null;
  child.once('error', (error) => {
    failure = error;
  });
  return {
    assertRunning() {
      if (failure) throw failure;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Vite exited before harvest completed; see ${logFile}`);
      }
    },
    stop: () => stopHarvestVite(child),
  };
}
