// The Drakelands dragonkin brood (v0.35 rework): eggs, whelps, and the
// broodlord kit (src/sim/mob/dragonkin_brood.ts + the arcCleave/breathCone
// arms). Covers the crack -> hatch path, the broodCracked gate that keeps a
// FIAT-killed corpse inert (and the shared rng stream still), the chain ripple
// with its stagger, the proximity ambush, the pounce (burn + priority
// targeting + speed burst), the engage shout (root window, egg break radius,
// the one-hit ward, once per pull) plus the broodguard's bellow-only variant,
// the counter-stun trade, the every-Nth front-arc cleave with the out-of-arc
// negative case, and the fire-breath cone facing.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { respawnMob } from '../src/sim/mob/lifecycle';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { dist2d, type PlayerClass } from '../src/sim/types';
import { despawnMobs } from './sim_shared';

const SEED = 24601;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior' });
const ctxOf = (sim: Sim): SimContext => (sim as unknown as { ctx: SimContext }).ctx;

let nextTestId = 990001;
function spawn(sim: Sim, templateId: string, x: number, z: number, level = 20) {
  const p = sim.entities.get(sim.playerId)!;
  const mob = createMob(nextTestId++, MOBS[templateId], level, {
    x: p.pos.x + x,
    y: p.pos.y,
    z: p.pos.z + z,
  });
  (sim as any).addEntity(mob);
  return mob;
}

function whelpsOf(sim: Sim): any[] {
  return [...sim.entities.values()].filter(
    (e: any) => e.kind === 'mob' && e.templateId === 'dragonkin_whelp' && !e.dead,
  );
}

function tick(sim: Sim, n: number) {
  for (let i = 0; i < n; i++) sim.tick();
}

// Level a tester so their REAL pool survives elite swings: hand-inflated
// maxHp lies (any aura application recalcs the player and clamps it back).
function levelUp(sim: Sim, pid: number, cls: PlayerClass, level = 30) {
  const e = sim.entities.get(pid)!;
  const meta = (sim as any).players.get(pid);
  e.level = level;
  recalcPlayerStats(e, cls, meta.equipment, meta.talentMods, meta.equipmentInstance);
  e.hp = e.maxHp;
  return e;
}

describe('dragonkin brood content', () => {
  it('the brood templates carry their mechanic data', () => {
    // Pinned as LITERALS, because the geometry every behavior test below
    // stands on is exactly what drifted unnoticed once already: the first
    // tuning pass moved chainRadius 7 -> 5.5 and proximityRadius 3.5 -> 3 with
    // nothing red, leaving only the comments wrong.
    expect(MOBS.dragonkin_egg.broodEgg).toEqual({
      chainRadius: 5.5,
      chainDelay: 0.3,
      proximityRadius: 3,
      hatchMobId: 'dragonkin_whelp',
    });
    expect(MOBS.dragonkin_egg.xpMult).toBe(0);
    expect(MOBS.dragonkin_egg.hpBase).toBe(1);
    expect(MOBS.dragonkin_egg.hpPerLevel).toBe(0);
    expect(MOBS.dragonkin_whelp.broodWhelp).toBeDefined();
    // The broodguard's shout is a BELLOW and nothing else: a root window, no
    // break radius. A breakEggsRadius here would crack a clutch on every guard
    // pull, so the absence is content, not an omission.
    expect(MOBS.dragonkin_broodguard.engageShout).toEqual({ rootSeconds: 1.3 });
    const lord = MOBS.drakemaw_broodlord;
    expect(lord.engageShout?.breakEggsRadius).toBeGreaterThan(0);
    expect(lord.engageShout?.wardWhelps).toBeDefined();
    expect(lord.arcCleave?.every).toBe(5);
    expect(lord.arcCleave?.arcDeg).toBe(150);
    expect(lord.arcCleave?.range).toBe(8);
    expect(lord.breathCone).toBeDefined();
    expect(lord.counterStun).toEqual({ seconds: 2, cooldown: 25, name: 'Tail Hammer' });
    // the matriarch runs the same kit, scaled
    const maw = MOBS.cindraleth_maw_matriarch;
    expect(maw.engageShout?.breakEggsRadius).toBeGreaterThan(0);
    expect(maw.arcCleave).toBeDefined();
    expect(maw.breathCone).toBeDefined();
    expect(maw.counterStun).toBeDefined();
  });

  it('whelps are one-hit squishy and the broodlord carries no mount reins', () => {
    const whelp = createMob(1, MOBS.dragonkin_whelp, 20, { x: 0, y: 0, z: 0 });
    // A level-20 player's weakest swing clears ~50; the whelp must die to one.
    expect(whelp.maxHp).toBeLessThanOrEqual(50);
    // The raptor reins were pulled off this table (owner call, 2026-08-04): the
    // broodlord is the quest chain's own 90% emberwing_scale source, so a mount
    // lottery on it camps the Drakemaw belt. Its table keeps the coin and the
    // scale, and nothing else: a mount added back here reds this AND the
    // rarity-derived pin in mounts.test.ts.
    expect(MOBS.drakemaw_broodlord.loot.map((l) => l.itemId)).toEqual([
      undefined, // the guaranteed copper row
      'emberwing_scale',
    ]);
  });
});

describe('egg crack, hatch, and ripple', () => {
  it('killing an egg hatches a whelp at its spot (a summoned add)', () => {
    const sim = makeSim();
    const egg = spawn(sim, 'dragonkin_egg', 30, 0);
    (sim as any).dealDamage(null, egg, 1, false, 'physical', 'test', 'hit', true);
    expect(egg.dead).toBe(true);
    tick(sim, 1);
    const whelps = whelpsOf(sim);
    expect(whelps.length).toBe(1);
    expect(whelps[0].summonedAdd).toBe(true);
    expect(dist2d(whelps[0].pos, egg.pos)).toBeLessThan(1);
    // the shell corpse stays (no burst-despawn): the open egg IS the corpse
    expect(sim.entities.get(egg.id)).toBeDefined();
  });

  it('an egg FIAT-flagged dead stays inert; only a real death cracks it', () => {
    const sim = makeSim();
    const egg = spawn(sim, 'dragonkin_egg', 30, 0);
    // despawnMobs (tests/sim_shared.ts) is the silencing idiom the gather,
    // profession, and core sim suites all use: it writes dead/hp 0 straight
    // onto every mob and never goes near dealDamage, so handleDeath never runs
    // and broodCracked is never set. That is the whole reason for the gate.
    despawnMobs(sim);
    expect(egg.dead).toBe(true);
    expect(egg.broodCracked).toBeUndefined();
    tick(sim, 5);
    // Nothing hatched: not this egg, and not one of the shipped Drakelands
    // clutches despawnMobs just fiat-killed alongside it.
    expect(egg.broodHatched).toBeUndefined();
    expect(whelpsOf(sim).length).toBe(0);
    // The positive control, in the SAME silenced world: an egg that dies
    // through the REAL damage path still cracks and hatches, so the gate
    // discriminates rather than just switching hatching off.
    const real = spawn(sim, 'dragonkin_egg', 40, 0);
    (sim as any).dealDamage(null, real, 1, false, 'physical', 'test', 'hit', true);
    expect(real.broodCracked).toBe(true);
    tick(sim, 1);
    expect(whelpsOf(sim).length).toBe(1);
    // ...and exactly once: broodHatched keeps the corpse from re-hatching.
    tick(sim, 3);
    expect(whelpsOf(sim).length).toBe(1);
  });

  it('a world of fiat-killed eggs costs the shared rng stream nothing', () => {
    // Why the gate is load-bearing rather than tidy: a hatch draws the whelp's
    // level band, and the loose whelp then wanders on the shared stream. A
    // fiat-killed clutch hatching inside an unrelated suite would shift every
    // seeded roll downstream (the fix in 125a8db9a). Differential rather than
    // an absolute 0, so ambient world draws cancel instead of flaking.
    const drawsAfterSilencing = (withExtraEgg: boolean): number => {
      const sim = makeSim();
      if (withExtraEgg) spawn(sim, 'dragonkin_egg', 30, 0);
      despawnMobs(sim);
      let draws = 0;
      sim.rng.setObserver(() => draws++);
      try {
        tick(sim, 5);
      } finally {
        sim.rng.setObserver(null);
      }
      return draws;
    };
    expect(drawsAfterSilencing(true)).toBe(drawsAfterSilencing(false));
  });

  it('a break ripples to neighboring eggs on the chain stagger, never instantly', () => {
    const sim = makeSim();
    const a = spawn(sim, 'dragonkin_egg', 30, 0);
    const b = spawn(sim, 'dragonkin_egg', 35, 0); // 5yd: inside chainRadius 5.5
    const far = spawn(sim, 'dragonkin_egg', 50, 0); // 20yd: out of the chain
    (sim as any).dealDamage(null, a, 1, false, 'physical', 'test', 'hit', true);
    // Tick 1 hatches `a` and ARMS the ripple at +chainDelay (0.3s, 6 ticks).
    // 3 ticks in (0.15s) the neighbor must still be whole: this is the arm that
    // reds if the stagger is dropped and a clutch unzips inside one tick.
    tick(sim, 3);
    expect(b.broodChainAt).toBeDefined();
    expect(b.dead).toBe(false);
    // 5 more (0.4s total) carries past the stagger: now it cracks and clears.
    tick(sim, 5);
    expect(b.dead).toBe(true);
    expect(b.broodChainAt).toBeUndefined();
    tick(sim, 1); // the pass after the crack hatches its whelp
    expect(far.dead).toBe(false);
    expect(whelpsOf(sim).length).toBe(2);
  });

  it('a player walking onto an egg springs it', () => {
    const sim = makeSim();
    const egg = spawn(sim, 'dragonkin_egg', 2, 0); // 2yd: inside proximityRadius 3
    tick(sim, 2);
    expect(egg.dead).toBe(true);
    expect(whelpsOf(sim).length).toBe(1);
  });
});

describe('whelp pounce state dies with the pull', () => {
  /** A freshly hatched whelp mid-pounce: speed burst live, burn owed, cooldown
   *  armed, and warded by the shout that cracked its egg. */
  function pouncingWhelp() {
    const sim = makeSim();
    const egg = spawn(sim, 'dragonkin_egg', 6, 0);
    egg.broodWardOnHatch = MOBS.drakemaw_broodlord.engageShout!.wardWhelps;
    (sim as any).dealDamage(null, egg, 1, false, 'physical', 'test', 'hit', true);
    tick(sim, 1);
    const [whelp] = whelpsOf(sim);
    const def = MOBS.dragonkin_whelp;
    expect(whelp.leapUntil).toBeGreaterThan((sim as any).time);
    expect(whelp.leapBurnPending).toBe(true);
    expect(whelp.leapReadyAt).toBeGreaterThan((sim as any).time);
    expect(whelp.wardOneHit).toBe(true);
    expect(whelp.moveSpeed).toBeCloseTo(def.moveSpeed * def.broodWhelp!.leapSpeedMult);
    return { sim, whelp, def };
  }

  // The two resets are TWINS and drifted apart: resetEvadingMob cleared the five
  // broodlord fields but none of the four whelp ones, so a whelp that leashed
  // home kept leapBurnPending and made the NEXT pull's first landed swing pay a
  // pounce burn no pounce earned, while a stale leapReadyAt held that pull's
  // opening pounce. Both twins are asserted, so neither can drift again.
  for (const [label, reset] of [
    ['resetEvadingMob (leashes home)', (sim: Sim, m: any) => (sim as any).resetEvadingMob(m)],
    // respawnMob lives behind the SimContext seam, not on Sim (mob/lifecycle.ts).
    ['respawnMob (a fresh life)', (sim: Sim, m: any) => respawnMob(ctxOf(sim), m)],
  ] as const) {
    it(`${label} clears the whole pounce kit and restores the authored speed`, () => {
      const { sim, whelp, def } = pouncingWhelp();
      reset(sim, whelp);
      expect(whelp.leapUntil).toBeUndefined();
      expect(whelp.leapReadyAt).toBeUndefined();
      expect(whelp.leapBurnPending).toBeUndefined();
      expect(whelp.wardOneHit).toBeUndefined();
      // The ORDER matters, not just the clears: the brood pass only restores the
      // authored speed while leapUntil is still live, so a reset that cleared it
      // first would strand the whelp at burst speed for the rest of its life.
      expect(whelp.moveSpeed).toBeCloseTo(def.moveSpeed);
    });
  }
});

describe('whelp pounce', () => {
  it('the hatch pounce bursts speed, then the first landed swing burns and clears the debt', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const egg = spawn(sim, 'dragonkin_egg', 6, 0);
    (sim as any).dealDamage(null, egg, 1, false, 'physical', 'test', 'hit', true);
    tick(sim, 1);
    const [whelp] = whelpsOf(sim);
    expect(whelp).toBeDefined();
    expect(whelp.aggroTargetId).toBe(player.id);
    expect(whelp.leapBurnPending).toBe(true);
    const def = MOBS.dragonkin_whelp;
    expect(whelp.moveSpeed).toBeCloseTo(def.moveSpeed * def.broodWhelp!.leapSpeedMult);
    // land the pounce: swing until the hit table connects
    for (let i = 0; i < 60 && whelp.leapBurnPending; i++) (sim as any).mobSwing(whelp, player);
    expect(whelp.leapBurnPending).toBe(false);
    const burn = player.auras.find((a) => a.name === 'Hatchling Burn');
    expect(burn?.kind).toBe('dot');
    expect(burn?.school).toBe('fire');
    // the burst expires back to authored speed
    tick(sim, Math.ceil(def.broodWhelp!.leapSeconds * 20) + 2);
    expect(whelp.moveSpeed).toBeCloseTo(def.moveSpeed);
  });

  it('the pounce duration derives from the launch distance and a loose whelp re-pounces off cooldown', () => {
    const sim = makeSim();
    const player = levelUp(sim, sim.playerId, 'warrior');
    const egg = spawn(sim, 'dragonkin_egg', 6, 0);
    (sim as any).dealDamage(null, egg, 1, false, 'physical', 'test', 'hit', true);
    tick(sim, 1);
    const [whelp] = whelpsOf(sim);
    const def = MOBS.dragonkin_whelp.broodWhelp!;
    const speed = MOBS.dragonkin_whelp.moveSpeed * def.leapSpeedMult;
    // 6yd at ~26 yd/s clamps to the minimum hop, far under the cap
    const firstLeap = whelp.leapUntil! - (sim as any).time;
    expect(firstLeap).toBeGreaterThan(0);
    expect(firstLeap).toBeLessThan(def.leapSeconds);
    // the cooldown armed alongside the launch
    expect(whelp.leapReadyAt! - (sim as any).time).toBeCloseTo(8, 0);
    // let the burst expire and the speed restore
    tick(sim, Math.ceil(def.leapSeconds * 20) + 2);
    expect(whelp.leapUntil).toBeUndefined();
    expect(whelp.moveSpeed).toBeCloseTo(MOBS.dragonkin_whelp.moveSpeed);
    // park the victim inside the leap window and clear the cooldown: the
    // loose whelp launches the jump attack again, owing a fresh burn
    player.pos = { x: whelp.pos.x + 15, y: player.pos.y, z: whelp.pos.z };
    whelp.leapBurnPending = false;
    whelp.leapReadyAt = 0;
    tick(sim, 1);
    expect(whelp.leapUntil).toBeDefined();
    expect(whelp.leapBurnPending).toBe(true);
    expect(whelp.moveSpeed).toBeCloseTo(speed);
    // ~15yd at ~26 yd/s: a real calculated leap, longer than the minimum hop
    const releap = whelp.leapUntil! - (sim as any).time;
    expect(releap).toBeGreaterThan(0.4);
    expect(releap).toBeLessThanOrEqual(def.leapSeconds);
  });

  it('the hatch prefers a healer over a closer non-healer', () => {
    const sim = makeSim();
    const healerPid = sim.addPlayer('priest', 'Mendy');
    const healer = sim.entities.get(healerPid)!;
    const tank = sim.entities.get(sim.playerId)!;
    const meta = (sim as any).players.get(healerPid);
    meta.talentMods.role = 'healer';
    // healer farther (12yd) than the tank (6yd), both inside hatch range
    healer.pos = { x: tank.pos.x + 12, y: tank.pos.y, z: tank.pos.z };
    const egg = spawn(sim, 'dragonkin_egg', 6, 0);
    (sim as any).dealDamage(null, egg, 1, false, 'physical', 'test', 'hit', true);
    tick(sim, 1);
    const [whelp] = whelpsOf(sim);
    expect(whelp.aggroTargetId).toBe(healer.id);
  });

  it('with no healer up, the hatch still takes the dps over a CLOSER tank', () => {
    const sim = makeSim();
    const tank = sim.entities.get(sim.playerId)!;
    (sim as any).players.get(sim.playerId).talentMods.role = 'tank';
    const dpsPid = sim.addPlayer('mage', 'Blast');
    const dps = sim.entities.get(dpsPid)!;
    (sim as any).players.get(dpsPid).talentMods.role = 'dps';
    // dps farther from the egg (8yd) than the tank (6yd), both inside hatch
    // range: the middle band has to beat distance, or only a lone tank is safe.
    dps.pos = { x: tank.pos.x + 14, y: tank.pos.y, z: tank.pos.z };
    const egg = spawn(sim, 'dragonkin_egg', 6, 0);
    (sim as any).dealDamage(null, egg, 1, false, 'physical', 'test', 'hit', true);
    tick(sim, 1);
    const [whelp] = whelpsOf(sim);
    expect(whelp.aggroTargetId).toBe(dps.id);
  });
});

describe('broodlord kit', () => {
  it('the engage shout roots the lord, cracks the clutch, and wards the hatchlings for exactly one hit', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    // lord inside aggro range (20), eggs ringed around it inside the 26yd break radius
    const lord = spawn(sim, 'drakemaw_broodlord', 15, 0);
    const egg = spawn(sim, 'dragonkin_egg', 20, 0);
    const posAtShout = { ...lord.pos };
    tick(sim, 3); // aggro + shout fires
    expect(lord.shoutFired).toBe(true);
    expect(egg.dead).toBe(true); // the shout cracked it
    // rooted for the shout window: the lord has not advanced
    expect(dist2d(lord.pos, posAtShout)).toBeLessThan(0.01);
    tick(sim, 1); // hatch pass
    const [whelp] = whelpsOf(sim);
    expect(whelp).toBeDefined();
    const ward = whelp.auras.find((a: any) => a.id === 'brood_ward');
    expect(ward).toBeDefined();
    expect(whelp.wardOneHit).toBe(true);
    // first hit: fully absorbed
    const hpBefore = whelp.hp;
    (sim as any).dealDamage(player, whelp, 25, false, 'physical', 'test', 'hit', true);
    expect(whelp.hp).toBe(hpBefore);
    tick(sim, 1); // the strip pass shatters the soaked ward
    expect(whelp.auras.some((a: any) => a.id === 'brood_ward')).toBe(false);
    // second hit: kills the squishy hatchling outright
    (sim as any).dealDamage(player, whelp, 60, false, 'physical', 'test', 'hit', true);
    expect(whelp.dead).toBe(true);
    // after the root window the lord closes on the player
    tick(sim, Math.ceil((MOBS.drakemaw_broodlord.engageShout!.rootSeconds + 0.5) * 20));
    expect(dist2d(lord.pos, posAtShout)).toBeGreaterThan(0.5);
  });

  it('the shout fires once per pull: an egg laid after it sleeps through the fight', () => {
    const sim = makeSim();
    // Level-1 tester on purpose: aggro range is level-scaled (a level-30
    // player shrinks a level-20 lord's 20yd to 5), so levelling here would
    // mean the lord never pulls at all.
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const lord = spawn(sim, 'drakemaw_broodlord', 15, 0);
    tick(sim, 3); // aggro + the one shout
    expect(lord.shoutFired).toBe(true);
    // A whole egg placed INSIDE the break radius AFTER the shout: the shout is
    // spent for this pull, so the engaged arm must not run it a second time.
    const late = spawn(sim, 'dragonkin_egg', 15, 6);
    expect(dist2d(late.pos, lord.pos)).toBeLessThan(
      MOBS.drakemaw_broodlord.engageShout!.breakEggsRadius!,
    );
    let reShouts = 0;
    for (let i = 0; i < 20; i++) {
      player.hp = player.maxHp;
      for (const ev of sim.tick()) {
        if (ev.type === 'spellfx' && ev.fx === 'shout' && ev.sourceId === lord.id) reShouts++;
      }
    }
    expect(reShouts).toBe(0);
    expect(late.dead).toBe(false);
    expect(late.broodWardOnHatch).toBeUndefined();
    expect(whelpsOf(sim).length).toBe(0);
  });

  it("the broodguard's shout roots it too, and cracks nothing (no break radius)", () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    // aggroRadius 14, so a level-1 tester at 12yd pulls it; egg at its feet
    const guard = spawn(sim, 'dragonkin_broodguard', 12, 0);
    const egg = spawn(sim, 'dragonkin_egg', 12, 2);
    for (let i = 0; i < 20 && !guard.shoutFired; i++) tick(sim, 1);
    expect(guard.shoutFired).toBe(true);
    const posAtShout = { ...guard.pos };
    // rooted: 1.0s into the 1.3s window it has not advanced a step
    for (let i = 0; i < 20; i++) {
      player.hp = player.maxHp;
      tick(sim, 1);
    }
    expect(dist2d(guard.pos, posAtShout)).toBeLessThan(0.01);
    // The guard's shout carries NO breakEggsRadius, so the clutch sleeps
    // through it. Dropping dragonkinEngageShout's `if (!shout.breakEggsRadius)
    // return` makes the radius test compare against undefined (NaN, never
    // greater), which would crack every egg alive on any broodguard pull.
    expect(egg.dead).toBe(false);
    expect(egg.broodWardOnHatch).toBeUndefined();
    expect(whelpsOf(sim).length).toBe(0);
    // past the window it comes on
    for (let i = 0; i < 20; i++) {
      player.hp = player.maxHp;
      tick(sim, 1);
    }
    expect(dist2d(guard.pos, posAtShout)).toBeGreaterThan(0.5);
  });

  it('a player stun is answered with the counter-stun, once per cooldown', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const lord = spawn(sim, 'drakemaw_broodlord', 300, 0); // far: no aggro/shout noise
    (sim as any).applyAura(lord, {
      id: 'test_stun',
      name: 'Pin',
      kind: 'stun',
      remaining: 3,
      duration: 3,
      value: 0,
      sourceId: player.id,
      school: 'physical',
    });
    tick(sim, 1);
    const counter = player.auras.find((a) => a.id === 'brood_counter_stun');
    expect(counter?.kind).toBe('stun');
    expect(counter?.sourceId).toBe(lord.id);
    // The LITERAL 2s authored in drakelands.ts, not the template field this
    // code copies into `remaining`: a self-comparison passes at any duration.
    expect(counter?.remaining).toBeCloseTo(2, 1);
    expect(counter?.name).toBe('Tail Hammer');
    // the lord is still stunned itself: the trade landed both ways
    expect(lord.auras.some((a: any) => a.kind === 'stun')).toBe(true);
    // a second stun inside the cooldown is NOT answered again
    player.auras.splice(player.auras.indexOf(counter!), 1);
    (sim as any).applyAura(lord, {
      id: 'test_stun_2',
      name: 'Pin',
      kind: 'stun',
      remaining: 3,
      duration: 3,
      value: 0,
      sourceId: player.id,
      school: 'physical',
    });
    tick(sim, 1);
    expect(player.auras.some((a) => a.id === 'brood_counter_stun')).toBe(false);
  });

  it('every 5th landed swing cleaves the front arc and burns everyone struck', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 50000;
    player.hp = 50000;
    const buddyPid = sim.addPlayer('mage', 'Zap');
    const buddy = sim.entities.get(buddyPid)!;
    buddy.maxHp = 50000;
    buddy.hp = 50000;
    const flankPid = sim.addPlayer('rogue', 'Edge');
    const flank = sim.entities.get(flankPid)!;
    flank.maxHp = 50000;
    flank.hp = 50000;
    const lord = spawn(sim, 'drakemaw_broodlord', 300, 0);
    // stand two players down the lord's facing: the primary at melee reach,
    // the buddy just past them, inside arcCleave range 8 and the 150deg arc
    lord.facing = 0.7;
    player.pos = {
      x: lord.pos.x + Math.sin(lord.facing) * 3,
      y: lord.pos.y,
      z: lord.pos.z + Math.cos(lord.facing) * 3,
    };
    buddy.pos = {
      x: lord.pos.x + Math.sin(lord.facing) * 4.5,
      y: lord.pos.y,
      z: lord.pos.z + Math.cos(lord.facing) * 4.5,
    };
    // ...and the third square on the lord's flank: comfortably INSIDE range 8,
    // 90deg off the facing, so the 150deg arc (halfArc 75deg) is the only
    // thing that can spare them. Any widening past 180deg sweeps them in.
    const flankAngle = lord.facing + Math.PI / 2;
    flank.pos = {
      x: lord.pos.x + Math.sin(flankAngle) * 4,
      y: lord.pos.y,
      z: lord.pos.z + Math.cos(flankAngle) * 4,
    };
    expect(dist2d(flank.pos, lord.pos)).toBeLessThan(8);
    let landed = 0;
    let cleaved = false;
    for (let i = 0; i < 200 && !cleaved; i++) {
      const before = lord.swingCleaveCount ?? 0;
      (sim as any).mobSwing(lord, player);
      const after = lord.swingCleaveCount ?? 0;
      if (after !== before) landed++;
      if (after === 0 && before === 4) cleaved = true; // 5th landed swing fired the cleave
    }
    expect(cleaved).toBe(true);
    expect(landed).toBe(5);
    expect(lord.swingCleaveCount).toBe(0);
    // The cleave DEALT damage to the off-target (pinned via the event stream,
    // not hp deltas: any aura application recalcs a player and clamps a
    // hand-inflated pool, so hp arithmetic lies here).
    const cleaveHit = (sim as any).events.find(
      (ev: any) => ev.type === 'damage' && ev.targetId === buddy.id && ev.amount > 0,
    );
    expect(cleaveHit).toBeDefined();
    expect(buddy.auras.some((a) => a.name === 'Seared Scales')).toBe(true);
    expect(player.auras.some((a) => a.name === 'Seared Scales')).toBe(true);
    // The NEGATIVE arc arm: the flanker stood inside the cleave's range the
    // whole time and took nothing, so this really is a 150deg front arc and
    // not a radius. (No tick runs in this test, so sim.events is the full log.)
    expect(
      (sim as any).events.some((ev: any) => ev.type === 'damage' && ev.targetId === flank.id),
    ).toBe(false);
    expect(flank.auras.some((a) => a.name === 'Seared Scales')).toBe(false);
  });

  it('the fire breath lands in the facing cone and spares a player behind the lord', () => {
    const sim = makeSim();
    const player = levelUp(sim, sim.playerId, 'warrior');
    const backPid = sim.addPlayer('mage', 'Sneak');
    const back = levelUp(sim, backPid, 'mage');
    const lord = spawn(sim, 'drakemaw_broodlord', 4, 0);
    // park the second player squarely BEHIND the lord relative to the player
    const away = Math.atan2(lord.pos.x - player.pos.x, lord.pos.z - player.pos.z);
    back.pos = {
      x: lord.pos.x + Math.sin(away) * 5,
      y: lord.pos.y,
      z: lord.pos.z + Math.cos(away) * 5,
    };
    const breath = MOBS.drakemaw_broodlord.breathCone!;
    // Ride real ticks well past shout + cadence + cast (melee contact keeps
    // the mechanics tail running). A level-1 tester dies to the elite long
    // before the 14s cadence, and any aura application recalcs the player
    // (clamping hand-inflated pools back to the real level-1 99), so keep
    // both players alive by topping the REAL pool up every tick instead.
    //
    // WHO the breath hit is read off its own ability-tagged damage events, not
    // off 'Seared Scales': the every-5th front-arc cleave refreshes that same
    // debuff name (one shared row, by design), and the lord is in melee here,
    // so the burn alone cannot tell the cone from a cleave.
    const breathHits: number[] = [];
    for (let i = 0; i < Math.ceil((breath.every + breath.castTime + 6) * 20); i++) {
      player.hp = player.maxHp;
      back.hp = back.maxHp;
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && ev.ability === 'Fire Breath') breathHits.push(ev.targetId);
      }
      if (breathHits.length > 0) break;
    }
    // the cone landed on the player in front and on nobody else
    expect(breathHits).toEqual([player.id]);
    expect(player.auras.some((a) => a.name === 'Seared Scales')).toBe(true);
    expect(back.auras.some((a) => a.name === 'Seared Scales')).toBe(false);
  });
});
