// The Drakelands dragonkin brood (v0.35 rework): eggs, whelps, and the
// broodlord kit (src/sim/mob/dragonkin_brood.ts + the arcCleave/breathCone
// arms). Covers the crack -> hatch path, the chain ripple, the proximity
// ambush, the pounce (burn + priority targeting + speed burst), the engage
// shout (root window, egg break radius, the one-hit ward), the counter-stun
// trade, the every-Nth front-arc cleave, and the fire-breath cone facing.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { dist2d, type PlayerClass } from '../src/sim/types';

const SEED = 24601;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior' });

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
    expect(MOBS.dragonkin_egg.broodEgg).toBeDefined();
    expect(MOBS.dragonkin_egg.xpMult).toBe(0);
    expect(MOBS.dragonkin_egg.hpBase).toBe(1);
    expect(MOBS.dragonkin_egg.hpPerLevel).toBe(0);
    expect(MOBS.dragonkin_whelp.broodWhelp).toBeDefined();
    expect(MOBS.dragonkin_broodguard.engageShout).toBeDefined();
    const lord = MOBS.drakemaw_broodlord;
    expect(lord.engageShout?.breakEggsRadius).toBeGreaterThan(0);
    expect(lord.engageShout?.wardWhelps).toBeDefined();
    expect(lord.arcCleave?.every).toBe(5);
    expect(lord.breathCone).toBeDefined();
    expect(lord.counterStun).toBeDefined();
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

  it('a break ripples to neighboring eggs on the chain stagger', () => {
    const sim = makeSim();
    const a = spawn(sim, 'dragonkin_egg', 30, 0);
    const b = spawn(sim, 'dragonkin_egg', 35, 0); // 5yd: inside chainRadius 7
    const far = spawn(sim, 'dragonkin_egg', 50, 0); // 20yd: out of the chain
    (sim as any).dealDamage(null, a, 1, false, 'physical', 'test', 'hit', true);
    // chainDelay 0.3s = 6 ticks, plus the hatch/crack pass ticks
    tick(sim, 12);
    expect(b.dead).toBe(true);
    expect(far.dead).toBe(false);
    expect(whelpsOf(sim).length).toBe(2);
  });

  it('a player walking onto an egg springs it', () => {
    const sim = makeSim();
    const egg = spawn(sim, 'dragonkin_egg', 2, 0); // inside proximityRadius 3.5
    tick(sim, 2);
    expect(egg.dead).toBe(true);
    expect(whelpsOf(sim).length).toBe(1);
  });
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
    expect(counter?.remaining).toBeCloseTo(MOBS.drakemaw_broodlord.counterStun!.seconds, 1);
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
    const lord = spawn(sim, 'drakemaw_broodlord', 300, 0);
    // stand both players down the lord's facing: the primary at melee reach,
    // the buddy just past them, inside arcCleave range 6 and the 150deg arc
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
    let breathLanded = false;
    for (let i = 0; i < Math.ceil((breath.every + breath.castTime + 6) * 20); i++) {
      player.hp = player.maxHp;
      back.hp = back.maxHp;
      const evs = sim.tick();
      if (evs.some((ev) => ev.type === 'log' && ev.text.includes('Fire Breath')))
        breathLanded = true;
      if (breathLanded) break;
    }
    expect(breathLanded).toBe(true);
    expect(player.auras.some((a) => a.name === 'Seared Scales')).toBe(true);
    expect(back.auras.some((a) => a.name === 'Seared Scales')).toBe(false);
  });
});
