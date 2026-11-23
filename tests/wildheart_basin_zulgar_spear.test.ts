// Zulgar's Hunting Spear (src/sim/encounters/wildheart_basin/zulgar_spear.ts,
// the 2026-10-13 rework): its clock (ahead of every second Wildheart Pulse,
// so the Pulse lands 5 s after the pin; never in a hunt), the pin (a root nothing a player has takes off, a
// small bleed), the pull (a teammate's 1.5 s use on the spear's body; alone,
// the victim's own 3 s), the Pulse that strikes a Pinned player anywhere and
// harder, the 10 s it lets go after, and what clears it. On a real claimed
// Basin with a real party (tests/helpers/wildheart_fight.ts).

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import {
  HUNTING_SPEAR_ID,
  HUNTING_SPEAR_PULL_CAST,
  isPinned,
  pinnedBy,
  ZULGAR_TUNING as T,
  ZULGAR_HUNTING_SPEAR,
  ZULGAR_ID,
  ZULGAR_PINNED,
  ZULGAR_PREY,
  ZULGAR_PULSE,
  ZULGAR_SPEAR_FREED,
  ZULGAR_SPEAR_HELP_ERROR,
} from '../src/sim/encounters/wildheart_basin';
import {
  DT,
  type Entity,
  KIT_USE_CAST_PREFIX,
  type SimEvent,
  type ZulgarFightState,
} from '../src/sim/types';
import {
  aura,
  boss,
  engage,
  type Fight,
  fight,
  hitsOn,
  put,
  run,
  tick,
  wipe,
} from './helpers/wildheart_fight';

/** Everyone but the tank stands well outside the Pulse's 14 yd. */
const FAR: readonly [number, number][] = [
  [-20, 204],
  [20, 204],
  [0, 236],
];

function pull(f: Fight): Entity {
  const z = boss(f, ZULGAR_ID);
  put(f, z, 0, 218);
  put(f, f.tank, 0, 214);
  f.others.forEach((p, i) => {
    put(f, p, FAR[i][0], FAR[i][1]);
  });
  engage(f, z);
  tick(f);
  return z;
}

function dev(f: Fight, what: string): void {
  f.sim.chat(`/dev wildheart trigger ${what}`, f.tank.id);
}

function st(z: Entity): ZulgarFightState {
  if (z.wildheartFight?.kind !== 'zulgar') throw new Error('no zulgar fight');
  return z.wildheartFight;
}

function everyone(f: Fight): Entity[] {
  return [f.tank, ...f.others];
}

function pinned(f: Fight): Entity {
  const p = everyone(f).find(isPinned);
  if (!p) throw new Error('nobody is Pinned');
  return p;
}

function spearOf(f: Fight, victim: Entity): Entity {
  const body = f.sim.ctx.entities.get(pinnedBy(victim) ?? -1);
  if (!body) throw new Error('no spear body');
  return body;
}

/** The player presses interact on the spear's body. */
function press(f: Fight, p: Entity, body: Entity | null): SimEvent[] {
  f.sim.drainEvents();
  if (body) p.targetId = body.id;
  f.sim.interact(p.id);
  return f.sim.drainEvents();
}

describe('the Hunting Spear: the content seams', () => {
  it('the spear body is the engine use the ids name', () => {
    expect(HUNTING_SPEAR_PULL_CAST.startsWith(KIT_USE_CAST_PREFIX)).toBe(true);
    const use = MOBS[HUNTING_SPEAR_ID]?.trashKit?.usable;
    expect(use?.castId).toBe(HUNTING_SPEAR_PULL_CAST);
    expect(use?.channel).toBe(T.spearPullSeconds);
    expect(use?.range).toBe(T.spearPullRange);
    expect(use?.holdsThroughHits).toBe(true);
    expect(use?.effect.kind).toBe('free');
    // The victim's own pull is longer than a teammate's, and shorter than the
    // time the Pulse leaves them.
    expect(T.spearWrenchSeconds).toBeGreaterThan(T.spearPullSeconds);
    expect(T.spearWrenchSeconds).toBeLessThan(T.spearLeadsPulse + T.pulseCast);
    expect(T.spearPullSeconds).toBeLessThan(T.spearLeadsPulse);
  });
});

describe('the Hunting Spear: its clock', () => {
  it('opens ahead of every second Pulse, at a non-tank, and never in a hunt', () => {
    const f = fight();
    const z = pull(f);
    const spears: number[] = [];
    const pulses: number[] = [];
    let last: string | null = null;
    let t = DT;
    for (; t < 62; t += DT) {
      tick(f);
      if (z.castingAbility !== last) {
        if (z.castingAbility === ZULGAR_HUNTING_SPEAR) {
          spears.push(t);
          expect(z.castTargetId).not.toBe(f.tank.id);
          expect(z.castTotal).toBe(T.spearCast);
        }
        if (z.castingAbility === ZULGAR_PULSE) pulses.push(t);
        last = z.castingAbility;
      }
    }
    expect(spears).toHaveLength(2);
    // Two Pulse periods and the spear's own bar apart (his clocks wait out
    // his own bars): 28.5 s.
    expect(spears[1] - spears[0]).toBeCloseTo((T.pulseEvery + T.pulseCast) * 2 + T.spearCast, 1);
    for (const s of spears) {
      // The spear lands, and the Pulse's bar opens `spearLeadsPulse` later.
      const next = pulses.find((p) => p > s);
      expect(next).toBeDefined();
      expect((next as number) - s).toBeCloseTo(T.spearCast + T.spearLeadsPulse, 1);
    }
    // Never thrown before its first clock.
    expect(spears[0]).toBeGreaterThan(T.spearFirst);
    // A hunt holds the spear's clock: none opens while he is the avatar.
    dev(f, 'prey');
    const held = () => {
      put(f, z, 0, 218);
      for (const p of everyone(f)) if (aura(p, ZULGAR_PREY)) put(f, p, 0, 236);
    };
    for (let u = 0; u < T.huntSeconds - 1; u += DT) {
      tick(f, held);
      expect(z.castingAbility).not.toBe(ZULGAR_HUNTING_SPEAR);
    }
  }, 120_000);
});

describe('Pinned', () => {
  it('the bar ends: its target is rooted, the spear stands beside them and bleeds them', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'spear');
    expect(z.castingAbility).toBe(ZULGAR_HUNTING_SPEAR);
    const target = f.sim.ctx.entities.get(z.castTargetId ?? -1) as Entity;
    expect(target.id).not.toBe(f.tank.id);
    run(f, T.spearCast + 0.1);
    const victim = pinned(f);
    expect(victim.id).toBe(target.id);
    const mark = aura(victim, ZULGAR_PINNED);
    expect(mark?.kind).toBe('root');
    expect(mark?.unbreakableControl).toBe(true);
    expect(mark?.undispellable).toBe(true);
    expect(f.sim.ctx.isRooted(victim)).toBe(true);
    const body = spearOf(f, victim);
    expect(body.templateId).toBe(HUNTING_SPEAR_ID);
    expect(f.inst.mobIds).toContain(body.id);
    expect(body.hostile).toBe(false);
    expect(body.damageImmune).toBe(true);
    expect(Math.hypot(body.pos.x - victim.pos.x, body.pos.z - victim.pos.z)).toBeCloseTo(
      T.spearStandoff,
      1,
    );
    // The bleed: 15 every second.
    const from = f.hits.length;
    run(f, 3.05);
    const bleeds = hitsOn(f, victim, 'Hunting Spear', from);
    expect(bleeds).toHaveLength(3);
    for (const b of bleeds) expect(b.amount).toBe(T.pinBleed);
    // A shove never drags them off it.
    const at = { x: victim.pos.x, z: victim.pos.z };
    put(f, victim, 0, 236);
    tick(f);
    expect(Math.hypot(victim.pos.x - at.x, victim.pos.z - at.z)).toBeLessThan(0.01);
  });

  it('a teammate pulls it out in 1.5 s with the interact press, under hits', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'pin');
    const victim = pinned(f);
    const body = spearOf(f, victim);
    tick(f);
    expect(aura(victim, ZULGAR_PINNED)?.value2).toBe(0);
    // The tank walks over with Zulgar on him and pulls.
    put(f, f.tank, body.pos.x - f.ox + 1.5, body.pos.z - f.oz);
    press(f, f.tank, body);
    expect(f.tank.castingAbility).toBe(HUNTING_SPEAR_PULL_CAST);
    expect(f.tank.castTotal).toBe(T.spearPullSeconds);
    const from = f.hits.length;
    run(f, T.spearPullSeconds - 0.15, () => put(f, z, body.pos.x - f.ox + 4, body.pos.z - f.oz));
    expect(isPinned(victim)).toBe(true);
    const fx = f.fx.length;
    run(f, 0.3);
    expect(isPinned(victim)).toBe(false);
    expect(f.sim.ctx.entities.has(body.id)).toBe(false);
    expect(f.inst.mobIds).not.toContain(body.id);
    expect(f.fx.slice(fx)).toContain(ZULGAR_SPEAR_FREED);
    expect(st(z).spears).toHaveLength(0);
    // Zulgar swung at the tank meanwhile and the pull held.
    expect(f.hits.slice(from).some((h) => h.targetId === f.tank.id)).toBe(true);
  });

  it("the victim's own press is refused while a teammate stands free", () => {
    const f = fight();
    pull(f);
    dev(f, 'pin');
    const victim = pinned(f);
    tick(f);
    const events = press(f, victim, spearOf(f, victim));
    expect(victim.castingAbility).toBeNull();
    expect(
      events.some(
        (e) => e.type === 'error' && e.text === ZULGAR_SPEAR_HELP_ERROR && e.pid === victim.id,
      ),
    ).toBe(true);
  });

  it('alone, the victim wrenches it out themself in 3 s, through the bleed', () => {
    const f = fight('normal', 0);
    const z = pull(f);
    dev(f, 'pin');
    const victim = pinned(f);
    expect(victim.id).toBe(f.tank.id);
    tick(f);
    expect(aura(victim, ZULGAR_PINNED)?.value2).toBe(1);
    // No target needed: a Pinned player's press is always their own spear.
    press(f, victim, null);
    expect(victim.castingAbility).toBe(HUNTING_SPEAR_PULL_CAST);
    expect(victim.castTotal).toBe(T.spearWrenchSeconds);
    const from = f.hits.length;
    run(f, T.spearWrenchSeconds - 0.15);
    expect(isPinned(victim)).toBe(true);
    expect(hitsOn(f, victim, 'Hunting Spear', from).length).toBeGreaterThanOrEqual(2);
    run(f, 0.3);
    expect(isPinned(victim)).toBe(false);
    expect(st(z).spears).toHaveLength(0);
  });

  it('it lets go on its own after 10 s', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'pin');
    const victim = pinned(f);
    const body = spearOf(f, victim);
    run(f, T.pinSeconds - 0.2);
    expect(isPinned(victim)).toBe(true);
    run(f, 0.4);
    expect(isPinned(victim)).toBe(false);
    expect(f.sim.ctx.entities.has(body.id)).toBe(false);
    expect(st(z).spears).toHaveLength(0);
  });

  it('a Wildheart Pulse strikes a Pinned player wherever they stand, for half as much again', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'pin');
    const victim = pinned(f);
    expect(Math.hypot(victim.pos.x - z.pos.x, victim.pos.z - z.pos.z)).toBeGreaterThan(
      T.pulseRadius,
    );
    dev(f, 'pulse');
    const from = f.hits.length;
    run(f, T.pulseCast + 0.1);
    const onVictim = hitsOn(f, victim, 'Wildheart Pulse', from);
    expect(onVictim).toHaveLength(1);
    expect(onVictim[0].amount).toBeGreaterThanOrEqual(Math.round(T.pulseMin * T.pinPulseMult));
    expect(onVictim[0].amount).toBeLessThanOrEqual(Math.round(T.pulseMax * T.pinPulseMult));
    expect(onVictim[0].amount).toBeGreaterThan(T.pulseMax);
    // The tank, in reach and not Pinned, takes the plain roll; the others,
    // out of reach and free, take nothing.
    const onTank = hitsOn(f, f.tank, 'Wildheart Pulse', from);
    expect(onTank).toHaveLength(1);
    expect(onTank[0].amount).toBeLessThanOrEqual(T.pulseMax);
    for (const p of f.others)
      if (p !== victim) expect(hitsOn(f, p, 'Wildheart Pulse', from)).toHaveLength(0);
  });
});

describe('what clears a spear', () => {
  it('releases a departed player while the rest of the party keeps fighting', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'pin');
    const victim = pinned(f);
    const body = spearOf(f, victim);
    expect(f.sim.leaveDungeon(victim.id)).toBe(true);
    const outside = { ...victim.pos };

    tick(f);

    expect(z.wildheartFight?.kind).toBe('zulgar');
    expect(victim.pos.x).toBe(outside.x);
    expect(victim.pos.z).toBe(outside.z);
    expect(isPinned(victim)).toBe(false);
    expect(f.sim.ctx.entities.has(body.id)).toBe(false);
    expect(st(z).spears).toHaveLength(0);
  });

  it('a hunt beginning pulls every spear out: no Prey is ever rooted', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'pin');
    const victim = pinned(f);
    const body = spearOf(f, victim);
    dev(f, 'prey');
    expect(isPinned(victim)).toBe(false);
    expect(f.sim.ctx.entities.has(body.id)).toBe(false);
    expect(st(z).spears).toHaveLength(0);
  });

  it('a wipe takes the spear and the pin with it', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'pin');
    const victim = pinned(f);
    const body = spearOf(f, victim);
    wipe(f, z);
    tick(f);
    expect(z.wildheartFight).toBeUndefined();
    expect(isPinned(victim)).toBe(false);
    expect(f.sim.ctx.entities.has(body.id)).toBe(false);
  });

  it('its victim falling takes the spear away', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'pin');
    const victim = pinned(f);
    const body = spearOf(f, victim);
    f.sim.ctx.handleDeath(victim, z);
    f.sim.tick();
    expect(f.sim.ctx.entities.has(body.id)).toBe(false);
    expect(st(z).spears).toHaveLength(0);
  });
});

describe('heroic', () => {
  it('the bleed and the Pinned Pulse take the heroic mechanic factor', () => {
    const f = fight('heroic');
    const z = pull(f);
    const mult = z.mechanicDamageMult ?? 1;
    expect(mult).toBeGreaterThan(1);
    dev(f, 'pin');
    const victim = pinned(f);
    const from = f.hits.length;
    run(f, 1.05);
    const [bleed] = hitsOn(f, victim, 'Hunting Spear', from);
    expect(bleed.amount).toBe(Math.round(T.pinBleed * mult));
  });
});
