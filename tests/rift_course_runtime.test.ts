// The rift course RUNTIME against a real Sim: bodies on decks through the
// actual movement kernel, not through unit-level queries.
//
// These are the claims a player would file bugs about, proven end to end:
// a deck holds you up, a crumble deck drops you, a ferry carries you, a
// geyser throws you, and the summit gate plate cannot be pressed from the
// floor beneath it (the y-gate that keeps a course gated by its course).
import { beforeEach, describe, expect, it } from 'vitest';
import type { CourseDeckKind } from '../src/sim/course';
import { courseClockNow, courseDeckCentre, resetCourseState } from '../src/sim/course';
import { DUNGEON_FLOOR_Y, MOBS, riftInstanceOrigin } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { resetRiftCourseRegions } from '../src/sim/rift/course_runtime';
import { RIFT_RANK_BASE_LEVEL } from '../src/sim/rift/ranks';
import { generateRiftFloor } from '../src/sim/rift/rift_gen';
import { Sim } from '../src/sim/sim';

const BASE = RIFT_RANK_BASE_LEVEL.S; // S rolls every mechanic kind

beforeEach(() => {
  resetCourseState();
  resetRiftCourseRegions();
});

/** First seed whose floor 0 course carries `kind`, with the deck index. */
function seedWith(
  kind: CourseDeckKind,
  extra?: (plan: NonNullable<ReturnType<typeof generateRiftFloor>['course']>) => boolean,
): {
  seed: number;
  deckIndex: number;
} {
  for (let seed = 1; seed < 3000; seed++) {
    const plan = generateRiftFloor(seed, BASE, 0);
    const course = plan.course;
    if (!course) continue;
    if (extra && !extra(course)) continue;
    let deckIndex = -1;
    for (let i = 0; i < course.decks.length; i++) {
      const d = course.decks[i];
      if (d.kind !== kind) continue;
      // Prefer the HIGHEST such deck: a fall from it is unambiguous.
      if (deckIndex < 0 || d.y > course.decks[deckIndex].y) deckIndex = i;
    }
    if (deckIndex >= 0) return { seed, deckIndex };
  }
  throw new Error(`no seed with a ${kind} deck on floor 0`);
}

function enter(seed: number): { sim: Sim; origin: { x: number; z: number } } {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', devCommands: true });
  sim.setPlayerLevel(BASE);
  sim.enterRift(seed, BASE, sim.player.id);
  const inst = sim.riftInstances.find((i) => i.partyKey !== null);
  expect(inst, 'the rift claimed a slot').toBeTruthy();
  const origin = riftInstanceOrigin(inst!.slot, 0);
  // The parked test body is not here to fight S-rank elites: clear the floor
  // so the platforming claims are measured, not the combat.
  for (const id of inst?.mobIds ?? []) {
    const m = sim.entities.get(id);
    if (m && !m.dead) {
      (sim as unknown as { dealDamage: (a: unknown, b: unknown, d: number) => void }).dealDamage(
        sim.player,
        m,
        m.maxHp * 10,
      );
    }
  }
  sim.tick();
  return { sim, origin };
}

function standAt(sim: Sim, x: number, y: number, z: number): void {
  sim.player.pos = { x, y, z };
  sim.player.prevPos = { x, y, z };
  sim.player.vx = 0;
  sim.player.vy = 0;
  sim.player.vz = 0;
  sim.player.onGround = true;
  sim.player.jumping = false;
  sim.player.fallStartY = y;
}

describe('decks hold bodies through the movement kernel', () => {
  it('a static deck is a floor: the body stays seated across ticks', () => {
    const { seed } = seedWith('crumble'); // any course floor will do
    const { sim, origin } = enter(seed);
    const course = generateRiftFloor(seed, BASE, 0).course;
    expect(course).toBeTruthy();
    const wp = course?.route[0];
    expect(wp).toBeTruthy();
    if (!wp || !course) return;
    standAt(sim, origin.x + wp.x, DUNGEON_FLOOR_Y + wp.y, origin.z + wp.z);
    for (let t = 0; t < 40; t++) sim.tick();
    expect(sim.player.pos.y).toBeCloseTo(DUNGEON_FLOOR_Y + wp.y, 1);
    expect(sim.player.onGround).toBe(true);
  });

  it('a crumble deck shakes, drops the body to the room floor, and emits deck state', () => {
    const { seed, deckIndex } = seedWith('crumble');
    const { sim, origin } = enter(seed);
    const course = generateRiftFloor(seed, BASE, 0).course;
    if (!course) return;
    const deck = course.decks[deckIndex];
    standAt(sim, origin.x + deck.x, DUNGEON_FLOOR_Y + deck.y, origin.z + deck.z);

    let sawDeckState = false;
    let fell = false;
    for (let t = 0; t < 20 * 12 && !fell; t++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'riftDeckState' && ev.deck === deckIndex) sawDeckState = true;
      }
      if (sim.player.pos.y < DUNGEON_FLOOR_Y + deck.y - 0.6) fell = true;
    }
    expect(sawDeckState, 'the arming event fired').toBe(true);
    expect(fell, 'the deck dropped its load').toBe(true);
    // The body lands on the ROOM FLOOR, not in any void: Crash rules.
    for (let t = 0; t < 20 * 3; t++) sim.tick();
    expect(sim.player.pos.y).toBeLessThan(DUNGEON_FLOOR_Y + 1.2);
    expect(sim.player.dead).toBe(false);
  });

  it('a ferry carries its rider along the track', () => {
    const { seed, deckIndex } = seedWith('ferry');
    const { sim, origin } = enter(seed);
    const course = generateRiftFloor(seed, BASE, 0).course;
    if (!course) return;
    const deck = course.decks[deckIndex];
    // Board it wherever it is RIGHT NOW (the sim clock has been ticking).
    sim.tick();
    const at = courseDeckCentre(deck, courseClockNow());
    standAt(sim, origin.x + at.x, DUNGEON_FLOOR_Y + deck.y, origin.z + at.z);
    const startX = sim.player.pos.x;
    const startZ = sim.player.pos.z;
    for (let t = 0; t < 20 * 3; t++) sim.tick();
    const moved = Math.hypot(sim.player.pos.x - startX, sim.player.pos.z - startZ);
    expect(moved, 'the rider travelled with the deck').toBeGreaterThan(1.2);
    expect(sim.player.onGround, 'still aboard').toBe(true);
  });

  it('a geyser eruption throws the body upward', () => {
    const { seed, deckIndex } = seedWith('geyser');
    const { sim, origin } = enter(seed);
    const course = generateRiftFloor(seed, BASE, 0).course;
    if (!course) return;
    const deck = course.decks[deckIndex];
    standAt(sim, origin.x + deck.x, DUNGEON_FLOOR_Y + deck.y, origin.z + deck.z);
    let launched = false;
    let peak = DUNGEON_FLOOR_Y + deck.y;
    for (let t = 0; t < 20 * 8; t++) {
      sim.tick();
      // Keep re-boarding until the window opens (the eruption is periodic).
      if (sim.player.onGround && !launched) {
        standAt(sim, origin.x + deck.x, DUNGEON_FLOOR_Y + deck.y, origin.z + deck.z);
      }
      if (sim.player.vy > 5) launched = true;
      peak = Math.max(peak, sim.player.pos.y);
    }
    expect(launched, 'the geyser fired under the body').toBe(true);
    // The throw DELIVERS: the body ends up above the pad (the arc mantles
    // onto the next stand; free-flight apex is not the contract, arrival is).
    expect(peak, 'the eruption carried the body upward').toBeGreaterThan(
      DUNGEON_FLOOR_Y + deck.y + 1.1,
    );
  });
});

describe('the summit gate plate', () => {
  it('refuses a floor walker beneath it and yields to a climber at height', () => {
    const found = (() => {
      for (let seed = 1; seed < 4000; seed++) {
        const plan = generateRiftFloor(seed, BASE, 0);
        if (plan.course && plan.gate) return { seed, plan };
      }
      throw new Error('no gated course floor found');
    })();
    const { sim, origin } = enter(found.seed);
    const inst = sim.riftInstances.find((i) => i.partyKey !== null);
    const course = found.plan.course;
    const gate = found.plan.gate;
    if (!course || !gate || !inst) return;

    // Standing at the plate's (x, z) but at FLOOR height: nothing happens.
    standAt(sim, origin.x + gate.switchX, DUNGEON_FLOOR_Y, origin.z + gate.switchZ);
    for (let t = 0; t < 40; t++) sim.tick();
    expect(inst.gateOpen, 'the floor walk under the summit must not open the gate').toBe(false);

    // At summit height, the plate throws.
    standAt(
      sim,
      origin.x + gate.switchX,
      DUNGEON_FLOOR_Y + course.summit.y,
      origin.z + gate.switchZ,
    );
    for (let t = 0; t < 40 && !inst.gateOpen; t++) sim.tick();
    expect(inst.gateOpen, 'the summit press opens the gate').toBe(true);
  });
});

describe('the riftbound vaulter', () => {
  it('leaps to a target on another tier, arcs visibly, and lands hunting', () => {
    // A course floor with a vaulter and a real deck to stand its target on.
    const found = (() => {
      for (let seed = 1; seed < 4000; seed++) {
        const plan = generateRiftFloor(seed, BASE, 0);
        if (!plan.course) continue;
        if (!plan.spawns.some((sp) => sp.templateId === 'rift_vaulter')) continue;
        const stand = plan.course.route.find((w) => !w.via && w.y > 2.4);
        if (stand) return { seed, stand };
      }
      throw new Error('no vaulter course floor found');
    })();
    const { sim, origin } = enter(found.seed);
    // enter() cleared the trash: bring ONE vaulter back by spawning fresh at
    // the course base via the plan record.
    const plan = generateRiftFloor(found.seed, BASE, 0);
    const vs = plan.spawns.find((sp) => sp.templateId === 'rift_vaulter');
    expect(vs).toBeTruthy();
    if (!vs) return;
    const inst = sim.riftInstances.find((i) => i.partyKey !== null);
    if (!inst) return;
    const mob = createMob(
      (sim as unknown as { nextId: number }).nextId++,
      MOBS.rift_vaulter,
      BASE,
      { x: origin.x + vs.x, y: DUNGEON_FLOOR_Y, z: origin.z + vs.z },
    );
    (sim as unknown as { addEntity: (e: unknown) => void }).addEntity(mob);
    inst.mobIds.push(mob.id);

    // The player stands on a raised course deck; the vaulter starts on the
    // floor below within aggro range.
    standAt(
      sim,
      origin.x + found.stand.x,
      DUNGEON_FLOOR_Y + found.stand.y,
      origin.z + found.stand.z,
    );
    mob.pos.x = origin.x + found.stand.x + 4;
    mob.pos.z = origin.z + found.stand.z;
    mob.pos.y = DUNGEON_FLOOR_Y;
    mob.prevPos = { ...mob.pos };
    sim.player.hp = sim.player.maxHp;

    let sawEvent = false;
    let sawAirborne = false;
    let peak = mob.pos.y;
    for (let t = 0; t < 20 * 20 && !sawEvent; t++) {
      standAt(
        sim,
        origin.x + found.stand.x,
        DUNGEON_FLOOR_Y + found.stand.y,
        origin.z + found.stand.z,
      );
      sim.player.hp = sim.player.maxHp;
      for (const ev of sim.tick()) {
        if (ev.type === 'mobLeap' && ev.entityId === mob.id) sawEvent = true;
      }
    }
    expect(sawEvent, 'the vaulter never leapt').toBe(true);
    for (let t = 0; t < 20 * 3 && mob.mobLeap; t++) {
      sim.tick();
      sim.player.hp = sim.player.maxHp;
      sawAirborne ||= mob.onGround === false;
      peak = Math.max(peak, mob.pos.y);
      // The arc must never be flattened by the lift pass mid-flight.
      expect(mob.pos.y).toBeGreaterThanOrEqual(DUNGEON_FLOOR_Y - 0.01);
    }
    expect(sawAirborne, 'the arc cleared the ground (jump clip contract)').toBe(true);
    expect(peak, 'a real arc, not a slide').toBeGreaterThan(DUNGEON_FLOOR_Y + 1.2);
    expect(mob.mobLeap, 'the arc completed').toBeFalsy();
    expect(mob.pos.y).toBeGreaterThan(DUNGEON_FLOOR_Y + found.stand.y - 1.5);
  });
});
