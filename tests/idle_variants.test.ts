import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import {
  type BaseState,
  CharacterVisual,
  idleVariantCadenceForTest,
} from '../src/render/characters/visual';

const repoRoot = path.resolve(__dirname, '..');

/** Clip name -> duration (seconds), read straight out of a GLB's accessors. */
function clipDurations(glbRelative: string): Map<string, number> {
  const buf = readFileSync(path.join(repoRoot, 'public', glbRelative));
  let offset = 12;
  let json: any = null;
  let bin: Buffer | null = null;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const body = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
    else if (type === 0x004e4942) bin = body;
    offset += 8 + len;
    if (len % 4) offset += 4 - (len % 4);
  }
  const out = new Map<string, number>();
  for (const anim of json.animations ?? []) {
    let end = 0;
    for (const sampler of anim.samplers) {
      const acc = json.accessors[sampler.input];
      if (acc.max?.[0] != null) {
        end = Math.max(end, acc.max[0]);
        continue;
      }
      const view = json.bufferViews[acc.bufferView];
      const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      for (let i = 0; i < acc.count; i++) end = Math.max(end, bin!.readFloatLE(base + i * 4));
    }
    out.set(anim.name, end);
  }
  return out;
}

/** Every manifest rig that declares idle-breakers. */
const rigsWithVariants = Object.entries(VISUALS).filter(
  ([, def]) => (def.clips.idleVariants ?? []).length > 0,
);

interface IdleVariantHarness {
  idleVariantIn: number;
  idleBeatIn: number;
  currentIsOneShot: boolean;
  currentOneShotIsIdleVariant: boolean;
  def: {
    clips: {
      idleVariants: string[];
      idleBeat?: { clip: string; everySec: number; jitterSec?: number };
    };
  };
  action(name: string): object | null;
  playOneShot(name: string, speed: number): void;
  tickIdleVariant(dt: number, desired: BaseState): void;
  tickIdleBeat(dt: number, desired: BaseState): void;
}

function idleVariantHarness(): {
  visual: IdleVariantHarness;
  playOneShot: ReturnType<typeof vi.fn>;
} {
  const playOneShot = vi.fn();
  const visual = Object.create(CharacterVisual.prototype) as IdleVariantHarness;
  Object.assign(visual, {
    idleVariantIn: -1,
    idleBeatIn: -1,
    currentIsOneShot: false,
    currentOneShotIsIdleVariant: false,
    def: {
      clips: {
        idleVariants: ['Idle_Look', 'Idle_Rear'],
        idleBeat: { clip: 'Idle_Shake', everySec: 20, jitterSec: 4 },
      },
    },
    action: () => ({}),
    playOneShot,
  });
  return { visual, playOneShot };
}

describe('idle-breaker clips', () => {
  it('is a feature at least one rig actually uses', () => {
    expect(rigsWithVariants.map(([key]) => key)).toContain('mount_chimeglass_tortoise');
  });

  it('names only clips the shipped GLB really carries', () => {
    for (const [key, def] of rigsWithVariants) {
      const durations = clipDurations(def.url.replace(/^\//, ''));
      for (const name of def.clips.idleVariants ?? []) {
        expect(durations.has(name), `${key} declares a missing idle variant: ${name}`).toBe(true);
      }
      // and the base idle it hands back to
      expect(durations.has(def.clips.idle), `${key} is missing its base idle`).toBe(true);
    }
  });

  it('pins the Chimeglass fidget pool, signature beat, and airborne handoff clips', () => {
    expect(VISUALS.mount_chimeglass_tortoise.clips).toMatchObject({
      idle: 'Idle',
      idleVariants: ['Idle_Look', 'Idle_Rear', 'Idle_Stamp', 'Idle_Groove'],
      idleBeat: { clip: 'Idle_Shake', everySec: 20, jitterSec: 4 },
      jump: 'Jump',
      land: 'Land',
    });
  });

  it('fires a fidget on the authored 5-second beat, clear of the previous one', () => {
    // The fidgets are this rig's character, so the cadence is deliberately
    // tight: a fidget falls due every 5 seconds. The only hard requirement left
    // is that a variant has ENDED before the next one is due, since a fidget is
    // a one-shot and re-firing over a live one would cut it short.
    const { min, jitter } = idleVariantCadenceForTest;
    expect(jitter).toBe(0);
    expect(min).toBe(5);
    for (const [key, def] of rigsWithVariants) {
      const durations = clipDurations(def.url.replace(/^\//, ''));
      const longest = Math.max(
        ...(def.clips.idleVariants ?? []).map((name) => durations.get(name) ?? 0),
      );
      expect(longest, `${key} has a zero-length idle variant`).toBeGreaterThan(0);
      expect(min, `${key}: fidget beat ${min}s vs longest clip ${longest}s`).toBeGreaterThan(
        longest,
      );
    }
  });

  it('runs the CharacterVisual scheduler on the shipped five-second beat', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { visual, playOneShot } = idleVariantHarness();
      visual.tickIdleVariant(0, 'idle');
      expect(visual.idleVariantIn).toBe(5);
      visual.tickIdleVariant(4.99, 'idle');
      expect(playOneShot).not.toHaveBeenCalled();
      visual.tickIdleVariant(0.02, 'idle');
      expect(playOneShot).toHaveBeenCalledOnce();
      expect(playOneShot).toHaveBeenCalledWith('Idle_Look', 1);
      expect(visual.currentOneShotIsIdleVariant).toBe(true);

      visual.tickIdleVariant(0, 'run');
      expect(visual.idleVariantIn).toBe(-1);
    } finally {
      random.mockRestore();
    }
  });

  it('holds an overdue fidget behind another one-shot, then fires on the first clear frame', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { visual, playOneShot } = idleVariantHarness();
      visual.idleVariantIn = 0;
      visual.currentIsOneShot = true;

      visual.tickIdleVariant(0, 'idle');
      expect(playOneShot).not.toHaveBeenCalled();
      expect(visual.idleVariantIn).toBe(0);

      visual.currentIsOneShot = false;
      visual.tickIdleVariant(0, 'idle');
      expect(playOneShot).toHaveBeenCalledOnce();
      expect(playOneShot).toHaveBeenCalledWith('Idle_Look', 1);
    } finally {
      random.mockRestore();
    }
  });

  it('runs the signature shake on its independent 20-plus-jitter clock', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const { visual, playOneShot } = idleVariantHarness();
      visual.tickIdleBeat(0, 'idle');
      expect(visual.idleBeatIn).toBe(22);
      visual.tickIdleBeat(21.99, 'idle');
      expect(playOneShot).not.toHaveBeenCalled();
      visual.tickIdleBeat(0.02, 'idle');
      expect(playOneShot).toHaveBeenCalledWith('Idle_Shake', 1);
      expect(visual.currentOneShotIsIdleVariant).toBe(true);

      visual.tickIdleBeat(0, 'run');
      expect(visual.idleBeatIn).toBe(-1);
    } finally {
      random.mockRestore();
    }
  });
});
