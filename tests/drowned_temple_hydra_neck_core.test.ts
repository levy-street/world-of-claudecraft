// The Mere Hydra's neck and pour bookkeeping (src/render/drowned_temple/
// temple_hydra_neck_core.ts): a regrown neck rises straight out of the pool,
// the necks that fell before stay down when the last head dies (they used to
// pop back to full height for a frame and die again), and a breath pour whose
// head is gone is cut at once (it used to pour from a dead mouth forever).

import { describe, expect, it } from 'vitest';
import {
  freshNeck,
  holdFallenNecks,
  NECK_RISE_DEPTH,
  NECK_RISE_SECONDS,
  type NeckInput,
  type NeckMemory,
  type NeckPose,
  releaseOrphanPours,
  stepNeck,
} from '../src/render/drowned_temple/temple_hydra_neck_core';

const DT = 1 / 60;
const REGROW = 20;

function frames(
  m: NeckMemory,
  seconds: number,
  input: Partial<NeckInput>,
  clock: { t: number },
): (NeckPose | null)[] {
  const out: (NeckPose | null)[] = [];
  for (let s = 0; s < seconds; s += DT) {
    clock.t += DT;
    out.push(
      stepNeck(m, {
        dead: false,
        allDead: false,
        regrowAfter: REGROW,
        clock: clock.t,
        dt: DT,
        phase: 0,
        ...input,
      }).pose,
    );
  }
  return out;
}

describe('a fallen Hydra neck', () => {
  it('folds into the pool, then rises straight up out of it when the head regrows', () => {
    const m = freshNeck();
    const clock = { t: 0 };
    const down = frames(m, REGROW, { dead: true }, clock);
    expect(down[down.length - 1]?.scale).toBeLessThan(0.5);
    // The regrowth frame: under the water, no fold left to unwind.
    clock.t += DT;
    const edge = stepNeck(m, {
      dead: false,
      allDead: false,
      regrowAfter: REGROW,
      clock: clock.t,
      dt: DT,
      phase: 0,
    });
    expect(edge.regrew).toBe(true);
    expect(edge.pose?.drop).toBeGreaterThan(NECK_RISE_DEPTH * 0.9);
    const rise = frames(m, NECK_RISE_SECONDS + 0.2, {}, clock);
    let lastDrop = edge.pose?.drop ?? 0;
    let lastScale = edge.pose?.scale ?? 0;
    for (const p of rise) {
      if (!p) continue;
      // Straight up: it never tilts or writhes on the way, never sinks back.
      expect(p.tiltX).toBe(0);
      expect(p.swayZ).toBe(0);
      expect(p.drop).toBeLessThanOrEqual(lastDrop + 1e-9);
      expect(p.scale).toBeGreaterThanOrEqual(lastScale - 1e-9);
      lastDrop = p.drop;
      lastScale = p.scale;
    }
    // Then the mixer owns it again.
    expect(rise[rise.length - 1]).toBeNull();
  });
});

describe('the last head falling', () => {
  it('keeps the necks that fell before folded; only the last neck is the Death clip’s', () => {
    const clock = { t: 0 };
    const necks = [freshNeck(), freshNeck(), freshNeck()];
    frames(necks[0], 3, { dead: true }, clock);
    frames(necks[1], 3, { dead: true }, clock);
    frames(necks[2], 0.1, { dead: true }, clock);
    holdFallenNecks(necks);
    for (let s = 0; s < 3; s += DT) {
      clock.t += DT;
      const poses = necks.map(
        (m) =>
          stepNeck(m, {
            dead: true,
            allDead: true,
            regrowAfter: REGROW,
            clock: clock.t,
            dt: DT,
            phase: 0,
          }).pose,
      );
      // Never back to full height: still folded, every frame.
      expect(poses[0]?.scale).toBeLessThan(0.01);
      expect(poses[1]?.scale).toBeLessThan(0.01);
      expect(poses[2]).toBeNull();
    }
  });
});

describe('the breath pours', () => {
  it('cuts a pour whose head died or vanished, keeps a living head’s', () => {
    const slots = [
      { headId: 7, life: 0.8 },
      { headId: 8, life: 0.6 },
      { headId: 9, life: 1 },
      { headId: -1, life: 0 },
    ];
    const live = new Set([9]);
    expect(releaseOrphanPours(slots, (id) => live.has(id))).toBe(2);
    expect(slots.map((s) => [s.headId, s.life])).toEqual([
      [-1, 0],
      [-1, 0],
      [9, 1],
      [-1, 0],
    ]);
    // All three dead (or the body under the Tsunami): nothing pours.
    live.clear();
    releaseOrphanPours(slots, (id) => live.has(id));
    expect(slots.every((s) => s.headId === -1 && s.life === 0)).toBe(true);
  });
});
