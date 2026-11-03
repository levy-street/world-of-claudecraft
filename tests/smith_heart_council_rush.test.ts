// The Hammer Council's Mountain's Rush, its cursed pillar, Bond of the Stone
// and the pillar supply (src/sim/encounters/smith_heart/council_rush.ts,
// council_bond.ts, council_stone.ts) over a REAL Sim claim: the Rush never on a
// tank; it stops at the FIRST pillar on its line (the cursed one: shattered,
// the Guardian stunned and exposed; a sheltering one: taken whole, the curse
// keeps pulsing); a miss tramples its path and, on mythic only, sets the
// Quarry collapsing until the cursed pillar breaks; the rock never touches the
// cursed pillar and its pulse is low on normal; Bond of the Stone's ward and
// growing pulse while the two stand together, gone apart; and the Wake cadence
// giving every Wrath enough shelter for ten (one kicked Wake: normal still
// survives, heroic is tight, mythic leaves someone out).

import { describe, expect, it } from 'vitest';
import { HAMMER_PIT } from '../src/sim/content/smith_heart_layout';
import {
  bondPulseMult,
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_CURSED,
  COUNCIL_DIFFICULTY,
  COUNCIL_NAMES,
  type CouncilFightState,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { raisePillar } from '../src/sim/encounters/smith_heart/council_pillars';
import type { Entity, SimEvent } from '../src/sim/types';
import { type CouncilFight, councilFight, hitsOf } from './helpers/council_fight';

const MID = { x: HAMMER_PIT.x, z: HAMMER_PIT.z };
type Tier = 'normal' | 'heroic' | 'mythic';
type Fight = CouncilFight & { st: CouncilFightState };

function quiet(st: CouncilFightState): void {
  st.weightTimer = 999;
  st.wakeTimer = 999;
  st.rockTimer = 999;
  st.boltTimer = 999;
  st.songTimer = 999;
  st.rushTimer = 999;
  st.pulseTimer = 999;
  st.songDue = null;
  st.energy = 0;
}

function pulled(n = 6, tier: Tier = 'normal', seed = 17): Fight {
  const f = councilFight(n, seed);
  if (tier !== 'normal') f.dev(`/dev heart council ${tier} on`);
  f.dev('/dev heart council pull');
  f.tick();
  const st = f.state();
  if (!st) throw new Error('the council did not pull');
  quiet(st);
  return { ...f, st };
}

function plant(f: CouncilFight, e: Entity, x: number, z: number): void {
  const w = f.world(x, z);
  e.pos.x = w.x;
  e.pos.z = w.z;
  e.pos.y = f.sim.ctx.groundPos(w.x, w.z).y;
  e.prevPos = { ...e.pos };
  f.sim.ctx.rebucket(e);
}

/** No column standing (the Rush tests set their own pillars). */
function clearColumns(f: CouncilFight): void {
  for (const p of f.pillars()) f.sim.ctx.dropEntity(p.e.id);
  f.inst.objectIds = f.inst.objectIds.filter((id) => f.sim.ctx.entities.has(id));
}

const cursed = (f: CouncilFight) => f.pillars().find((p) => p.cursed);
const warned = (ev: readonly SimEvent[], key: string) =>
  ev.some(
    (e) =>
      e.type === 'chat' && (e as { textKey?: string }).textKey === `hudChrome.council.warn.${key}`,
  );

/** Set the Rush going with the Guardian at the middle, the Singer parked far
 *  off (no Bond), every column gone. Returns the marked player and the cursed
 *  pillar's local spot. */
function rushSetup(f: Fight) {
  const b = f.bodies();
  const g = b.guardian as Entity;
  const c = b.singer as Entity;
  clearColumns(f);
  plant(f, g, MID.x, MID.z);
  plant(f, c, MID.x - 30, MID.z + 25);
  // The raid parked well away from the middle, on the far side of the Singer.
  f.players.forEach((p, i) => {
    f.put(p, MID.x + 2 + i * 0.3, MID.z + 3);
  });
  expect(f.dev('/dev heart council rush')).toBe(true);
  expect(g.castingAbility).toBe(COUNCIL_CASTS.rush);
  const target = f.sim.ctx.entities.get(g.castTargetId as number) as Entity;
  const cp = cursed(f);
  expect(cp).toBeDefined();
  if (!cp) throw new Error('no cursed pillar');
  return { g, target, cp, at: f.local(cp.e) };
}

/** The local spot `out` yards past `p` on the line from `from`. */
function past(from: { x: number; z: number }, p: { x: number; z: number }, out: number) {
  const d = Math.hypot(p.x - from.x, p.z - from.z);
  return { x: p.x + ((p.x - from.x) / d) * out, z: p.z + ((p.z - from.z) / d) * out };
}

function runRush(f: Fight): SimEvent[] {
  return f.tick(Math.ceil((T.rushCast + 2) * 20));
}

describe("Mountain's Rush: the mark", () => {
  it('never marks a tank, and with only tanks on the floor it waits', () => {
    const f = pulled(4);
    const b = f.bodies();
    const tanks = [b.guardian?.aggroTargetId, b.singer?.aggroTargetId];
    for (let k = 0; k < 6; k++) {
      quiet(f.st);
      f.st.lastFloorAt = null;
      f.dev('/dev heart council rush');
      const target = b.guardian?.castTargetId;
      expect(target).not.toBeNull();
      expect(tanks).not.toContain(target);
      f.tick(Math.ceil((T.rushCast + 2) * 20));
    }
    const solo = pulled(1);
    expect(solo.dev('/dev heart council rush')).toBe(true);
    expect(solo.bodies().guardian?.castingAbility).not.toBe(COUNCIL_CASTS.rush);
    expect(solo.st.rush).toBeNull();
  });

  it('raises one cursed pillar with the mark, never a second while it stands', () => {
    const f = pulled(4);
    const { cp } = rushSetup(f);
    expect(cp.e.templateId).toBe(COUNCIL_CURSED);
    f.players.forEach((p, i) => {
      f.put(p, MID.x + 2 + i * 0.3, MID.z + 3);
    });
    runRush(f);
    quiet(f.st);
    f.dev('/dev heart council rush');
    expect(f.pillars().filter((p) => p.cursed).length).toBe(1);
  });
});

describe("Mountain's Rush: the first pillar on its line", () => {
  it('the cursed pillar first: it shatters, the Guardian is stunned and exposed, the marked spared', () => {
    const f = pulled(4);
    const { g, target, at } = rushSetup(f);
    const spot = past(MID, at, T.cursedR + 4);
    f.put(target, spot.x, spot.z);
    const ev = runRush(f);
    expect(cursed(f)).toBeUndefined();
    expect(g.auras.find((a) => a.id === COUNCIL_AURAS.rushStunned)?.kind).toBe('stun');
    const exposed = g.auras.find((a) => a.id === COUNCIL_AURAS.rushExposed);
    expect(exposed?.kind).toBe('vulnerability');
    expect(exposed?.value).toBe(T.rushExposed);
    expect(f.sim.ctx.isStunned(g)).toBe(true);
    expect(hitsOf(ev, COUNCIL_NAMES.rush, target.id)).toEqual([]);
    expect(warned(ev, 'rushCursed')).toBe(true);
    // The Guardian stopped at the pillar's face, short of the marked player.
    const gl = f.local(g);
    expect(Math.hypot(gl.x - spot.x, gl.z - spot.z)).toBeGreaterThan(T.cursedR);
  });

  it('a sheltering pillar first: it is taken whole and the cursed one keeps pulsing', () => {
    const f = pulled(4);
    const { g, target, at } = rushSetup(f);
    const spot = past(MID, at, T.cursedR + 4);
    f.put(target, spot.x, spot.z);
    // A good pillar between the Guardian and the cursed one.
    const half = { x: (MID.x + at.x) / 2, z: (MID.z + at.z) / 2 };
    const good = raisePillar(f.sim.ctx, f.inst, g, [g], [], half.x, half.z, 1);
    expect(good).not.toBeNull();
    const goodId = good?.id;
    const ev = runRush(f);
    expect(f.sim.ctx.entities.has(goodId as number)).toBe(false);
    expect(cursed(f)).toBeDefined();
    expect(g.auras.some((a) => a.id === COUNCIL_AURAS.rushStunned)).toBe(false);
    expect(hitsOf(ev, COUNCIL_NAMES.rush, target.id)).toEqual([]);
    expect(warned(ev, 'rushPillar')).toBe(true);
    const later = f.tick(20 * 4);
    expect(hitsOf(later, COUNCIL_NAMES.cursed).length).toBeGreaterThan(0);
  });

  it('no pillar on the line: the marked and anyone in the path take the blow and a throw, the curse stays', () => {
    const f = pulled(4);
    const { g, target, at } = rushSetup(f);
    // The marked steps to the opposite side of the middle from the curse.
    const away = past(at, MID, 14);
    f.put(target, away.x, away.z);
    // A bystander in the lane, halfway.
    const bystander = f.players.find((p) => p !== target && p.id !== g.aggroTargetId) as Entity;
    const mid = { x: (MID.x + away.x) / 2, z: (MID.z + away.z) / 2 };
    f.put(bystander, mid.x, mid.z);
    const before = { ...target.pos };
    const ev = runRush(f);
    const hits = hitsOf(ev, COUNCIL_NAMES.rush, target.id);
    expect(hits.length).toBe(1);
    expect(hits[0]).toBeGreaterThanOrEqual(T.rushMin);
    expect(hits[0]).toBeLessThanOrEqual(Math.ceil(T.rushMax * 1.2));
    expect(hitsOf(ev, COUNCIL_NAMES.rush, bystander.id).length).toBe(1);
    expect(Math.hypot(target.pos.x - before.x, target.pos.z - before.z)).toBeGreaterThan(2);
    expect(cursed(f)).toBeDefined();
    expect(warned(ev, 'rushMiss')).toBe(true);
    // Normal: no collapse.
    expect(f.st.collapse).toBeNull();
  });
});

describe('the cursed pillar', () => {
  it('pulses low on normal, the real pressure on heroic and mythic', () => {
    const n = COUNCIL_DIFFICULTY.normal;
    const h = COUNCIL_DIFFICULTY.heroic;
    const m = COUNCIL_DIFFICULTY.mythic;
    expect(n.cursedPulseMax).toBeLessThan(h.cursedPulseMin / 2);
    expect(m.cursedPulseMin).toBeGreaterThanOrEqual(h.cursedPulseMin);
    const amounts = (tier: Tier) => {
      const f = pulled(4, tier);
      rushSetup(f);
      f.st.rushTimer = 999;
      const ev = f.tick(20 * 6);
      return hitsOf(ev, COUNCIL_NAMES.cursed);
    };
    const normal = amounts('normal');
    const heroic = amounts('heroic');
    expect(normal.length).toBeGreaterThan(0);
    expect(heroic.length).toBeGreaterThan(0);
    expect(Math.max(...normal)).toBeLessThanOrEqual(n.cursedPulseMax);
    expect(Math.min(...heroic)).toBeGreaterThanOrEqual(Math.floor(h.cursedPulseMin * h.damageMult));
  });

  it('the Falling Rock never damages or breaks it, on any tier', () => {
    for (const tier of ['normal', 'mythic'] as const) {
      const f = pulled(5, tier);
      const { at } = rushSetup(f);
      f.st.rushTimer = 999;
      // Let the Rush land harmlessly first (the marked well off any line).
      f.tick(Math.ceil((T.rushCast + 2) * 20));
      const cp = cursed(f);
      expect(cp).toBeDefined();
      quiet(f.st);
      f.dev('/dev heart council rock');
      f.tick(Math.ceil((T.rockCast + 0.2) * 20));
      const rock = f.st.rock;
      expect(rock).not.toBeNull();
      if (!rock) return;
      // Every player on the cursed pillar's face.
      for (const p of f.players) f.put(p, at.x + T.cursedR + 1, at.z);
      f.tick(Math.ceil(T.rockMarkSeconds * 20) + 2);
      expect(cursed(f)?.e.id, tier).toBe(cp?.e.id);
      expect(cursed(f)?.integrity).toBe(1);
    }
  });

  it("shelters nobody from Mountain's Wrath, and the Wrath shatters it with the rest", () => {
    const f = pulled(4);
    const { g, target, at } = rushSetup(f);
    f.tick(Math.ceil((T.rushCast + 2) * 20));
    quiet(f.st);
    plant(f, g, MID.x, MID.z);
    const hide = past(MID, at, T.cursedR + 1.5);
    f.put(target, hide.x, hide.z);
    f.dev('/dev heart council wrath');
    const ev = f.tick(Math.ceil(T.wrathCast * 20) + 2);
    expect(hitsOf(ev, COUNCIL_NAMES.wrath, target.id).length).toBe(1);
    expect(cursed(f)).toBeUndefined();
  });
});

describe('Mythic: the Quarry collapses after a miss', () => {
  const miss = (f: Fight) => {
    const { target, at } = rushSetup(f);
    const away = past(at, MID, 14);
    f.put(target, away.x, away.z);
    return runRush(f);
  };

  it('a miss sets it collapsing: a stacking raid-wide blow until the cursed pillar breaks', () => {
    const f = pulled(4, 'mythic');
    let ev = miss(f);
    expect(f.st.collapse).not.toBeNull();
    expect(warned(ev, 'collapse')).toBe(true);
    ev = f.tick(20 * 7);
    const p = f.players[1];
    const blows = hitsOf(ev, COUNCIL_NAMES.collapse, p.id);
    expect(blows.length).toBeGreaterThanOrEqual(3);
    expect(blows[blows.length - 1]).toBeGreaterThan(blows[0]);
    expect(p.auras.find((a) => a.id === COUNCIL_AURAS.collapse)?.stacks).toBeGreaterThanOrEqual(3);
    // The next Rush led into the cursed pillar ends it.
    quiet(f.st);
    f.st.lastFloorAt = null;
    const g = f.bodies().guardian as Entity;
    plant(f, g, MID.x, MID.z);
    f.dev('/dev heart council rush');
    const target = f.sim.ctx.entities.get(g.castTargetId as number) as Entity;
    const cp = cursed(f);
    if (!cp) throw new Error('curse');
    const spot = past(MID, f.local(cp.e), T.cursedR + 4);
    f.put(target, spot.x, spot.z);
    runRush(f);
    expect(cursed(f)).toBeUndefined();
    expect(f.st.collapse).toBeNull();
    expect(p.auras.some((a) => a.id === COUNCIL_AURAS.collapse)).toBe(false);
    const after = f.tick(20 * 4);
    expect(hitsOf(after, COUNCIL_NAMES.collapse).length).toBe(0);
  });

  it('never on normal or heroic', () => {
    for (const tier of ['normal', 'heroic'] as const) {
      const f = pulled(4, tier);
      miss(f);
      expect(f.st.collapse, tier).toBeNull();
      const ev = f.tick(20 * 5);
      expect(hitsOf(ev, COUNCIL_NAMES.collapse).length).toBe(0);
    }
  });
});

describe('Bond of the Stone', () => {
  it('together: both take far less damage and the raid pulse grows each time', () => {
    const f = pulled(4);
    const b = f.bodies();
    const g = b.guardian as Entity;
    const c = b.singer as Entity;
    plant(f, g, MID.x, MID.z);
    plant(f, c, MID.x + 8, MID.z);
    const ev = f.tick(20 * 13);
    for (const body of [g, c]) {
      const bond = body.auras.find((a) => a.id === COUNCIL_AURAS.bond);
      expect(bond?.kind).toBe('shield_wall');
      expect(bond?.value).toBe(T.bondWard);
    }
    const p = f.players[1];
    const pulses = hitsOf(ev, COUNCIL_NAMES.bond, p.id);
    expect(pulses.length).toBeGreaterThanOrEqual(4);
    expect(pulses[3]).toBeGreaterThan(pulses[0]);
    expect(bondPulseMult(3)).toBeCloseTo(1 + 3 * T.bondPulseGrowth);
    expect(bondPulseMult(999)).toBe(T.bondPulseCap);
    // The ward: a blow lands at a fifth.
    const hp = g.hp;
    f.sim.ctx.dealDamage(f.players[0], g, 1000, false, 'physical', 'Test', 'hit', true);
    expect(hp - g.hp).toBeLessThanOrEqual(Math.round(1000 * (1 - T.bondWard)) + 1);
  });

  it('apart: the ward lifts, the pulse stops and its count starts again', () => {
    const f = pulled(4);
    const b = f.bodies();
    const g = b.guardian as Entity;
    const c = b.singer as Entity;
    plant(f, g, MID.x, MID.z);
    plant(f, c, MID.x + 8, MID.z);
    f.tick(20 * 7);
    expect(f.st.bond.pulses).toBeGreaterThan(0);
    plant(f, c, MID.x + T.bondReach + 10, MID.z);
    // Hold her there (her own AI would walk her back to her tank).
    let ev: SimEvent[] = [];
    for (let i = 0; i < 20 * 7; i++) {
      plant(f, c, MID.x + T.bondReach + 10, MID.z);
      ev = ev.concat(f.tick());
    }
    for (const body of [g, c])
      expect(body.auras.some((a) => a.id === COUNCIL_AURAS.bond)).toBe(false);
    expect(f.st.bond.pulses).toBe(0);
    expect(hitsOf(ev, COUNCIL_NAMES.bond).length).toBe(0);
    const hp = g.hp;
    f.sim.ctx.dealDamage(f.players[0], g, 1000, false, 'physical', 'Test', 'hit', true);
    expect(hp - g.hp).toBeGreaterThan(500);
  });
});

describe('the lifecycle: nothing of the Rush, the curse or the Bond outlives its fight', () => {
  /** A mythic pull with a cursed pillar standing, the Quarry collapsing and
   *  the Guardian reeling from an earlier shattered curse. */
  function messy(): Fight {
    const f = pulled(4, 'mythic');
    const { target, at } = rushSetup(f);
    const away = past(at, MID, 14);
    f.put(target, away.x, away.z);
    runRush(f);
    expect(f.st.collapse).not.toBeNull();
    const g = f.bodies().guardian as Entity;
    f.sim.ctx.applyAura(g, {
      id: COUNCIL_AURAS.rushExposed,
      name: COUNCIL_NAMES.rushStunned,
      kind: 'vulnerability',
      remaining: T.rushExposedSeconds,
      duration: T.rushExposedSeconds,
      value: T.rushExposed,
      sourceId: g.id,
      school: 'physical',
    });
    f.tick(20 * 3);
    return f;
  }
  const clean = (f: Fight) => {
    expect(cursed(f)).toBeUndefined();
    for (const p of f.players)
      for (const id of [COUNCIL_AURAS.rushMark, COUNCIL_AURAS.collapse])
        expect(
          p.auras.some((a) => a.id === id),
          id,
        ).toBe(false);
    for (const b of [f.bodies().guardian, f.bodies().singer])
      for (const id of [COUNCIL_AURAS.bond, COUNCIL_AURAS.rushStunned, COUNCIL_AURAS.rushExposed])
        expect(
          b?.auras.some((a) => a.id === id),
          id,
        ).toBe(false);
  };

  it('a wipe clears the dash, the curse, the collapse, the reel and the bond', () => {
    const f = messy();
    for (const p of f.players) f.sim.ctx.handleDeath(p, null);
    for (let i = 0; i < 20 * 60 && f.state(); i++) f.sim.tick();
    expect(f.state()).toBeNull();
    clean(f);
  });

  it('the dev reset clears them too', () => {
    const f = messy();
    f.dev('/dev heart council reset');
    expect(f.state()).toBeNull();
    clean(f);
  });

  it('the Guardian falling breaks his curse and ends the collapse; the kill clears the rest', () => {
    const f = messy();
    f.sim.ctx.handleDeath(f.bodies().guardian as Entity, f.players[0]);
    f.tick();
    expect(cursed(f)).toBeUndefined();
    expect(f.st.collapse).toBeNull();
    expect(f.st.rush).toBeNull();
    f.sim.ctx.handleDeath(f.bodies().singer as Entity, f.players[0]);
    f.tick();
    expect(f.state()?.finished).toBe(true);
    clean(f);
  });

  it('a bond worn before its first pulse lifts off the survivor when the other falls', () => {
    const f = pulled(4);
    const b = f.bodies();
    const g = b.guardian as Entity;
    const c = b.singer as Entity;
    plant(f, g, MID.x, MID.z);
    plant(f, c, MID.x + 6, MID.z);
    f.tick(10);
    expect(c.auras.some((a) => a.id === COUNCIL_AURAS.bond)).toBe(true);
    expect(f.st.bond.pulses).toBe(0);
    f.sim.ctx.handleDeath(g, f.players[0]);
    f.tick(2);
    expect(c.auras.some((a) => a.id === COUNCIL_AURAS.bond)).toBe(false);
  });

  it('a marked player who leaves the Quarry draws no dash', () => {
    const f = pulled(4);
    const { g, target } = rushSetup(f);
    const start = f.local(g);
    f.put(target, MID.x + 200, MID.z);
    runRush(f);
    const now = f.local(g);
    expect(Math.hypot(now.x - start.x, now.z - start.z)).toBeLessThan(3);
  });
});

// ---- the pillar supply over a whole pull ------------------------------------------------------

/** Twelve open spots on a ring round the middle, each well clear of the next. */
const SLOTS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  return { x: MID.x + Math.sin(a) * 17, z: MID.z + Math.cos(a) * 17 };
});

/**
 * A pull of ten with no mistakes but what `kickAfter` asks (the Wake that
 * starts after that many Wraths is kicked): the marked walk to an open spot,
 * every other clock but the Wrath and the Wake parked. Returns, for each Wrath
 * bar from the second, how many players the standing shelter can hold.
 */
function supply(tier: Tier, kickAfter: number | null): number[] {
  const f = pulled(10, tier, 23);
  f.st.wakeTimer = T.wakeFirst;
  let slot = 0;
  const moved = new Set<number>();
  const out: number[] = [];
  let lastBar = '';
  let kicked = false;
  for (let i = 0; i < 20 * 190; i++) {
    const st = f.st;
    st.rockTimer = 999;
    st.songTimer = 999;
    st.songDue = null;
    st.boltTimer = 999;
    st.rushTimer = 999;
    st.weightTimer = 999;
    f.tick();
    const b = f.bodies();
    const c = b.singer as Entity;
    const g = b.guardian as Entity;
    if (
      kickAfter !== null &&
      !kicked &&
      st.wraths === kickAfter &&
      c.castingAbility === COUNCIL_CASTS.wake
    ) {
      f.sim.ctx.cancelCast(c);
      kicked = true;
    }
    for (const m of st.wakeMarks) {
      if (moved.has(m.playerId)) continue;
      const p = f.sim.ctx.entities.get(m.playerId) as Entity;
      const s = SLOTS[slot++ % SLOTS.length];
      f.put(p, s.x, s.z);
      moved.add(m.playerId);
    }
    if (st.wakeMarks.length === 0) moved.clear();
    const bar = g.castingAbility ?? '';
    if (bar === COUNCIL_CASTS.wrath && lastBar !== bar && st.wraths >= 1) {
      const shelters = f.pillars().filter((p) => !p.cursed && p.soul === null).length;
      out.push(shelters * (COUNCIL_DIFFICULTY[tier].pillarLimit ?? 99));
    }
    lastBar = bar;
    if (out.length >= 2) break;
  }
  return out;
}

describe('the pillar supply: every Wrath has room for ten', () => {
  for (const tier of ['normal', 'heroic', 'mythic'] as const) {
    it(`${tier}: no mistakes, every Wrath after the first shelters the whole raid`, () => {
      const slots = supply(tier, null);
      expect(slots.length).toBe(2);
      for (const n of slots) expect(n).toBeGreaterThanOrEqual(10);
    });
  }

  it('one Wake kicked: normal still shelters ten, heroic is tight, mythic leaves someone out', () => {
    const [normal] = supply('normal', 1);
    const [heroic] = supply('heroic', 1);
    const [mythic] = supply('mythic', 1);
    expect(normal).toBe(10);
    expect(heroic).toBeGreaterThanOrEqual(10);
    expect(heroic).toBeLessThanOrEqual(12);
    expect(mythic).toBeLessThan(10);
  });
});
