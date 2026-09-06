// Real NDJSON transport regression for the optional headless gathering
// command family (PR3, Intentional Gathering): one temp esbuild bundle of
// `headless/env_server.ts`, one real `node` subprocess, one ordered sequence
// of stdin requests pinned against their exact stdout reply lines. This is a
// WIRE smoke test, not a parser/dispatcher fixture suite: deep behavioral
// coverage (every refusal reason, disclosure shape, no-time-advance proof at
// the sim level) lives in the dedicated fixtures behind
// `headless/gathering_protocol.ts` / `headless/gathering_commands.ts`.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GATHERING_CAPABILITY } from '../headless/gathering_protocol';
import { ACTIONS } from '../src/sim/obs';

const REPLY_WAIT_MS = 5000;

describe('headless gathering NDJSON transport', () => {
  let tempDir = '';
  let bundlePath = '';

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gathering-transport-test-'));
    bundlePath = path.join(tempDir, 'env_server.cjs');
    const entry = fileURLToPath(new URL('../headless/env_server.ts', import.meta.url));
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: bundlePath,
    });
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('pins one exact ordered request/reply sequence over one real subprocess', async () => {
    const child = spawn(process.execPath, [bundlePath], { stdio: ['pipe', 'pipe', 'inherit'] });
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    const waitForExit = async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          exited,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('env did not exit')), REPLY_WAIT_MS);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    let requestsSent = 0;
    let repliesReceived = 0;
    let buffer = '';
    const pendingLines: string[] = [];
    const waiters: ((line: string) => void)[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let idx = buffer.indexOf('\n');
      while (idx >= 0) {
        repliesReceived++;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const waiter = waiters.shift();
        if (waiter) waiter(line);
        else pendingLines.push(line);
        idx = buffer.indexOf('\n');
      }
    });
    const nextLine = (): Promise<string> => {
      const queued = pendingLines.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('timed out waiting for a reply line')),
          REPLY_WAIT_MS,
        );
        waiters.push((line) => {
          clearTimeout(timer);
          resolve(line);
        });
      });
    };
    // biome-ignore lint/suspicious/noExplicitAny: one exact NDJSON reply object per request, shape varies by cmd
    const request = async (msg: object): Promise<any> => {
      requestsSent++;
      child.stdin.write(`${JSON.stringify(msg)}\n`);
      return JSON.parse(await nextLine());
    };

    try {
      const info = await request({ cmd: 'info' });
      expect(info.gathering).toEqual(GATHERING_CAPABILITY);

      const beforeReset = await request({ cmd: 'gathering', verb: 'inspect' });
      expect(beforeReset).toEqual({ ok: false, reason: 'reset_required' });

      const reset = await request({ cmd: 'reset', seed: 1, player_class: 'warrior' });
      expect(Array.isArray(reset.obs)).toBe(true);
      expect(reset.info.step).toBe(0);

      const malformed = await request({ cmd: 'gathering', verb: 'not_a_real_verb' });
      expect(malformed).toEqual({ ok: false, reason: 'invalid_request' });

      const setPreference = await request({
        cmd: 'gathering',
        verb: 'set_preference',
        preference: 'all',
      });
      expect(setPreference.ok).toBe(true);
      expect(setPreference.verb).toBe('set_preference');
      expect(setPreference.reason).toBeUndefined();
      expect(setPreference.state.preference).toEqual({ kind: 'all' });

      const inspect = await request({ cmd: 'gathering', verb: 'inspect' });
      expect(inspect.ok).toBe(true);
      expect(inspect.verb).toBe('inspect');
      // Retained across the wire boundary: the exact state just set, unchanged.
      expect(inspect.state).toEqual(setPreference.state);
      expect(Array.isArray(inspect.corpses)).toBe(true);
      expect(Array.isArray(inspect.vendors)).toBe(true);

      const harvest = await request({ cmd: 'gathering', verb: 'harvest', corpseId: 999999 });
      expect(harvest.ok).toBe(false);
      expect(harvest.verb).toBe('harvest');
      expect(harvest.reason).toBe('harvest_refused');

      // No gathering command above may advance sim time or the episode step:
      // this is the FIRST step of the episode, so its count must read 1.
      const noopIndex = ACTIONS.indexOf('noop');
      const step = await request({ cmd: 'step', action: noopIndex });
      expect(step.info.step).toBe(1);

      const close = await request({ cmd: 'close' });
      expect(close).toEqual({ ok: true });
      expect(await waitForExit()).toEqual({ code: 0, signal: null });
      expect(repliesReceived).toBe(requestsSent);
      expect(pendingLines).toEqual([]);
      expect(buffer).toBe('');
      expect(waiters).toEqual([]);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await waitForExit();
    }
  });
});
