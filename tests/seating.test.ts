// Sitting on furniture (src/sim/seating.ts over the seat anchors in src/sim/seat_anchor.ts
// and the tavern's list in src/sim/content/mirefen_tavern_seats.ts): the anchors line up
// with the furniture, the sit command's server-side checks, occupancy (two bodies never
// share a seat, the patrons hold theirs), every stand-up path freeing the seat, the rest
// area and the innkeeper's stock.
import { beforeAll, describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  TAVERN_KEEPER_ENTITY_ID,
  TAVERN_ORIGIN,
  TAVERN_PIT,
  TAVERN_PROPS,
  TAVERN_TOWER,
  tavernToWorld,
} from '../src/sim/content/mirefen_tavern';
import { TAVERN_PATRONS } from '../src/sim/content/mirefen_tavern_patrons';
import { MIREFEN_TAVERN_SEATS } from '../src/sim/content/mirefen_tavern_seats';
import {
  bodyHoldsSeat,
  SEAT_CHAIR_HEIGHT,
  SEAT_HIGH_HEIGHT,
  SEAT_REACH,
  type SeatAnchor,
  seatHeldBy,
  seatRootY,
} from '../src/sim/seat_anchor';
import { activeSeats, BUILTIN_SEATS, seatById } from '../src/sim/seat_registry';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const seat = (id: string): SeatAnchor => {
  const s = seatById(id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
};

/** The unit vector a facing points along (the sim's atan2(dx, dz)). */
const along = (facing: number) => ({ x: Math.sin(facing), z: Math.cos(facing) });
/** Degrees between a seat's facing and the direction to a world point. */
function facingError(s: SeatAnchor, x: number, z: number): number {
  const f = along(s.facing);
  const dx = x - s.x;
  const dz = z - s.z;
  const cos = (f.x * dx + f.z * dz) / Math.hypot(dx, dz);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}
const local = (x: number, z: number) => ({ lx: TAVERN_ORIGIN.z - z, lz: x - TAVERN_ORIGIN.x });

describe('the tavern seat anchors', () => {
  it('seats every piece of furniture a body sits on, each place once', () => {
    const ids = MIREFEN_TAVERN_SEATS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const count = (prefix: string) => ids.filter((id) => id.startsWith(prefix)).length;
    expect(count('tavern_hearth_')).toBe(10); // five benches round the fire, two places each
    expect(count('tavern_nook_')).toBe(10); // the nook bench's five runs, two places each
    expect(count('tavern_longbench_')).toBe(5); // three on the room side, two by the wall
    expect(count('tavern_settle_')).toBe(14); // three booths and the fire's settle
    expect(count('tavern_chair_')).toBe(4);
    expect(count('tavern_stool_')).toBe(4); // the dice table's three and the bard's
    expect(count('tavern_barstool_')).toBe(4);
    expect(count('tavern_porch_')).toBe(1);
    expect(BUILTIN_SEATS).toEqual(MIREFEN_TAVERN_SEATS);
    expect(activeSeats()).toBe(BUILTIN_SEATS);
  });

  it('stands every seated body on clear floor, never inside furniture or a wall', () => {
    for (const s of MIREFEN_TAVERN_SEATS) {
      expect(isBlocked(WORLD_SEED, s.standX, s.standZ, 0.5), s.id).toBe(false);
      // on the seat's own floor (the pit's benches stand you in the pit); outside on the
      // terrace the cobbles follow the terrain, which falls gently toward the road, so the spot
      // behind a bench stands a hand off the ground under the bench's middle
      const slack = s.id.startsWith('tavern_terrace_') ? 0.3 : 0.06;
      expect(Math.abs(groundHeight(s.standX, s.standZ, WORLD_SEED) - s.floorY), s.id).toBeLessThan(
        slack,
      );
      // near enough that the drawn body's walk in stays short
      expect(Math.hypot(s.standX - s.x, s.standZ - s.z), s.id).toBeLessThan(4.5);
    }
  });

  it('keeps every stand spot apart, so each seat is held by exactly its own sitter', () => {
    for (const a of MIREFEN_TAVERN_SEATS) {
      for (const b of MIREFEN_TAVERN_SEATS) {
        if (a === b) continue;
        expect(
          Math.hypot(a.standX - b.standX, a.standZ - b.standZ),
          `${a.id}/${b.id}`,
        ).toBeGreaterThan(0.69);
      }
    }
  });

  it('turns each seat to what it faces', () => {
    const pit = tavernToWorld(TAVERN_PIT.x, TAVERN_PIT.z);
    const tower = tavernToWorld(TAVERN_TOWER.x, TAVERN_TOWER.z);
    const counter = TAVERN_PROPS.find(
      (p) => p.kind === 'counter' && (p.hw ?? 0) > 1,
    ) as NonNullable<(typeof TAVERN_PROPS)[number]>;
    for (const s of MIREFEN_TAVERN_SEATS) {
      if (s.id.startsWith('tavern_hearth_'))
        expect(facingError(s, pit.x, pit.z), s.id).toBeLessThan(35);
      if (s.id.startsWith('tavern_nook_'))
        expect(facingError(s, tower.x, tower.z), s.id).toBeLessThan(35);
      if (s.id.startsWith('tavern_barstool_')) {
        // straight at the counter: world -x is local -z (the back of the hall)
        const c = tavernToWorld(local(s.x, s.z).lx, counter.z);
        expect(facingError(s, c.x, c.z), s.id).toBeLessThan(1);
        expect(s.pose).toBe('high');
      }
      if (s.id.startsWith('tavern_porch_')) {
        // the road is world +x
        expect(Math.abs(s.facing - Math.PI / 2), s.id).toBeLessThan(1e-9);
      }
    }
    // the chairs and the booths' settles face their tables
    const tables = TAVERN_PROPS.filter((p) => p.kind === 'table' || p.kind === 'roundTable');
    const nearestTable = (s: SeatAnchor) => {
      const l = local(s.x, s.z);
      return tables.reduce((a, b) =>
        Math.hypot(a.x - l.lx, a.z - l.lz) < Math.hypot(b.x - l.lx, b.z - l.lz) ? a : b,
      );
    };
    for (const s of MIREFEN_TAVERN_SEATS) {
      const isBooth = s.id.startsWith('tavern_settle_') && s.via !== undefined;
      if (!s.id.startsWith('tavern_chair_') && !isBooth) continue;
      const t = nearestTable(s);
      const w = tavernToWorld(t.x, t.z);
      // a booth's places sit along the settle, so the table's middle is off-axis for them:
      // face across the booth (toward the table's near edge), within the settle's spread
      expect(facingError(s, w.x, w.z), s.id).toBeLessThan(isBooth ? 45 : 1);
    }
  });

  it('lines the seated height up with each piece: never floating, never sunk in wood', () => {
    for (const s of MIREFEN_TAVERN_SEATS) {
      const root = seatRootY(s);
      if (s.pose === 'high') {
        // a bar stool: its own clips, authored for its 1.0 seat over the platform
        expect(root - s.floorY, s.id).toBeCloseTo(SEAT_HIGH_HEIGHT, 9);
        expect(root, s.id).toBe(s.seatY);
      } else {
        // the chair clips were authored on a 0.9 seat: every seat's root is exactly that
        // over its floor, and never above the seat surface (a cushion gives under the body
        // by at most its own thickness, a plain board not at all)
        expect(root - s.floorY, s.id).toBeCloseTo(SEAT_CHAIR_HEIGHT, 9);
        expect(s.seatY - root, s.id).toBeGreaterThanOrEqual(-1e-9);
        expect(s.seatY - root, s.id).toBeLessThanOrEqual(0.13 + 1e-9);
      }
    }
  });

  it("sits each body just behind its seat's front edge, where the hanging calves clear it", () => {
    for (const s of MIREFEN_TAVERN_SEATS) {
      // the seat's footprint in front of the anchor, along its facing (the click box is the
      // furniture's footprint; a settle's seat board overhangs it by 0.05)
      const b = s.pick;
      const f = { x: Math.sin(s.facing), z: Math.cos(s.facing) };
      const ux = Math.cos(b.rot);
      const uz = -Math.sin(b.rot);
      const wx = Math.sin(b.rot);
      const wz = Math.cos(b.rot);
      // a stool's seat is round (its click box the square round it)
      const round = s.kind === 'stool' || s.kind === 'barStool';
      const support = round
        ? b.hw
        : Math.abs(f.x * ux + f.z * uz) * b.hw + Math.abs(f.x * wx + f.z * wz) * b.hd;
      const along = (s.x - b.x) * f.x + (s.z - b.z) * f.z;
      const lip = s.kind === 'settle' ? 0.05 : 0;
      expect(support + lip - along, s.id).toBeCloseTo(0.11, 6);
      // the drawn body steps in from no further than the clips stand it
      expect(s.presit, s.id).toBeGreaterThanOrEqual(0.3);
      expect(s.presit, s.id).toBeLessThanOrEqual(0.62);
    }
  });

  it('anchors each place on its piece of furniture, inside its click box', () => {
    for (const s of MIREFEN_TAVERN_SEATS) {
      const b = s.pick;
      const c = Math.cos(b.rot);
      const sn = Math.sin(b.rot);
      const u = (s.x - b.x) * c - (s.z - b.z) * sn;
      const w = (s.x - b.x) * sn + (s.z - b.z) * c;
      expect(Math.abs(u), s.id).toBeLessThanOrEqual(b.hw + 1e-9);
      expect(Math.abs(w), s.id).toBeLessThanOrEqual(b.hd + 1e-9);
      expect(b.y0, s.id).toBe(s.floorY);
      expect(b.y1, s.id).toBeGreaterThan(s.seatY);
    }
  });
});

describe('sitting down (the sit command)', () => {
  let sim: Sim;
  let a: number;
  let b: number;
  const events: SimEvent[] = [];
  const errorsFor = (pid: number) => {
    events.push(...sim.drainEvents());
    return events
      .filter((e) => e.type === 'error' && e.pid === pid)
      .map((e) => (e as { text: string }).text);
  };
  const body = (pid: number) => sim.entities.get(pid) as Entity;
  const standAt = (pid: number, s: SeatAnchor, dx = 0, dz = 0) => {
    const e = body(pid);
    e.pos.x = s.standX + dx;
    e.pos.z = s.standZ + dz;
    e.pos.y = groundHeight(e.pos.x, e.pos.z, WORLD_SEED);
    e.prevPos = { ...e.pos };
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) events.push(...sim.tick());
  };

  beforeAll(() => {
    sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    a = sim.addPlayer('warrior', 'Aleph');
    b = sim.addPlayer('mage', 'Bet');
    step();
  });

  it('seats the body on the stand spot, turned to the seat', () => {
    const s = seat('tavern_chair_0');
    standAt(a, s, 0.4, -0.3);
    body(a).facing = 1.23;
    sim.sitOnSeat(s.id, a);
    const e = body(a);
    expect(e.sitting).toBe(true);
    expect(e.pos.x).toBe(s.standX);
    expect(e.pos.z).toBe(s.standZ);
    expect(e.facing).toBe(s.facing);
    expect(seatHeldBy(e, BUILTIN_SEATS)).toBe(s);
    // it holds through ticks: no physics step drags a seated body off its spot
    step(10);
    expect(e.sitting).toBe(true);
    expect(Math.hypot(e.pos.x - s.standX, e.pos.z - s.standZ)).toBeLessThan(1e-6);
    expect(bodyHoldsSeat(e, s)).toBe(true);
  });

  it('never seats two bodies in one place', () => {
    const s = seat('tavern_chair_0');
    standAt(b, s, 0.2, 0.2);
    events.length = 0;
    sim.sitOnSeat(s.id, b);
    expect(body(b).sitting).toBe(false);
    expect(errorsFor(b)).toContain('Someone is already sitting there.');
  });

  it('keeps the patrons in their seats, held against every player', () => {
    for (const patron of TAVERN_PATRONS) {
      const npc = sim.entities.get(patron.entityId) as Entity;
      expect(npc.kind).toBe('npc');
      expect(npc.templateId).toBe(patron.npcId);
      expect(npc.sitting).toBe(true);
      const s = seat(patron.seatId);
      expect(seatHeldBy(npc, BUILTIN_SEATS)).toBe(s);
      expect(npc.facing).toBe(s.facing);
      standAt(b, s);
      events.length = 0;
      sim.sitOnSeat(s.id, b);
      expect(body(b).sitting, patron.npcId).toBe(false);
      expect(errorsFor(b)).toContain('Someone is already sitting there.');
    }
  });

  it('refuses from too far, a stranger seat id, the dead, combat and a rooted body', () => {
    const s = seat('tavern_chair_1');
    standAt(b, s, SEAT_REACH + 0.3, 0);
    events.length = 0;
    sim.sitOnSeat(s.id, b);
    expect(body(b).sitting).toBe(false);
    expect(errorsFor(b)).toEqual(['Too far away.']);

    // a forged id is dropped without a word
    standAt(b, s);
    events.length = 0;
    sim.sitOnSeat('no_such_seat', b);
    expect(body(b).sitting).toBe(false);
    expect(errorsFor(b)).toEqual([]);

    const e = body(b);
    e.inCombat = true;
    events.length = 0;
    sim.sitOnSeat(s.id, b);
    expect(e.sitting).toBe(false);
    expect(errorsFor(b)).toEqual(["You can't do that while in combat."]);
    e.inCombat = false;

    e.auras.push({
      id: 'test_root',
      name: 'Rooted',
      kind: 'root',
      remaining: 5,
      duration: 5,
      sourceId: e.id,
      value: 0,
      tickInterval: 0,
      tickTimer: 0,
    } as unknown as Entity['auras'][number]);
    events.length = 0;
    sim.sitOnSeat(s.id, b);
    expect(e.sitting).toBe(false);
    expect(errorsFor(b)).toEqual(["Can't move!"]);
    e.auras = e.auras.filter((x) => x.id !== 'test_root');

    e.dead = true;
    events.length = 0;
    sim.sitOnSeat(s.id, b);
    expect(e.sitting).toBe(false);
    expect(errorsFor(b)).toEqual(["You can't do that while dead."]);
    e.dead = false;
  });

  it('stands up (and frees the seat) on a step, a jump, a hit or a cast', () => {
    const s = seat('tavern_stool_0');
    const e = body(b);
    const sitDown = () => {
      standAt(b, s);
      events.length = 0;
      sim.sitOnSeat(s.id, b);
      expect(errorsFor(b)).toEqual([]);
      expect(e.sitting).toBe(true);
      expect(bodyHoldsSeat(e, s)).toBe(true);
    };
    const meta = sim.meta(b);
    if (!meta) throw new Error('no meta');

    sitDown();
    meta.moveInput = { ...meta.moveInput, forward: true };
    step();
    meta.moveInput = { ...meta.moveInput, forward: false };
    expect(e.sitting).toBe(false);
    expect(bodyHoldsSeat(e, s)).toBe(false);

    sitDown();
    meta.moveInput = { ...meta.moveInput, jump: true };
    step();
    meta.moveInput = { ...meta.moveInput, jump: false };
    step(20);
    expect(e.sitting).toBe(false);

    sitDown();
    sim.ctx.dealDamage(null, e, 1, false, 'physical', null, 'hit');
    step();
    expect(e.sitting).toBe(false);

    sitDown();
    e.resource = e.maxResource;
    sim.castAbility('frost_armor', b);
    step();
    // a cast from the seat stands the body up
    expect(e.sitting).toBe(false);
    // and the seat is free for someone else
    standAt(a, s);
    sim.sitOnSeat(s.id, a);
    expect(body(a).sitting).toBe(true);
  });

  it('keeps a seated body in its seat while it eats or drinks', () => {
    const s = seat('tavern_barstool_3');
    const e = body(b);
    standAt(b, s);
    sim.sitOnSeat(s.id, b);
    sim.addItem('baked_bread', 1, b);
    e.hp = Math.max(1, e.maxHp - 50);
    events.length = 0;
    sim.useItem('baked_bread', b);
    step(5);
    expect(errorsFor(b)).toEqual([]);
    expect(e.eating).not.toBeNull();
    expect(e.sitting).toBe(true);
    expect(bodyHoldsSeat(e, s)).toBe(true);
  });
});

describe('the tavern rests a body, and its innkeeper sells', () => {
  it('fills the rested pool inside, out of combat, and says it is resting', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const p = sim.player;
    p.level = 8;
    const inside = seat('tavern_longbench_1_1');
    p.pos.x = inside.standX;
    p.pos.z = inside.standZ;
    p.pos.y = groundHeight(p.pos.x, p.pos.z, WORLD_SEED);
    p.prevPos = { ...p.pos };
    const before = sim.restedXp;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(sim.resting).toBe(true);
    expect(sim.restedXp).toBeGreaterThan(before);
    // outside, on the road, nothing accrues
    const road = { x: TAVERN_ORIGIN.x + 26, z: TAVERN_ORIGIN.z };
    p.pos.x = road.x;
    p.pos.z = road.z;
    p.pos.y = groundHeight(road.x, road.z, WORLD_SEED);
    p.prevPos = { ...p.pos };
    sim.tick();
    const outside = sim.restedXp;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(sim.resting).toBe(false);
    expect(sim.restedXp).toBe(outside);
  });

  it('sells the marsh fare from behind the bar', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const p = sim.player;
    const keeper = sim.entities.get(TAVERN_KEEPER_ENTITY_ID) as Entity;
    p.pos.x = keeper.pos.x + 2.2;
    p.pos.z = keeper.pos.z;
    p.pos.y = keeper.pos.y;
    sim.copper = 10_000;
    const had = sim.countItem('smoked_eel');
    sim.buyItem(keeper.id, 'smoked_eel');
    expect(sim.countItem('smoked_eel')).toBeGreaterThan(had);
    expect(sim.copper).toBeLessThan(10_000);
  });
});
