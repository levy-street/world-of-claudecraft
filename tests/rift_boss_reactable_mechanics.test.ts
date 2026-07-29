// Rift boss reactable mechanics (player feedback, 2026-08-04): the spacing lock
// (mob/mechanic_spacing.ts) stopped two mechanics FIRING the same instant, but
// three ungoverned layers still made rift boss fights read as unreactable:
//
// 1. Instant AoE mechanics (stomp, aoePulse) had NO tell: their nova landed the
//    same tick as the damage, and a stomp could land the same instant as an
//    auto-attack (the "double hit with no tell" report on Warlord Grask). On a
//    rift-stamped boss they now WIND UP: a ground runeCircle telegraph at the
//    true blast radius, then the damage after RIFT_MECHANIC_WINDUP_SEC, and the
//    detonation pushes the next auto out by RIFT_POST_MECHANIC_SWING_GAP_SEC.
// 2. The anti-kite snare (aoeSlow) and the on-hit control procs (ensnare root,
//    knockback, dread, stunOnHit, concuss) fired legally DURING a death-zone or
//    hardcast telegraph, eating the escape window (Broodmother's Clinging Silk
//    made an S-rank Venom Pool mathematically inescapable). The snare now holds
//    at due while a telegraph is in flight, and the control procs still DRAW
//    their rng roll (parity draw-order stability) but skip their effect inside
//    an escape window.
// 3. A death zone's fuse assumed an unimpaired runner (speed 7). The fuse now
//    scales per anchor by their live movement impairment, capped at
//    RIFT_IMPAIRED_FUSE_CAP, so a slowed or rooted anchor always has a real
//    escape window.
// 4. Warlord Grask's Sweeping Arc hit 360 degrees around the tank, so melee
//    could never play the fight. On a rift-stamped boss the cleave is now a
//    FRONTAL arc (the Nythraxis Gravebreaker precedent); world and dungeon
//    cleave carriers keep their shipped radial splash (mob_cleave.test.ts).
//
// Every behavior here is scoped by the rift spawn stamp (riftMechanicSpacing):
// world, dungeon, and raid bosses keep their shipped instant mechanics
// (mob_warstomp.test.ts pins Korgath's instant Shuddering Stomp).
import { describe, expect, it } from 'vitest';
import { RIFT_BOSS_IDS } from '../src/sim/content/rift/mobs';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { RIFT_MECHANIC_SPACING_SEC } from '../src/sim/mob/mechanic_spacing';
import {
  RIFT_CLEAVE_HALF_ARC,
  RIFT_IMPAIRED_FUSE_CAP,
  RIFT_MECHANIC_WINDUP_SEC,
  RIFT_POST_MECHANIC_SWING_GAP_SEC,
} from '../src/sim/mob/rift_escape_window';
import { Sim } from '../src/sim/sim';
import { addThreat } from '../src/sim/threat';
import { DT, dist2d, type Entity, type SimEvent } from '../src/sim/types';

const SPACING = RIFT_MECHANIC_SPACING_SEC;
const WINDUP = RIFT_MECHANIC_WINDUP_SEC;

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

const stunAura = (e: Entity) => e.auras.find((a) => a.id === 'stomp_stun');
const slowAura = (e: Entity) => e.auras.find((a) => a.id === 'aoe_slow');

// Engage a hand-built rift boss on the test player (the mob_mechanic_spacing
// fixture): sat on the player so it is in radius with no leash concerns, threat
// pinned, plus a bystander for splash/CC assertions.
function engagedBoss(sim: Sim, templateId: string): { mob: Entity; off: Entity } {
  sim.player.level = 20;
  const mob = createMob(920300, MOBS[templateId], 22, { ...sim.player.pos });
  mob.spawnPos = { ...sim.player.pos };
  mob.aiState = 'attack';
  mob.aggroTargetId = sim.playerId;
  mob.inCombat = true;
  addThreat(mob, sim.playerId, 1000);
  (sim as any).addEntity(mob);
  const offId = sim.addPlayer('warrior', 'Bystander', { autoEquip: true });
  const off = sim.entities.get(offId)!;
  off.level = 20;
  off.pos = { ...mob.pos };
  sim.player.maxHp = 5000;
  sim.player.hp = 5000;
  off.maxHp = 5000;
  off.hp = 5000;
  return { mob, off };
}

function holdInRadius(sim: Sim, mob: Entity, off: Entity): void {
  sim.player.hp = sim.player.maxHp;
  off.hp = off.maxHp;
  off.pos = { ...mob.pos };
}

function captureEvents(sim: Sim): SimEvent[] {
  const events: SimEvent[] = [];
  const origEmit = (sim as any).emit.bind(sim);
  (sim as any).emit = (ev: SimEvent) => {
    events.push(ev);
    return origEmit(ev);
  };
  return events;
}

// Enter a real floor-0 rift (rank C at baseLevel 20), clear its generated mobs,
// and hand-place a stamped boss of the given template on the player inside the
// instance (its id joined to inst.mobIds so the death-zone driver finds it).
function enterRiftWithBoss(templateId: string): { sim: Sim; mob: Entity } {
  const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: true, devCommands: true });
  sim.enterRift(3, 20, sim.player.id);
  const inst = sim.riftInstances.find((i) => i.partyKey !== null)!;
  for (const id of inst.mobIds) {
    const e = sim.entities.get(id);
    if (e) {
      e.hp = 0;
      e.dead = true;
    }
  }
  sim.player.gm = true; // survive swings and zone detonations; auras still apply
  const mob = createMob(920400, MOBS[templateId], 22, { ...sim.player.pos });
  mob.spawnPos = { ...sim.player.pos };
  mob.aiState = 'attack';
  mob.aggroTargetId = sim.playerId;
  mob.inCombat = true;
  mob.riftMechanicSpacing = SPACING;
  addThreat(mob, sim.playerId, 1000);
  // Park every OTHER governed mechanic far in the future so only the mechanic
  // a test arms can fire (pulse/bigCast otherwise come due on the first tick
  // and their windup lock would hold the mechanic under test).
  mob.pulseTimer = 999;
  mob.bigCastTimer = 999;
  mob.stompTimer = 999;
  mob.terrifyTimer = 999;
  mob.deathZoneCastTimer = 999;
  mob.deathZoneStrikeTimer = 999;
  (sim as any).addEntity(mob);
  inst.mobIds.push(mob.id);
  return { sim, mob };
}

describe('rift boss instant mechanics wind up', () => {
  it('a stamped stomp telegraphs first: no damage or stun on the fire tick', () => {
    const sim = makeSim();
    const { mob, off } = engagedBoss(sim, 'rift_boss_brute');
    mob.riftMechanicSpacing = SPACING;
    const stomp = MOBS.rift_boss_brute.stomp!;
    const events = captureEvents(sim);
    mob.stompTimer = 0.001;
    (sim as any).updateMob(mob);

    expect(stunAura(off)).toBeUndefined();
    expect(
      (events as any[]).find((e) => e.type === 'damage' && e.ability === stomp.name),
    ).toBeUndefined();
    // The tell: a ground circle at the true blast radius for the windup length.
    const ring = (events as any[]).find(
      (e) => e.type === 'spellfxAt' && e.fx === 'runeCircle' && e.radius === stomp.radius,
    );
    expect(ring).toBeDefined();
  });

  it('the stomp lands damage + stun after the windup and pushes the next auto out', () => {
    const sim = makeSim();
    const { mob, off } = engagedBoss(sim, 'rift_boss_brute');
    mob.riftMechanicSpacing = SPACING;
    const stomp = MOBS.rift_boss_brute.stomp!;
    const events = captureEvents(sim);
    mob.stompTimer = 0.001;
    (sim as any).updateMob(mob); // windup starts
    let ticks = 0;
    while (!stunAura(off) && ticks < Math.ceil((WINDUP + 1) / DT)) {
      holdInRadius(sim, mob, off);
      (sim as any).updateMob(mob);
      ticks++;
    }
    expect(stunAura(off)).toBeDefined();
    // Detonation at the authored windup, within a tick of slack.
    expect(ticks * DT).toBeGreaterThanOrEqual(WINDUP - 2 * DT);
    expect(ticks * DT).toBeLessThanOrEqual(WINDUP + 2 * DT);
    const hit = (events as any[]).find((e) => e.type === 'damage' && e.ability === stomp.name);
    expect(hit).toBeDefined();
    expect(hit.amount).toBeGreaterThan(0);
    // No same-instant auto on top of the blast: the swing is pushed out.
    expect(mob.swingTimer).toBeGreaterThanOrEqual(RIFT_POST_MECHANIC_SWING_GAP_SEC - DT);
  });

  it('an unstamped boss stomp stays instant (world/dungeon bosses unchanged)', () => {
    const sim = makeSim();
    const { mob, off } = engagedBoss(sim, 'rift_boss_brute');
    // no riftMechanicSpacing stamp
    mob.stompTimer = 0.001;
    (sim as any).updateMob(mob);
    expect(stunAura(off)).toBeDefined();
  });

  it('a stamped aoePulse telegraphs, then detonates after the windup', () => {
    const sim = makeSim();
    const { mob, off } = engagedBoss(sim, 'rift_boss_ember');
    mob.riftMechanicSpacing = SPACING;
    const pulse = MOBS.rift_boss_ember.aoePulse!;
    const events = captureEvents(sim);
    mob.pulseTimer = 0.001;
    (sim as any).updateMob(mob);

    expect(
      (events as any[]).find((e) => e.type === 'damage' && e.ability === pulse.name),
    ).toBeUndefined();
    expect(
      (events as any[]).find(
        (e) => e.type === 'spellfxAt' && e.fx === 'runeCircle' && e.radius === pulse.radius,
      ),
    ).toBeDefined();

    let ticks = 0;
    let hit: any;
    while (!hit && ticks < Math.ceil((WINDUP + 1) / DT)) {
      holdInRadius(sim, mob, off);
      (sim as any).updateMob(mob);
      hit = (events as any[]).find((e) => e.type === 'damage' && e.ability === pulse.name);
      ticks++;
    }
    expect(hit).toBeDefined();
    expect(hit.amount).toBeGreaterThan(0);
  });

  it('is deterministic: the same seed detonates the windup on the same tick', () => {
    const detonationTick = (): number => {
      const sim = makeSim(1234);
      const { mob, off } = engagedBoss(sim, 'rift_boss_brute');
      mob.riftMechanicSpacing = SPACING;
      mob.stompTimer = 0.001;
      (sim as any).updateMob(mob);
      let ticks = 0;
      while (!stunAura(off) && ticks < 10 / DT) {
        holdInRadius(sim, mob, off);
        (sim as any).updateMob(mob);
        ticks++;
      }
      return ticks;
    };
    expect(detonationTick()).toBe(detonationTick());
  });
});

describe('the anti-kite snare respects telegraph escape windows', () => {
  it('holds at due while a death-zone telegraph is in flight, fires after it clears', () => {
    const { sim, mob } = enterRiftWithBoss('rift_boss_venom');
    const zone = MOBS.rift_boss_venom.deathZoneCast!;
    mob.swingTimer = 999; // no swings: keep the on-hit procs out of this test
    mob.aoeSlowTimer = 999;
    mob.deathZoneCastTimer = 0.001;
    sim.tick();
    expect(mob.castingAbility).toBe(zone.castId); // telegraph in flight

    mob.aoeSlowTimer = 0.001; // snare due mid-telegraph
    const castTicks = Math.ceil((zone.castTime + 0.5) / DT);
    let sawSlowDuringCast = false;
    for (let i = 0; i < castTicks; i++) {
      mob.swingTimer = 999;
      sim.player.hp = sim.player.maxHp;
      sim.tick();
      if (mob.castingAbility !== null && slowAura(sim.player)) sawSlowDuringCast = true;
    }
    expect(sawSlowDuringCast).toBe(false);
    // The window is over (cast done, zone detonated): the held snare now fires.
    let ticks = 0;
    while (!slowAura(sim.player) && ticks < 5 / DT) {
      mob.swingTimer = 999;
      sim.player.hp = sim.player.maxHp;
      sim.tick();
      ticks++;
    }
    expect(slowAura(sim.player)).toBeDefined();
  });

  it('keeps its free cadence when no telegraph is in flight (kiters still get snared)', () => {
    const { sim, mob } = enterRiftWithBoss('rift_boss_venom');
    mob.swingTimer = 999;
    mob.deathZoneCastTimer = 999;
    mob.deathZoneStrikeTimer = 999;
    mob.aoeSlowTimer = 0.001;
    sim.tick();
    expect(slowAura(sim.player)).toBeDefined();
  });
});

describe('death-zone fuses scale with the anchor movement impairment', () => {
  function spawnZoneAndCaptureFuse(impair: 'none' | 'slow' | 'root'): number {
    const { sim, mob } = enterRiftWithBoss('rift_boss_venom');
    mob.swingTimer = 999;
    mob.aoeSlowTimer = 999; // the boss's own silk must not contaminate the fuse
    if (impair === 'slow') {
      sim.player.auras.push({
        id: 'test_slow',
        name: 'Test Slow',
        kind: 'slow',
        remaining: 30,
        duration: 30,
        value: 0.5,
        sourceId: mob.id,
        school: 'nature',
      });
    } else if (impair === 'root') {
      sim.player.auras.push({
        id: 'test_root',
        name: 'Test Root',
        kind: 'root',
        remaining: 30,
        duration: 30,
        value: 0,
        sourceId: mob.id,
        school: 'nature',
      });
    }
    const events = captureEvents(sim);
    mob.deathZoneCastTimer = 0.001;
    sim.tick();
    const spawn = (events as any[]).find((e) => e.type === 'riftDeathZoneSpawn');
    expect(spawn).toBeDefined();
    return spawn.durationSecs as number;
  }

  it('an unimpaired anchor keeps the authored fuse', () => {
    const zone = MOBS.rift_boss_venom.deathZoneCast!;
    expect(spawnZoneAndCaptureFuse('none')).toBeCloseTo(zone.castTime, 5);
  });

  it('a 50% slowed anchor gets a doubled fuse (capped)', () => {
    const zone = MOBS.rift_boss_venom.deathZoneCast!;
    expect(spawnZoneAndCaptureFuse('slow')).toBeCloseTo(zone.castTime * RIFT_IMPAIRED_FUSE_CAP, 5);
  });

  it('a rooted anchor gets the full fuse cap', () => {
    const zone = MOBS.rift_boss_venom.deathZoneCast!;
    expect(spawnZoneAndCaptureFuse('root')).toBeCloseTo(zone.castTime * RIFT_IMPAIRED_FUSE_CAP, 5);
  });
});

describe('on-hit control procs respect escape windows', () => {
  it('the web root skips its effect while a telegraph is in flight', () => {
    const sim = makeSim(7);
    const { mob } = engagedBoss(sim, 'rift_boss_venom');
    mob.riftMechanicSpacing = SPACING;
    // A telegraph window held open (the wall-clock deadline the drivers stamp).
    mob.escapeWindowUntil = 1e9;
    for (let i = 0; i < 80; i++) {
      sim.player.hp = sim.player.maxHp;
      (sim as any).mobSwing(mob, sim.player);
    }
    expect(sim.player.auras.find((a) => a.id === 'ensnare_rift_boss_venom')).toBeUndefined();
  });

  it('the web root still lands outside a telegraph (same seed control)', () => {
    const sim = makeSim(7);
    const { mob } = engagedBoss(sim, 'rift_boss_venom');
    mob.riftMechanicSpacing = SPACING; // stamped, but no telegraph in flight
    let rooted = false;
    for (let i = 0; i < 80 && !rooted; i++) {
      sim.player.hp = sim.player.maxHp;
      (sim as any).mobSwing(mob, sim.player);
      rooted = sim.player.auras.some((a) => a.id === 'ensnare_rift_boss_venom');
    }
    expect(rooted).toBe(true);
  });

  it('the knockback skips its shove while a telegraph is in flight', () => {
    const sim = makeSim(11);
    const { mob } = engagedBoss(sim, 'rift_boss_pitlord');
    mob.riftMechanicSpacing = SPACING;
    mob.escapeWindowUntil = 1e9;
    const start = { ...sim.player.pos };
    for (let i = 0; i < 80; i++) {
      sim.player.hp = sim.player.maxHp;
      (sim as any).mobSwing(mob, sim.player);
    }
    expect(sim.player.pos.x).toBe(start.x);
    expect(sim.player.pos.z).toBe(start.z);
  });

  it('the knockback still shoves outside a telegraph (same seed control)', () => {
    const sim = makeSim(11);
    const { mob } = engagedBoss(sim, 'rift_boss_pitlord');
    mob.riftMechanicSpacing = SPACING;
    const start = { ...sim.player.pos };
    let moved = false;
    for (let i = 0; i < 80 && !moved; i++) {
      sim.player.hp = sim.player.maxHp;
      (sim as any).mobSwing(mob, sim.player);
      moved = sim.player.pos.x !== start.x || sim.player.pos.z !== start.z;
    }
    expect(moved).toBe(true);
  });
});

describe('rift boss cleave is a frontal arc', () => {
  it('exports a 180 degree frontal arc', () => {
    expect(RIFT_CLEAVE_HALF_ARC).toBeCloseTo(Math.PI / 2, 9);
  });

  function cleaveSplashAt(offX: number, offZ: number, stamped: boolean): boolean {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const mainId = sim.addPlayer('warrior', 'Tank');
    const offId = sim.addPlayer('warrior', 'Bystander');
    const mob = createMob((sim as any).nextId++, MOBS.rift_boss_brute, 22, { x: 0, y: 0, z: 0 });
    mob.hostile = true;
    mob.hp = mob.maxHp;
    if (stamped) mob.riftMechanicSpacing = SPACING;
    (sim as any).addEntity(mob);
    const mainE = sim.entities.get(mainId)!;
    mainE.pos = { x: 2, y: 0, z: 0 };
    mainE.prevPos = { ...mainE.pos };
    mainE.maxHp = 50000;
    mainE.hp = 50000;
    const offE = sim.entities.get(offId)!;
    offE.pos = { x: offX, y: 0, z: offZ };
    offE.prevPos = { ...offE.pos };
    offE.maxHp = 50000;
    offE.hp = 50000;
    // Face the tank, exactly as tryMobMeleeSwingInRange would mid-fight.
    mob.facing = Math.atan2(mainE.pos.x - mob.pos.x, mainE.pos.z - mob.pos.z);
    const events = captureEvents(sim);
    const cleaveName = MOBS.rift_boss_brute.cleave!.name;
    for (let i = 0; i < 50; i++) {
      mainE.hp = mainE.maxHp;
      offE.hp = offE.maxHp;
      (sim as any).mobSwing(mob, mainE);
    }
    return (events as any[]).some(
      (e) =>
        e.type === 'damage' && e.ability === cleaveName && e.targetId === offE.id && e.amount > 0,
    );
  }

  it('splashes a bystander in front of the boss', () => {
    // In front: on the tank side of the boss, 2yd from the tank.
    expect(cleaveSplashAt(2, 2, true)).toBe(true);
  });

  it('does not splash a bystander behind the boss', () => {
    // Behind the boss, but only 4yd from the tank: the shipped radial splash
    // would hit them (radius 9); the frontal arc must not.
    expect(cleaveSplashAt(-2, 0, true)).toBe(false);
  });

  it('an unstamped cleave carrier keeps the shipped radial splash', () => {
    expect(cleaveSplashAt(-2, 0, false)).toBe(true);
  });
});

describe('windup lifecycle and invariants', () => {
  it('an in-flight windup dies with the pull (evade) and with the life (respawn)', () => {
    const sim = makeSim();
    const { mob } = engagedBoss(sim, 'rift_boss_brute');
    mob.riftMechanicSpacing = SPACING;
    mob.stompWindupRemaining = 0.8;
    (sim as any).resetEvadingMob(mob);
    expect(mob.stompWindupRemaining).toBe(0);
    mob.pulseWindupRemaining = 0.8;
    (sim as unknown as { ctx: { respawnMob(m: Entity): void } }).ctx.respawnMob(mob);
    expect(mob.pulseWindupRemaining).toBe(0);
    // An unstamped mob passing the same resets never gains the fields (the
    // mechanicLockTimer defined-vs-undefined parity discipline).
    const wolf = createMob(920500, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 });
    (sim as any).addEntity(wolf);
    (sim as any).resetEvadingMob(wolf);
    expect('stompWindupRemaining' in wolf).toBe(false);
    expect('pulseWindupRemaining' in wolf).toBe(false);
  });

  it('every rift boss is ccImmune, so a windup can never freeze under CC', () => {
    // The windup countdown ticks on the engaged hook, which a stunned mob
    // never reaches (updateMob early-returns on CC): a CC-able stamped boss
    // would freeze its countdown while the client ring expires on its own
    // wall timer, landing the blast later with no live tell. Every boss the
    // generator can stamp is ccImmune, making that freeze unreachable; a new
    // rift boss template without ccImmune reds this pin.
    for (const id of RIFT_BOSS_IDS) {
      expect(MOBS[id].ccImmune, `${id} must be ccImmune`).toBe(true);
    }
  });

  it('a kite-frozen telegraph bar cannot pin the escape window open', () => {
    const { sim, mob } = enterRiftWithBoss('rift_boss_venom');
    const zone = MOBS.rift_boss_venom.deathZoneCast!;
    mob.swingTimer = 999;
    mob.deathZoneCastTimer = 0.001;
    sim.tick();
    expect(mob.castingAbility).toBe(zone.castId); // telegraph started in melee
    // Kite: hold the player 20yd out. The melee-gated cast bar freezes, but
    // the escape window is a wall-clock deadline that expires with the zone
    // fuse, so the held anti-kite snare recovers instead of being pinned off
    // forever (the exploit a castingAbility-based window would allow).
    mob.aoeSlowTimer = 0.001;
    const kitePos = { x: mob.pos.x + 20, y: sim.player.pos.y, z: mob.pos.z };
    let ticks = 0;
    const limit = Math.ceil((zone.castTime + 3) / DT);
    while (!slowAura(sim.player) && ticks < limit) {
      sim.player.pos = { ...kitePos };
      sim.player.prevPos = { ...kitePos };
      sim.player.hp = sim.player.maxHp;
      sim.tick();
      ticks++;
    }
    expect(slowAura(sim.player)).toBeDefined();
    // ...and it genuinely HELD while the window was open: the snare landed
    // only after the fuse deadline, not on its own free cadence.
    expect(ticks * DT).toBeGreaterThanOrEqual(zone.castTime - 2 * DT);
    expect(ticks * DT).toBeLessThanOrEqual(zone.castTime + 1);
  });

  it('a windup blast is measured from the telegraphed ring, not the drifted boss', () => {
    const sim = makeSim();
    const { mob, off } = engagedBoss(sim, 'rift_boss_brute');
    mob.riftMechanicSpacing = SPACING;
    const stomp = MOBS.rift_boss_brute.stomp!;
    mob.stompTimer = 0.001;
    (sim as any).updateMob(mob); // windup starts: the ring is drawn HERE
    const ring = { x: mob.pos.x, y: 0, z: mob.pos.z };
    // Exaggerated chase drift: put the boss far outside its own ring while the
    // players hold the ring center.
    mob.pos = { x: ring.x + 40, y: mob.pos.y, z: ring.z };
    mob.prevPos = { ...mob.pos };
    mob.spawnPos = { ...mob.pos }; // keep the leash quiet
    let ticks = 0;
    while (!stunAura(off) && ticks < Math.ceil((WINDUP + 1) / DT)) {
      sim.player.pos = { x: ring.x, y: sim.player.pos.y, z: ring.z };
      sim.player.prevPos = { ...sim.player.pos };
      sim.player.hp = sim.player.maxHp;
      off.pos = { ...sim.player.pos };
      off.hp = off.maxHp;
      (sim as any).updateMob(mob);
      ticks++;
    }
    // The players standing on the ring took the blast although the boss ended
    // the windup well outside its own telegraphed radius.
    expect(stunAura(off)).toBeDefined();
    expect(dist2d(mob.pos, ring)).toBeGreaterThan(stomp.radius);
  });

  it('proc suppression keeps the rng stream position identical', () => {
    // The window check sits AFTER each proc's chance draw, so a suppressed
    // effect must consume exactly the rng a landed one would have fed into
    // its roll: after the same swing count the next draw from the shared
    // stream is byte-identical whether or not the window was open.
    const drawAfterSwings = (windowOpen: boolean): number => {
      const sim = makeSim(7);
      const { mob } = engagedBoss(sim, 'rift_boss_venom');
      mob.riftMechanicSpacing = SPACING;
      if (windowOpen) mob.escapeWindowUntil = 1e9;
      for (let i = 0; i < 40; i++) {
        sim.player.hp = sim.player.maxHp;
        (sim as any).mobSwing(mob, sim.player);
      }
      return (sim as any).rng.next();
    };
    expect(drawAfterSwings(true)).toBe(drawAfterSwings(false));
  });
});
