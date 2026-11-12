// Bankshot (src/sim/pvp/skill_event_bankshot.ts): the seeded stone field, the
// harmless straight bolt, a banked hit, a bolt coming back for its owner, the
// Brace reflect, solid stones, the closing field, and the bolt stream with its
// client mirror (src/net/skill_event_marks_mirror.ts).

import { describe, expect, it } from 'vitest';
import { emitSkillEventBoltsKey } from '../server/world_pvp_wire';
import {
  applySkillEventBoltsWire,
  CLIENT_BOLT_SPEED,
  skillEventMarkBookOf,
} from '../src/net/skill_event_marks_mirror';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  BANKSHOT_BOLT_SPEED,
  BANKSHOT_FIELD_CLOSE_SECONDS,
  BANKSHOT_FIELD_MIN_RADIUS,
  BANKSHOT_STONE_COUNT,
  BANKSHOT_STONE_RADIUS,
  bankshotStonesAt,
  placeStones,
} from '../src/sim/pvp/skill_event_bankshot';
import {
  SKILL_EVENT_HEARTS,
  SKILL_EVENT_RADIUS,
  SKILL_EVENT_WARNING_SECONDS,
} from '../src/sim/pvp/skill_event_rules';
import { skillEventAction, skillEventBoltsFor } from '../src/sim/pvp/skill_events';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const SEED = 7;
const EMPTY_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
/** Bankshot is the fourth kind of the rotation. */
const BANKSHOT_ORDINAL = 3;

function ent(sim: Sim, pid: number): Entity {
  return sim.entities.get(pid)!;
}
function tickSeconds(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) sim.tick();
}
function place(sim: Sim, pid: number, dz: number, facing: number, dx = 0): void {
  const ev = sim.skillEventState.active!;
  const e = ent(sim, pid);
  e.pos = { x: ev.x + dx, y: groundHeight(ev.x + dx, ev.z + dz, SEED), z: ev.z + dz };
  e.prevPos = { ...e.pos };
  e.facing = facing;
}

/** Aleph at the centre facing +z, Bet 10 yd out on the same line facing back;
 *  the stones cleared so every path is the wall's. */
function field(): { sim: Sim; a: number; b: number } {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world: EMPTY_WORLD });
  sim.resetDay = '2026-11-12';
  const add = (name: string) => {
    const pid = sim.addPlayer('warrior', name, {
      autoEquip: true,
      characterId: 6000 + sim.players.size,
    });
    sim.setPlayerLevel(20, pid);
    return pid;
  };
  const a = add('Aleph');
  const b = add('Bet');
  sim.skillEventState.plan = {
    ordinal: BANKSHOT_ORDINAL,
    startsAt: sim.time + SKILL_EVENT_WARNING_SECONDS,
  };
  tickSeconds(sim, 1.1);
  const ev = sim.skillEventState.active!;
  expect(ev.kind).toBe('bankshot');
  place(sim, a, 0, 0);
  place(sim, b, 10, Math.PI);
  sim.joinSkillEvent(a);
  sim.joinSkillEvent(b);
  ev.startsAt = sim.time;
  tickSeconds(sim, 1.1);
  ev.bankshot!.stones = [];
  ev.startsAt = sim.time; // the field at full size for the whole test
  return { sim, a, b };
}
const hearts = (sim: Sim, pid: number) => ent(sim, pid).eventHearts;

describe('Bankshot', () => {
  it('draws the same stone field for the same event, spaced and inside the arena', () => {
    const { sim } = field();
    const one = placeStones(sim.ctx, 9);
    expect(one).toEqual(placeStones(sim.ctx, 9));
    expect(one.length).toBe(BANKSHOT_STONE_COUNT);
    for (const s of one) {
      expect(Math.hypot(s.dx, s.dz)).toBeLessThan(SKILL_EVENT_RADIUS);
      expect(s.r).toBe(BANKSHOT_STONE_RADIUS);
    }
  });

  it('a straight bolt is harmless; the same bolt banked off the wall takes a heart', () => {
    const { sim, a, b } = field();
    expect(skillEventAction(sim.ctx, a, 'bolt')).toBe(true);
    tickSeconds(sim, 0.6); // flies out through Bet unbounced
    expect(hearts(sim, b)).toBe(SKILL_EVENT_HEARTS);
    tickSeconds(sim, 1.2); // off the wall and back down the line
    expect(hearts(sim, b)).toBe(SKILL_EVENT_HEARTS - 1);
    expect(hearts(sim, a)).toBe(SKILL_EVENT_HEARTS);
    expect(skillEventBoltsFor(sim.ctx, a)).toHaveLength(0); // spent on the hit
  });

  it('a bolt can come back for its owner, and that never counts toward a win', () => {
    const { sim, a, b } = field();
    place(sim, b, 0, 0, 12); // out of the line
    expect(skillEventAction(sim.ctx, a, 'bolt')).toBe(true);
    tickSeconds(sim, 2.2);
    expect(hearts(sim, a)).toBe(SKILL_EVENT_HEARTS - 1);
    expect(sim.skillEventState.active!.heartsTaken.get(a) ?? 0).toBe(0);
  });

  it('a Brace turns a banked bolt back, and it is the bracer’s now', () => {
    const { sim, a, b } = field();
    skillEventAction(sim.ctx, a, 'bolt');
    tickSeconds(sim, 1.55); // the return is close to Bet
    expect(skillEventAction(sim.ctx, b, 'brace')).toBe(true);
    tickSeconds(sim, 0.2);
    expect(hearts(sim, b)).toBe(SKILL_EVENT_HEARTS);
    const bolts = sim.skillEventState.active!.bankshot!.bolts;
    expect(bolts).toHaveLength(1);
    expect(bolts[0].owner).toBe(b);
    expect(bolts[0].dz).toBeGreaterThan(0); // flying back out
  });

  it('stones are solid, and they close in with the field', () => {
    const { sim, a } = field();
    const ev = sim.skillEventState.active!;
    ev.bankshot!.stones = [{ dx: 5, dz: 0, r: BANKSHOT_STONE_RADIUS }];
    place(sim, a, 0, 0, 5);
    sim.tick();
    const [s] = bankshotStonesAt(ev, ev.bankshot!.stones, sim.time);
    expect(Math.hypot(ent(sim, a).pos.x - s.x, ent(sim, a).pos.z - s.z)).toBeGreaterThanOrEqual(
      BANKSHOT_STONE_RADIUS,
    );
    const closed = bankshotStonesAt(
      ev,
      ev.bankshot!.stones,
      ev.startsAt + BANKSHOT_FIELD_CLOSE_SECONDS,
    );
    expect(closed[0].x - ev.x).toBeCloseTo((5 * BANKSHOT_FIELD_MIN_RADIUS) / SKILL_EVENT_RADIUS, 6);
    expect(sim.skillEventInfoFor(a)?.stones).toHaveLength(1);
  });

  it('streams the bolts once per tick to everyone near, and the mirror extrapolates them', () => {
    const { sim, a, b } = field();
    skillEventAction(sim.ctx, a, 'bolt');
    sim.tick();
    const session = { lastSent: {} as Record<string, string> };
    const sent: string[] = [];
    const emit = (_k: 'sevb', s: string) => {
      sent.push(s);
      session.lastSent.sevb = s;
    };
    emitSkillEventBoltsKey(emit, sim, session, a);
    const other: string[] = [];
    emitSkillEventBoltsKey((_k, s) => other.push(s), sim, { lastSent: {} }, b);
    expect(other[0]).toBe(sent[0]); // one string, shared
    const target = {};
    applySkillEventBoltsWire(target, JSON.parse(sent[0]), 50);
    const book = skillEventMarkBookOf(target, 50);
    expect(book.bolts).toHaveLength(1);
    expect(book.bolts[0].harmful).toBe(false);
    expect(CLIENT_BOLT_SPEED).toBe(BANKSHOT_BOLT_SPEED);
    tickSeconds(sim, 2.5); // every bolt spent
    emitSkillEventBoltsKey(emit, sim, session, a);
    expect(sent[sent.length - 1]).toBe('[]');
  });
});
