// The Tideglass Colossus's Tideglass Fracture (src/sim/encounters/
// drowned_temple/tideglass_fracture.ts): the Prism Terrace's floor splits into
// eight prism slices like a pie; in each of three rounds the red slices (and
// the hub under the plinth) detonate and the clear ones are safe; every
// round's safe slices were red the round before, so the group must move. The
// pattern is fixed per cast (a hashed rotation of a fixed table), the same on
// every host. Driven through full Sim ticks in a real claimed Temple.

import { describe, expect, it } from 'vitest';
import {
  COLOSSUS_ID,
  COLOSSUS_PRISM_FLARE,
  COLOSSUS_TIDEGLASS_FRACTURE,
  COLOSSUS_TUNING,
  FRACTURE_HUB,
  FRACTURE_REACH,
  FRACTURE_ROUNDS,
  FRACTURE_SAFE_PATTERNS,
  FRACTURE_SLICES,
  FRACTURE_TEMPLATES,
  fractureHits,
  fractureSafeSlices,
  fractureSliceAt,
  fractureSliceYaw,
  fractureStateOf,
  TERRACE,
} from '../src/sim/encounters/drowned_temple';
import {
  fractureChannel,
  fractureWarn,
  startFracture,
} from '../src/sim/encounters/drowned_temple/tideglass_fracture';
import type { ColossusFightState, Entity } from '../src/sim/types';
import {
  boss,
  engage,
  type Fight,
  fight,
  local,
  objects,
  put,
  run,
  until,
} from './helpers/temple_fight';

const T = COLOSSUS_TUNING;

/** A spot on slice `i`, `r` yards out from the terrace centre (local). */
function onSlice(i: number, r = 10): { x: number; z: number } {
  const yaw = fractureSliceYaw(i);
  return { x: TERRACE.x + Math.sin(yaw) * r, z: TERRACE.z + Math.cos(yaw) * r };
}

describe('the fracture pattern (pure)', () => {
  it('cuts the terrace into eight slices round its centre, a hub under the plinth', () => {
    for (let i = 0; i < FRACTURE_SLICES; i++) {
      const at = onSlice(i);
      expect(fractureSliceAt(at.x, at.z)).toBe(i);
      // Just inside either edge of the slice is still the slice.
      const edge = (Math.PI * 2) / FRACTURE_SLICES / 2 - 0.02;
      for (const d of [-edge, edge]) {
        const yaw = fractureSliceYaw(i) + d;
        expect(
          fractureSliceAt(TERRACE.x + Math.sin(yaw) * 12, TERRACE.z + Math.cos(yaw) * 12),
        ).toBe(i);
      }
    }
    expect(fractureSliceAt(TERRACE.x + FRACTURE_HUB - 0.5, TERRACE.z)).toBe('hub');
    expect(fractureSliceAt(TERRACE.x, TERRACE.z + FRACTURE_REACH + 1)).toBeNull();
  });

  it('every round, for every rotation, moves the safe slices onto last round’s red ones', () => {
    expect(FRACTURE_ROUNDS).toBe(3);
    for (let rot = 0; rot < FRACTURE_SLICES; rot++) {
      for (let r = 0; r < FRACTURE_ROUNDS; r++) {
        const safe = fractureSafeSlices(r, rot);
        expect(safe.length).toBeGreaterThan(0);
        // Some slice is red every round (the round is a real threat).
        expect(safe.length).toBeLessThan(FRACTURE_SLICES);
        if (r === 0) continue;
        const before = fractureSafeSlices(r - 1, rot);
        for (const i of safe) expect(before).not.toContain(i);
      }
    }
    // The rotation turns the table, never reshapes it.
    expect(fractureSafeSlices(2, 0)).toEqual([...FRACTURE_SAFE_PATTERNS[2]]);
    expect(fractureSafeSlices(2, 3)).toEqual(FRACTURE_SAFE_PATTERNS[2].map((i) => (i + 3) % 8));
  });

  it('a safe slice never hits, a red slice and the hub always do', () => {
    for (let rot = 0; rot < FRACTURE_SLICES; rot++) {
      for (let r = 0; r < FRACTURE_ROUNDS; r++) {
        const safe = fractureSafeSlices(r, rot);
        for (let i = 0; i < FRACTURE_SLICES; i++) {
          const at = onSlice(i);
          expect(fractureHits(r, rot, at.x, at.z)).toBe(!safe.includes(i));
        }
        expect(fractureHits(r, rot, TERRACE.x, TERRACE.z)).toBe(true);
      }
    }
  });
});

describe('the Tideglass Fracture in the fight', () => {
  function colossus(difficulty: 'normal' | 'heroic' = 'normal'): {
    f: Fight;
    b: Entity;
    st: ColossusFightState;
  } {
    const f = fight(difficulty);
    const b = boss(f, COLOSSUS_ID);
    put(f, f.tank, TERRACE.x - 6, TERRACE.z);
    put(f, f.others[0], TERRACE.x + 10, TERRACE.z - 10);
    put(f, f.others[1], TERRACE.x + 10, TERRACE.z + 10);
    engage(f, b);
    run(f, 0.05);
    const st = b.templeFight;
    if (st?.kind !== 'colossus') throw new Error('no colossus fight');
    // Only the fracture: no lance, slam or flare to muddy the reads.
    st.lanceTimer = 999;
    st.slamTimer = 999;
    st.flares = T.flareAt.length;
    return { f, b, st };
  }

  it('comes on its own timer (first at 20 s) as one planted channel', () => {
    const { f, b, st } = colossus();
    // The fresh fight's clock (one tick in), then skip most of the wait.
    expect(st.fractureTimer).toBeCloseTo(T.fractureFirst - 0.05, 6);
    expect(st.fracture).toBeNull();
    st.fractureTimer = 0.5;
    run(f, 0.3);
    expect(b.castingAbility).not.toBe(COLOSSUS_TIDEGLASS_FRACTURE);
    expect(until(f, () => b.castingAbility === COLOSSUS_TIDEGLASS_FRACTURE, 1)).toBe(true);
    expect(st.fractureTimer).toBeCloseTo(T.fractureEvery, 1);
    expect(b.channeling).toBe(true);
    expect(b.castTotal).toBeCloseTo(fractureChannel(false), 6);
    expect(fractureChannel(false)).toBeCloseTo(T.fractureCast + 3 * T.fractureWarn, 6);
    expect(st.fracture?.round).toBe(-1);
    // Eight cracking slices, one per slice heading.
    const cracks = objects(f, FRACTURE_TEMPLATES.crack);
    expect(cracks).toHaveLength(FRACTURE_SLICES);
    expect(cracks.map((o) => o.facing).sort((a, c) => a - c)).toEqual(
      Array.from({ length: FRACTURE_SLICES }, (_, i) => fractureSliceYaw(i)),
    );
    // Planted for the whole channel while the tank walks round it.
    const at = local(f, b);
    run(f, 4, () => put(f, f.tank, TERRACE.x + 12, TERRACE.z + 12));
    const now = local(f, b);
    expect(Math.hypot(now.x - at.x, now.z - at.z)).toBeLessThan(0.05);
  });

  it('three rounds: red slices hit, safe slices do not, and the safe ones move', () => {
    const { f, b, st } = colossus();
    expect(startFracture(f.sim.ctx, f.inst, b, st)).toBe(true);
    const fr = st.fracture;
    if (!fr) throw new Error('no fracture');
    const rot = fr.rot;
    const [stayer, mover] = f.others;
    // The tank stays out on the rim beyond the reach (never hit).
    const off = { x: TERRACE.x, z: TERRACE.z - FRACTURE_REACH - 4 };
    run(f, T.fractureCast + 0.1, () => put(f, f.tank, off.x, off.z));
    let prevSafe: number[] = [];
    for (let r = 0; r < FRACTURE_ROUNDS; r++) {
      expect(fr.round).toBe(r);
      const safe = fractureSafeSlices(r, rot);
      const red = Array.from({ length: FRACTURE_SLICES }, (_, i) => i).find(
        (i) => !safe.includes(i),
      ) as number;
      // The slice objects show this round's colours.
      fr.objectIds.forEach((id, i) => {
        const o = f.sim.ctx.entities.get(id) as Entity;
        expect(fractureStateOf(o.templateId)).toBe(safe.includes(i) ? 'safe' : 'red');
      });
      // The safe slices are new this round.
      for (const i of safe) expect(prevSafe).not.toContain(i);
      prevSafe = safe;
      // The mover stands safe, the stayer on a red slice, until the burst.
      const safeAt = onSlice(safe[0]);
      const redAt = onSlice(red);
      const from = f.hits.length;
      run(f, T.fractureWarn, () => {
        put(f, mover, safeAt.x, safeAt.z);
        put(f, stayer, redAt.x, redAt.z);
        put(f, f.tank, off.x, off.z);
      });
      const bursts = f.hits.slice(from).filter((h) => h.ability === 'Tideglass Fracture');
      expect(bursts.map((h) => h.targetId)).toEqual([stayer.id]);
      expect(bursts[0].amount).toBeGreaterThanOrEqual(T.fractureMin);
      expect(bursts[0].amount).toBeLessThanOrEqual(T.fractureMax);
    }
    // The channel is over and the floor is whole again.
    run(f, 0.2);
    expect(b.castingAbility).not.toBe(COLOSSUS_TIDEGLASS_FRACTURE);
    expect(st.fracture).toBeNull();
    for (const t of Object.values(FRACTURE_TEMPLATES)) expect(objects(f, t)).toHaveLength(0);
  });

  it('the same cast count turns the same pattern (no rng in the pick)', () => {
    const a = colossus();
    const b = colossus();
    startFracture(a.f.sim.ctx, a.f.inst, a.b, a.st);
    startFracture(b.f.sim.ctx, b.f.inst, b.b, b.st);
    expect(a.st.fracture?.rot).toBe(b.st.fracture?.rot);
  });

  it('heroic detonates sooner (2 s a round)', () => {
    expect(fractureWarn(true)).toBe(T.fractureWarnHeroic);
    expect(fractureWarn(true)).toBeLessThan(fractureWarn(false));
    const { f, b, st } = colossus('heroic');
    startFracture(f.sim.ctx, f.inst, b, st);
    expect(b.castTotal).toBeCloseTo(T.fractureCast + 3 * T.fractureWarnHeroic, 6);
  });

  it('never opens inside a Prism Flare, and a wipe clears the slices', () => {
    const { f, b, st } = colossus();
    // The next flare threshold just ahead: the fracture holds.
    st.flares = 0;
    st.fractureTimer = 0;
    b.hp = Math.floor(b.maxHp * (T.flareAt[0] + 0.02));
    run(f, 0.2);
    expect(b.castingAbility).not.toBe(COLOSSUS_TIDEGLASS_FRACTURE);
    // Over the threshold it flares first.
    b.hp = Math.floor(b.maxHp * (T.flareAt[0] - 0.01));
    run(f, 0.1);
    expect(b.castingAbility).toBe(COLOSSUS_PRISM_FLARE);
    // A fracture in flight, then a wipe: every slice fades.
    b.castingAbility = null;
    b.castRemaining = 0;
    startFracture(f.sim.ctx, f.inst, b, st);
    run(f, T.fractureCast + 0.5);
    expect(objects(f, FRACTURE_TEMPLATES.red).length).toBeGreaterThan(0);
    for (const p of [f.tank, ...f.others]) put(f, p, 0, -230);
    b.inCombat = false;
    b.aggroTargetId = null;
    b.aiState = 'evade';
    run(f, 0.2);
    for (const t of Object.values(FRACTURE_TEMPLATES)) expect(objects(f, t)).toHaveLength(0);
    expect(b.templeFight).toBeUndefined();
  });
});
