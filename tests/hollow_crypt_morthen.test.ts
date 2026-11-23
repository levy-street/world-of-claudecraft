// Morthen the Gravecaller on the Rite Ring (src/sim/encounters/hollow_crypt/
// morthen.ts and its siblings): the telegraphed Shadow Pulse, Gravecall's Bound
// Souls (the G5 walker: they gorge him, a body in the way takes them), the Rite
// of the Unquiet at 65 percent (immune at the altar, Grave Chill, the Restless
// Bones, the four Remembrance Candles and their DRAINING relight channel: the
// G3 use kept through hits, healable, completing, uncheesable), the ward
// shattering (stun and vulnerability), his Last Rites at 35 percent (Reap the
// Unquiet), the heroic Name the Dead and Grasp of the Grave, the wipe reset,
// the Every Candle Lit deed and determinism. Full Sim ticks in a real claimed
// Hollow Crypt.

import { describe, expect, it, vi } from 'vitest';
import { NORMAL_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { HOLLOW_CRYPT_FIELD } from '../src/sim/content/hollow_crypt_layout';
import { MOBS } from '../src/sim/data';
import {
  BOUND_SOUL_WALKER,
  candleBodySpot,
  cryptDevTrigger,
  gorgedStacks,
  MARROW_BONES_ID,
  MORTHEN_CANDLE_ID,
  MORTHEN_DEED,
  MORTHEN_GORGED,
  MORTHEN_GRASP_HANDS_TEMPLATE,
  MORTHEN_GRASP_MARK,
  MORTHEN_GRASP_ROOT,
  MORTHEN_GRASP_TEMPLATE,
  MORTHEN_GRAVE_CHILL,
  MORTHEN_ID,
  MORTHEN_REAP,
  MORTHEN_RELIGHT_CAST,
  MORTHEN_RITE,
  MORTHEN_RITE_BROKEN,
  MORTHEN_SHADOW_PULSE,
  MORTHEN_SHATTERED,
  MORTHEN_SOUL_TEMPLATE,
  MORTHEN_SPOT,
  MORTHEN_TUNING,
  MORTHEN_UNQUIET_WARD,
  nameTheDeadOrder,
  RITE_ALCOVE_SPOTS,
  RITE_CANDLE_DARK,
  RITE_CANDLE_LIT,
  RITE_CANDLE_NAMED,
  RITE_CANDLE_SPOTS,
  soulAlcove,
} from '../src/sim/encounters/hollow_crypt';
import type { MorthenFightState } from '../src/sim/encounters/hollow_crypt/boss_state';
import { DT, type Entity } from '../src/sim/types';
import {
  aura,
  boss,
  cryptFight,
  earned,
  type Fight,
  live,
  put,
  run,
  took,
  until,
} from './helpers/crypt_boss_fight';

vi.setConfig({ testTimeout: 90_000 });

const T = MORTHEN_TUNING;
const KEEP = new Set([MORTHEN_ID]);

function morthenFight(
  difficulty: 'normal' | 'heroic' = 'normal',
  extra = 3,
  seed = 23,
): { f: Fight; m: Entity } {
  const f = cryptFight(difficulty, extra, KEEP, seed);
  cryptDevTrigger(f.sim.ctx, f.inst, 'skip');
  const m = boss(f, MORTHEN_ID);
  put(f, m, MORTHEN_SPOT.x, MORTHEN_SPOT.z);
  put(f, f.tank, MORTHEN_SPOT.x, MORTHEN_SPOT.z - 4);
  // The group spread round the ring, well clear of him and the souls' paths.
  const spots = [
    [-24, 205],
    [24, 205],
    [0, 181],
  ];
  for (const [i, p] of f.others.entries()) put(f, p, spots[i % 3][0], spots[i % 3][1]);
  m.maxHp = 1e6;
  m.hp = m.maxHp;
  f.sim.ctx.aggroMob(m, f.tank, false);
  f.sim.drainEvents();
  return { f, m };
}

function fightState(m: Entity): MorthenFightState {
  const st = m.cryptBossFight;
  if (st?.kind !== 'morthen') throw new Error('no morthen fight');
  return st;
}

function objectsOf(f: Fight, templateId: string): Entity[] {
  return f.inst.objectIds
    .map((id) => f.sim.ctx.entities.get(id))
    .filter((e): e is Entity => !!e && e.templateId === templateId);
}

function candleObject(f: Fight, st: MorthenFightState, i: number): Entity {
  const e = f.sim.ctx.entities.get(st.candles[i].objectId);
  if (!e) throw new Error('no candle object');
  return e;
}

/** Drop him to `share` of his health and tick once (a phase line). */
function toShare(f: Fight, m: Entity, share: number): void {
  m.hp = Math.floor(m.maxHp * share);
  run(f, DT);
}

/** Stand `p` by candle `i`'s body and start the relight with the interact press. */
function startRelight(f: Fight, st: MorthenFightState, p: Entity, i: number): Entity {
  const body = f.sim.ctx.entities.get(st.candles[i].bodyId ?? -1);
  if (!body) throw new Error('no candle body');
  const at = candleBodySpot(i);
  const c = RITE_CANDLE_SPOTS[i];
  // A yard and a half further toward the ring's centre than the body.
  const dx = at.x - c.x;
  const dz = at.z - c.z;
  const d = Math.hypot(dx, dz);
  put(f, p, at.x + (dx / d) * 1.5, at.z + (dz / d) * 1.5);
  p.targetId = body.id;
  f.sim.interact(p.id);
  return body;
}

describe('Morthen: the content seams', () => {
  it('the candle spots are the kit pillars, the candle template is the relight use', () => {
    const props = HOLLOW_CRYPT_FIELD.props
      ?.filter((p) => p.kind === 'hc_remembrance_candle')
      .map((p) => ({ x: p.x, z: p.z }));
    expect(props).toEqual(RITE_CANDLE_SPOTS.map((c) => ({ x: c.x, z: c.z })));
    const alcoves = HOLLOW_CRYPT_FIELD.props?.filter((p) => p.kind === 'hc_sarcophagus_alcove');
    expect(alcoves).toHaveLength(4);
    // Each soul rises a step in front of its alcove's mouth (3 yd toward the centre).
    for (const [i, a] of RITE_ALCOVE_SPOTS.entries()) {
      const prop = alcoves?.[i];
      expect(Math.hypot((prop?.x ?? 0) - a.x, (prop?.z ?? 0) - a.z)).toBeCloseTo(3, 5);
    }
    const candle = MOBS[MORTHEN_CANDLE_ID];
    const use = candle?.trashKit?.usable;
    expect(use?.castId).toBe(MORTHEN_RELIGHT_CAST);
    expect(use?.channel).toBe(T.relightChannel);
    expect(use?.range).toBe(T.relightRange);
    expect(use?.holdsThroughHits).toBe(true);
    expect(use?.effect.kind).toBe('relight');
    // His old untelegraphed pulse is gone from the template: the encounter owns it.
    expect(MOBS[MORTHEN_ID].aoePulse).toBeUndefined();
    // Health from fight length x planning party DPS (about 6,800 on normal).
    expect(NORMAL_DUNGEON_TUNING.hollow_crypt.healthMultiplierByMob?.morthen).toBe(5.7);
  });

  it('the shipped pool on normal is about 6,800', () => {
    const f = cryptFight('normal', 1, KEEP);
    const m = boss(f, MORTHEN_ID);
    expect(m.maxHp).toBeGreaterThan(6600);
    expect(m.maxHp).toBeLessThan(7000);
  });
});

describe('Morthen: the Calling', () => {
  it('Shadow Pulse is a planted 2 s bar, then shadow within 12 yd only', () => {
    const { f, m } = morthenFight();
    const near = f.others[0];
    const far = f.others[1];
    put(f, near, MORTHEN_SPOT.x + 6, MORTHEN_SPOT.z);
    put(f, far, MORTHEN_SPOT.x + T.pulseRadius + 3, MORTHEN_SPOT.z);
    const hold = () => {
      put(f, near, MORTHEN_SPOT.x + 6, MORTHEN_SPOT.z);
      put(f, far, MORTHEN_SPOT.x + T.pulseRadius + 3, MORTHEN_SPOT.z);
    };
    expect(until(f, () => m.castingAbility === MORTHEN_SHADOW_PULSE, T.pulseFirst + 1, hold)).toBe(
      true,
    );
    const from = f.hits.length;
    // The telegraph: nothing lands while the bar fills.
    run(f, T.pulseCast - 0.2, hold);
    expect(took(f, near, 'Shadow Pulse', from)).toBe(0);
    run(f, 0.4, hold);
    expect(took(f, near, 'Shadow Pulse', from)).toBeGreaterThanOrEqual(T.pulseMin);
    expect(took(f, near, 'Shadow Pulse', from)).toBeLessThanOrEqual(T.pulseMax);
    expect(took(f, far, 'Shadow Pulse', from)).toBe(0);
  });

  it('Shadow Pulse spares a player far under the ring (the loft below the south rim)', () => {
    const { f, m } = morthenFight();
    // Morthen near the south rim; a player on the Choir Loft below, 7 yd away on the map.
    const hold = () => {
      put(f, m, 0, 180);
      put(f, f.others[0], 0, 173);
    };
    hold();
    expect(f.others[0].pos.y).toBeLessThan(m.pos.y - 10);
    expect(until(f, () => m.castingAbility === MORTHEN_SHADOW_PULSE, T.pulseFirst + 1, hold)).toBe(
      true,
    );
    const from = f.hits.length;
    run(f, T.pulseCast + 0.2, hold);
    expect(took(f, f.others[0], 'Shadow Pulse', from)).toBe(0);
  });

  it('Gravecall: a Bound Soul leaves the first alcove and gorges him on arrival, stacking, with a heal', () => {
    const { f, m } = morthenFight();
    m.hp = m.maxHp * 0.9;
    run(f, T.soulFirst + DT);
    const souls = objectsOf(f, MORTHEN_SOUL_TEMPLATE);
    expect(souls).toHaveLength(1);
    const a0 = soulAlcove(0);
    expect(Math.hypot(souls[0].pos.x - f.ox - a0.x, souls[0].pos.z - f.oz - a0.z)).toBeLessThan(1);
    const hp = m.hp;
    expect(until(f, () => gorgedStacks(m) === 1, T.soulSeconds)).toBe(true);
    expect(aura(m, MORTHEN_GORGED)?.value).toBeCloseTo(T.gorgedPct, 5);
    expect(m.hp).toBeGreaterThan(hp);
    // The next one rises from the next alcove, clockwise, and stacks.
    expect(until(f, () => objectsOf(f, MORTHEN_SOUL_TEMPLATE).length === 1, T.soulEvery)).toBe(
      true,
    );
    const a1 = soulAlcove(1);
    const s1 = objectsOf(f, MORTHEN_SOUL_TEMPLATE)[0];
    expect(Math.hypot(s1.pos.x - f.ox - a1.x, s1.pos.z - f.oz - a1.z)).toBeLessThan(1);
    expect(until(f, () => gorgedStacks(m) === 2, T.soulSeconds)).toBe(true);
    expect(aura(m, MORTHEN_GORGED)?.value).toBeCloseTo(T.gorgedPct * 2, 5);
  });

  it('a player standing in the soul path takes it instead (shadow), and he gains nothing', () => {
    const { f, m } = morthenFight();
    const blocker = f.others[0];
    // Halfway from the first alcove to him, right in its path.
    const a0 = soulAlcove(0);
    const mid = { x: (a0.x + MORTHEN_SPOT.x) / 2, z: (a0.z + MORTHEN_SPOT.z) / 2 };
    const hold = () => put(f, blocker, mid.x, mid.z);
    hold();
    run(f, T.soulFirst + DT, hold);
    expect(objectsOf(f, MORTHEN_SOUL_TEMPLATE)).toHaveLength(1);
    const from = f.hits.length;
    expect(
      until(f, () => objectsOf(f, MORTHEN_SOUL_TEMPLATE).length === 0, T.soulSeconds, hold),
    ).toBe(true);
    const bite = took(f, blocker, BOUND_SOUL_WALKER.name, from);
    expect(bite).toBeGreaterThanOrEqual(T.soulInterceptMin);
    expect(bite).toBeLessThanOrEqual(T.soulInterceptMax);
    expect(gorgedStacks(m)).toBe(0);
  });
});

describe('Morthen: the Rite of the Unquiet', () => {
  it('at 65 percent he goes immune at the altar, the candles gutter out, two Restless Bones rise', () => {
    const { f, m } = morthenFight();
    run(f, 1);
    // A burst past the line still stops at it.
    toShare(f, m, 0.5);
    const st = fightState(m);
    expect(st.act).toBe('rite');
    expect(m.hp).toBe(Math.floor(m.maxHp * T.riteAt));
    expect(m.damageImmune).toBe(true);
    expect(aura(m, MORTHEN_UNQUIET_WARD)).toBeDefined();
    expect(m.castingAbility).toBe(MORTHEN_RITE);
    expect(st.candles).toHaveLength(4);
    expect(objectsOf(f, RITE_CANDLE_DARK)).toHaveLength(4);
    const bodies = live(f, MORTHEN_CANDLE_ID);
    expect(bodies).toHaveLength(4);
    for (const b of bodies) {
      expect(b.hostile).toBe(false);
      expect(b.damageImmune).toBe(true);
    }
    expect(live(f, MARROW_BONES_ID)).toHaveLength(T.riteBones);
    // Nothing hurts him through the ward.
    const hp = m.hp;
    f.sim.ctx.dealDamage(f.tank, m, 5000, false, 'physical', 'Strike', 'hit', true);
    // He glides back to the altar and stays there.
    run(f, T.riteStrideMax + 1);
    expect(m.hp).toBe(hp);
    expect(
      Math.hypot(m.pos.x - f.ox - MORTHEN_SPOT.x, m.pos.z - f.oz - MORTHEN_SPOT.z),
    ).toBeLessThan(0.2);
  });

  it('Grave Chill bites everyone every second, rising every 5 s', () => {
    const { f, m } = morthenFight();
    toShare(f, m, 0.64);
    const from = f.hits.length;
    run(f, 1.05);
    const p = f.others[2];
    expect(took(f, p, 'Grave Chill', from)).toBe(T.chillBase);
    expect(aura(p, MORTHEN_GRAVE_CHILL)?.value2).toBe(T.chillBase);
    const mid = f.hits.length;
    run(f, T.chillEvery);
    // Five more bites: the last of them a step harder.
    expect(took(f, p, 'Grave Chill', mid)).toBe(T.chillBase * 4 + T.chillBase + T.chillStep);
  });

  it('the relight is a 4 s channel that drains its lighter every second and lights the candle', () => {
    const { f, m } = morthenFight();
    toShare(f, m, 0.64);
    const st = fightState(m);
    const lighter = f.others[0];
    const body = startRelight(f, st, lighter, 0);
    expect(lighter.castingAbility).toBe(MORTHEN_RELIGHT_CAST);
    expect(lighter.castTargetId).toBe(body.id);
    const from = f.hits.length;
    const at = { x: lighter.pos.x - f.ox, z: lighter.pos.z - f.oz };
    run(f, T.relightChannel + 0.1, () => put(f, lighter, at.x, at.z));
    const bite = Math.round(lighter.maxHp * T.relightDrainPct);
    const drains = f.hits.filter(
      (h) => h.targetId === lighter.id && h.ability === "Candle's Price",
    );
    expect(drains.map((h) => h.amount)).toEqual([bite, bite, bite, bite]);
    expect(st.candles[0].lit).toBe(true);
    expect(candleObject(f, st, 0).templateId).toBe(RITE_CANDLE_LIT);
    expect(f.sim.ctx.entities.has(body.id)).toBe(false);
    expect(aura(m, MORTHEN_UNQUIET_WARD)?.value2).toBe(1);
    expect(took(f, lighter, "Candle's Price", from)).toBe(bite * 4);
  });

  it('enemy hits never break the relight, and the healer can heal the lighter through it', () => {
    const { f, m } = morthenFight();
    toShare(f, m, 0.64);
    const st = fightState(m);
    const lighter = f.others[1];
    startRelight(f, st, lighter, 1);
    const at = { x: lighter.pos.x - f.ox, z: lighter.pos.z - f.oz };
    const hold = () => put(f, lighter, at.x, at.z);
    run(f, 1.2, hold);
    // A Restless Bones' swing and Morthen's own shadow land: the channel holds.
    const bones = live(f, MARROW_BONES_ID)[0];
    f.sim.ctx.dealDamage(bones, lighter, 40, false, 'physical', 'Melee', 'hit', false);
    f.sim.ctx.dealDamage(m, lighter, 40, false, 'shadow', 'Grave Chill', 'hit', true);
    expect(lighter.castingAbility).toBe(MORTHEN_RELIGHT_CAST);
    // Healed mid-channel: the health comes back and the channel goes on.
    const low = lighter.hp;
    f.sim.ctx.applyHeal(f.others[2], lighter, 250_000, 'Heal');
    expect(lighter.hp).toBeGreaterThan(low);
    expect(lighter.castingAbility).toBe(MORTHEN_RELIGHT_CAST);
    run(f, T.relightChannel - 1.1, hold);
    expect(st.candles[1].lit).toBe(true);
  });

  it('a step or a stun breaks it, nothing carries over, and an untouchable lighter is refused the candle', () => {
    const { f, m } = morthenFight();
    toShare(f, m, 0.64);
    const st = fightState(m);
    const lighter = f.others[0];
    startRelight(f, st, lighter, 2);
    run(f, 1.6);
    // A step: the move breaks the activity.
    const meta = f.sim.players.get(lighter.id);
    if (!meta) throw new Error('no meta');
    meta.moveInput.forward = true;
    run(f, DT * 2);
    meta.moveInput.forward = false;
    expect(lighter.castingAbility).toBeNull();
    expect(st.candles[2].lit).toBe(false);
    // Again: the price starts over (drains counted from the beginning).
    startRelight(f, st, lighter, 2);
    const from = f.hits.length;
    run(f, 1.6);
    expect(
      f.hits.filter(
        (h, i) => i >= from && h.targetId === lighter.id && h.ability === "Candle's Price",
      ),
    ).toHaveLength(2);
    // A stun breaks it.
    lighter.auras.push({
      id: 'test_stun',
      name: 'Stun',
      kind: 'stun',
      remaining: 1,
      duration: 1,
      value: 0,
      sourceId: m.id,
      school: 'physical',
    });
    run(f, DT * 2);
    expect(lighter.castingAbility).toBeNull();
    run(f, 1.2);
    // An Ice Block's stasis (immune to the drain) is refused the candle.
    startRelight(f, st, lighter, 2);
    expect(lighter.castingAbility).toBe(MORTHEN_RELIGHT_CAST);
    lighter.damageImmune = true;
    run(f, DT * 2);
    expect(lighter.castingAbility).toBeNull();
    lighter.damageImmune = false;
    // Out of reach: the authoritative press refuses it.
    const body = f.sim.ctx.entities.get(st.candles[2].bodyId ?? -1) as Entity;
    put(f, lighter, 0, 200);
    lighter.targetId = body.id;
    f.sim.interact(lighter.id);
    expect(lighter.castingAbility).toBeNull();
    // And nothing lights a candle before the Rite or after the ward breaks.
    expect(st.candles[2].lit).toBe(false);
  });

  it('the fourth candle shatters the ward: an 8 s stun and 25 percent more damage taken', () => {
    const { f, m } = morthenFight();
    toShare(f, m, 0.64);
    const st = fightState(m);
    for (let i = 0; i < 3; i++) cryptDevTrigger(f.sim.ctx, f.inst, 'candle');
    run(f, DT);
    expect(st.act).toBe('rite');
    expect(m.damageImmune).toBe(true);
    const lighter = f.others[0];
    startRelight(f, st, lighter, 3);
    const at = { x: lighter.pos.x - f.ox, z: lighter.pos.z - f.oz };
    run(f, T.relightChannel + 0.1, () => put(f, lighter, at.x, at.z));
    expect(st.act).toBe('broken');
    expect(m.damageImmune).toBe(false);
    expect(aura(m, MORTHEN_UNQUIET_WARD)).toBeUndefined();
    expect(aura(m, MORTHEN_RITE_BROKEN)?.kind).toBe('stun');
    expect(aura(m, MORTHEN_SHATTERED)?.value).toBe(T.brokenVuln);
    expect(f.sim.ctx.isStunned(m)).toBe(true);
    expect(live(f, MORTHEN_CANDLE_ID)).toHaveLength(0);
    expect(objectsOf(f, RITE_CANDLE_LIT)).toHaveLength(4);
    // Vulnerable: the same hit lands a quarter harder.
    const a = f.sim.ctx.dealDamage(f.tank, m, 1000, false, 'holy', 'Smite', 'hit', true);
    expect(a).toBe(1250);
    run(f, T.brokenSeconds + 0.2);
    expect(st.act).toBe('calling');
    expect(f.sim.ctx.isStunned(m)).toBe(false);
    // The Rite never comes twice.
    toShare(f, m, 0.5);
    expect(st.act).toBe('calling');
  });
});

describe('Morthen: Last Rites', () => {
  it('at 35 percent the souls stop and Reap the Unquiet sweeps in front of him only', () => {
    const { f, m } = morthenFight();
    toShare(f, m, 0.64);
    for (let i = 0; i < 4; i++) cryptDevTrigger(f.sim.ctx, f.inst, 'candle');
    run(f, T.brokenSeconds + 0.5);
    toShare(f, m, 0.3);
    const st = fightState(m);
    expect(st.act).toBe('last_rites');
    const front = f.others[0];
    const behind = f.others[1];
    const hold = () => {
      // The tank is south of him: the sweep faces south.
      put(f, f.tank, MORTHEN_SPOT.x, MORTHEN_SPOT.z - 4);
      put(f, front, MORTHEN_SPOT.x + 2, MORTHEN_SPOT.z - 9);
      put(f, behind, MORTHEN_SPOT.x, MORTHEN_SPOT.z + 6);
    };
    const souls = st.souls;
    expect(until(f, () => m.castingAbility === MORTHEN_REAP, T.reapFirst + 1, hold)).toBe(true);
    const from = f.hits.length;
    run(f, T.reapCast + 0.2, hold);
    const hit = took(f, front, 'Reap the Unquiet', from);
    expect(hit).toBeGreaterThanOrEqual(T.reapMin);
    expect(hit).toBeLessThanOrEqual(T.reapMax);
    expect(took(f, f.tank, 'Reap the Unquiet', from)).toBeGreaterThan(0);
    expect(took(f, behind, 'Reap the Unquiet', from)).toBe(0);
    run(f, T.soulEvery + 1, hold);
    expect(st.souls).toBe(souls);
  });
});

describe('Morthen: heroic', () => {
  it('Name the Dead: the Ledger names the order; a wrong candle snuffs the last lit one and burns', () => {
    const { f, m } = morthenFight('heroic');
    toShare(f, m, 0.64);
    const st = fightState(m);
    expect(st.order).toEqual(nameTheDeadOrder(m.id, f.inst.slot));
    expect([...st.order].sort()).toEqual([0, 1, 2, 3]);
    const first = st.order[0];
    expect(candleObject(f, st, first).templateId).toBe(RITE_CANDLE_NAMED);
    expect(objectsOf(f, RITE_CANDLE_NAMED)).toHaveLength(1);
    // The right one first.
    cryptDevTrigger(f.sim.ctx, f.inst, 'candle');
    expect(st.candles[first].lit).toBe(true);
    expect(candleObject(f, st, st.order[1]).templateId).toBe(RITE_CANDLE_NAMED);
    // Then a wrong one: the last lit gutters again, the lighter burns.
    const wrong = st.order[3];
    const lighter = f.others[0];
    startRelight(f, st, lighter, wrong);
    const at = { x: lighter.pos.x - f.ox, z: lighter.pos.z - f.oz };
    const from = f.hits.length;
    run(f, T.relightChannel + 0.1, () => put(f, lighter, at.x, at.z));
    expect(st.candles[wrong].lit).toBe(false);
    expect(st.candles[first].lit).toBe(false);
    expect(candleObject(f, st, first).templateId).toBe(RITE_CANDLE_NAMED);
    expect(st.candles[first].bodyId).not.toBeNull();
    const mult = m.mechanicDamageMult ?? 1;
    const burn = took(f, lighter, 'Name the Dead', from);
    expect(burn).toBeGreaterThanOrEqual(Math.round(T.wrongCandleMin * mult));
    expect(burn).toBeLessThanOrEqual(Math.round(T.wrongCandleMax * mult));
    // The heroic drain is the steeper share.
    const bite = Math.round(lighter.maxHp * T.relightDrainPctHeroic);
    expect(took(f, lighter, "Candle's Price", from)).toBe(bite * 4);
  });

  it('Grasp of the Grave: two rings, hands erupt after the fuse: root and shadow inside only', () => {
    const { f } = morthenFight('heroic');
    const stand = f.others.map((p) => ({ p, x: p.pos.x - f.ox, z: p.pos.z - f.oz }));
    const hold = () => {
      for (const s of stand) put(f, s.p, s.x, s.z);
    };
    expect(
      until(f, () => objectsOf(f, MORTHEN_GRASP_TEMPLATE).length === 2, T.graspFirst + 1, hold),
    ).toBe(true);
    const marked = f.others.filter((p) => aura(p, MORTHEN_GRASP_MARK));
    expect(marked).toHaveLength(2);
    expect(aura(marked[0], MORTHEN_GRASP_MARK)?.value2).toBe(T.graspRadius);
    const free = [f.tank, ...f.others].find((p) => !marked.includes(p)) as Entity;
    const from = f.hits.length;
    run(f, T.graspFuse + 0.1, hold);
    expect(objectsOf(f, MORTHEN_GRASP_HANDS_TEMPLATE)).toHaveLength(2);
    for (const p of marked) {
      expect(took(f, p, 'Grasp of the Grave', from)).toBeGreaterThan(0);
      expect(aura(p, MORTHEN_GRASP_ROOT)?.kind).toBe('root');
    }
    expect(took(f, free, 'Grasp of the Grave', from)).toBe(0);
    run(f, T.graspRootSeconds + 0.2, hold);
    expect(objectsOf(f, MORTHEN_GRASP_HANDS_TEMPLATE)).toHaveLength(0);
  });

  it('normal never grasps', () => {
    const { f } = morthenFight('normal');
    run(f, T.graspFirst + T.graspEvery + 1);
    expect(objectsOf(f, MORTHEN_GRASP_TEMPLATE)).toHaveLength(0);
  });
});

describe('Morthen: the fight holds', () => {
  it('held at the altar through a long Rite, he never walks home and the Rite holds', () => {
    const { f, m } = morthenFight();
    toShare(f, m, 0.64);
    const st = fightState(m);
    // The tank stands far off the dais the whole time.
    const hold = () => put(f, f.tank, 0, 186);
    let evaded = false;
    run(f, 25, () => {
      hold();
      if (m.aiState === 'evade') evaded = true;
    });
    expect(evaded).toBe(false);
    expect(st.act).toBe('rite');
    expect(m.cryptBossFight).toBe(st);
  });

  it('losing his target in his Last Rites never resets the fight (no second Rite)', () => {
    const { f, m } = morthenFight();
    toShare(f, m, 0.64);
    for (let i = 0; i < 4; i++) cryptDevTrigger(f.sim.ctx, f.inst, 'candle');
    run(f, T.brokenSeconds + 0.5);
    toShare(f, m, 0.3);
    const st = fightState(m);
    expect(st.act).toBe('last_rites');
    // The others are on his threat list (they have hit him).
    for (const p of f.others) f.sim.ctx.dealDamage(p, m, 10, false, 'fire', 'Fireball', 'hit');
    // The tank falls: he turns to the next one, the fight goes on.
    f.tank.hp = 0;
    f.tank.dead = true;
    run(f, 2, () => {
      f.tank.dead = true;
    });
    expect(m.cryptBossFight).toBe(st);
    expect(st.riteDone).toBe(true);
    toShare(f, m, 0.3);
    expect(st.act).toBe('last_rites');
  });
});

describe('Morthen: the end of the fight', () => {
  it('a wipe puts the rite to rest: no candle, soul, ring or ward left behind', () => {
    const { f, m } = morthenFight('heroic');
    run(f, T.soulFirst + 0.5);
    toShare(f, m, 0.64);
    run(f, 0.5);
    expect(live(f, MORTHEN_CANDLE_ID)).toHaveLength(4);
    for (const p of [f.tank, ...f.others]) {
      p.hp = 0;
      p.dead = true;
    }
    run(f, 1);
    expect(m.cryptBossFight).toBeUndefined();
    expect(m.damageImmune).toBe(false);
    expect(aura(m, MORTHEN_UNQUIET_WARD)).toBeUndefined();
    expect(live(f, MORTHEN_CANDLE_ID)).toHaveLength(0);
    // The Rite's Restless Bones go back to the earth with it.
    expect(live(f, MARROW_BONES_ID)).toHaveLength(0);
    for (const t of [RITE_CANDLE_DARK, RITE_CANDLE_LIT, RITE_CANDLE_NAMED, MORTHEN_SOUL_TEMPLATE])
      expect(objectsOf(f, t)).toHaveLength(0);
  });

  it('Every Candle Lit: all four relit within 20 s of the ward earns the deed at the kill', () => {
    const { f, m } = morthenFight();
    toShare(f, m, 0.64);
    for (let i = 0; i < 4; i++) cryptDevTrigger(f.sim.ctx, f.inst, 'candle');
    run(f, DT);
    expect(fightState(m).candlelight).toBe(true);
    f.sim.ctx.handleDeath(m, f.tank);
    run(f, DT);
    expect(earned(f, f.tank, MORTHEN_DEED)).toBe(true);
  });

  it('too slow a Rite earns nothing', () => {
    const { f, m } = morthenFight();
    toShare(f, m, 0.64);
    run(f, T.candlelightSeconds + 1);
    for (let i = 0; i < 4; i++) cryptDevTrigger(f.sim.ctx, f.inst, 'candle');
    run(f, DT);
    expect(fightState(m).candlelight).toBe(false);
    f.sim.ctx.handleDeath(m, f.tank);
    run(f, DT);
    expect(earned(f, f.tank, MORTHEN_DEED)).toBe(false);
  });

  it('is deterministic: the same seed plays the same fight', () => {
    const play = () => {
      const { f, m } = morthenFight('heroic', 3, 41);
      run(f, 14);
      toShare(f, m, 0.64);
      run(f, 6);
      return f.hits.map((h) => `${h.targetId}:${h.ability}:${h.amount}`).join('|');
    };
    const a = play();
    expect(a.length).toBeGreaterThan(0);
    expect(play()).toBe(a);
  });
});
