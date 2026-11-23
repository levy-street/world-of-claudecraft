// Gaoler Ossick's Mooring Posts (src/sim/encounters/sunken_bastion/
// ossick_moorings.ts): a player hooked by the Drowned Anchor who reaches a LIT
// post moors the chain and is freed; that post goes dark for 30 s (kindling
// over its last 5) while the others stay lit; a dark post does nothing; the
// chain is a tether the victim can move along but never out past; a wipe
// relights every post; and the same fight plays out identically twice.

import { describe, expect, it, vi } from 'vitest';
import {
  anchorDragSpeed,
  MOORING_CHAIN_FLOOR,
  MOORING_POST_SPOTS,
  MOORING_TEMPLATES,
  mooringPostInReach,
  mooringStateFor,
  OSSICK_ANCHORED,
  OSSICK_ID,
  OSSICK_KEELHAULED,
  OSSICK_MOORED,
  OSSICK_TUNING,
  WINCH,
} from '../src/sim/encounters/sunken_bastion';
import { startDrownedAnchor } from '../src/sim/encounters/sunken_bastion/ossick';
import { DT, type Entity, type OssickFightState } from '../src/sim/types';
import { aura, boss, engage, type Fight, fight, put, run, until } from './helpers/bastion_fight';

vi.setConfig({ testTimeout: 60_000 });

const T = OSSICK_TUNING;

describe('Mooring Posts: the pure reach and the lamp', () => {
  it('moors to the nearest lit post within reach, never a dark or distant one', () => {
    const all = [true, true, true, true];
    const [nw, ne] = MOORING_POST_SPOTS;
    // Hooked far from every post (the winch side of the yard's middle).
    const hx = WINCH.x;
    const hz = WINCH.z - 18;
    expect(mooringPostInReach(nw.x + 2, nw.z, all, hx, hz)).toBe(0);
    expect(mooringPostInReach(ne.x, ne.z - 2.9, all, hx, hz)).toBe(1);
    // Just past the reach: nothing.
    expect(mooringPostInReach(nw.x + T.postReach + 0.05, nw.z, all, hx, hz)).toBe(-1);
    // A dark post holds nothing, however close.
    expect(mooringPostInReach(nw.x + 0.5, nw.z, [false, true, true, true], hx, hz)).toBe(-1);
  });

  it('a post never takes a chain whose victim was hooked beside it (no camping)', () => {
    const all = [true, true, true, true];
    const [nw] = MOORING_POST_SPOTS;
    // Hooked 4 yd from the post: standing on it does nothing.
    expect(mooringPostInReach(nw.x + 1, nw.z, all, nw.x + 4, nw.z)).toBe(-1);
    // Hooked just past the run it asks for: it holds.
    expect(mooringPostInReach(nw.x + 1, nw.z, all, nw.x + T.postRun + 0.1, nw.z)).toBe(0);
  });

  it('a dark lamp kindles over its last seconds, then lights', () => {
    expect(mooringStateFor(T.postDarkSeconds)).toBe('dark');
    expect(mooringStateFor(T.postKindleSeconds + 0.1)).toBe('dark');
    expect(mooringStateFor(T.postKindleSeconds)).toBe('kindling');
    expect(mooringStateFor(0.05)).toBe('kindling');
    expect(mooringStateFor(0)).toBe('lit');
  });

  it('a chain shorter than the posts less their reach can reach none', () => {
    const d = Math.hypot(MOORING_POST_SPOTS[0].x - WINCH.x, MOORING_POST_SPOTS[0].z - WINCH.z);
    expect(MOORING_CHAIN_FLOOR).toBeCloseTo(d - T.postReach, 5);
    expect(MOORING_CHAIN_FLOOR).toBeGreaterThan(11);
  });
});

// ---------------------------------------------------------------------------
describe('Mooring Posts in the fight', () => {
  function yard(difficulty: 'normal' | 'heroic' = 'normal'): { f: Fight; ossick: Entity } {
    const f = fight(difficulty);
    const ossick = boss(f, OSSICK_ID);
    put(f, ossick, -2, 12);
    put(f, f.tank, -2, 9);
    // On the yard's axes, 18 yd out: no straight haul passes a post.
    const spots = [
      [-2, 42],
      [16, 24],
      [-20, 24],
    ];
    for (const [i, p] of f.others.entries()) put(f, p, spots[i][0], spots[i][1]);
    engage(f, ossick);
    return { f, ossick };
  }

  function state(ossick: Entity): OssickFightState {
    const st = ossick.bastionFight;
    if (st?.kind !== 'ossick') throw new Error('no fight');
    return st;
  }

  function posts(f: Fight): Entity[] {
    return MOORING_POST_SPOTS.map((spot) => {
      const e = f.inst.objectIds
        .map((id) => f.sim.ctx.entities.get(id))
        .find(
          (o) =>
            o !== undefined &&
            Math.abs(o.pos.x - f.ox - spot.x) < 0.75 &&
            Math.abs(o.pos.z - f.oz - spot.z) < 0.75,
        );
      if (!e) throw new Error(`no post at ${spot.id}`);
      return e;
    });
  }

  function winchDist(f: Fight, p: Entity): number {
    return Math.hypot(p.pos.x - f.ox - WINCH.x, p.pos.z - f.oz - WINCH.z);
  }

  /** Hook a player now (the dev trigger's path), land the anchor, return them. */
  function hook(f: Fight, ossick: Entity): { victim: Entity; anchor: Entity } {
    const st = state(ossick);
    st.shackleTimer = 999;
    st.cudgelTimer = 999;
    ossick.castingAbility = null;
    expect(startDrownedAnchor(f.sim.ctx, f.inst, ossick, st)).toBe(true);
    run(f, T.anchorCast + DT * 2);
    const victim = f.others.find((p) => aura(p, OSSICK_ANCHORED));
    if (!victim) throw new Error('nobody anchored');
    const anchor = f.sim.ctx.entities.get(aura(victim, OSSICK_ANCHORED)?.sourceId ?? -1);
    if (!anchor) throw new Error('no anchor');
    return { victim, anchor };
  }

  /** A spot `inset` yd from post `i`, on the winch side (inside the chain). */
  function nearPost(i: number, inset: number): { x: number; z: number } {
    const p = MOORING_POST_SPOTS[i];
    const dx = WINCH.x - p.x;
    const dz = WINCH.z - p.z;
    const d = Math.hypot(dx, dz);
    return { x: p.x + (dx / d) * inset, z: p.z + (dz / d) * inset };
  }

  it('every post stands lit when the claim opens', () => {
    const { f } = yard();
    for (const p of posts(f)) expect(p.templateId).toBe(MOORING_TEMPLATES.lit);
  });

  it('reaching a lit post moors the chain: freed, the anchor gone, the post dark, the cue sent', () => {
    const { f, ossick } = yard();
    run(f, 1);
    const { victim, anchor } = hook(f, ossick);
    const cues = f.cues.length;
    const at = nearPost(0, 2);
    put(f, victim, at.x, at.z);
    run(f, DT * 2);
    expect(aura(victim, OSSICK_ANCHORED)).toBeUndefined();
    expect(f.sim.ctx.entities.has(anchor.id)).toBe(false);
    const [nw, ...rest] = posts(f);
    expect(nw.templateId).toBe(MOORING_TEMPLATES.dark);
    for (const p of rest) expect(p.templateId).toBe(MOORING_TEMPLATES.lit);
    expect(state(ossick).postDark[0]).toBeGreaterThan(T.postDarkSeconds - 0.2);
    const cue = f.cues.slice(cues).find((c) => c.ability === OSSICK_MOORED);
    expect(cue?.sourceId).toBe(nw.id);
    expect(cue?.targetId).toBe(victim.id);
    // Free: the winch no longer hauls them, and the pit never takes them.
    const d = winchDist(f, victim);
    run(f, 10);
    expect(winchDist(f, victim)).toBeCloseTo(d, 1);
    expect(aura(victim, OSSICK_KEELHAULED)).toBeUndefined();
  });

  it('the spent post stays dark 30 s, kindles in its last 5, then lights again', () => {
    const { f, ossick } = yard();
    run(f, 1);
    const { victim } = hook(f, ossick);
    const at = nearPost(2, 2);
    put(f, victim, at.x, at.z);
    run(f, DT * 2);
    const se = posts(f)[2];
    expect(se.templateId).toBe(MOORING_TEMPLATES.dark);
    // Keep the next anchor away: only the post's own clock runs.
    state(ossick).anchorTimer = 999;
    run(f, T.postDarkSeconds - T.postKindleSeconds - 0.5);
    expect(se.templateId).toBe(MOORING_TEMPLATES.dark);
    run(f, 1);
    expect(se.templateId).toBe(MOORING_TEMPLATES.kindling);
    expect(until(f, () => se.templateId === MOORING_TEMPLATES.lit, T.postKindleSeconds)).toBe(true);
    expect(state(ossick).postDark[2]).toBe(0);
  });

  it('a dark post holds nothing: the chain keeps hauling to the pit', () => {
    const { f, ossick } = yard();
    run(f, 1);
    const first = hook(f, ossick);
    const at = nearPost(0, 2);
    put(f, first.victim, at.x, at.z);
    run(f, DT * 2);
    expect(posts(f)[0].templateId).toBe(MOORING_TEMPLATES.dark);
    // Hook again (another player, or the same): bring them to the dark post.
    const st = state(ossick);
    st.anchorTimer = 999;
    const { victim } = hook(f, ossick);
    put(f, victim, at.x, at.z);
    run(f, 1);
    expect(aura(victim, OSSICK_ANCHORED)).toBeDefined();
    expect(f.cues.filter((c) => c.ability === OSSICK_MOORED)).toHaveLength(1);
    expect(until(f, () => aura(victim, OSSICK_KEELHAULED) !== undefined, 16)).toBe(true);
  });

  it('the chain is a tether: the victim walks along it but never out past it', () => {
    const { f, ossick } = yard();
    run(f, 1);
    const { victim } = hook(f, ossick);
    const d0 = winchDist(f, victim);
    // Stepping straight out: the chain holds them at its length.
    const out = {
      x: WINCH.x + ((victim.pos.x - f.ox - WINCH.x) / d0) * (d0 + 2),
      z: WINCH.z + ((victim.pos.z - f.oz - WINCH.z) / d0) * (d0 + 2),
    };
    put(f, victim, out.x, out.z);
    run(f, DT);
    expect(winchDist(f, victim)).toBeLessThanOrEqual(d0 + 1e-3);
    // Stepping inward takes up the slack: it never pays out again.
    const inX = WINCH.x + ((victim.pos.x - f.ox - WINCH.x) / d0) * (d0 - 3);
    const inZ = WINCH.z + ((victim.pos.z - f.oz - WINCH.z) / d0) * (d0 - 3);
    put(f, victim, inX, inZ);
    run(f, DT);
    const shorter = winchDist(f, victim);
    put(f, victim, out.x, out.z);
    run(f, DT);
    expect(winchDist(f, victim)).toBeLessThanOrEqual(shorter + 1e-3);
    expect(aura(victim, OSSICK_ANCHORED)).toBeDefined();
  });

  it('a hold against pulls stops the reel, never the tether', () => {
    const { f, ossick } = yard();
    run(f, 1);
    const { victim } = hook(f, ossick);
    run(f, T.anchorSettle + 0.5);
    // Held (the dev anchor stands in for the Mooring Stone or an Ice Block):
    // the winch cannot reel them in ...
    const meta = f.sim.players.get(victim.id);
    if (!meta) throw new Error('no meta');
    meta.devAnchored = true;
    const d0 = winchDist(f, victim);
    run(f, 2);
    expect(winchDist(f, victim)).toBeCloseTo(d0, 1);
    // ... but stepping out past the chain still draws them straight back.
    const ux = (victim.pos.x - f.ox - WINCH.x) / d0;
    const uz = (victim.pos.z - f.oz - WINCH.z) / d0;
    put(f, victim, WINCH.x + ux * (d0 + 2), WINCH.z + uz * (d0 + 2));
    run(f, DT);
    expect(winchDist(f, victim)).toBeLessThanOrEqual(d0 + 0.05);
    expect(aura(victim, OSSICK_ANCHORED)).toBeDefined();
  });

  it('camping a post does nothing: hooked beside it, the winch still hauls', () => {
    const { f, ossick } = yard();
    run(f, 1);
    const st = state(ossick);
    st.shackleTimer = 999;
    st.cudgelTimer = 999;
    // Every non-tank parked beside a post through the mark.
    const camp = () => {
      for (const [i, p] of f.others.entries()) {
        const at = nearPost(i, 1.5);
        put(f, p, at.x, at.z);
      }
    };
    ossick.castingAbility = null;
    expect(startDrownedAnchor(f.sim.ctx, f.inst, ossick, st)).toBe(true);
    run(f, T.anchorCast + DT * 2, camp);
    const victim = f.others.find((p) => aura(p, OSSICK_ANCHORED));
    if (!victim) throw new Error('nobody anchored');
    run(f, 1);
    expect(aura(victim, OSSICK_ANCHORED)).toBeDefined();
    expect(f.cues.some((c) => c.ability === OSSICK_MOORED)).toBe(false);
    for (const p of posts(f)) expect(p.templateId).toBe(MOORING_TEMPLATES.lit);
  });

  it('a victim gone from the claim is let go, never dragged back across the world', () => {
    const { f, ossick } = yard();
    run(f, 1);
    const { victim, anchor } = hook(f, ossick);
    const far = { x: victim.pos.x + 900, z: victim.pos.z };
    victim.pos = f.sim.ctx.groundPos(far.x, far.z);
    victim.prevPos = { ...victim.pos };
    f.sim.ctx.grid.update(victim);
    run(f, DT * 2);
    expect(aura(victim, OSSICK_ANCHORED)).toBeUndefined();
    expect(f.sim.ctx.entities.has(anchor.id)).toBe(false);
    expect(Math.abs(victim.pos.x - far.x)).toBeLessThan(0.01);
  });

  it('a stationary victim is hauled exactly at the drag speed each tick', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { f, ossick } = yard(difficulty);
      run(f, 1);
      const { victim } = hook(f, ossick);
      run(f, T.anchorSettle + 0.2);
      for (let k = 0; k < 10; k++) {
        const d0 = winchDist(f, victim);
        run(f, DT);
        const step = d0 - winchDist(f, victim);
        expect(step).toBeCloseTo(anchorDragSpeed(d0, difficulty === 'heroic') * DT, 4);
      }
    }
  });

  it('no slack piles up behind a held victim: released, the haul resumes at its pace', () => {
    const { f, ossick } = yard();
    run(f, 1);
    const { victim } = hook(f, ossick);
    run(f, T.anchorSettle + 0.2);
    const meta = f.sim.players.get(victim.id);
    if (!meta) throw new Error('no meta');
    meta.devAnchored = true;
    run(f, 3);
    meta.devAnchored = false;
    const d0 = winchDist(f, victim);
    run(f, DT);
    expect(d0 - winchDist(f, victim)).toBeLessThanOrEqual(anchorDragSpeed(d0, false) * DT + 1e-3);
  });

  it('a wipe relights every post', () => {
    const { f, ossick } = yard();
    run(f, 1);
    const { victim } = hook(f, ossick);
    const at = nearPost(1, 2);
    put(f, victim, at.x, at.z);
    run(f, DT * 2);
    expect(posts(f)[1].templateId).toBe(MOORING_TEMPLATES.dark);
    ossick.aiState = 'evade';
    run(f, DT * 2);
    for (const p of posts(f)) expect(p.templateId).toBe(MOORING_TEMPLATES.lit);
  });

  it('heroic keeps all four posts and the same rule', () => {
    const { f, ossick } = yard('heroic');
    run(f, 1);
    for (const p of posts(f)) expect(p.templateId).toBe(MOORING_TEMPLATES.lit);
    const { victim } = hook(f, ossick);
    const at = nearPost(3, 2.5);
    put(f, victim, at.x, at.z);
    run(f, DT * 2);
    expect(aura(victim, OSSICK_ANCHORED)).toBeUndefined();
    expect(posts(f)[3].templateId).toBe(MOORING_TEMPLATES.dark);
  });

  it('is deterministic: the same fight moors and relights identically', () => {
    const trace = (): string[] => {
      const { f, ossick } = yard();
      const out: string[] = [];
      run(f, 1);
      const { victim } = hook(f, ossick);
      // The nearest post to wherever the hook found them.
      let best = 0;
      for (let i = 1; i < MOORING_POST_SPOTS.length; i++) {
        const di = Math.hypot(
          victim.pos.x - f.ox - MOORING_POST_SPOTS[i].x,
          victim.pos.z - f.oz - MOORING_POST_SPOTS[i].z,
        );
        const db = Math.hypot(
          victim.pos.x - f.ox - MOORING_POST_SPOTS[best].x,
          victim.pos.z - f.oz - MOORING_POST_SPOTS[best].z,
        );
        if (di < db) best = i;
      }
      const at = nearPost(best, 2);
      // Walk them to the post a step a tick, as a player would.
      for (let k = 0; k < 60; k++) {
        const dx = f.ox + at.x - victim.pos.x;
        const dz = f.oz + at.z - victim.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.3)
          put(
            f,
            victim,
            victim.pos.x - f.ox + (dx / d) * 0.3,
            victim.pos.z - f.oz + (dz / d) * 0.3,
          );
        run(f, DT);
        out.push(
          `${victim.pos.x.toFixed(4)},${victim.pos.z.toFixed(4)},${posts(f)
            .map((p) => p.templateId)
            .join('|')},${state(ossick)
            .postDark.map((x) => x.toFixed(2))
            .join('|')}`,
        );
      }
      run(f, T.postDarkSeconds);
      out.push(
        posts(f)
          .map((p) => p.templateId)
          .join('|'),
      );
      out.push(f.cues.map((c) => c.ability).join(','));
      return out;
    };
    const a = trace();
    const b = trace();
    expect(a).toEqual(b);
    expect(a.some((line) => line.includes(MOORING_TEMPLATES.dark))).toBe(true);
  });
});
