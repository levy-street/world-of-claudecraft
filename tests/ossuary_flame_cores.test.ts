// Wraith the Deadstrier's two pure flame cores: the speed-to-length stretch and
// the tail's spring chain. Node-only (RENDER_PURE_CORES): no Three, no DOM.
import { describe, expect, it } from 'vitest';
import {
  STRETCH_FULL_SPEED,
  STRETCH_START_SPEED,
  stretchForSpeed,
} from '../src/render/ossuary_flame_stretch_core';
import { createTailChain, stepTailChain, TAIL_LINKS } from '../src/render/ossuary_tail_chain_core';

describe('ossuary flame stretch', () => {
  it('stays at the standing length at rest and below a walk', () => {
    expect(stretchForSpeed(0)).toBe(0);
    expect(stretchForSpeed(STRETCH_START_SPEED)).toBe(0);
    expect(stretchForSpeed(Number.NaN)).toBe(0);
    expect(stretchForSpeed(-5)).toBe(0);
  });

  it('reaches the full galloping length at full speed and holds it past it', () => {
    expect(stretchForSpeed(STRETCH_FULL_SPEED)).toBe(1);
    expect(stretchForSpeed(STRETCH_FULL_SPEED * 3)).toBe(1);
  });

  it('grows monotonically between a walk and a gallop, eased in', () => {
    let last = 0;
    for (let v = STRETCH_START_SPEED; v <= STRETCH_FULL_SPEED; v += 0.5) {
      const s = stretchForSpeed(v);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
    const quarter = STRETCH_START_SPEED + (STRETCH_FULL_SPEED - STRETCH_START_SPEED) * 0.25;
    expect(stretchForSpeed(quarter)).toBeLessThan(0.25);
  });
});

/** A straight tail hanging back along -z from (0, 1, 0), one unit per link. */
function goalsAt(x: number, z = 0): Float32Array {
  const g = new Float32Array(TAIL_LINKS * 3);
  for (let i = 0; i < TAIL_LINKS; i++) {
    g[i * 3] = x;
    g[i * 3 + 1] = 1;
    g[i * 3 + 2] = z - i;
  }
  return g;
}

describe('ossuary tail chain', () => {
  it('snaps onto its goals on the first step', () => {
    const chain = createTailChain();
    const goals = goalsAt(0);
    stepTailChain(chain, goals, 1 / 60);
    expect(chain.primed).toBe(true);
    expect(Array.from(chain.pos)).toEqual(Array.from(goals));
  });

  it('pins the root to its goal and lags the tip behind a sideways move', () => {
    const chain = createTailChain();
    stepTailChain(chain, goalsAt(0), 1 / 60);
    const moved = goalsAt(1);
    stepTailChain(chain, moved, 1 / 60);
    expect(chain.pos[0]).toBeCloseTo(1, 6);
    const tip = (TAIL_LINKS - 1) * 3;
    expect(chain.pos[tip]).toBeLessThan(0.5);
  });

  it('keeps every link at its goal spacing', () => {
    const chain = createTailChain();
    stepTailChain(chain, goalsAt(0), 1 / 60);
    for (let f = 0; f < 30; f++) stepTailChain(chain, goalsAt(f * 0.1), 1 / 60);
    for (let i = 1; i < TAIL_LINKS; i++) {
      const a = (i - 1) * 3;
      const b = i * 3;
      const d = Math.hypot(
        chain.pos[b] - chain.pos[a],
        chain.pos[b + 1] - chain.pos[a + 1],
        chain.pos[b + 2] - chain.pos[a + 2],
      );
      expect(d).toBeCloseTo(1, 4);
    }
  });

  it('settles back onto still goals', () => {
    const chain = createTailChain();
    stepTailChain(chain, goalsAt(0), 1 / 60);
    stepTailChain(chain, goalsAt(1), 1 / 60);
    const still = goalsAt(1);
    for (let f = 0; f < 600; f++) stepTailChain(chain, still, 1 / 60);
    const tip = (TAIL_LINKS - 1) * 3;
    expect(chain.pos[tip]).toBeCloseTo(1, 1);
  });
});
