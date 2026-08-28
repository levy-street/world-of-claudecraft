// The aimed slams and the shared launch (src/sim/mob/boss_slams.ts).
//
// NOTHING HERE MAY USE GODMODE, and that is not a style preference. `dealDamage` returns
// SILENTLY for a `gm` target (combat/damage.ts) without emitting the event, so a godded
// subject makes every "this did not hit me" assertion in the file pass for the wrong
// reason, and every "this hit me" assertion impossible. A first cut of this suite was
// godded throughout and reported three green tests that were measuring nothing at all.
// The subject is mortal; where he needs to survive the boss's ordinary autos long enough
// to reach a mechanic, he is topped up each tick instead.
//
// Three things here are worth pinning and nothing else can see them. The hammer's aim is
// SNAPSHOT, so "step out of the ring" has to keep working no matter where the boss walks
// during the wind. The cleave is the fight's only jump check, so the clear must be a real
// height test rather than an `onGround` flag a one-frame hop would satisfy. And the launch
// has to throw a player without quietly handing them fall damage on the way down, which is
// a number nobody would notice until a raider died to a mechanic that did not kill them.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The live-fight suites tick a real Sim through a 175-yard opening march before a cleave
// or hammer resolves: 4 to 5 seconds each on an idle machine, and past the shared 20 s
// default under CI shard contention. Same allowance the Vale Cup match suite takes.
vi.setConfig({ testTimeout: 40_000 });

import { MOBS } from '../src/sim/data';
import {
  CLEAVE_ABILITY,
  CLEAVE_CLEAR_HEIGHT,
  HAMMER_ABILITY,
  launchFromSlam,
} from '../src/sim/mob/boss_slams';
import { FALL_SAFE_DISTANCE, GRAVITY } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';

const BALGATH = 'balgath_cyclops';

/** Where the live scheduler spawns him: the flat raid-floor pad the fight is measured on.
 *  Spawning anywhere else measures the cleave's jump-clear height across whatever relief
 *  happens to be there, which is what broke this file when the lair moved. */
function lair(): { x: number; z: number } {
  const row = WORLD_BOSSES.find((b) => b.templateId === BALGATH);
  if (!row) throw new Error('balgath_cyclops is not in WORLD_BOSSES');
  return row.pos;
}
const slams = () => {
  const d = MOBS[BALGATH]?.slams;
  if (!d) throw new Error('balgath_cyclops declares no slams');
  return d;
};
const launch = () => {
  const d = MOBS[BALGATH]?.launch;
  if (!d) throw new Error('balgath_cyclops declares no launch');
  return d;
};

describe('slam tuning', () => {
  it('never launches hard enough to add fall damage to its own hit', () => {
    // apex = up^2 / 2g. A slam that throws a player past FALL_SAFE_DISTANCE starts
    // charging them for the landing too, which reads as the boss dealing damage the
    // combat log cannot explain.
    const apex = launch().up ** 2 / (2 * GRAVITY);
    expect(apex).toBeLessThan(FALL_SAFE_DISTANCE);
    expect(apex, 'a punt nobody can see is not a punt').toBeGreaterThan(1.5);
  });

  it('keeps the cleave clearable by one ordinary jump', () => {
    // A standing jump apexes at JUMP_VELOCITY^2 / 2g. If the clear height ever rises above
    // that, the fight's only jump check becomes undodgeable without a mount or a talent.
    const apex = 6 ** 2 / (2 * GRAVITY);
    expect(CLEAVE_CLEAR_HEIGHT).toBeLessThan(apex * 0.75);
  });

  it('gives the raid time to read each telegraph', () => {
    expect(slams().hammer.windup).toBeGreaterThanOrEqual(1);
    expect(slams().cleave.windup).toBeGreaterThanOrEqual(1);
  });

  it('keeps the hammer small enough to step out of', () => {
    // It is aimed AT a player, so it is only fair while the footprint is something a few
    // seconds of running beats. Wider than his Barrow Smash and it is just a second one.
    const pulse = MOBS[BALGATH]?.aoePulse;
    expect(slams().hammer.radius).toBeLessThan(pulse?.radius ?? 12);
  });
});

describe('launchFromSlam', () => {
  let sim: Sim;
  let player: Entity;
  let boss: Entity;

  beforeEach(() => {
    sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    player = sim.player;
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss(BALGATH, lair().x, lair().z);
    const e = sim.entities.get(id);
    if (!e) throw new Error('no boss');
    boss = e;
    place(player, lair().x + 4, lair().z);
  });

  const place = (e: Entity, x: number, z: number) => {
    e.pos.x = x;
    e.pos.z = z;
    e.pos.y = groundHeight(x, z, sim.cfg.seed);
    e.prevPos = { ...e.pos };
    e.onGround = true;
    e.vx = 0;
    e.vy = 0;
    e.vz = 0;
  };

  /**
   * Fire the launch, then take the boss out of the world before measuring the flight.
   *
   * Not squeamishness about a messy fixture: his melee reach is 14.6 yards and his swings
   * carry a 30% knockback proc, and `applyKnockback` deliberately grounds its victim
   * (`vy = 0; onGround = true`). Leaving him standing there means a third of flights get
   * swatted out of the air two ticks in by an unrelated mechanic, and the test would be
   * measuring his auto-attack rather than the launch it names.
   */
  const launchAndClearTheField = (radius = 14) => {
    launchFromSlam(
      (sim as unknown as { ctx: Parameters<typeof launchFromSlam>[0] }).ctx,
      boss,
      boss.pos,
      radius,
    );
    sim.entities.delete(boss.id);
  };

  it('throws a player into the air, not along the floor', () => {
    launchAndClearTheField();
    expect(player.vy).toBeGreaterThan(5);
    expect(player.onGround).toBe(false);
    // And they actually leave the ground once the kernel runs, rather than only holding a
    // velocity the movement pass immediately zeroes.
    const startY = player.pos.y;
    for (let i = 0; i < 8; i++) sim.tick();
    expect(player.pos.y).toBeGreaterThan(startY + 0.5);
  });

  it('lands them without charging fall damage for the flight it caused', () => {
    const hpBefore = player.hp;
    launchAndClearTheField();
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    expect(player.onGround).toBe(true);
    expect(player.hp).toBe(hpBefore);
  });

  it('leaves anyone outside the blast alone', () => {
    place(player, lair().x + 60, lair().z);
    launchFromSlam(
      (sim as unknown as { ctx: Parameters<typeof launchFromSlam>[0] }).ctx,
      boss,
      boss.pos,
      14,
    );
    expect(player.vy).toBe(0);
    expect(player.onGround).toBe(true);
  });

  it('hits harder at the epicentre than at the rim', () => {
    place(player, lair().x + 1, lair().z);
    launchFromSlam(
      (sim as unknown as { ctx: Parameters<typeof launchFromSlam>[0] }).ctx,
      boss,
      boss.pos,
      14,
    );
    const near = player.vy;
    place(player, lair().x + 13.5, lair().z);
    launchFromSlam(
      (sim as unknown as { ctx: Parameters<typeof launchFromSlam>[0] }).ctx,
      boss,
      boss.pos,
      14,
    );
    expect(near).toBeGreaterThan(player.vy);
  });

  it('is inert for a mob whose template never opted in', () => {
    const other = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId !== BALGATH && !e.dead,
    );
    expect(other, 'no ordinary mob to test against').toBeDefined();
    if (!other) return;
    place(player, other.pos.x + 1, other.pos.z);
    launchFromSlam(
      (sim as unknown as { ctx: Parameters<typeof launchFromSlam>[0] }).ctx,
      other,
      other.pos,
      14,
    );
    expect(player.vy).toBe(0);
    expect(player.onGround).toBe(true);
  });
});

describe('the aimed slams in a live fight', () => {
  let sim: Sim;
  let player: Entity;
  let boss: Entity;

  const place = (e: Entity, x: number, z: number) => {
    e.pos.x = x;
    e.pos.z = z;
    e.pos.y = groundHeight(x, z, sim.cfg.seed);
    e.prevPos = { ...e.pos };
  };

  beforeEach(() => {
    sim = new Sim({ seed: 5, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    player = sim.player;
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss(BALGATH, lair().x, lair().z);
    const e = sim.entities.get(id);
    if (!e) throw new Error('no boss');
    boss = e;
    place(player, lair().x + 6, lair().z);
  });

  /** One tick with the subject kept alive: he is mortal (see the header) and standing
   *  inside the reach of a level-20 world boss, so his autos would end the run long
   *  before a 26-second cadence came around. Topping up hp leaves every damage EVENT
   *  intact, which is what these tests actually read. */
  const tickAlive = () => {
    const events = sim.tick();
    player.hp = player.maxHp;
    return events;
  };

  /** Tick until an ability's telegraph ring is emitted; returns where it was drawn. */
  const waitForRing = (ability: string, seconds = 120) => {
    for (let i = 0; i < 20 * seconds; i++) {
      for (const ev of tickAlive()) {
        if (
          ev.type === 'spellfxAt' &&
          ev.fx === 'runeCircle' &&
          (ev as { ability?: string }).ability === ability
        ) {
          return { x: ev.x, z: ev.z, radius: ev.radius ?? 0, at: i / 20, ev };
        }
      }
      // Stay glued to him so he keeps melee contact and keeps throwing these.
      const d = Math.hypot(boss.pos.x - player.pos.x, boss.pos.z - player.pos.z);
      if (d > 8) {
        const a = Math.atan2(boss.pos.x - player.pos.x, boss.pos.z - player.pos.z);
        player.pos.x += Math.sin(a) * 7 * 0.05;
        player.pos.z += Math.cos(a) * 7 * 0.05;
        player.pos.y = groundHeight(player.pos.x, player.pos.z, sim.cfg.seed);
      }
    }
    return null;
  };

  it('draws the hammer ring on the player it picked', () => {
    const ring = waitForRing(HAMMER_ABILITY);
    expect(ring, 'he never threw a hammer').not.toBeNull();
    expect(Math.hypot((ring?.x ?? 0) - player.pos.x, (ring?.z ?? 0) - player.pos.z)).toBeLessThan(
      2,
    );
    expect(ring?.radius).toBe(slams().hammer.radius);
  });

  it('lands the hammer where the ring was drawn, not where the boss ended up', () => {
    // The snapshot is the mechanic. If the blast tracked him, stepping out would stop
    // working exactly when he repositioned, which is the moment a player most needs it to.
    const ring = waitForRing(HAMMER_ABILITY);
    expect(ring).not.toBeNull();
    let impact: { x: number; z: number } | null = null;
    for (let i = 0; i < 20 * 4 && !impact; i++) {
      for (const ev of tickAlive()) {
        if (
          ev.type === 'spellfxAt' &&
          ev.fx === 'nova' &&
          (ev as { ability?: string }).ability === HAMMER_ABILITY
        ) {
          impact = { x: ev.x, z: ev.z };
        }
      }
      // Drag the boss well clear during the wind.
      boss.pos.x += 0.6;
    }
    expect(impact).not.toBeNull();
    expect(
      Math.hypot((impact?.x ?? 0) - (ring?.x ?? 0), (impact?.z ?? 0) - (ring?.z ?? 0)),
    ).toBeLessThan(0.01);
  });

  it('misses a player who stepped out of the hammer ring', () => {
    const ring = waitForRing(HAMMER_ABILITY);
    expect(ring).not.toBeNull();
    // Walk clear of the drawn circle and stay there.
    place(player, (ring?.x ?? 0) + (ring?.radius ?? 0) + 6, ring?.z ?? 0);
    const hpBefore = player.hp;
    let hit = false;
    for (let i = 0; i < 20 * 3; i++) {
      for (const ev of tickAlive()) {
        if (ev.type === 'damage' && ev.ability === slams().hammer.name) hit = true;
      }
      place(player, (ring?.x ?? 0) + (ring?.radius ?? 0) + 6, ring?.z ?? 0);
    }
    expect(hit, 'the hammer followed him out of its own ring').toBe(false);
    expect(player.hp).toBe(hpBefore);
  });

  /** Wind a cleave, then hold the player in the arc at a chosen height until it lands. */
  const rideOutCleave = (feetAboveGround: number) => {
    const ring = waitForRing(CLEAVE_ABILITY, 200);
    expect(ring, 'he never threw a cleave').not.toBeNull();
    if (!ring) throw new Error('he never threw a cleave');
    const swept = ring.ev as { dirX?: number; dirZ?: number };
    const aim = Math.atan2(swept.dirX ?? 0, swept.dirZ ?? 1);
    // Plant them dead centre in the arc, well inside its reach.
    const hold = () => {
      player.pos.x = boss.pos.x + Math.sin(aim) * 10;
      player.pos.z = boss.pos.z + Math.cos(aim) * 10;
      player.pos.y = groundHeight(player.pos.x, player.pos.z, sim.cfg.seed) + feetAboveGround;
      player.onGround = feetAboveGround <= 0.01;
      player.prevPos = { ...player.pos };
    };
    const hpBefore = player.hp;
    let hit = false;
    let landed = false;
    for (let i = 0; i < 20 * 4 && !landed; i++) {
      hold();
      for (const ev of tickAlive()) {
        if (ev.type === 'damage' && ev.ability === slams().cleave.name) hit = true;
        if (
          ev.type === 'spellfxAt' &&
          ev.fx === 'nova' &&
          (ev as { ability?: string }).ability === CLEAVE_ABILITY
        ) {
          landed = true;
        }
      }
    }
    expect(landed, 'the cleave telegraph never resolved').toBe(true);
    return { hit, hpBefore, carried: Math.hypot(player.vx, player.vz) };
  };

  it('cuts down a player who stood in the arc', () => {
    const r = rideOutCleave(0);
    expect(r.hit, 'standing in a 120-degree arc cost nothing').toBe(true);
  });

  it('misses a player who jumped it, and carries them instead', () => {
    // The whole point of the mechanic: it is beaten by leaving the ground, and beating it
    // pays you a ride on the arm rather than merely nothing.
    const r = rideOutCleave(1.0);
    expect(r.hit, 'a jump did not clear the arm').toBe(false);
    expect(r.carried, 'he cleared it but the arm did not take him with it').toBeGreaterThan(1);
  });

  it('does not punt the player who dodged it', () => {
    // The defect this pins, found by reading the diff rather than by a failure: the cleave
    // launched everyone inside its RANGE, and range is a circle. That punted players
    // standing behind him, who were never in the arc, and it punted the ones who had just
    // jumped it correctly, which quietly converted the fight's one skill check into a coin
    // flip. A dodge has to be worth something.
    const r = rideOutCleave(1.0);
    expect(r.hit).toBe(false);
    // Carried along the arm, yes. Thrown into the air by the blast, no: the vertical punt
    // is what a landed hit pays out, and this one did not land.
    expect(player.vy, 'a clean dodge was launched anyway').toBeLessThan(3);
  });

  it('will not let a hop off a kerb count as a jump', () => {
    // Just under the clear height: still standing in it as far as the arm is concerned.
    const r = rideOutCleave(CLEAVE_CLEAR_HEIGHT - 0.15);
    expect(r.hit).toBe(true);
  });
});
