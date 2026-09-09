// Real NDJSON transport regression for the optional headless gathering-goal
// command family (PR4, Intentional Gathering): one temp esbuild bundle of
// `headless/env_server.ts`, one real `node` subprocess, one ordered sequence
// of stdin requests pinned against their exact stdout reply lines. Adapted
// from `tests/headless_gathering_transport.test.ts` (the sibling PR3 family's
// own wire smoke test) to the separate `{cmd:'gathering_goal', verb:...}`
// shape. This is a WIRE smoke test, not a parser/dispatcher fixture suite:
// deep behavioral coverage (refusal reasons, retrack-is-success, commission
// identity) lives in `tests/headless_gathering_goal.test.ts`.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GATHERING_GOAL_CAPABILITY } from '../headless/gathering_goal_protocol';
import { ACTIONS } from '../src/sim/obs';

const REPLY_WAIT_MS = 5000;

describe('headless gathering-goal NDJSON transport', () => {
  let tempDir = '';
  let bundlePath = '';

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gathering-goal-transport-test-'));
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
      expect(info.gathering_goal).toEqual(GATHERING_GOAL_CAPABILITY);

      const beforeReset = await request({ cmd: 'gathering_goal', verb: 'inspect' });
      expect(beforeReset).toEqual({ ok: false, reason: 'reset_required' });

      const reset = await request({ cmd: 'reset', seed: 1, player_class: 'warrior' });
      expect(Array.isArray(reset.obs)).toBe(true);
      expect(reset.info.step).toBe(0);

      const malformed = await request({ cmd: 'gathering_goal', verb: 'not_a_real_verb' });
      expect(malformed).toEqual({ ok: false, reason: 'invalid_request' });

      // A real content recipe id, no field kit, no station, no bag materials:
      // tracking is a goal-selection write, never a purchase or a material grant.
      const track = await request({
        cmd: 'gathering_goal',
        verb: 'track_recipe',
        recipeId: 'recipe_tough_jerky',
        count: 5,
      });
      expect(track.ok).toBe(true);
      expect(track.verb).toBe('track_recipe');
      expect(track.reason).toBeUndefined();
      expect(track.goal.goal).toEqual({ kind: 'recipe', recipeId: 'recipe_tough_jerky', count: 5 });

      const inspect = await request({ cmd: 'gathering_goal', verb: 'inspect' });
      expect(inspect.ok).toBe(true);
      expect(inspect.verb).toBe('inspect');
      // Retained across the wire boundary: the exact goal just tracked.
      expect(inspect.goal.goal).toEqual(track.goal.goal);

      const clear = await request({ cmd: 'gathering_goal', verb: 'clear' });
      expect(clear).toEqual({ ok: true, verb: 'clear', goal: null });

      // No gathering_goal command above may advance sim time or the episode
      // step: this is the FIRST step of the episode, so its count must read 1.
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
