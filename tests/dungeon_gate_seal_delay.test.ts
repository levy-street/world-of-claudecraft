// The boss-room seal delay (src/sim/instances/dungeon_gates.ts): an arena
// seals BOSS_ROOM_SEAL_DELAY_SECONDS into its boss's fight, not at the pull.
// The first half drives a real claimed Hollow Crypt with a real party through
// full Sim ticks (the window, the wipe inside it, the boss dying inside it,
// the second pull, the boss walked to its own door, who is locked out); the
// second half walks every sealing gate of every dungeon through the one rule.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wireEntity } from '../server/game';
import { syncClientDungeonGates } from '../src/net/dungeon_gate_wire';
import { isBlocked, resolvePosition } from '../src/sim/colliders';
import { HOLLOW_CRYPT_GATES } from '../src/sim/content/hollow_crypt';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  KORZUL_EMERGE_FROM,
  KORZUL_EMERGE_TO,
} from '../src/sim/encounters/gravewyrm_sanctum/korzul_emerge_plan';
import { BELL_YARD, MARROW_ID } from '../src/sim/encounters/hollow_crypt';
import { MORTHEN_SPOT } from '../src/sim/encounters/hollow_crypt/ids';
import { VAEL_INTRO_STOPS } from '../src/sim/encounters/sunken_bastion/ids';
import { clearDungeonGateStateForTest } from '../src/sim/instances/dungeon_gate_state';
import {
  BOSS_ROOM_DOORWAY_REACH,
  BOSS_ROOM_SEAL_DELAY_SECONDS,
  BOSS_ROOM_SEAL_DELAY_TICKS,
  DUNGEON_GATE_TEMPLATES,
  dungeonGateEntity,
  dungeonGateState,
  gateInward,
  inGateDoorway,
  tickDungeonGates,
} from '../src/sim/instances/dungeon_gates';
import { enterDungeon, freeInstance } from '../src/sim/instances/dungeons';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type DungeonGateDef, type Entity, type WorldContent } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';
import { boss, cryptFight, type Fight, put, run, tick } from './helpers/crypt_boss_fight';

vi.setConfig({ testTimeout: 120_000 });

const YARD = HOLLOW_CRYPT_GATES.find((g) => g.id === 'yard_barrier') as DungeonGateDef;
const KEEP = new Set([MARROW_ID]);
const MID = { x: BELL_YARD.x, z: BELL_YARD.z };

function state(f: Fight): string {
  return dungeonGateState(f.sim.ctx, f.inst, YARD);
}

function gateEntity(f: Fight): Entity {
  const e = dungeonGateEntity(f.sim.ctx, f.inst, YARD);
  if (!e) throw new Error('no yard barrier object');
  return e;
}

/** Is the Bone Barrier's passage walled right now (the collision view)? */
function walled(f: Fight): boolean {
  return isBlocked(f.sim.cfg.seed, f.ox + YARD.x, f.oz + YARD.z, 0.5);
}

/** Marrow's distance along the passage on his own side of the gate's line
 *  (positive inside his yard, negative once he is through the door). */
function inward(f: Fight, mob: Entity): number {
  return gateInward(
    YARD,
    { x: mob.spawnPos.x - f.ox, z: mob.spawnPos.z - f.oz },
    { x: mob.pos.x - f.ox, z: mob.pos.z - f.oz },
  );
}

/** What the online client would wall from the gate entities it mirrors: the
 *  collision view rebuilt from scratch by its own sync (net/dungeon_gate_wire). */
function clientWalled(f: Fight): boolean {
  clearDungeonGateStateForTest();
  syncClientDungeonGates({ entities: f.sim.ctx.entities, player: f.tank });
  const walledForClient = walled(f);
  // Hand the view back to the authoritative world.
  tickDungeonGates(f.sim.ctx);
  return walledForClient;
}

/** A claimed crypt with every mob but Marrow dead, so the Bone Barrier is open. */
function yard(extra = 1): { f: Fight; marrow: Entity } {
  const f = cryptFight('normal', extra, KEEP);
  const marrow = boss(f, MARROW_ID);
  marrow.maxHp = 1e6;
  marrow.hp = marrow.maxHp;
  put(f, marrow, MID.x, MID.z);
  put(f, f.tank, MID.x, MID.z - 2.5);
  for (const [i, p] of f.others.entries()) put(f, p, MID.x + 12 + i * 3, MID.z + 8);
  tick(f);
  return { f, marrow };
}

/** Hold the tank on Marrow and the others on their spots (no grave drift). */
function holder(f: Fight): () => void {
  const spots = [f.tank, ...f.others].map((p) => [p, p.pos.x - f.ox, p.pos.z - f.oz] as const);
  return () => {
    for (const [p, x, z] of spots) if (!p.dead) put(f, p, x, z);
  };
}

describe('the boss-room seal delay: the one shared rule', () => {
  it('is ten seconds, counted in sim ticks', () => {
    expect(BOSS_ROOM_SEAL_DELAY_SECONDS).toBe(10);
    expect(BOSS_ROOM_SEAL_DELAY_TICKS).toBe(200);
    expect(BOSS_ROOM_SEAL_DELAY_TICKS * DT).toBeCloseTo(BOSS_ROOM_SEAL_DELAY_SECONDS, 9);
  });

  it('reads a doorway from the side the boss lives on', () => {
    // The Bone Barrier spans x at z 93; Marrow's yard lies beyond it (z up).
    const home = { x: YARD.x, z: YARD.z + 29 };
    expect(inGateDoorway(YARD, home, { x: YARD.x, z: YARD.z + 20 })).toBe(false);
    expect(inGateDoorway(YARD, home, { x: YARD.x, z: YARD.z + BOSS_ROOM_DOORWAY_REACH })).toBe(
      true,
    );
    expect(
      inGateDoorway(YARD, home, { x: YARD.x, z: YARD.z + BOSS_ROOM_DOORWAY_REACH + 0.1 }),
    ).toBe(false);
    // On the line or past it is never the doorway: a seal landing there would
    // shut the boss out of its own room.
    expect(inGateDoorway(YARD, home, { x: YARD.x, z: YARD.z })).toBe(false);
    expect(inGateDoorway(YARD, home, { x: YARD.x, z: YARD.z - 1 })).toBe(false);
    expect(inGateDoorway(YARD, home, { x: YARD.x, z: YARD.z - 12 })).toBe(false);
    expect(gateInward(YARD, home, { x: YARD.x + 3, z: YARD.z + 4 })).toBeCloseTo(4, 9);
    expect(gateInward(YARD, home, { x: YARD.x - 3, z: YARD.z - 5 })).toBeCloseTo(-5, 9);
    expect(inGateDoorway(YARD, home, { x: YARD.x + YARD.hw + 3, z: YARD.z + 1 })).toBe(false);
    // The same gate seen from a boss living on the other side mirrors it.
    const other = { x: YARD.x, z: YARD.z - 29 };
    expect(inGateDoorway(YARD, other, { x: YARD.x, z: YARD.z - BOSS_ROOM_DOORWAY_REACH })).toBe(
      true,
    );
    expect(inGateDoorway(YARD, other, { x: YARD.x, z: YARD.z - 20 })).toBe(false);
  });
});

describe('the boss-room seal delay: Sexton Marrow and the Bone Barrier', () => {
  afterEach(() => clearDungeonGateStateForTest());

  it('stays open, on the wire and to collision, for ten seconds of the fight and then seals', () => {
    const { f, marrow } = yard();
    const keep = holder(f);
    expect(state(f)).toBe('open');
    expect(gateEntity(f).gateSealTick).toBeUndefined();
    f.sim.ctx.aggroMob(marrow, f.tank, false);
    tick(f, keep);
    // The pull is seen: the clock is set, the gate is still open.
    expect(marrow.inCombat).toBe(true);
    const lands = gateEntity(f).gateSealTick;
    expect(lands).toBeDefined();
    expect((lands as number) - f.sim.tickCount).toBe(BOSS_ROOM_SEAL_DELAY_TICKS);
    let open = 0;
    for (let i = 0; i < BOSS_ROOM_SEAL_DELAY_TICKS * 2 && state(f) === 'open'; i++) {
      // Truthful through the whole window: the readers, the mirrored template
      // and the collision view all say open.
      expect(gateEntity(f).templateId).toBe(DUNGEON_GATE_TEMPLATES.open);
      expect(walled(f)).toBe(false);
      tick(f, keep);
      open++;
    }
    expect(open).toBe(BOSS_ROOM_SEAL_DELAY_TICKS);
    expect(state(f)).toBe('sealed');
    expect(gateEntity(f).templateId).toBe(DUNGEON_GATE_TEMPLATES.sealed);
    expect(walled(f)).toBe(true);
    // It holds for the fight.
    run(f, 3, keep);
    expect(state(f)).toBe('sealed');
    expect(walled(f)).toBe(true);
  });

  it('the client mirror walls nothing through the window and walls the gate when it lands', () => {
    const { f, marrow } = yard();
    const keep = holder(f);
    f.sim.ctx.aggroMob(marrow, f.tank, false);
    run(f, 5, keep);
    // Pending: the entity the client mirrors still reads open, so its own
    // collision view (rebuilt from the mirrored entities alone) is open too.
    expect(state(f)).toBe('open');
    expect(gateEntity(f).templateId).toBe(DUNGEON_GATE_TEMPLATES.open);
    expect(clientWalled(f)).toBe(false);
    run(f, BOSS_ROOM_SEAL_DELAY_SECONDS - 5 + 0.5, keep);
    expect(state(f)).toBe('sealed');
    expect(gateEntity(f).templateId).toBe(DUNGEON_GATE_TEMPLATES.sealed);
    expect(clientWalled(f)).toBe(true);
  });

  it('locks out whoever is outside when it lands, until the boss resets', () => {
    const { f, marrow } = yard(1);
    const late = f.others[0];
    // The latecomer waits outside the barrier, on the far side from the yard.
    put(f, late, YARD.x, YARD.z - 6);
    const keep = holder(f);
    f.sim.ctx.aggroMob(marrow, f.tank, false);
    run(f, BOSS_ROOM_SEAL_DELAY_SECONDS + 0.5, keep);
    expect(state(f)).toBe('sealed');
    // Nobody is moved by the seal: the latecomer is where they stood, outside,
    // and the passage between them and the fight is walled.
    expect(late.pos.z - f.oz).toBeCloseTo(YARD.z - 6, 3);
    expect(walled(f)).toBe(true);
    const step = f.sim.ctx.resolveMovePoint(f.ox + YARD.x, f.oz + YARD.z, 0.5, late);
    expect(Math.hypot(step.x - (f.ox + YARD.x), step.z - (f.oz + YARD.z))).toBeGreaterThan(0.5);
  });

  it('a wipe inside the window cancels the seal: the door never shuts on the empty yard', () => {
    const { f, marrow } = yard();
    const keep = holder(f);
    f.sim.ctx.aggroMob(marrow, f.tank, false);
    run(f, 4, keep);
    expect(state(f)).toBe('open');
    expect(gateEntity(f).gateSealTick).toBeDefined();
    // Dragged to the rim first, so his walk home outlasts the rest of the window.
    put(f, marrow, MID.x + 16, MID.z);
    for (const p of [f.tank, ...f.others]) f.sim.ctx.handleDeath(p, marrow);
    let sawEvade = false;
    for (let i = 0; i < (BOSS_ROOM_SEAL_DELAY_SECONDS + 6) / DT; i++) {
      f.sim.tick();
      if (marrow.aiState === 'evade') sawEvade = true;
      expect(state(f)).toBe('open');
      expect(gateEntity(f).templateId).toBe(DUNGEON_GATE_TEMPLATES.open);
      expect(walled(f)).toBe(false);
    }
    expect(sawEvade).toBe(true);
    expect(marrow.aiState).toBe('idle');
    expect(marrow.inCombat).toBe(false);
    expect(gateEntity(f).gateSealTick).toBeUndefined();
  });

  it('the pull after a reset gets the whole ten seconds again', () => {
    const { f, marrow } = yard();
    const keep = holder(f);
    f.sim.ctx.aggroMob(marrow, f.tank, false);
    run(f, 7, keep);
    for (const p of [f.tank, ...f.others]) f.sim.ctx.handleDeath(p, marrow);
    for (let i = 0; i < 12 / DT && (marrow.aiState !== 'idle' || marrow.inCombat); i++)
      f.sim.tick();
    expect(marrow.aiState).toBe('idle');
    expect(gateEntity(f).gateSealTick).toBeUndefined();
    // The group comes back and pulls again (the tank stood back up by hand:
    // the corpse run is not what is under test).
    f.tank.dead = false;
    f.tank.ghost = false;
    f.tank.maxHp = 1e7;
    f.tank.hp = 1e7;
    put(f, f.tank, marrow.pos.x - f.ox, marrow.pos.z - f.oz - 2.5);
    const again = holder(f);
    f.sim.ctx.aggroMob(marrow, f.tank, false);
    tick(f, again);
    expect((gateEntity(f).gateSealTick as number) - f.sim.tickCount).toBe(
      BOSS_ROOM_SEAL_DELAY_TICKS,
    );
    run(f, BOSS_ROOM_SEAL_DELAY_SECONDS - 0.5, again);
    expect(state(f)).toBe('open');
    run(f, 1, again);
    expect(state(f)).toBe('sealed');
  });

  it('a pull taken up again before he stands idle starts the delay afresh', () => {
    // Two players: the tank pulls and falls at 3 s; the other, who never
    // touched him, is standing beside his spot when he turns for home.
    const { f, marrow } = yard(1);
    const second = f.others[0];
    put(f, second, MID.x + 3, MID.z + 2);
    const keep = holder(f);
    f.sim.ctx.aggroMob(marrow, f.tank, false);
    tick(f, keep);
    const firstPull = f.sim.tickCount;
    run(f, 3, keep);
    expect(gateEntity(f).gateSealTick).toBe(firstPull + BOSS_ROOM_SEAL_DELAY_TICKS);
    f.sim.ctx.handleDeath(f.tank, marrow);
    // From here the fallen tank is left alone: the survivor is held and healed.
    const step = (): void => {
      keep();
      second.hp = second.maxHp;
      f.sim.tick();
    };
    // He drops the pull: the pending seal is gone on that very tick.
    let dropped = false;
    let secondPull = -1;
    for (let i = 0; i < 8 / DT && secondPull < 0; i++) {
      step();
      if (marrow.aiState === 'evade') {
        dropped = true;
        expect(gateEntity(f).gateSealTick).toBeUndefined();
      }
      // Home again he is pulled at once by the player standing on his spot.
      if (dropped && marrow.aiState === 'idle') f.sim.ctx.aggroMob(marrow, second, false);
      if (dropped && marrow.inCombat && marrow.aggroTargetId === second.id)
        secondPull = f.sim.tickCount;
    }
    expect(dropped).toBe(true);
    expect(secondPull).toBeGreaterThan(firstPull);
    step();
    const lands = gateEntity(f).gateSealTick as number;
    // The whole delay from the second pull, not what was left of the first.
    expect(lands).toBeGreaterThanOrEqual(secondPull + BOSS_ROOM_SEAL_DELAY_TICKS - 1);
    expect(lands).toBeGreaterThan(firstPull + BOSS_ROOM_SEAL_DELAY_TICKS + 20);
    // Open when the first pull's ten seconds would have run out.
    while (f.sim.tickCount < firstPull + BOSS_ROOM_SEAL_DELAY_TICKS + 5) step();
    expect(state(f)).toBe('open');
    expect(walled(f)).toBe(false);
    while (f.sim.tickCount < lands) step();
    expect(state(f)).toBe('sealed');
  });

  it('thrown past his own gate inside the window, he is never sealed out: the seal waits for him', () => {
    const { f, marrow } = yard();
    const keep = holder(f);
    f.sim.ctx.aggroMob(marrow, f.tank, false);
    tick(f, keep);
    const lands = gateEntity(f).gateSealTick as number;
    run(f, 4, keep);
    // A knockback, a leap or a scripted plant puts him 5 yd past the line.
    const out = (): void => put(f, marrow, YARD.x, YARD.z - 5);
    const held = (): void => {
      keep();
      out();
    };
    out();
    expect(inward(f, marrow)).toBeLessThan(-4.5);
    // Held there past the end of the window: due, and still open.
    while (f.sim.tickCount < lands + 40) {
      tick(f, held);
      expect(state(f)).toBe('open');
      expect(gateEntity(f).templateId).toBe(DUNGEON_GATE_TEMPLATES.open);
      expect(walled(f)).toBe(false);
    }
    expect(f.sim.tickCount).toBeGreaterThan(lands);
    expect(marrow.inCombat).toBe(true);
    // Let go, he walks back in to his target, and the seal lands on the
    // first tick he is on his own side of the line.
    let sealedAt = -1;
    for (let i = 0; i < 10 / DT && sealedAt < 0; i++) {
      const before = inward(f, marrow);
      tick(f, keep);
      if (state(f) === 'sealed') {
        sealedAt = i;
        expect(before).toBeLessThanOrEqual(0.6);
        expect(inward(f, marrow)).toBeGreaterThan(0);
      } else {
        expect(inward(f, marrow)).toBeLessThanOrEqual(0);
      }
    }
    expect(sealedAt).toBeGreaterThanOrEqual(0);
    expect(walled(f)).toBe(true);
    // Sealed with him inside: the collider did not shove him back out.
    run(f, 1, keep);
    expect(inward(f, marrow)).toBeGreaterThan(0);
  });

  it('a boss that dies inside the window never seals its room', () => {
    const { f, marrow } = yard();
    const keep = holder(f);
    f.sim.ctx.aggroMob(marrow, f.tank, false);
    run(f, 5, keep);
    expect(state(f)).toBe('open');
    f.sim.ctx.handleDeath(marrow, f.tank);
    for (let i = 0; i < 8 / DT; i++) {
      tick(f, keep);
      expect(state(f)).toBe('open');
      expect(walled(f)).toBe(false);
    }
    expect(gateEntity(f).gateSealTick).toBeUndefined();
  });

  it('a landed seal still holds while he walks home and opens when he stands idle', () => {
    const { f, marrow } = yard();
    const keep = holder(f);
    f.sim.ctx.aggroMob(marrow, f.tank, false);
    run(f, BOSS_ROOM_SEAL_DELAY_SECONDS + 1, keep);
    expect(state(f)).toBe('sealed');
    put(f, marrow, MID.x + 16, MID.z);
    for (const p of [f.tank, ...f.others]) f.sim.ctx.handleDeath(p, marrow);
    f.sim.tick();
    f.sim.tick();
    expect(marrow.aiState).toBe('evade');
    expect(state(f)).toBe('sealed');
    expect(walled(f)).toBe(true);
    for (let i = 0; i < 12 / DT && marrow.aiState !== 'idle'; i++) f.sim.tick();
    f.sim.tick();
    expect(marrow.aiState).toBe('idle');
    expect(state(f)).toBe('open');
    expect(walled(f)).toBe(false);
  });

  it('walked to his own door inside the window, he shuts it at once and stays inside', () => {
    const { f, marrow } = yard(0);
    // The tank pulls from outside the barrier and waits there for him.
    put(f, marrow, marrow.spawnPos.x - f.ox, marrow.spawnPos.z - f.oz);
    put(f, f.tank, YARD.x, YARD.z - 7);
    const keep = (): void => put(f, f.tank, YARD.x, YARD.z - 7);
    expect(inward(f, marrow)).toBeGreaterThan(20);
    f.sim.ctx.aggroMob(marrow, f.tank, false);
    let sealedAfter = -1;
    let nearest = Infinity;
    const window = BOSS_ROOM_SEAL_DELAY_TICKS - 20;
    for (let i = 0; i < window; i++) {
      tick(f, keep);
      nearest = Math.min(nearest, inward(f, marrow));
      if (sealedAfter < 0 && state(f) === 'sealed') sealedAfter = i + 1;
    }
    // Sealed early, well inside the ten seconds, on his arrival at the door.
    expect(sealedAfter).toBeGreaterThan(0);
    expect(sealedAfter).toBeLessThan(window);
    expect(walled(f)).toBe(true);
    // He never crossed the line: the door shut with him still on his side.
    expect(nearest).toBeGreaterThan(0.9);
    expect(nearest).toBeLessThanOrEqual(BOSS_ROOM_DOORWAY_REACH + 0.01);
    expect(marrow.inCombat).toBe(true);
    expect(marrow.aiState).not.toBe('evade');
  });

  it('draws no rng and is deterministic from the seed', () => {
    const timeline = (): string => {
      const { f, marrow } = yard();
      const keep = holder(f);
      f.sim.ctx.aggroMob(marrow, f.tank, false);
      let out = '';
      for (let i = 0; i < BOSS_ROOM_SEAL_DELAY_TICKS + 20; i++) {
        tick(f, keep);
        out += state(f) === 'sealed' ? 'S' : 'o';
      }
      let draws = 0;
      f.sim.rng.setObserver(() => {
        draws++;
      });
      for (let i = 0; i < 5; i++) tickDungeonGates(f.sim.ctx);
      f.sim.rng.setObserver(null);
      expect(draws).toBe(0);
      clearDungeonGateStateForTest();
      return out;
    };
    const a = timeline();
    expect(a).toBe(timeline());
    expect(a.indexOf('S')).toBe(BOSS_ROOM_SEAL_DELAY_TICKS);
  });

  // The wait for a boss past the line has no upper bound, by decision
  // (dungeon_gates.ts header): a timeout would only be a second way to seal a
  // boss out of its own room.
  it('held past his gate for a whole minute the room stays open, and it seals the tick he is home', () => {
    const { f, marrow } = yard();
    const keep = holder(f);
    f.sim.ctx.aggroMob(marrow, f.tank, false);
    tick(f, keep);
    const lands = gateEntity(f).gateSealTick as number;
    const out = (): void => put(f, marrow, YARD.x, YARD.z - 5);
    const held = (): void => {
      keep();
      marrow.hp = marrow.maxHp;
      out();
    };
    out();
    // Sixty seconds past the tick the seal fell due.
    while (f.sim.tickCount < lands + 60 / DT) {
      tick(f, held);
      expect(state(f)).toBe('open');
      expect(gateEntity(f).templateId).toBe(DUNGEON_GATE_TEMPLATES.open);
      expect(walled(f)).toBe(false);
    }
    expect(f.sim.tickCount - lands).toBeGreaterThanOrEqual(60 / DT);
    // Still his fight, and the seal still due: waiting, not forgotten.
    expect(marrow.inCombat).toBe(true);
    expect(marrow.aiState).not.toBe('evade');
    expect(gateEntity(f).gateSealTick).toBe(Number.POSITIVE_INFINITY);
    // Set down inside his yard, well clear of the doorway band: the very next
    // pass seals the room.
    const home = (): void => {
      keep();
      put(f, marrow, MID.x, MID.z);
    };
    home();
    expect(inward(f, marrow)).toBeGreaterThan(4);
    tick(f, home);
    expect(state(f)).toBe('sealed');
    expect(gateEntity(f).templateId).toBe(DUNGEON_GATE_TEMPLATES.sealed);
    expect(walled(f)).toBe(true);
  });

  // A player standing IN the gate's box on the tick the seal lands. The
  // collider appears round them; the movement kernel's push-out
  // (colliders.ts resolvePosition, what every step is resolved with) must put
  // them out on one side, the same side every time, and never leave them in a
  // spot no step leaves.
  it('a player standing in the gate box when the seal lands is put out on a deterministic side, never stuck, and the client agrees', () => {
    const landing = (): { f: Fight; marrow: Entity } => {
      const { f, marrow } = yard();
      const keep = holder(f);
      f.sim.ctx.aggroMob(marrow, f.tank, false);
      // A second player stands dead on the gate's line through the window.
      const inBox = (): void => {
        keep();
        put(f, f.others[0], YARD.x, YARD.z);
      };
      inBox();
      while (state(f) !== 'sealed') tick(f, inBox);
      return { f, marrow };
    };
    const { f, marrow } = landing();
    const seed = f.sim.cfg.seed;
    const player = f.others[0];
    const homeSide = { x: marrow.spawnPos.x - f.ox, z: marrow.spawnPos.z - f.oz };
    const sideOf = (wx: number, wz: number): number =>
      gateInward(YARD, homeSide, { x: wx - f.ox, z: wz - f.oz });
    // The collider stands, with the player inside it.
    expect(walled(f)).toBe(true);
    expect(Math.abs(sideOf(player.pos.x, player.pos.z))).toBeLessThan(0.01);
    expect(isBlocked(seed, player.pos.x, player.pos.z, 0.5)).toBe(true);

    // Where the kernel puts a body at a point of the box, and whether that
    // spot is clear floor.
    const settle = (wx: number, wz: number): { side: number; clear: boolean } => {
      const p = resolvePosition(seed, wx, wz, 0.5);
      return { side: sideOf(p.x, p.z), clear: !isBlocked(seed, p.x, p.z, 0.5) };
    };
    const server = {
      centre: settle(player.pos.x, player.pos.z),
      inside: settle(f.ox + YARD.x, f.oz + YARD.z + 0.2),
      outside: settle(f.ox + YARD.x, f.oz + YARD.z - 0.2),
    };
    // Out of the box, onto clear floor, each time.
    for (const s of Object.values(server)) {
      expect(s.clear).toBe(true);
      expect(Math.abs(s.side)).toBeGreaterThan(0.5);
    }
    // A step short of the middle goes back the way it came; the dead centre
    // has ONE answer (the boss's side or the party's, never either).
    const toward = (z: number): number => sideOf(f.ox + YARD.x, f.oz + z);
    expect(Math.sign(server.inside.side)).toBe(Math.sign(toward(YARD.z + 0.2)));
    expect(Math.sign(server.outside.side)).toBe(Math.sign(toward(YARD.z - 0.2)));
    expect(server.centre.side).not.toBe(0);

    // Never stuck: from where the player stands, a step in any direction
    // resolves to clear floor outside the box.
    for (let a = 0; a < 8; a++) {
      const dx = Math.sin((a * Math.PI) / 4) * 0.35;
      const dz = Math.cos((a * Math.PI) / 4) * 0.35;
      const step = settle(player.pos.x + dx, player.pos.z + dz);
      expect(step.clear, `heading ${a}`).toBe(true);
      expect(Math.abs(step.side), `heading ${a}`).toBeGreaterThan(0.5);
    }

    // The client, rebuilding its collision view from the gate entities it
    // mirrors, walls the same box and puts the same body in the same place.
    clearDungeonGateStateForTest();
    syncClientDungeonGates({ entities: f.sim.ctx.entities, player });
    const client = {
      centre: settle(player.pos.x, player.pos.z),
      inside: settle(f.ox + YARD.x, f.oz + YARD.z + 0.2),
      outside: settle(f.ox + YARD.x, f.oz + YARD.z - 0.2),
    };
    expect(client).toEqual(server);
    tickDungeonGates(f.sim.ctx);

    // And a second world from the same seed lands the same seal and settles
    // the same body on the same side.
    const again = landing();
    const twin = again.f.others[0];
    expect(again.f.sim.tickCount).toBe(f.sim.tickCount);
    const p = resolvePosition(again.f.sim.cfg.seed, twin.pos.x, twin.pos.z, 0.5);
    const q = resolvePosition(seed, player.pos.x, player.pos.z, 0.5);
    expect({ x: p.x - again.f.ox, z: p.z - again.f.oz }).toEqual({ x: q.x - f.ox, z: q.z - f.oz });
  });

  it('a claim freed with a seal stamped comes back clean', () => {
    const { f, marrow } = yard();
    const keep = holder(f);
    f.sim.ctx.aggroMob(marrow, f.tank, false);
    run(f, 4, keep);
    const stamped = gateEntity(f);
    expect(stamped.gateSealTick).toBeDefined();
    const slot = f.inst.slot;
    // The claim goes while the seal is still pending.
    freeInstance(f.sim.ctx, f.inst);
    expect(f.inst.partyKey).toBeNull();
    expect(f.sim.ctx.entities.has(stamped.id)).toBe(false);
    f.sim.tick();
    // The same party claims the crypt again.
    expect(enterDungeon(f.sim.ctx, 'hollow_crypt', f.tank.id)).toBe(true);
    const inst = f.sim.ctx.instances.find(
      (i) => i.dungeonId === 'hollow_crypt' && i.partyKey !== null,
    ) as InstanceSlot;
    expect(inst.slot).toBe(slot);
    const fresh = dungeonGateEntity(f.sim.ctx, inst, YARD);
    if (!fresh) throw new Error('no yard barrier in the new claim');
    // A new gate object, with no clock on it, shut behind its living packs.
    expect(fresh.id).not.toBe(stamped.id);
    expect(fresh.gateSealTick).toBeUndefined();
    // The party stands at the door it came in by, pulling nothing (left in
    // the yard it would pull the new Marrow at once and start a new clock,
    // which is the rule working, not a stamp that survived).
    for (const p of [f.tank, ...f.others]) {
      p.devNoAggro = true;
      p.pos = { ...f.tank.pos };
      p.prevPos = { ...p.pos };
      f.sim.ctx.grid.update(p);
    }
    for (let i = 0; i < 40; i++) {
      f.sim.tick();
      expect(dungeonGateState(f.sim.ctx, inst, YARD)).toBe('closed');
      expect(fresh.gateSealTick).toBeUndefined();
    }
    expect(fresh.templateId).toBe(DUNGEON_GATE_TEMPLATES.closed);
  });

  it('the seal clock never rides a snapshot or a character save', () => {
    const { f, marrow } = yard();
    const keep = holder(f);
    f.sim.ctx.aggroMob(marrow, f.tank, false);
    run(f, 2, keep);
    const gate = gateEntity(f);
    expect(gate.gateSealTick).toBeDefined();
    // A value no other field of the record could hold by chance.
    gate.gateSealTick = 987654321;
    const wire = JSON.stringify(wireEntity(gate));
    expect(wire).not.toContain('987654321');
    expect(wire).not.toContain('gateSealTick');
    // The state the client needs is on it all the same: the template id.
    expect(wire).toContain(DUNGEON_GATE_TEMPLATES.open);
    const save = JSON.stringify(f.sim.serializeCharacter(f.tank.id));
    expect(save).not.toContain('987654321');
    expect(save).not.toContain('gateSealTick');
  });
});

// Every sealing gate of every dungeon rides the same rule. A real claim and the
// real gate tick, with each boss's combat flags set by hand and the tick count
// advanced directly: the gate module reads nothing else, and the bosses' own
// entrances and scripts are not what is under test here.
describe('the boss-room seal delay: every sealing gate of every dungeon', () => {
  afterEach(() => clearDungeonGateStateForTest());

  const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
  const SEALING = Object.values(DUNGEONS).flatMap((d) =>
    (d.gates ?? []).filter((g) => g.sealWhileEngaged).map((g) => [d.id, g.id] as const),
  );

  it('covers the five reworked dungeons', () => {
    expect(new Set(SEALING.map(([d]) => d))).toEqual(
      new Set([
        'hollow_crypt',
        'sunken_bastion',
        'drowned_temple',
        'gravewyrm_sanctum',
        'wildheart_basin',
      ]),
    );
    expect(SEALING.length).toBeGreaterThanOrEqual(17);
  });

  function claim(dungeonId: string): { sim: Sim; inst: InstanceSlot } {
    const sim = new Sim({ seed: 11, playerClass: 'warrior', noPlayer: true, world: WORLD });
    const pid = sim.addPlayer('warrior', 'Sealwalker');
    sim.setPlayerLevel(20, pid);
    expect(enterDungeon(sim.ctx, dungeonId, pid)).toBe(true);
    const inst = sim.ctx.instances.find(
      (i) => i.dungeonId === dungeonId && i.partyKey !== null,
    ) as InstanceSlot;
    return { sim, inst };
  }

  function step(sim: Sim): void {
    (sim as unknown as { tickCount: number }).tickCount++;
    tickDungeonGates(sim.ctx);
  }

  it("Korgath's two Chain Stairs share one clock and land on the same tick", () => {
    const { sim, inst } = claim('gravewyrm_sanctum');
    const def = DUNGEONS.gravewyrm_sanctum;
    const stairs = (def.gates ?? []).filter((g) => g.sealWhileEngaged === 'korgath_the_bound');
    expect(stairs.map((g) => g.id).sort()).toEqual(['east_chain_stair', 'west_chain_stair']);
    let korgath: Entity | null = null;
    def.spawns.forEach((s, i) => {
      const mob = sim.ctx.entities.get(inst.mobIds[i]) as Entity;
      if (s.mobId === 'korgath_the_bound') {
        korgath = mob;
        return;
      }
      mob.hp = 0;
      mob.dead = true;
      mob.aiState = 'dead';
      mob.inCombat = false;
    });
    const boss = korgath as Entity | null;
    if (!boss) throw new Error('no Korgath');
    boss.aiState = 'chase';
    boss.inCombat = true;
    step(sim);
    const stamps = (): (number | undefined)[] =>
      stairs.map((g) => dungeonGateEntity(sim.ctx, inst, g)?.gateSealTick);
    const first = stamps();
    expect(first[0]).toBeDefined();
    expect(first[1]).toBe(first[0]);
    let landedTogether = false;
    for (let i = 0; i <= BOSS_ROOM_SEAL_DELAY_TICKS; i++) {
      const states = stairs.map((g) => dungeonGateState(sim.ctx, inst, g));
      // Never one stair shut and the other open.
      expect(states[0]).toBe(states[1]);
      expect(stamps()[1]).toBe(stamps()[0]);
      if (states[0] === 'sealed') {
        landedTogether = true;
        expect(i).toBe(BOSS_ROOM_SEAL_DELAY_TICKS);
      }
      step(sim);
    }
    expect(landedTogether).toBe(true);
    // Walked to ONE stair's doorway on a fresh pull, he shuts both at once.
    boss.aiState = 'idle';
    boss.inCombat = false;
    step(sim);
    expect(stamps()).toEqual([undefined, undefined]);
    boss.aiState = 'chase';
    boss.inCombat = true;
    step(sim);
    const o = instanceOrigin(def.index, inst.slot);
    const west = stairs.find((g) => g.id === 'west_chain_stair') as DungeonGateDef;
    // Two yards inside the west stair's line, on the side his spawn lies on.
    const home = { x: boss.spawnPos.x - o.x, z: boss.spawnPos.z - o.z };
    const toHome = Math.hypot(home.x - west.x, home.z - west.z);
    boss.pos.x = o.x + west.x + ((home.x - west.x) / toHome) * 2;
    boss.pos.z = o.z + west.z + ((home.z - west.z) / toHome) * 2;
    expect(inGateDoorway(west, home, { x: boss.pos.x - o.x, z: boss.pos.z - o.z })).toBe(true);
    step(sim);
    expect(stairs.map((g) => dungeonGateState(sim.ctx, inst, g))).toEqual(['sealed', 'sealed']);
  });

  // The seal judges "inside" by the half of the floor the boss's spawn lies
  // on. That is exact only while every sealed arena lies wholly on that half:
  // flood each room from its boss's spawn with every gate shut and prove it.
  it.each(SEALING)(
    '%s / %s: the sealed room lies wholly on the boss side of the line',
    (dungeonId, gateId) => {
      clearDungeonGateStateForTest();
      const def = DUNGEONS[dungeonId];
      const gate = (def.gates ?? []).find((g) => g.id === gateId) as DungeonGateDef;
      const spawn = def.spawns.find((s) => s.mobId === gate.sealWhileEngaged);
      if (!spawn) throw new Error(`${gate.sealWhileEngaged} has no spawn`);
      // Slot 0 of a world that claimed nothing: every gate collider stands.
      const o = instanceOrigin(def.index, 0);
      const home = { x: spawn.x, z: spawn.z };
      const seen = new Set<number>();
      const key = (x: number, z: number): number => (x + 2048) * 4096 + (z + 2048);
      const queue: [number, number][] = [[Math.round(spawn.x), Math.round(spawn.z)]];
      seen.add(key(queue[0][0], queue[0][1]));
      let least = Infinity;
      let cells = 0;
      while (queue.length > 0) {
        const [x, z] = queue.pop() as [number, number];
        cells++;
        least = Math.min(least, gateInward(gate, home, { x, z }));
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const nz = z + dz;
          if (Math.abs(nx) > 400 || Math.abs(nz) > 500 || seen.has(key(nx, nz))) continue;
          seen.add(key(nx, nz));
          if (!isBlocked(WORLD_SEED, o.x + nx, o.z + nz, 0.5)) queue.push([nx, nz]);
        }
      }
      // A real room, sealed (the flood did not leak into the dungeon), and no
      // floor of it past the line: a body can stand a yard inside at the least.
      expect(cells).toBeGreaterThan(500);
      expect(cells).toBeLessThan(12000);
      expect(least).toBeGreaterThan(1);
    },
  );

  it.each(SEALING)('%s / %s: open for the window, sealed when it runs out', (dungeonId, gateId) => {
    const { sim, inst } = claim(dungeonId);
    const def = DUNGEONS[dungeonId];
    const gate = (def.gates ?? []).find((g) => g.id === gateId) as DungeonGateDef;
    const bossId = gate.sealWhileEngaged as string;
    // Everything this gate waits on is dead; its boss stands at home.
    let live: Entity | null = null;
    def.spawns.forEach((s, i) => {
      const mob = sim.ctx.entities.get(inst.mobIds[i]) as Entity;
      if (s.mobId === bossId) {
        live = mob;
        return;
      }
      mob.hp = 0;
      mob.dead = true;
      mob.aiState = 'dead';
      mob.inCombat = false;
    });
    const mob = live as Entity | null;
    if (!mob) throw new Error(`${bossId} is not in the roster`);
    const o = instanceOrigin(def.index, inst.slot);
    const walled = (): boolean => isBlocked(sim.cfg.seed, o.x + gate.x, o.z + gate.z, 0.5);
    mob.aiState = 'idle';
    mob.inCombat = false;
    step(sim);
    expect(dungeonGateState(sim.ctx, inst, gate)).toBe('open');
    expect(walled()).toBe(false);
    // The pull.
    mob.aiState = 'chase';
    mob.inCombat = true;
    step(sim);
    for (let i = 1; i < BOSS_ROOM_SEAL_DELAY_TICKS; i++) {
      expect(dungeonGateState(sim.ctx, inst, gate), `tick ${i}`).toBe('open');
      step(sim);
    }
    expect(dungeonGateState(sim.ctx, inst, gate)).toBe('open');
    expect(walled()).toBe(false);
    step(sim);
    expect(dungeonGateState(sim.ctx, inst, gate)).toBe('sealed');
    expect(dungeonGateEntity(sim.ctx, inst, gate)?.templateId).toBe(DUNGEON_GATE_TEMPLATES.sealed);
    expect(walled()).toBe(true);
    // Every gate that seals for the same boss lands on the same tick.
    for (const twin of def.gates ?? []) {
      if (twin.sealWhileEngaged === bossId)
        expect(dungeonGateState(sim.ctx, inst, twin), twin.id).toBe('sealed');
    }
    // Home and idle: open again, and the clock is gone.
    mob.aiState = 'idle';
    mob.inCombat = false;
    step(sim);
    expect(dungeonGateState(sim.ctx, inst, gate)).toBe('open');
    expect(dungeonGateEntity(sim.ctx, inst, gate)?.gateSealTick).toBeUndefined();
    expect(walled()).toBe(false);
  });

  // "Its side" is read from the boss's spawnPos. A boss whose encounter stands
  // it somewhere else to fight (a scripted entrance), or rewrites spawnPos
  // itself, must still read INWARD of its own gate from every such spot, or
  // its seal would wait for ever. These are every scripted spot the sealing
  // bosses have; the scan below is what keeps the list honest.
  const SCRIPTED: Readonly<
    Record<string, { homes: { x: number; z: number }[]; spots: { x: number; z: number }[] }>
  > = {
    // Morthen lies entombed under the Rite Ring and rises on the same spot.
    morthen: { homes: [], spots: [MORTHEN_SPOT] },
    // Vael rises at each stop of his entrance and ends on his home mark.
    vael_the_mistcaller: { homes: [], spots: [...VAEL_INTRO_STOPS] },
    // Korzul bursts out of the ice and walks to the Hollow, where the
    // encounter moves his spawnPos (korzul_emerge.ts): both are his home.
    korzul_the_gravewyrm: {
      homes: [KORZUL_EMERGE_TO],
      spots: [KORZUL_EMERGE_FROM, KORZUL_EMERGE_TO],
    },
  };

  it.each(SEALING)(
    '%s / %s: its boss reads inward of the gate from its spawn and from every scripted spot',
    (dungeonId, gateId) => {
      const def = DUNGEONS[dungeonId];
      const gate = (def.gates ?? []).find((g) => g.id === gateId) as DungeonGateDef;
      const bossId = gate.sealWhileEngaged as string;
      const spawns = def.spawns.filter((s) => s.mobId === bossId);
      expect(spawns.length).toBeGreaterThan(0);
      const scripted = SCRIPTED[bossId] ?? { homes: [], spots: [] };
      const homes = [...spawns.map((s) => ({ x: s.x, z: s.z })), ...scripted.homes];
      const spots = [...spawns.map((s) => ({ x: s.x, z: s.z })), ...scripted.spots];
      for (const home of homes) {
        for (const spot of spots) {
          // A yard and more inside: clear of the line and of rounding.
          expect(
            gateInward(gate, home, spot),
            `${bossId} home (${home.x}, ${home.z}) at (${spot.x}, ${spot.z})`,
          ).toBeGreaterThan(1);
        }
      }
    },
  );

  it('knows every encounter that moves a spawn: a new one must be judged against its gate', () => {
    // Every file under src/sim/encounters that assigns a spawnPos. Each was
    // read for this suite: only korzul_emerge.ts moves a SEALING boss's home
    // (covered above); the rest re-home adds, shackles and raid bosses that
    // have no sealing gate. A file that joins this list has not been read yet.
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'sim', 'encounters');
    const writers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (
          entry.name.endsWith('.ts') &&
          /\.spawnPos\s*=[^=]/.test(readFileSync(path, 'utf8'))
        )
          writers.push(relative(root, path).replace(/\\/g, '/'));
      }
    };
    walk(root);
    expect(writers.sort()).toEqual([
      'gravewyrm_sanctum/korgath.ts',
      'gravewyrm_sanctum/korzul_emerge.ts',
      'hollow_crypt/knellwyrm.ts',
      'ignivar.ts',
      'nythraxis.ts',
      'varkhul.ts',
    ]);
    // And none of the others is a sealing boss's own module by another name:
    // the sealing bosses with a scripted spot are exactly the three above.
    const sealingBosses = new Set(
      Object.values(DUNGEONS).flatMap((d) =>
        (d.gates ?? []).flatMap((g) => (g.sealWhileEngaged ? [g.sealWhileEngaged] : [])),
      ),
    );
    for (const id of Object.keys(SCRIPTED)) expect(sealingBosses.has(id), id).toBe(true);
  });
});
