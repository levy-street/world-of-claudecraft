// The Hollow Crypt finale (src/sim/encounters/hollow_crypt): Morthen's
// entrance (entombed and untouchable until the group steps into the Rite Ring,
// then the rite wakes, he rises into the sky, speaks, descends and only then
// fights) and the Knellwyrm his dying rite summons (the burning circle warning,
// the flight in from the sky, the touchdown blast, Pyre Strafe, Dread Bellow,
// the exit portal and the deed). Driven through the real Sim tick inside a
// claimed crypt.

import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import {
  CRYPT_ENTOMBED,
  CRYPT_GRAVE_ASCENSION,
  cryptDevTrigger,
  inStrafeLane,
  KNELL_LANE_MARK_TEMPLATE,
  KNELL_LANE_TEMPLATE,
  KNELL_PYRE_TEMPLATE,
  KNELLWYRM_ARRIVE,
  KNELLWYRM_BARED_RIBS,
  KNELLWYRM_DEED,
  KNELLWYRM_DREAD_BELLOW,
  KNELLWYRM_ID,
  KNELLWYRM_PYRE_STRAFE,
  KNELLWYRM_STRAFE_RUN,
  KNELLWYRM_TUNING,
  MORTHEN_DESCEND,
  MORTHEN_ENTRANCE_SECONDS,
  MORTHEN_FINALE_YELL,
  MORTHEN_ID,
  MORTHEN_PROCLAIM,
  MORTHEN_RISE,
  MORTHEN_RISE_TUNING,
  MORTHEN_RISE_YELL,
  MORTHEN_RITE_WAKES,
  MORTHEN_SPOT,
  morthenEntranceHeight,
  RITE_RING,
  strafeLane,
  wyrmArrivalPose,
} from '../src/sim/encounters/hollow_crypt';
import { claimedInstanceAt, enterDungeon } from '../src/sim/instances/dungeons';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';

interface Run {
  sim: Sim;
  inst: InstanceSlot;
  ox: number;
  oz: number;
  tank: Entity;
  others: Entity[];
  events: SimEvent[];
}

function crypt(extra = 1): Run {
  const sim = new Sim({ seed: 23, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const tank = sim.player;
  sim.chat('/dev level 20', tank.id);
  const ids: number[] = [];
  for (let i = 0; i < extra; i++) {
    const pid = sim.addPlayer('mage', `Gravewalker${i}`);
    sim.partyInvite(pid, tank.id);
    sim.partyAccept(pid);
    ids.push(pid);
  }
  sim.chat('/dev crypt enter', tank.id);
  for (const pid of ids) enterDungeon(sim.ctx, 'hollow_crypt', pid);
  const inst = claimedInstanceAt(sim.ctx, tank.pos);
  if (!inst) throw new Error('no crypt claim');
  // Clear every pack: the finale plays alone.
  for (const id of inst.mobIds) {
    const e = sim.ctx.entities.get(id);
    if (e && !e.dead && e.templateId !== MORTHEN_ID) sim.ctx.handleDeath(e, tank);
  }
  const others = ids.map((pid) => sim.ctx.entities.get(pid) as Entity);
  for (const p of [tank, ...others]) {
    p.maxHp = 1e7;
    p.hp = 1e7;
  }
  const o = instanceOrigin(DUNGEONS.hollow_crypt.index, inst.slot);
  const r: Run = { sim, inst, ox: o.x, oz: o.z, tank, others, events: [] };
  // Everyone waits at the foot of the Bone Stair, outside the ring.
  for (const p of [tank, ...others]) put(r, p, 40, 161);
  sim.drainEvents();
  return r;
}

function put(r: Run, e: Entity, x: number, z: number): void {
  e.pos = r.sim.ctx.groundPos(r.ox + x, r.oz + z);
  e.prevPos = { ...e.pos };
}

function run(r: Run, seconds: number, each: () => void = () => {}): void {
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    for (const p of [r.tank, ...r.others]) if (p.hp < 1e5) p.hp = 1e6;
    r.events.push(...r.sim.tick(), ...r.sim.drainEvents());
    each();
  }
}

function mob(r: Run, templateId: string): Entity | null {
  for (const id of r.inst.mobIds) {
    const e = r.sim.ctx.entities.get(id);
    if (e?.templateId === templateId) return e;
  }
  return null;
}

function morthen(r: Run): Entity {
  const e = mob(r, MORTHEN_ID);
  if (!e) throw new Error('no morthen');
  return e;
}

function has(e: Entity, aura: string): boolean {
  return e.auras.some((a) => a.id === aura);
}

function floorY(r: Run): number {
  return r.sim.ctx.groundPos(r.ox + MORTHEN_SPOT.x, r.oz + MORTHEN_SPOT.z).y;
}

function objects(r: Run, templateId: string): Entity[] {
  return r.inst.objectIds
    .map((id) => r.sim.ctx.entities.get(id))
    .filter((e): e is Entity => !!e && e.templateId === templateId);
}

/** Walk the group into the ring and let the whole entrance play. */
function riseAndFight(r: Run): Entity {
  for (const p of [r.tank, ...r.others]) put(r, p, 0, 196);
  run(r, MORTHEN_ENTRANCE_SECONDS + 0.5);
  return morthen(r);
}

function slayMorthen(r: Run): Entity {
  const m = riseAndFight(r);
  r.sim.ctx.handleDeath(m, r.tank);
  return m;
}

/** Let the wyrm fly in and take the fight. */
function wyrmIn(r: Run): Entity {
  slayMorthen(r);
  run(
    r,
    KNELLWYRM_TUNING.pyreSeconds +
      KNELLWYRM_TUNING.arriveSeconds +
      KNELLWYRM_TUNING.settleSeconds +
      0.3,
  );
  const w = mob(r, KNELLWYRM_ID);
  if (!w) throw new Error('no wyrm');
  return w;
}

describe('Morthen: entombed until the group steps into the Rite Ring', { timeout: 120_000 }, () => {
  it('lies hidden, non-hostile and immune under the ring, and nothing can pull or hurt him', () => {
    const r = crypt();
    run(r, 1);
    const m = morthen(r);
    expect(has(m, CRYPT_ENTOMBED)).toBe(true);
    expect(has(m, CRYPT_GRAVE_ASCENSION)).toBe(true);
    expect(m.hostile).toBe(false);
    expect(m.damageImmune).toBe(true);
    expect(m.encounterHeld).toBe(true);
    expect(m.pos.y).toBeLessThan(floorY(r) - 5);
    // A hit lands nothing, a pull does not stick.
    const hp = m.hp;
    expect(r.sim.ctx.dealDamage(r.tank, m, 500, false, 'physical', 'Strike', 'hit', true)).toBe(0);
    r.sim.ctx.aggroMob(m, r.tank, false);
    run(r, 0.5);
    expect(m.hp).toBe(hp);
    expect(m.inCombat).toBe(false);
    expect(m.cryptRite?.phase).toBe('dormant');
    // Standing at the rim (outside the trigger inset) does not wake him.
    put(r, r.tank, RITE_RING.x, RITE_RING.z - RITE_RING.r + 1);
    run(r, 1);
    expect(m.cryptRite?.phase).toBe('dormant');
  });

  it('wakes when a player steps in, rises into the sky, speaks, descends, lands and only then fights', () => {
    const r = crypt();
    run(r, 0.5);
    const m = morthen(r);
    put(r, r.others[0], 0, 196);
    run(r, DT);
    expect(m.cryptRite?.phase).toBe('wakes');
    expect(m.castingAbility).toBe(MORTHEN_RITE_WAKES);
    expect(has(m, CRYPT_ENTOMBED)).toBe(true);
    const T = MORTHEN_RISE_TUNING;
    const floor = floorY(r);
    const heights: number[] = [];
    const casts = new Set<string>();
    let hostileEarly = false;
    let hurtEarly = false;
    run(r, T.wakeSeconds + T.riseSeconds + T.proclaimSeconds + T.descendSeconds - 0.2, () => {
      heights.push(m.pos.y - floor);
      if (m.castingAbility) casts.add(m.castingAbility);
      if (m.hostile || !m.damageImmune) hostileEarly = true;
      if (r.sim.ctx.dealDamage(r.tank, m, 500, false, 'fire', 'Fireball', 'hit', true) > 0)
        hurtEarly = true;
    });
    expect(hostileEarly).toBe(false);
    expect(hurtEarly).toBe(false);
    expect([...casts]).toEqual(
      expect.arrayContaining([MORTHEN_RITE_WAKES, MORTHEN_RISE, MORTHEN_PROCLAIM, MORTHEN_DESCEND]),
    );
    // He came up out of the floor and high into the sky.
    expect(Math.min(...heights)).toBeLessThan(-T.buriedDepth + 0.5);
    expect(Math.max(...heights)).toBeGreaterThan(T.apex - 1);
    // Revealed once he breaks the floor, and he spoke his line over the ring.
    expect(has(m, CRYPT_ENTOMBED)).toBe(false);
    const yells = r.events.filter((e) => e.type === 'chat' && e.text === MORTHEN_RISE_YELL);
    expect(yells.length).toBeGreaterThan(0);
    run(r, T.landSeconds + 0.6);
    expect(m.cryptRite?.phase).toBe('risen');
    expect(m.hostile).toBe(true);
    expect(m.damageImmune).toBe(false);
    expect(has(m, CRYPT_GRAVE_ASCENSION)).toBe(false);
    expect(Math.abs(m.pos.y - floor)).toBeLessThan(0.5);
    expect(m.inCombat).toBe(true);
    expect(m.aggroTargetId).not.toBeNull();
    expect(
      r.sim.ctx.dealDamage(r.tank, m, 50, false, 'physical', 'Strike', 'hit', true),
    ).toBeGreaterThan(0);
  });

  it('plays the same on every run (deterministic heights and timings)', () => {
    const trace = () => {
      const r = crypt();
      run(r, 0.5);
      put(r, r.tank, 0, 196);
      const out: number[] = [];
      run(r, MORTHEN_ENTRANCE_SECONDS + 0.5, () =>
        out.push(Math.round((morthen(r).pos.y - floorY(r)) * 1000)),
      );
      return out;
    };
    expect(trace()).toEqual(trace());
  });

  it('the pure entrance curve is buried, rises slowly to the apex and comes down', () => {
    const T = MORTHEN_RISE_TUNING;
    expect(morthenEntranceHeight('dormant', 0)).toBe(-T.buriedDepth);
    expect(morthenEntranceHeight('rise', 0)).toBeCloseTo(-T.buriedDepth, 6);
    expect(morthenEntranceHeight('rise', T.riseSeconds * 0.1)).toBeLessThan(-T.buriedDepth + 1);
    expect(morthenEntranceHeight('rise', T.riseSeconds)).toBeCloseTo(T.apex, 6);
    expect(morthenEntranceHeight('descend', T.descendSeconds)).toBeCloseTo(0, 6);
  });

  it('a dev kill mid-entrance never leaves a hidden, untouchable corpse', () => {
    const r = crypt();
    run(r, 0.5);
    const m = morthen(r);
    r.sim.ctx.handleDeath(m, r.tank);
    run(r, 0.5);
    expect(has(m, CRYPT_ENTOMBED)).toBe(false);
    expect(m.encounterHeld).toBe(false);
  });

  it('/dev crypt rise wakes him at once; skip leaves him ready at the altar', () => {
    const r = crypt();
    run(r, 0.5);
    expect(cryptDevTrigger(r.sim.ctx, r.inst, 'rise')).toContain('wakes');
    expect(morthen(r).cryptRite?.phase).toBe('wakes');
    const r2 = crypt();
    run(r2, 0.5);
    cryptDevTrigger(r2.sim.ctx, r2.inst, 'skip');
    expect(morthen(r2).cryptRite?.phase).toBe('risen');
    expect(morthen(r2).hostile).toBe(true);
  });
});

describe("The Knellwyrm: the finale Morthen's dying rite summons", { timeout: 120_000 }, () => {
  it("Morthen's fall sets the ritual circle burning, and no exit opens yet", () => {
    const r = crypt();
    slayMorthen(r);
    run(r, 0.2);
    const pyres = objects(r, KNELL_PYRE_TEMPLATE);
    expect(pyres.length).toBe(1);
    expect(pyres[0].pos.x - r.ox).toBeCloseTo(MORTHEN_SPOT.x, 3);
    expect(pyres[0].pos.z - r.oz).toBeCloseTo(MORTHEN_SPOT.z, 3);
    expect(r.events.some((e) => e.type === 'chat' && e.text === MORTHEN_FINALE_YELL)).toBe(true);
    expect(r.inst.bossExitId).toBeNull();
    // The wyrm is summoned but hidden, far out over the mist and high up.
    const w = mob(r, KNELLWYRM_ID);
    expect(w).not.toBeNull();
    if (!w) return;
    expect(has(w, CRYPT_ENTOMBED)).toBe(true);
    expect(w.hostile).toBe(false);
    const d = Math.hypot(w.pos.x - r.ox - MORTHEN_SPOT.x, w.pos.z - r.oz - MORTHEN_SPOT.z);
    expect(d).toBeGreaterThan(80);
    expect(w.pos.y - floorY(r)).toBeGreaterThan(40);
  });

  it('flies in from the sky over the warning, lands in the pyre and burns whoever stands in it', () => {
    const r = crypt(2);
    slayMorthen(r);
    const inPyre = r.others[0];
    const clear = r.others[1];
    put(r, inPyre, MORTHEN_SPOT.x + 3, MORTHEN_SPOT.z);
    put(r, clear, MORTHEN_SPOT.x + KNELLWYRM_TUNING.pyreRadius + 6, MORTHEN_SPOT.z);
    run(r, KNELLWYRM_TUNING.pyreSeconds + 0.1);
    const w = mob(r, KNELLWYRM_ID) as Entity;
    expect(has(w, CRYPT_ENTOMBED)).toBe(false);
    expect(w.castingAbility).toBe(KNELLWYRM_ARRIVE);
    // Descending the whole way in: never popping up in anyone's face.
    const ups: number[] = [];
    const dists: number[] = [];
    let hitInFlight = false;
    run(r, KNELLWYRM_TUNING.arriveSeconds - 0.3, () => {
      ups.push(w.pos.y - floorY(r));
      dists.push(Math.hypot(w.pos.x - r.ox - MORTHEN_SPOT.x, w.pos.z - r.oz - MORTHEN_SPOT.z));
      if (r.sim.ctx.dealDamage(r.tank, w, 100, false, 'fire', 'Fireball', 'hit', true) > 0)
        hitInFlight = true;
    });
    expect(hitInFlight).toBe(false);
    for (let i = 1; i < dists.length; i++)
      expect(dists[i]).toBeLessThanOrEqual(dists[i - 1] + 1e-6);
    expect(ups[0]).toBeGreaterThan(30);
    const inBefore = inPyre.hp;
    const clearBefore = clear.hp;
    run(r, 0.5);
    expect(objects(r, KNELL_PYRE_TEMPLATE).length).toBe(0);
    expect(inPyre.hp).toBeLessThan(inBefore);
    expect(clear.hp).toBe(clearBefore);
    run(r, KNELLWYRM_TUNING.settleSeconds + 0.2);
    expect(w.hostile).toBe(true);
    expect(w.damageImmune).toBe(false);
    expect(w.inCombat).toBe(true);
  });

  it('Pyre Strafe marks a lane through a player, runs it rim to rim and leaves it burning', () => {
    const r = crypt(1);
    const w = wyrmIn(r);
    put(r, r.others[0], MORTHEN_SPOT.x + 12, MORTHEN_SPOT.z - 4);
    put(r, r.tank, MORTHEN_SPOT.x - 2, MORTHEN_SPOT.z + 3);
    run(r, 0.2);
    expect(w.knellwyrmFight).toBeDefined();
    w.castingAbility = null;
    const st = w.knellwyrmFight;
    if (!st) return;
    const msg = cryptDevTrigger(r.sim.ctx, r.inst, 'strafe');
    expect(msg).toContain('Pyre Strafe');
    expect(w.castingAbility).toBe(KNELLWYRM_PYRE_STRAFE);
    // The hashed victim is the bar's target; the lane runs through them.
    const victim = r.sim.ctx.entities.get(w.castTargetId ?? -1) as Entity;
    expect(victim?.kind).toBe('player');
    const lane = st.strafe;
    expect(lane).not.toBeNull();
    if (!lane) return;
    expect(inStrafeLane(lane, victim.pos.x - r.ox, victim.pos.z - r.oz)).toBe(true);
    // Rim to rim across the ring, painted on the floor while the bar runs.
    expect(lane.length).toBeGreaterThan(RITE_RING.r);
    const marks = objects(r, KNELL_LANE_MARK_TEMPLATE);
    expect(marks.length).toBe(1);
    expect(marks[0].facing).toBeCloseTo(lane.yaw, 6);
    expect(marks[0].scale).toBeCloseTo(lane.length, 6);
    const before = victim.hp;
    let ran = false;
    let airborne = 0;
    run(r, KNELLWYRM_TUNING.strafeMark + KNELLWYRM_TUNING.strafeFlight + 0.2, () => {
      if (w.castingAbility === KNELLWYRM_STRAFE_RUN) ran = true;
      airborne = Math.max(airborne, w.pos.y - floorY(r));
    });
    expect(ran).toBe(true);
    expect(airborne).toBeGreaterThan(4);
    expect(victim.hp).toBeLessThan(before);
    expect(objects(r, KNELL_LANE_TEMPLATE).length).toBe(1);
    expect(objects(r, KNELL_LANE_MARK_TEMPLATE).length).toBe(0);
    // The lane burns while it stands; a player outside it is untouched.
    victim.hp = 1e6;
    const mid = {
      x: lane.x + Math.sin(lane.yaw) * lane.length * 0.5,
      z: lane.z + Math.cos(lane.yaw) * lane.length * 0.5,
    };
    put(r, victim, mid.x, mid.z);
    const burning = victim.hp;
    run(r, 2.1);
    expect(victim.hp).toBeLessThan(burning);
    expect(st.burned).toBe(true);
    run(r, KNELLWYRM_TUNING.laneSeconds);
    expect(objects(r, KNELL_LANE_TEMPLATE).length).toBe(0);
  });

  it('Dread Bellow throws the close back and bares its ribs', () => {
    const r = crypt(1);
    const w = wyrmIn(r);
    const close = r.others[0];
    put(r, close, w.pos.x - r.ox + 4, w.pos.z - r.oz);
    run(r, 0.1);
    w.castingAbility = null;
    expect(cryptDevTrigger(r.sim.ctx, r.inst, 'bellow')).toContain('Dread Bellow');
    expect(w.castingAbility).toBe(KNELLWYRM_DREAD_BELLOW);
    const before = close.hp;
    const d0 = Math.hypot(close.pos.x - w.pos.x, close.pos.z - w.pos.z);
    run(r, KNELLWYRM_TUNING.bellowCast + 0.1);
    expect(close.hp).toBeLessThan(before);
    expect(Math.hypot(close.pos.x - w.pos.x, close.pos.z - w.pos.z)).toBeGreaterThan(d0 + 3);
    const bared = w.auras.find((a) => a.id === KNELLWYRM_BARED_RIBS);
    expect(bared?.kind).toBe('vulnerability');
    expect(bared?.value).toBe(KNELLWYRM_TUNING.baredVuln);
  });

  it('its fall opens the exit by the altar and, with nobody burned, grants the deed', () => {
    const r = crypt(1);
    const w = wyrmIn(r);
    run(r, 1);
    r.sim.ctx.handleDeath(w, r.tank);
    run(r, 0.2);
    expect(r.inst.bossExitId).not.toBeNull();
    expect(r.sim.players.get(r.tank.id)?.deedsEarned.has(KNELLWYRM_DEED)).toBe(true);
  });

  it("keeps the drake kit and a modest purse; Morthen keeps the run's loot", () => {
    const t = MOBS[KNELLWYRM_ID];
    expect(t.breathCone?.range).toBe(MOBS.crypt_ossuary_drake.breathCone?.range);
    expect(t.breathCone?.arcDeg).toBe(MOBS.crypt_ossuary_drake.breathCone?.arcDeg);
    expect(t.trashKit?.tailLash).toBeDefined();
    expect(t.trashKit?.wingGust).toBeDefined();
    expect(t.ccImmune).toBe(true);
    expect(
      t.loot.every((l) => !l.itemId || ['bone_fragments', 'arcane_essence'].includes(l.itemId)),
    ).toBe(true);
    expect(MOBS.morthen.loot.some((l) => l.rollGroup === 'morthen_guaranteed_uncommon')).toBe(true);
  });

  it('the pure geometry: the flight in comes from the sky beyond the rim; lanes span the ring', () => {
    const a = wyrmArrivalPose(0);
    const b = wyrmArrivalPose(1);
    expect(Math.hypot(a.x - MORTHEN_SPOT.x, a.z - MORTHEN_SPOT.z)).toBeGreaterThan(
      RITE_RING.r + 50,
    );
    expect(a.up).toBeGreaterThan(40);
    expect(b.x).toBeCloseTo(MORTHEN_SPOT.x, 6);
    expect(b.z).toBeCloseTo(MORTHEN_SPOT.z, 6);
    expect(b.up).toBeCloseTo(0, 6);
    const lane = strafeLane(0, 212, 10, 200);
    expect(inStrafeLane(lane, 10, 200)).toBe(true);
    expect(lane.length).toBeGreaterThan(40);
  });
});
