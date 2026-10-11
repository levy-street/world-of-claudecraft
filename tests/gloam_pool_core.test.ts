// The pure half of Gloamveil's shadow pool: where the stain lies (the known
// floor, an unknown floor such as a bridge deck, a wearer in the air), what a
// vertex does where the floor breaks away, when the pool is laid again, the
// entry's eruption and ring, the wake behind a walking wearer, and the
// per-frame allowance of ground samples every pool shares.
import { describe, expect, it } from 'vitest';
import {
  createGloamFloor,
  createGloamWake,
  GLOAM_BREAK_HEIGHT,
  GLOAM_DRAPE_BUDGET,
  GLOAM_DROP_BELOW,
  GLOAM_ERUPT_SECONDS,
  GLOAM_KNOWN_FLOOR_GAP,
  GLOAM_LEAVE_FADE_FROM,
  GLOAM_LEAVE_FADE_TO,
  GLOAM_REDRAPE_RISE,
  GLOAM_REDRAPE_STEP,
  GLOAM_RING_SECONDS,
  GLOAM_UNKNOWN_FLOOR_GAP,
  GLOAM_WAKE_STEP,
  GLOAM_WAKE_TELEPORT,
  GloamDrapeBudget,
  gloamDrapeFade,
  gloamDrapeHeight,
  gloamEruptGrow,
  gloamFloorInto,
  gloamRedrapeDue,
  gloamRingAt,
  gloamWakeAlpha,
  gloamWakeGrow,
  gloamWakeStep,
} from '../src/render/gloam_pool_core';

describe('where the pool lies', () => {
  it('drapes on the sampled floor under a wearer standing on it', () => {
    const floor = createGloamFloor();
    gloamFloorInto(10, 10, true, floor);
    expect(floor).toEqual({ flat: false, baseY: 10, presence: 1 });
    // Still the known floor a hand above it: display smoothing, a kerb, a slope.
    gloamFloorInto(10, 10 + GLOAM_UNKNOWN_FLOOR_GAP, true, floor);
    expect(floor).toEqual({ flat: false, baseY: 10, presence: 1 });
    // A buried sample (feet under the sampled ground) is still the known floor.
    gloamFloorInto(10, 9.6, true, floor);
    expect(floor).toEqual({ flat: false, baseY: 10, presence: 1 });
  });

  it('lies flat at the feet on a floor the sampler does not know (a dock, a bridge, a storey)', () => {
    const floor = createGloamFloor();
    // Dock planks a yard over the bed: the pool must not go under them.
    gloamFloorInto(10, 11.3, true, floor);
    expect(floor).toEqual({ flat: true, baseY: 11.3, presence: 1 });
    // Walking up the deck carries the pool with the feet.
    gloamFloorInto(10, 14, true, floor);
    expect(floor).toEqual({ flat: true, baseY: 14, presence: 1 });
    // Stepping back down onto known ground drapes it again.
    gloamFloorInto(10, 10.1, true, floor);
    expect(floor).toEqual({ flat: false, baseY: 10, presence: 1 });
  });

  it('does not flip between the two near the threshold', () => {
    const floor = createGloamFloor();
    const between = (GLOAM_KNOWN_FLOOR_GAP + GLOAM_UNKNOWN_FLOOR_GAP) / 2;
    expect(GLOAM_KNOWN_FLOOR_GAP).toBeLessThan(GLOAM_UNKNOWN_FLOOR_GAP);
    // Coming from the ground it stays draped in the band...
    gloamFloorInto(10, 10, true, floor);
    gloamFloorInto(10, 10 + between, true, floor);
    expect(floor.flat).toBe(false);
    // ...and coming from a deck it stays flat in the same band.
    gloamFloorInto(10, 12, true, floor);
    gloamFloorInto(10, 10 + between, true, floor);
    expect(floor.flat).toBe(true);
    expect(floor.baseY).toBeCloseTo(10 + between, 12);
    gloamFloorInto(10, 10 + GLOAM_KNOWN_FLOOR_GAP - 0.01, true, floor);
    expect(floor.flat).toBe(false);
  });

  it('stays on the ground through a jump on known ground, at full strength', () => {
    const floor = createGloamFloor();
    gloamFloorInto(10, 10, true, floor);
    for (const feet of [10.4, 11.2, 11.6, 10.9, 10.1]) {
      gloamFloorInto(10, feet, false, floor);
      expect(floor).toEqual({ flat: false, baseY: 10, presence: 1 });
    }
  });

  it('stays on the deck through a jump on an unknown floor instead of following the feet', () => {
    const floor = createGloamFloor();
    gloamFloorInto(10, 15, true, floor);
    expect(floor).toEqual({ flat: true, baseY: 15, presence: 1 });
    for (const feet of [15.5, 16.3, 15.8, 15.05]) {
      gloamFloorInto(10, feet, false, floor);
      expect(floor.flat).toBe(true);
      expect(floor.baseY).toBe(15);
      expect(floor.presence).toBe(1);
    }
  });

  it('thins out as a body leaves its floor behind, and is gone far above it', () => {
    const floor = createGloamFloor();
    gloamFloorInto(10, 10, true, floor);
    // Flying up off known ground: full to the fade start, gone by its end.
    gloamFloorInto(10, 10 + GLOAM_LEAVE_FADE_FROM, false, floor);
    expect(floor.presence).toBe(1);
    const mid = (GLOAM_LEAVE_FADE_FROM + GLOAM_LEAVE_FADE_TO) / 2;
    gloamFloorInto(10, 10 + mid, false, floor);
    expect(floor.presence).toBeCloseTo(0.5, 12);
    expect(floor.baseY).toBe(10);
    gloamFloorInto(10, 10 + GLOAM_LEAVE_FADE_TO, false, floor);
    expect(floor.presence).toBe(0);
    // The same from a deck: measured from the deck, not from the ground under it.
    gloamFloorInto(10, 15, true, floor);
    gloamFloorInto(10, 15 + mid, false, floor);
    expect(floor.flat).toBe(true);
    expect(floor.baseY).toBe(15);
    expect(floor.presence).toBeCloseTo(0.5, 12);
  });

  it('lets go of a deck once the body has dropped below it (off a dock into water)', () => {
    const floor = createGloamFloor();
    gloamFloorInto(8, 15, true, floor);
    // Just under the deck is still a jump landing.
    gloamFloorInto(8, 15 - GLOAM_DROP_BELOW + 0.01, false, floor);
    expect(floor.flat).toBe(true);
    expect(floor.baseY).toBe(15);
    // Clearly below it: the pool belongs to the ground under the body now,
    // and stays unseen while the body is still high above that ground.
    gloamFloorInto(8, 15 - GLOAM_DROP_BELOW - 0.01, false, floor);
    expect(floor).toEqual({ flat: false, baseY: 8, presence: 0 });
    gloamFloorInto(8, 9, false, floor);
    expect(floor).toEqual({ flat: false, baseY: 8, presence: 1 });
  });

  it('fades over deep water under a swimmer and shows on a shallow bed', () => {
    const floor = createGloamFloor();
    // Swimming is unsettled: the bed is the floor, and the pool thins with depth.
    gloamFloorInto(2, 2 + GLOAM_LEAVE_FADE_TO + 1, false, floor);
    expect(floor).toEqual({ flat: false, baseY: 2, presence: 0 });
    gloamFloorInto(2, 3, false, floor);
    expect(floor).toEqual({ flat: false, baseY: 2, presence: 1 });
  });
});

describe('a draped vertex', () => {
  it('follows the floor up to the break height, either way', () => {
    for (const rise of [0, 0.3, -0.3, GLOAM_BREAK_HEIGHT, -GLOAM_BREAK_HEIGHT]) {
      expect(gloamDrapeHeight(rise)).toBe(rise);
      expect(gloamDrapeFade(rise)).toBe(1);
    }
  });

  it('fades out and holds at the break where the floor leaves it (a ledge, a wall foot)', () => {
    expect(gloamDrapeHeight(5)).toBe(GLOAM_BREAK_HEIGHT);
    expect(gloamDrapeFade(5)).toBe(0);
    expect(gloamDrapeHeight(-40)).toBe(-GLOAM_BREAK_HEIGHT);
    expect(gloamDrapeFade(-40)).toBe(0);
    expect(gloamDrapeFade(GLOAM_BREAK_HEIGHT + 1e-6)).toBe(0);
    // A sampler that answers nothing usable must not write it into a vertex:
    // the vertex stays on the pool's floor and fades out.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(gloamDrapeHeight(bad)).toBe(0);
      expect(gloamDrapeFade(bad)).toBe(0);
    }
  });
});

describe('when the pool is laid again', () => {
  it('lays a pool that was never laid', () => {
    expect(gloamRedrapeDue(1, 2, 3, Number.NaN, Number.NaN, Number.NaN)).toBe(true);
  });

  it('holds its lay until the wearer has moved a step or its floor has changed height', () => {
    expect(gloamRedrapeDue(1, 2, 3, 1, 2, 3)).toBe(false);
    expect(gloamRedrapeDue(1 + GLOAM_REDRAPE_STEP * 0.9, 2, 3, 1, 2, 3)).toBe(false);
    expect(gloamRedrapeDue(1 + GLOAM_REDRAPE_STEP, 2, 3, 1, 2, 3)).toBe(true);
    expect(gloamRedrapeDue(1, 2, 3 - GLOAM_REDRAPE_STEP, 1, 2, 3)).toBe(true);
    // A diagonal step counts by its length, not per axis.
    const diagonal = GLOAM_REDRAPE_STEP * 0.75;
    expect(gloamRedrapeDue(1 + diagonal, 2, 3 + diagonal, 1, 2, 3)).toBe(true);
    expect(gloamRedrapeDue(1, 2 + GLOAM_REDRAPE_RISE, 3, 1, 2, 3)).toBe(false);
    expect(gloamRedrapeDue(1, 2 + GLOAM_REDRAPE_RISE + 0.01, 3, 1, 2, 3)).toBe(true);
    expect(gloamRedrapeDue(1, 2 - GLOAM_REDRAPE_RISE - 0.01, 3, 1, 2, 3)).toBe(true);
  });
});

describe('the entry', () => {
  it('erupts the pool past its rest size and settles it back', () => {
    expect(gloamEruptGrow(0)).toBeCloseTo(0.2, 12);
    const peak = gloamEruptGrow(GLOAM_ERUPT_SECONDS * 0.3);
    expect(peak).toBeCloseTo(1.55, 12);
    let last = 0;
    for (let age = 0; age <= GLOAM_ERUPT_SECONDS * 0.3; age += 0.01) {
      expect(gloamEruptGrow(age)).toBeGreaterThanOrEqual(last);
      last = gloamEruptGrow(age);
    }
    last = peak;
    for (let age = GLOAM_ERUPT_SECONDS * 0.3; age <= GLOAM_ERUPT_SECONDS; age += 0.01) {
      expect(gloamEruptGrow(age)).toBeLessThanOrEqual(last + 1e-12);
      last = gloamEruptGrow(age);
    }
    expect(gloamEruptGrow(GLOAM_ERUPT_SECONDS)).toBeCloseTo(1, 12);
    expect(gloamEruptGrow(GLOAM_ERUPT_SECONDS * 4)).toBeCloseTo(1, 12);
  });

  it('rests at its size for a pool that never erupted (and a negative age)', () => {
    expect(gloamEruptGrow(Number.POSITIVE_INFINITY)).toBeCloseTo(1, 12);
    expect(gloamEruptGrow(-3)).toBeCloseTo(0.2, 12);
  });

  it('races the ring out and fades it, then reports it gone', () => {
    const out = { grow: -1, alpha: -1 };
    expect(gloamRingAt(0, out)).toBe(true);
    expect(out).toEqual({ grow: 0, alpha: 1 });
    let lastGrow = 0;
    let lastAlpha = 1;
    for (let age = 0.05; age < GLOAM_RING_SECONDS; age += 0.05) {
      expect(gloamRingAt(age, out)).toBe(true);
      expect(out.grow).toBeGreaterThan(lastGrow);
      expect(out.alpha).toBeLessThan(lastAlpha);
      lastGrow = out.grow;
      lastAlpha = out.alpha;
    }
    // Out fast: three quarters of the way by a third of its life.
    gloamRingAt(GLOAM_RING_SECONDS / 3, out);
    expect(out.grow).toBeGreaterThan(0.6);
    const kept = { ...out };
    expect(gloamRingAt(GLOAM_RING_SECONDS, out)).toBe(false);
    expect(gloamRingAt(Number.POSITIVE_INFINITY, out)).toBe(false);
    expect(gloamRingAt(Number.NaN, out)).toBe(false);
    // A ring that is gone writes nothing.
    expect(out).toEqual(kept);
  });
});

describe('the wake', () => {
  it('thins and shrinks a stain over its life', () => {
    expect(gloamWakeAlpha(1)).toBeCloseTo(0.8, 12);
    expect(gloamWakeAlpha(0)).toBe(0);
    expect(gloamWakeAlpha(0.25)).toBeCloseTo(0.25 * 0.5 * 0.8, 12);
    expect(gloamWakeGrow(1)).toBe(1);
    expect(gloamWakeGrow(0)).toBeCloseTo(0.55, 12);
  });

  it('drops nothing on the first frame, nor before a full step', () => {
    const wake = createGloamWake();
    expect(gloamWakeStep(wake, 5, 5, 8)).toBe(-1);
    expect(gloamWakeStep(wake, 5 + GLOAM_WAKE_STEP * 0.99, 5, 8)).toBe(-1);
    expect(wake.x).toBe(5);
  });

  it('drops a stain at the point it left, one step behind, and takes the stains in turn', () => {
    const wake = createGloamWake();
    gloamWakeStep(wake, 0, 0, 3);
    const stride = GLOAM_WAKE_STEP * 1.25;
    const drops: Array<[number, number, number]> = [];
    for (let i = 1; i <= 5; i++) {
      const drop = gloamWakeStep(wake, i * stride, 0, 3);
      drops.push([drop, wake.dropX, wake.x]);
    }
    expect(drops.map((d) => d[0])).toEqual([0, 1, 2, 0, 1]);
    for (let i = 0; i < drops.length; i++) {
      // Dropped where the wearer WAS; the wake now trails from where it is.
      expect(drops[i][1]).toBeCloseTo(i * stride, 12);
      expect(drops[i][2]).toBeCloseTo((i + 1) * stride, 12);
    }
  });

  it('drops nothing on a teleport, and carries on from the new place', () => {
    const wake = createGloamWake();
    gloamWakeStep(wake, 0, 0, 4);
    expect(gloamWakeStep(wake, GLOAM_WAKE_TELEPORT + 1, 0, 4)).toBe(-1);
    expect(wake.x).toBe(GLOAM_WAKE_TELEPORT + 1);
    expect(gloamWakeStep(wake, GLOAM_WAKE_TELEPORT + 1 + GLOAM_WAKE_STEP * 1.25, 0, 4)).toBe(0);
    expect(wake.dropX).toBe(GLOAM_WAKE_TELEPORT + 1);
  });

  it('keeps walking with no stains to drop (a tier with no wake)', () => {
    const wake = createGloamWake();
    gloamWakeStep(wake, 0, 0, 0);
    expect(gloamWakeStep(wake, 1, 0, 0)).toBe(-1);
    expect(wake.x).toBe(1);
    // Stains granted later start from where the wearer is, not from a stale point.
    expect(gloamWakeStep(wake, 1 + GLOAM_WAKE_STEP * 1.25, 0, 2)).toBe(0);
    expect(wake.dropX).toBe(1);
  });
});

describe('the shared drape allowance', () => {
  it('serves requests until the frame is spent, then refuses', () => {
    const budget = new GloamDrapeBudget(400);
    expect(budget.take(169)).toBe(false);
    budget.refill();
    expect(budget.take(169)).toBe(true);
    expect(budget.take(169)).toBe(true);
    expect(budget.remaining).toBe(62);
    // A third pool this frame does not fit: it waits for a later one.
    expect(budget.take(169)).toBe(false);
    // A small one still does.
    expect(budget.take(49)).toBe(true);
    expect(budget.take(49)).toBe(false);
    budget.refill();
    expect(budget.remaining).toBe(400);
  });

  it('always serves the first request of a frame, whatever its size', () => {
    const budget = new GloamDrapeBudget(100);
    budget.refill();
    expect(budget.take(361)).toBe(true);
    expect(budget.remaining).toBe(0);
    expect(budget.take(1)).toBe(false);
  });

  it('bounds a frame at one allowance plus at most one oversized first lay', () => {
    const budget = new GloamDrapeBudget();
    for (let frame = 0; frame < 20; frame++) {
      budget.refill();
      let spent = 0;
      for (let pool = 0; pool < 30; pool++) if (budget.take(169)) spent += 169;
      expect(spent).toBeLessThanOrEqual(GLOAM_DRAPE_BUDGET);
      expect(spent).toBeGreaterThan(0);
    }
  });
});
