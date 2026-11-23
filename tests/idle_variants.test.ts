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
const characterVisualSource = readFileSync(
  new URL('../src/render/characters/visual.ts', import.meta.url),
  'utf8',
);
const clipNamesSource = readFileSync(
  new URL('../src/render/characters/clip_names.ts', import.meta.url),
  'utf8',
);

/** Every clip a def plays: its body GLB's plus its animation libraries' (a WOC body ships
 *  its clips in a separate anims file, animUrls). */
function defClipDurations(def: { url: string; animUrls?: readonly string[] }): Map<string, number> {
  const out = new Map<string, number>();
  for (const url of [def.url, ...(def.animUrls ?? [])]) {
    for (const [name, d] of clipDurations(url.replace(/^\//, ''))) out.set(name, d);
  }
  return out;
}

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
      const durations = defClipDurations(def);
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

  it('registers every scheduled idle clip in the CharacterVisual action map', () => {
    // The clip-name listing lives in clip_names.ts; visual.ts registers what it returns.
    const start = clipNamesSource.indexOf('function clipNamesOf(def: VisualDef): string[] {');
    expect(start).toBeGreaterThan(-1);
    const actionMap = clipNamesSource.slice(start);

    const registration = characterVisualSource.match(
      /for \(const name of \[([\s\S]*?)\]\) \{([\s\S]*?)\n {6}\}/,
    );
    expect(registration, 'the constructor must register each declared action').not.toBeNull();
    expect(registration?.[1]).toContain('...clipNamesOf(prep.def)');
    expect(registration?.[1]).toContain('...SKIN_ATTACK_CLIP_NAMES');
    expect(registration?.[2]).toContain('const clip = prep.clips.get(name);');
    expect(registration?.[2]).toContain('this.actions.set(name, this.mixer.clipAction(clip))');
    expect(actionMap).toContain('...(c.idleVariants ?? []),');
    expect(actionMap).toContain('c.idleBeat?.clip,');
  });

  it('drives both schedulers from update and hands an interrupted fidget to locomotion', () => {
    const start = characterVisualSource.indexOf(
      'update(dt: number, s: AnimState, animate: boolean, reducedMotion = false): void {',
    );
    const end = characterVisualSource.indexOf('\n  /**', start + 1);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const update = characterVisualSource.slice(start, end);

    const cancelAt = update.indexOf(
      "this.currentIsOneShot && this.currentOneShotIsIdleVariant && desired !== 'idle'",
    );
    const beatAt = update.indexOf('this.tickIdleBeat(dt, desired);');
    const variantAt = update.indexOf('this.tickIdleVariant(dt, desired);');
    const gaitAt = update.indexOf('// foot-speed matching on locomotion cycles');
    expect(cancelAt).toBeGreaterThan(-1);
    expect(update.slice(cancelAt, beatAt)).toContain('this.currentIsOneShot = false;');
    expect(update.slice(cancelAt, beatAt)).toContain('this.currentOneShotIsIdleVariant = false;');
    expect(update.slice(cancelAt, beatAt)).toContain(
      'this.fadeTo(this.baseAction(), this.baseTransitionFade(desired), false);',
    );
    expect(beatAt).toBeGreaterThan(cancelAt);
    expect(variantAt).toBeGreaterThan(beatAt);
    expect(gaitAt).toBeGreaterThan(variantAt);
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
      const durations = defClipDurations(def);
      const longest = Math.max(
        ...(def.clips.idleVariants ?? []).map((name) => durations.get(name) ?? 0),
      );
      expect(longest, `${key} has a zero-length idle variant`).toBeGreaterThan(0);
      // A rig that holds every draw for its idle loop seam cannot re-fire over
      // a live fidget whatever its cadence: a due draw also waits out the
      // one-shot playing (the clock parks at zero), and the seam only comes
      // round once the base idle is back. Its short cadence is how its fidgets
      // chain (tests/idle_variant_shuffle.test.ts).
      if (def.clips.idleVariantsOnLoopSeam) continue;
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

describe('held draws and the loop seam', () => {
  it('parks a fidget held behind a one-shot at zero, so it fires when the one-shot ends', () => {
    // The clock below zero read as unarmed on the next frame and re-armed a full
    // cadence, silently dropping the held fidget. Real frames (dt > 0) show it.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { visual, playOneShot } = idleVariantHarness();
      visual.idleVariantIn = 0.01;
      visual.currentIsOneShot = true;
      visual.tickIdleVariant(0.016, 'idle');
      expect(visual.idleVariantIn).toBe(0);
      visual.tickIdleVariant(0.016, 'idle');
      expect(visual.idleVariantIn).toBe(0);
      expect(playOneShot).not.toHaveBeenCalled();
      visual.currentIsOneShot = false;
      visual.tickIdleVariant(0.016, 'idle');
      expect(playOneShot).toHaveBeenCalledExactlyOnceWith('Idle_Look', 1);
    } finally {
      random.mockRestore();
    }
  });

  it('parks the idle beat the same way', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { visual, playOneShot } = idleVariantHarness();
      visual.idleBeatIn = 0.01;
      visual.currentIsOneShot = true;
      visual.tickIdleBeat(0.016, 'idle');
      expect(visual.idleBeatIn).toBe(0);
      visual.currentIsOneShot = false;
      visual.tickIdleBeat(0.016, 'idle');
      expect(playOneShot).toHaveBeenCalledExactlyOnceWith('Idle_Shake', 1);
    } finally {
      random.mockRestore();
    }
  });

  it('holds a seam rig for the idle wrap, then draws fidgets and the idle itself in even turns', () => {
    const idle = { time: 3, getClip: () => ({ duration: 6 }) };
    const { visual, playOneShot } = idleVariantHarness();
    Object.assign(visual, {
      idleVariantBag: [],
      lastIdleVariant: null,
      def: {
        clips: {
          idle: 'Idle',
          idleVariants: ['A', 'B'],
          idleVariantCadence: { everySec: 1, jitterSec: 0 },
          idleVariantsOnLoopSeam: true,
          idleVariantsShuffled: true,
          idleVariantsIncludeIdle: true,
        },
      },
      action: (name: string) => (name === 'Idle' ? idle : {}),
    });
    visual.tickIdleVariant(0, 'idle'); // arm: 1 s
    visual.tickIdleVariant(1.01, 'idle'); // due mid-loop: held
    expect(playOneShot).not.toHaveBeenCalled();
    expect(visual.idleVariantIn).toBe(0);

    const picks: string[] = [];
    for (let draw = 0; draw < 9; draw++) {
      idle.time = 6; // on the seam
      const before = playOneShot.mock.calls.length;
      visual.tickIdleVariant(0.016, 'idle');
      const played = playOneShot.mock.calls.length > before;
      picks.push(played ? (playOneShot.mock.calls.at(-1)?.[0] as string) : 'Idle');
      if (!played) expect(visual.idleVariantIn).toBeCloseTo(1, 5); // one more idle loop
      idle.time = 3;
      visual.tickIdleVariant(1.01, 'idle'); // due again, held off the seam
    }
    expect(playOneShot.mock.calls.every(([name]) => name !== 'Idle')).toBe(true);
    for (let round = 0; round < 3; round++) {
      expect(picks.slice(round * 3, round * 3 + 3).sort()).toEqual(['A', 'B', 'Idle']);
    }
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
  });
});
