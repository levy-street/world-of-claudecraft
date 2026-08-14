import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runGateChild } from '../scripts/lib/gate_child.mjs';
import { acquireFullSuiteLock, DEFAULT_LOCK_HOST } from '../scripts/lib/gate_lock.mjs';

const childModuleUrl = new URL('../scripts/lib/gate_child.mjs', import.meta.url).href;
const lockModuleUrl = new URL('../scripts/lib/gate_lock.mjs', import.meta.url).href;

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: DEFAULT_LOCK_HOST, port: 0 }, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected TCP address');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForExit(child: ReturnType<typeof spawn>): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
}> {
  return new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
}

describe('runGateChild', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-child-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns an ordinary child exit status', async () => {
    const result = await runGateChild(process.execPath, ['-e', 'process.exit(7)'], {
      stdio: 'ignore',
    });
    expect(result).toEqual({ status: 7, signal: null });
  });

  it('retains the lock when the direct child exits until its resistant grandchild is dead', async () => {
    const port = await freePort();
    const marker = path.join(tempDir, 'grandchild-pid.txt');
    const grandchildSource = `
      const fs = require('node:fs');
      fs.writeFileSync(${JSON.stringify(marker)}, String(process.pid));
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
    `;
    const childSource = `
      const { spawn } = require('node:child_process');
      spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], { stdio: 'ignore' });
      setInterval(() => {}, 1000);
    `;
    const wrapperSource = `
      const { runGateChild } = await import(${JSON.stringify(childModuleUrl)});
      const { acquireFullSuiteLock } = await import(${JSON.stringify(lockModuleUrl)});
      const { release } = await acquireFullSuiteLock({ port: ${port} });
      let result;
      try {
        result = await runGateChild(process.execPath, ['-e', ${JSON.stringify(childSource)}], {
          stdio: 'ignore',
          forceKillAfterMs: 100,
          quiescencePollMs: 10,
          quiescenceEscalationMs: 500
        });
      } finally {
        await release();
      }
      process.exit(result.status ?? 1);
    `;
    const wrapper = spawn(process.execPath, ['--input-type=module', '-e', wrapperSource], {
      stdio: 'ignore',
    });
    await waitForFile(marker);
    const grandchildPid = Number(fs.readFileSync(marker, 'utf8'));

    let waiterAcquired = false;
    let grandchildAliveWhenWaiterAcquired = false;
    const waiterPromise = acquireFullSuiteLock({ port, pollMs: 5 }).then((lock) => {
      waiterAcquired = true;
      try {
        process.kill(grandchildPid, 0);
        grandchildAliveWhenWaiterAcquired = true;
      } catch {
        grandchildAliveWhenWaiterAcquired = false;
      }
      return lock;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(waiterAcquired).toBe(false);
    wrapper.kill('SIGTERM');
    const wrapperExit = await waitForExit(wrapper);
    const waiter = await waiterPromise;

    expect(wrapperExit).toEqual({ code: 143, signal: null });
    expect(waiterAcquired).toBe(true);
    expect(grandchildAliveWhenWaiterAcquired).toBe(false);
    expect(() => process.kill(grandchildPid, 0)).toThrow();
    await waiter.release();
  });
});
