// Footprints in Ash (src/sim/pvp/skill_event_footprints.ts): unseen fighters,
// footprints that fade, Sweep (hit and miss reveals), Hush, Pebble, the breath
// plume, the closing field, the last fighter standing, and the client mirror
// of the marks stream (src/net/skill_event_marks_mirror.ts).

import { describe, expect, it } from 'vitest';
import { canObserveEntity } from '../server/entity_observation';
import { emitSkillEventMarksKey } from '../server/world_pvp_wire';
import {
  applySkillEventMarksWire,
  CLIENT_MARK_LIFETIME,
  skillEventMarkBookOf,
} from '../src/net/skill_event_marks_mirror';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  FOOTPRINTS_FIELD_CLOSE_SECONDS,
  FOOTPRINTS_FIELD_MIN_RADIUS,
  FOOTPRINTS_HUSH,
  FOOTPRINTS_PEBBLE_LENGTH,
  FOOTPRINTS_REVEAL,
  footprintsFieldRadius,
  SKILL_EVENT_MARK_LIFETIME,
} from '../src/sim/pvp/skill_event_footprints';
import { keepsakeEligible } from '../src/sim/pvp/skill_event_kit';
import {
  SKILL_EVENT_HEARTS,
  SKILL_EVENT_RADIUS,
  SKILL_EVENT_WARNING_SECONDS,
} from '../src/sim/pvp/skill_event_rules';
import { skillEventAction, skillEventMarksFor } from '../src/sim/pvp/skill_events';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const SEED = 7;
const EMPTY_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
/** Footprints in Ash is the second kind of the rotation. */
const FOOTPRINTS_ORDINAL = 1;

function ent(sim: Sim, pid: number): Entity {
  return sim.entities.get(pid)!;
}
function tickSeconds(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) sim.tick();
}

/** Two fighters in a running Footprints in Ash, Bet 3 yd in front of Aleph,
 *  facing each other at the arena centre. */
function field(): { sim: Sim; a: number; b: number } {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world: EMPTY_WORLD });
  sim.resetDay = '2026-11-12';
  const add = (name: string) => {
    const pid = sim.addPlayer('warrior', name, {
      autoEquip: true,
      characterId: 4000 + sim.players.size,
    });
    sim.setPlayerLevel(20, pid);
    return pid;
  };
  const a = add('Aleph');
  const b = add('Bet');
  sim.skillEventState.plan = {
    ordinal: FOOTPRINTS_ORDINAL,
    startsAt: sim.time + SKILL_EVENT_WARNING_SECONDS,
  };
  tickSeconds(sim, 1.1);
  const ev = sim.skillEventState.active!;
  expect(ev.kind).toBe('footprints');
  place(sim, a, 0, 0);
  place(sim, b, 3, Math.PI);
  sim.joinSkillEvent(a);
  sim.joinSkillEvent(b);
  ev.startsAt = sim.time;
  tickSeconds(sim, 1.1);
  return { sim, a, b };
}
function place(sim: Sim, pid: number, dz: number, facing: number, dx = 0): void {
  const ev = sim.skillEventState.active!;
  const e = ent(sim, pid);
  e.pos = { x: ev.x + dx, y: groundHeight(ev.x + dx, ev.z + dz, SEED), z: ev.z + dz };
  e.prevPos = { ...e.pos };
  e.facing = facing;
}
/** Walk a fighter `yards` straight ahead over `seconds`, one tick at a time. */
function walk(sim: Sim, pid: number, yards: number, seconds: number): void {
  const steps = Math.round(seconds / DT);
  const e = ent(sim, pid);
  for (let i = 0; i < steps; i++) {
    e.pos = {
      x: e.pos.x + (Math.sin(e.facing) * yards) / steps,
      y: e.pos.y,
      z: e.pos.z + (Math.cos(e.facing) * yards) / steps,
    };
    sim.tick();
  }
}
const steps = (sim: Sim, pid: number) =>
  skillEventMarksFor(sim.ctx, pid).filter((m) => m.kind === 'step');

describe('Footprints in Ash', () => {
  it('hides every fighter from everyone else once it starts', () => {
    const { sim, a, b } = field();
    expect(ent(sim, a).eventUnseen).toBe(true);
    expect(ent(sim, b).eventUnseen).toBe(true);
    expect(ent(sim, a).eventHearts).toBe(SKILL_EVENT_HEARTS);
    // The server's interest scan sends an unseen fighter to no one else.
    expect(canObserveEntity(sim, ent(sim, b), ent(sim, a), 9)).toBe(false);
    expect(canObserveEntity(sim, ent(sim, a), ent(sim, a), 0)).toBe(true);
  });

  it('leaves footprints when you walk, which fade after their lifetime', () => {
    const { sim, a } = field();
    expect(steps(sim, a)).toHaveLength(0);
    walk(sim, a, 6, 1);
    const left = steps(sim, a);
    expect(left.length).toBeGreaterThanOrEqual(3);
    tickSeconds(sim, SKILL_EVENT_MARK_LIFETIME + 0.2);
    expect(steps(sim, a)).toHaveLength(0);
  });

  it('Hush walks without prints for its duration', () => {
    const { sim, a } = field();
    expect(skillEventAction(sim.ctx, a, 'hush')).toBe(true);
    walk(sim, a, 6, 1);
    expect(steps(sim, a)).toHaveLength(0);
    tickSeconds(sim, FOOTPRINTS_HUSH);
    walk(sim, a, 6, 1);
    expect(steps(sim, a).length).toBeGreaterThan(0);
    expect(skillEventAction(sim.ctx, a, 'hush')).toBe(false); // on cooldown
  });

  it('Pebble throws a trail as long as the card says, freshest at the far end', () => {
    const { sim, a } = field();
    expect(skillEventAction(sim.ctx, a, 'pebble')).toBe(true);
    const trail = steps(sim, a);
    expect(trail.length).toBeGreaterThan(8);
    const ev = sim.skillEventState.active!;
    const far = Math.max(...trail.map((m) => Math.hypot(m.x - ev.x, m.z - ev.z)));
    expect(far).toBeGreaterThan(FOOTPRINTS_PEBBLE_LENGTH - 1);
    expect(far).toBeLessThanOrEqual(FOOTPRINTS_PEBBLE_LENGTH + 0.5);
    const byDistance = [...trail].sort(
      (m, n) => Math.hypot(m.x - ev.x, m.z - ev.z) - Math.hypot(n.x - ev.x, n.z - ev.z),
    );
    expect(byDistance[byDistance.length - 1].at).toBeGreaterThan(byDistance[0].at);
    expect(skillEventAction(sim.ctx, a, 'pebble')).toBe(false); // on cooldown
  });

  it('a Sweep that hits takes a heart and reveals both fighters', () => {
    const { sim, a, b } = field();
    expect(skillEventAction(sim.ctx, a, 'sweep')).toBe(true);
    sim.tick();
    expect(ent(sim, b).eventHearts).toBe(SKILL_EVENT_HEARTS - 1);
    expect(ent(sim, a).eventUnseen).toBeUndefined();
    expect(ent(sim, b).eventUnseen).toBeUndefined();
    tickSeconds(sim, FOOTPRINTS_REVEAL + 0.1);
    expect(ent(sim, a).eventUnseen).toBe(true);
    expect(ent(sim, b).eventUnseen).toBe(true);
  });

  it('a Sweep that misses reveals only the swinger', () => {
    const { sim, a, b } = field();
    ent(sim, a).facing = 0.5 + Math.PI; // away from Bet
    expect(skillEventAction(sim.ctx, a, 'sweep')).toBe(true);
    sim.tick();
    expect(ent(sim, b).eventHearts).toBe(SKILL_EVENT_HEARTS);
    expect(ent(sim, a).eventUnseen).toBeUndefined();
    expect(ent(sim, b).eventUnseen).toBe(true);
  });

  it('standing still shows a breath plume', () => {
    const { sim, a } = field();
    tickSeconds(sim, 5);
    expect(skillEventMarksFor(sim.ctx, a).some((m) => m.kind === 'breath')).toBe(true);
  });

  it('the ash field closes, and a fighter outside it is seen', () => {
    const { sim, a } = field();
    const ev = sim.skillEventState.active!;
    expect(footprintsFieldRadius(ev, ev.startsAt)).toBe(SKILL_EVENT_RADIUS);
    expect(footprintsFieldRadius(ev, ev.startsAt + FOOTPRINTS_FIELD_CLOSE_SECONDS)).toBe(
      FOOTPRINTS_FIELD_MIN_RADIUS,
    );
    expect(sim.skillEventInfoFor(a)?.fieldRadius).toBeLessThan(SKILL_EVENT_RADIUS);
    place(sim, a, 0, 0, SKILL_EVENT_RADIUS - 1);
    ev.startsAt -= FOOTPRINTS_FIELD_CLOSE_SECONDS; // fully closed
    sim.tick();
    expect(ent(sim, a).eventUnseen).toBeUndefined();
  });

  it('the last fighter standing wins, and everyone shows again', () => {
    const { sim, a, b } = field();
    const ev = sim.skillEventState.active!;
    for (let i = 0; i < SKILL_EVENT_HEARTS; i++) {
      skillEventAction(sim.ctx, a, 'sweep');
      tickSeconds(sim, 1.1);
    }
    expect(ent(sim, b).dead).toBe(true);
    tickSeconds(sim, 1.1);
    expect(ev.winner).toBe(a);
    expect(sim.skillEventState.active).toBeNull();
    expect(ent(sim, a).eventUnseen).toBeUndefined();
  });

  it('never offers class stealth as the keepsake', () => {
    const { sim, a } = field();
    for (const k of sim.players.get(a)!.known) {
      const stealth = k.def.effects.some((e) => (e as { kind?: string }).kind === 'stealth');
      if (stealth) expect(keepsakeEligible(k.def), k.def.id).toBe(false);
    }
  });
});

describe('the marks stream', () => {
  it('sends only new marks, and the client mirror rebuilds the same book', () => {
    const { sim, a } = field();
    const session = { lastSent: {} as Record<string, string> };
    const sent: string[] = [];
    const emit = (_key: 'sevm', s: string) => {
      sent.push(s);
      session.lastSent.sevm = s;
    };
    emitSkillEventMarksKey(emit, sim, session, a);
    expect(sent).toEqual(['[]']); // the stream opens even on bare ash
    skillEventAction(sim.ctx, a, 'pebble');
    emitSkillEventMarksKey(emit, sim, session, a);
    emitSkillEventMarksKey(emit, sim, session, a); // nothing new: nothing sent
    expect(sent).toHaveLength(2);
    const target = {};
    for (const s of sent) applySkillEventMarksWire(target, JSON.parse(s), 100);
    const book = skillEventMarkBookOf(target, 100);
    const sim_marks = skillEventMarksFor(sim.ctx, a);
    expect(book.marks.map((m) => m.seq)).toEqual(sim_marks.map((m) => m.seq));
    // The client clock carries each mark's age: the thrown trail's backdating.
    for (let i = 0; i < book.marks.length; i++) {
      expect(100 - book.marks[i].at).toBeCloseTo(sim.time - sim_marks[i].at, 1);
    }
    expect(skillEventMarkBookOf(target, 100 + CLIENT_MARK_LIFETIME + 0.1).marks).toHaveLength(0);
    expect(CLIENT_MARK_LIFETIME).toBe(SKILL_EVENT_MARK_LIFETIME);
  });

  it('never streams the marks to someone outside the fight, and closes with null', () => {
    const { sim, a } = field();
    const session = { lastSent: {} as Record<string, string> };
    const sent: string[] = [];
    const emit = (_key: 'sevm', s: string) => {
      sent.push(s);
      session.lastSent.sevm = s;
    };
    const outsider = sim.addPlayer('mage', 'Gimel', { characterId: 4999 });
    emitSkillEventMarksKey(emit, sim, { lastSent: {} }, outsider);
    emitSkillEventMarksKey(emit, sim, session, a);
    expect(sent).toEqual(['[]']);
    sim.skillEventState.active!.hearts.delete(a);
    emitSkillEventMarksKey(emit, sim, session, a);
    expect(sent).toEqual(['[]', 'null']);
    const target = {};
    applySkillEventMarksWire(target, [1, 0, 0, 0, 0, 0], 5);
    applySkillEventMarksWire(target, null, 5);
    expect(skillEventMarkBookOf(target, 5).marks).toHaveLength(0);
  });
});
