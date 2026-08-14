import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  acquireFullSuiteLock,
  DEFAULT_LOCK_HOST,
  DEFAULT_MAX_WAIT_MS,
} from '../scripts/lib/gate_lock.mjs';

const gate = readFileSync(new URL('../scripts/gate.mjs', import.meta.url), 'utf8');
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

async function waitForLine(stream: NodeJS.ReadableStream, expected: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${expected}`)), 5000);
    stream.on('data', (chunk) => {
      output += chunk.toString();
      if (output.split(/\r?\n/).includes(expected)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

describe('acquireFullSuiteLock', () => {
  it('owns an uncontended listener until its idempotent release completes', async () => {
    const port = await freePort();
    const first = await acquireFullSuiteLock({ port });
    let secondAcquired = false;
    const secondPromise = acquireFullSuiteLock({ port, pollMs: 5 }).then((lock) => {
      secondAcquired = true;
      return lock;
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(secondAcquired).toBe(false);
    await first.release();
    await first.release();
    const second = await secondPromise;
    expect(secondAcquired).toBe(true);
    await second.release();
  });

  it('serializes two concurrent contenders after a holder exits', async () => {
    const port = await freePort();
    const first = await acquireFullSuiteLock({ port });
    const acquired: string[] = [];
    const contender = (ownerId: string) =>
      acquireFullSuiteLock({ port, ownerId, pollMs: 5 }).then((lock) => {
        acquired.push(ownerId);
        return lock;
      });
    const secondPromise = contender('second');
    const thirdPromise = contender('third');

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(acquired).toEqual([]);
    await first.release();
    while (acquired.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(acquired).toHaveLength(1);

    const firstWinner = acquired[0] === 'second' ? await secondPromise : await thirdPromise;
    await firstWinner.release();
    const finalOwner = acquired[0] === 'second' ? await thirdPromise : await secondPromise;
    expect(new Set(acquired)).toEqual(new Set(['second', 'third']));
    await finalOwner.release();
  });

  it('logs the real holder identity while waiting, without polling pid liveness', async () => {
    const port = await freePort();
    const first = await acquireFullSuiteLock({
      port,
      ownerId: 'holder-one',
      pid: 7777,
      now: () => 1000,
    });
    const logs: string[] = [];
    let elapsed = 1000;
    const secondPromise = acquireFullSuiteLock({
      port,
      ownerId: 'holder-two',
      pid: 8888,
      now: () => elapsed,
      pollMs: 5,
      sleep: async (ms) => {
        elapsed += ms;
        await new Promise((resolve) => setTimeout(resolve, 1));
      },
      log: (message) => logs.push(message),
    });
    while (!logs.some((message) => message.includes('pid 7777'))) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await first.release();
    const second = await secondPromise;
    expect(logs.some((message) => message.includes('pid 7777'))).toBe(true);
    await second.release();
  });

  it('recovers when the owning process dies even if its reported pid belongs to a live process', async () => {
    const port = await freePort();
    const source = `
      const { acquireFullSuiteLock } = await import(${JSON.stringify(lockModuleUrl)});
      await acquireFullSuiteLock({
        port: ${port},
        pid: ${process.pid},
        ownerId: 'doomed-owner'
      });
      console.log('owned');
      setInterval(() => {}, 1000);
    `;
    const owner = spawn(process.execPath, ['--input-type=module', '-e', source], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    if (owner.stdout === null) throw new Error('expected owner stdout');
    await waitForLine(owner.stdout, 'owned');
    owner.kill('SIGKILL');
    await new Promise<void>((resolve) => owner.once('close', () => resolve()));

    // The pid written into the dead owner's protocol response is this still-live
    // Vitest process. Socket ownership, not numeric pid identity, decides recovery.
    const recovered = await acquireFullSuiteLock({ port, pollMs: 5 });
    expect(process.kill(process.pid, 0)).toBe(true);
    await recovered.release();
  });

  it('falls open instead of blocking behind an unrelated loopback service', async () => {
    const port = await freePort();
    const foreign = net.createServer((socket) => socket.end('not a gate lock\n'));
    await new Promise<void>((resolve) =>
      foreign.listen({ host: DEFAULT_LOCK_HOST, port }, resolve),
    );
    const logs: string[] = [];
    const lock = await acquireFullSuiteLock({
      port,
      pollMs: 1,
      identifyTimeoutMs: 50,
      sleep: async () => {},
      log: (message) => logs.push(message),
    });
    expect(logs.some((message) => message.includes('not a World of Claudecraft'))).toBe(true);
    await lock.release();
    await new Promise<void>((resolve) => foreign.close(() => resolve()));
  });

  it('bounds and yields reset-only identification retries before falling open', async () => {
    const port = await freePort();
    let connections = 0;
    const resetting = net.createServer((socket) => {
      connections++;
      socket.resetAndDestroy();
    });
    await new Promise<void>((resolve) =>
      resetting.listen({ host: DEFAULT_LOCK_HOST, port }, resolve),
    );
    const logs: string[] = [];
    const startedAt = Date.now();
    const lock = await Promise.race([
      acquireFullSuiteLock({
        port,
        pollMs: 5,
        maxWaitMs: 100,
        identifyTimeoutMs: 25,
        log: (message) => logs.push(message),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('reset-only listener did not fall open')), 500),
      ),
    ]);

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(connections).toBeGreaterThan(0);
    expect(connections).toBeLessThanOrEqual(4);
    expect(logs.some((message) => message.includes('reset the gate lock probe'))).toBe(true);
    await lock.release();
    await new Promise<void>((resolve) => resetting.close(() => resolve()));
  });

  it('keeps the bounded wait fallback for a genuine long-running holder', async () => {
    const port = await freePort();
    const first = await acquireFullSuiteLock({ port, now: () => 0 });
    let elapsed = 0;
    const logs: string[] = [];
    const second = await acquireFullSuiteLock({
      port,
      now: () => elapsed,
      pollMs: 1000,
      maxWaitMs: 5000,
      sleep: async (ms) => {
        elapsed += ms;
      },
      log: (message) => logs.push(message),
    });
    expect(logs.some((message) => message.includes('waited over'))).toBe(true);
    await second.release();
    await first.release();
  });

  it('opts out without binding the port or disturbing a real holder', async () => {
    const port = await freePort();
    const first = await acquireFullSuiteLock({ port });
    const optedOut = await acquireFullSuiteLock({ port, optOut: true });
    await optedOut.release();
    let contenderAcquired = false;
    const contenderPromise = acquireFullSuiteLock({ port, pollMs: 5 }).then((lock) => {
      contenderAcquired = true;
      return lock;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(contenderAcquired).toBe(false);
    await first.release();
    const contender = await contenderPromise;
    await contender.release();
  });
});

describe('gate.mjs wiring pin', () => {
  it('locks only the full-suite step and awaits release in a finally', () => {
    expect(gate).toContain("import { acquireFullSuiteLock } from './lib/gate_lock.mjs'");
    expect(gate).toContain("import { runGateChild } from './lib/gate_child.mjs'");
    expect(gate).toMatch(/locked\s*=\s*name === FULL_SUITE_STEP_NAME/);
    expect(gate).toMatch(/locked\s*\? await runGateChild/);
    expect(gate).toMatch(/finally\s*{\s*await release\(\);?\s*}/);
  });

  it('reads GATE_NO_LOCK as the opt-out and announces it', () => {
    expect(gate).toContain("process.env.GATE_NO_LOCK === '1'");
    expect(gate).toContain('GATE_NO_LOCK=1');
  });
});

describe('DEFAULT_MAX_WAIT_MS', () => {
  it('is generous for a real suite but remains bounded', () => {
    expect(DEFAULT_MAX_WAIT_MS).toBeGreaterThan(30 * 60 * 1000);
    expect(DEFAULT_MAX_WAIT_MS).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});
