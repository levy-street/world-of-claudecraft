// Rite of Tongues (src/sim/pvp/skill_event_tongues.ts): no damage, the Rite
// chant and what breaks it, Sever on a real chant and on a fake, Shove, the
// circle wipe, the lone-fighter rule, the stance tell, and the win at 5.

import { describe, expect, it } from 'vitest';
import { castBarState } from '../src/render/cast_bar';
import { BUILTIN_WORLD } from '../src/sim/data';
import { SKILL_EVENT_WARNING_SECONDS } from '../src/sim/pvp/skill_event_rules';
import {
  TONGUES_CHANT,
  TONGUES_CIRCLE,
  TONGUES_RITES_TO_WIN,
  TONGUES_SEVER_WINDUP,
  TONGUES_SHOVE_DISTANCE,
  TONGUES_SILENCE,
} from '../src/sim/pvp/skill_event_tongues';
import { skillEventAction } from '../src/sim/pvp/skill_events';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const SEED = 7;
const EMPTY_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
/** Rite of Tongues is the third kind of the rotation. */
const TONGUES_ORDINAL = 2;

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

/** Two fighters in a running Rite of Tongues, Bet 3 yd in front of Aleph. */
function rite(): { sim: Sim; a: number; b: number } {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world: EMPTY_WORLD });
  sim.resetDay = '2026-11-12';
  const add = (name: string) => {
    const pid = sim.addPlayer('warrior', name, {
      autoEquip: true,
      characterId: 5000 + sim.players.size,
    });
    sim.setPlayerLevel(20, pid);
    return pid;
  };
  const a = add('Aleph');
  const b = add('Bet');
  sim.skillEventState.plan = {
    ordinal: TONGUES_ORDINAL,
    startsAt: sim.time + SKILL_EVENT_WARNING_SECONDS,
  };
  tickSeconds(sim, 1.1);
  const ev = sim.skillEventState.active!;
  expect(ev.kind).toBe('tongues');
  place(sim, a, 0, 0);
  place(sim, b, 3, Math.PI);
  sim.joinSkillEvent(a);
  sim.joinSkillEvent(b);
  ev.startsAt = sim.time;
  tickSeconds(sim, 1.1);
  return { sim, a, b };
}
const rites = (sim: Sim, pid: number) => sim.skillEventInfoFor(pid)?.score?.yours ?? -1;

describe('Rite of Tongues', () => {
  it('no one is on hearts, and no hit between fighters does any damage', () => {
    const { sim, a, b } = rite();
    expect(ent(sim, a).eventHearts).toBeUndefined();
    const hp = ent(sim, b).hp;
    sim.ctx.dealDamage(ent(sim, a), ent(sim, b), 500, false, 'physical', null, 'hit');
    expect(ent(sim, b).hp).toBe(hp);
  });

  it('a full Rite scores one, shown as a filling chant on the tell', () => {
    const { sim, a } = rite();
    expect(rites(sim, a)).toBe(0);
    expect(skillEventAction(sim.ctx, a, 'rite')).toBe(true);
    tickSeconds(sim, TONGUES_CHANT / 2);
    expect(ent(sim, a).eventStance).toBe('chant');
    expect(ent(sim, a).eventStanceFill).toBeGreaterThan(0.3);
    expect(ent(sim, a).eventStanceFill).toBeLessThan(0.7);
    // Every client's cast bar shows the chant filling, with no countdown text.
    const bar = castBarState(ent(sim, a));
    expect(bar).toMatchObject({ visible: true, untimed: true, label: 'skill_event_stance_chant' });
    expect(bar.fill).toBe(ent(sim, a).eventStanceFill);
    tickSeconds(sim, TONGUES_CHANT / 2 + 0.1);
    expect(rites(sim, a)).toBe(1);
    expect(ent(sim, a).eventStance).toBeUndefined();
  });

  it('moving breaks a chant', () => {
    const { sim, a } = rite();
    skillEventAction(sim.ctx, a, 'rite');
    tickSeconds(sim, 1);
    ent(sim, a).pos.x += 1;
    tickSeconds(sim, TONGUES_CHANT);
    expect(rites(sim, a)).toBe(0);
  });

  it('a Sever that lands on a real chant breaks it and silences the chanter', () => {
    const { sim, a, b } = rite();
    skillEventAction(sim.ctx, b, 'rite');
    expect(skillEventAction(sim.ctx, a, 'sever')).toBe(true);
    tickSeconds(sim, 0.1);
    expect(ent(sim, a).eventStance).toBe('sever');
    tickSeconds(sim, TONGUES_SEVER_WINDUP);
    expect(ent(sim, b).eventStance).toBe('silenced');
    expect(skillEventAction(sim.ctx, b, 'rite')).toBe(false);
    expect(skillEventAction(sim.ctx, a, 'rite')).toBe(true); // the severer is free
    tickSeconds(sim, TONGUES_SILENCE + 0.1);
    expect(rites(sim, b)).toBe(0);
  });

  it('a False Start under a Sever turns it back on the severer', () => {
    const { sim, a, b } = rite();
    skillEventAction(sim.ctx, b, 'rite');
    skillEventAction(sim.ctx, a, 'sever');
    tickSeconds(sim, 0.2);
    expect(skillEventAction(sim.ctx, b, 'false_start')).toBe(true);
    tickSeconds(sim, TONGUES_SEVER_WINDUP);
    expect(ent(sim, a).eventStance).toBe('silenced');
    expect(skillEventAction(sim.ctx, a, 'rite')).toBe(false);
    expect(skillEventAction(sim.ctx, b, 'rite')).toBe(true);
  });

  it('a Shove pushes the target away and breaks the chant', () => {
    const { sim, a, b } = rite();
    skillEventAction(sim.ctx, b, 'rite');
    const before = Math.hypot(
      ent(sim, b).pos.x - ent(sim, a).pos.x,
      ent(sim, b).pos.z - ent(sim, a).pos.z,
    );
    expect(skillEventAction(sim.ctx, a, 'shove')).toBe(true);
    const after = Math.hypot(
      ent(sim, b).pos.x - ent(sim, a).pos.x,
      ent(sim, b).pos.z - ent(sim, a).pos.z,
    );
    expect(after).toBeGreaterThan(before + TONGUES_SHOVE_DISTANCE - 1);
    tickSeconds(sim, TONGUES_CHANT + 0.1);
    expect(rites(sim, b)).toBe(0);
    expect(skillEventAction(sim.ctx, a, 'shove')).toBe(false); // on cooldown
  });

  it('leaving the circle wipes your count', () => {
    const { sim, a } = rite();
    skillEventAction(sim.ctx, a, 'rite');
    tickSeconds(sim, TONGUES_CHANT + 0.1);
    expect(rites(sim, a)).toBe(1);
    place(sim, a, 0, 0, TONGUES_CIRCLE + 2);
    sim.tick();
    expect(rites(sim, a)).toBe(0);
  });

  it('alone in the circle, no Rite can start', () => {
    const { sim, a, b } = rite();
    place(sim, b, 0, 0, TONGUES_CIRCLE + 3);
    sim.tick();
    expect(skillEventAction(sim.ctx, a, 'rite')).toBe(false);
  });

  it(`the first to ${TONGUES_RITES_TO_WIN} Rites wins`, () => {
    const { sim, a } = rite();
    const ev = sim.skillEventState.active!;
    for (let i = 0; i < TONGUES_RITES_TO_WIN; i++) {
      expect(skillEventAction(sim.ctx, a, 'rite')).toBe(true);
      tickSeconds(sim, TONGUES_CHANT + 0.1);
    }
    expect(ev.winner).toBe(a);
    tickSeconds(sim, 1.1);
    expect(sim.skillEventState.active).toBeNull();
    expect(ent(sim, a).eventStance).toBeUndefined();
  });
});
