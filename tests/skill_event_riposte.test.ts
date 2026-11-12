// Riposte (src/sim/pvp/skill_event_riposte.ts) and the skill event kit
// (src/sim/pvp/skill_event_kit.ts): the lunge, the guard and its perfect
// window, the overheld guard, the feint, the anti-passive rule, the last
// fencer standing, and the keepsake cast lock.

import { describe, expect, it } from 'vitest';
import { ABILITIES, BUILTIN_WORLD } from '../src/sim/data';
import { KEEPSAKE_EXCLUDED_IDS, keepsakeEligible } from '../src/sim/pvp/skill_event_kit';
import {
  RIPOSTE_GUARD_MAX,
  RIPOSTE_LUNGE_WINDUP,
  RIPOSTE_OPEN_AFTER_GUARD,
  RIPOSTE_PASSIVE_LIMIT,
} from '../src/sim/pvp/skill_event_riposte';
import { SKILL_EVENT_HEARTS, SKILL_EVENT_WARNING_SECONDS } from '../src/sim/pvp/skill_event_rules';
import {
  SKILL_EVENT_NOT_YET_LINE,
  skillEventAction,
  skillEventCastAllowed,
  skillEventPickKeepsake,
} from '../src/sim/pvp/skill_events';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass, WorldContent } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const SEED = 7;
const EMPTY_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function ent(sim: Sim, pid: number): Entity {
  return sim.entities.get(pid)!;
}
function tickSeconds(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) sim.tick();
}

/** Two fencers in a running Riposte, Bet 3 yd in front of Aleph, facing each other. */
function yard(cls: PlayerClass = 'warrior'): { sim: Sim; a: number; b: number } {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world: EMPTY_WORLD });
  sim.resetDay = '2026-11-12';
  const add = (name: string) => {
    const pid = sim.addPlayer(cls, name, { autoEquip: true, characterId: 3000 + sim.players.size });
    sim.setPlayerLevel(20, pid);
    ent(sim, pid).hp = ent(sim, pid).maxHp;
    return pid;
  };
  const a = add('Aleph');
  const b = add('Bet');
  sim.skillEventState.plan = { ordinal: 0, startsAt: sim.time + SKILL_EVENT_WARNING_SECONDS };
  tickSeconds(sim, 1.1);
  const ev = sim.skillEventState.active!;
  const place = (pid: number, dz: number, facing: number) => {
    const e = ent(sim, pid);
    e.pos = { x: ev.x, y: groundHeight(ev.x, ev.z + dz, SEED), z: ev.z + dz };
    e.prevPos = { ...e.pos };
    e.facing = facing;
  };
  place(a, 0, 0);
  place(b, 3, Math.PI);
  sim.joinSkillEvent(a);
  sim.joinSkillEvent(b);
  ev.startsAt = sim.time;
  tickSeconds(sim, 1.1);
  return { sim, a, b };
}
const hearts = (sim: Sim, pid: number) => ent(sim, pid).eventHearts;

describe('Riposte', () => {
  it('a lunge lands after its wind-up and takes one heart', () => {
    const { sim, a, b } = yard();
    expect(skillEventAction(sim.ctx, a, 'lunge')).toBe(true);
    expect(ent(sim, a).eventStance).toBeUndefined(); // the stance syncs on the next tick
    sim.tick();
    expect(ent(sim, a).eventStance).toBe('lunge');
    expect(hearts(sim, b)).toBe(SKILL_EVENT_HEARTS);
    tickSeconds(sim, RIPOSTE_LUNGE_WINDUP + 0.1);
    expect(hearts(sim, b)).toBe(SKILL_EVENT_HEARTS - 1);
  });

  it('a guard raised just before the lunge lands is a riposte: no heart, attacker open', () => {
    const { sim, a, b } = yard();
    skillEventAction(sim.ctx, a, 'lunge');
    tickSeconds(sim, RIPOSTE_LUNGE_WINDUP - 0.15);
    expect(skillEventAction(sim.ctx, b, 'guard')).toBe(true);
    tickSeconds(sim, 0.25);
    expect(hearts(sim, b)).toBe(SKILL_EVENT_HEARTS);
    expect(ent(sim, a).eventStance).toBe('open');
    expect(skillEventAction(sim.ctx, a, 'lunge')).toBe(false);
    expect(skillEventAction(sim.ctx, a, 'guard')).toBe(false);
  });

  it('a late guard turns the thrust aside without a riposte', () => {
    const { sim, a, b } = yard();
    skillEventAction(sim.ctx, b, 'guard'); // raised early: past the perfect window
    skillEventAction(sim.ctx, a, 'lunge');
    tickSeconds(sim, RIPOSTE_LUNGE_WINDUP + 0.1);
    expect(hearts(sim, b)).toBe(SKILL_EVENT_HEARTS);
    expect(ent(sim, a).eventStance).not.toBe('open');
  });

  it('a guard held the whole time leaves the fencer open', () => {
    const { sim, b } = yard();
    skillEventAction(sim.ctx, b, 'guard');
    tickSeconds(sim, RIPOSTE_GUARD_MAX + 0.1);
    expect(ent(sim, b).eventStance).toBe('open');
    expect(skillEventAction(sim.ctx, b, 'lunge')).toBe(false);
    tickSeconds(sim, RIPOSTE_OPEN_AFTER_GUARD);
    expect(skillEventAction(sim.ctx, b, 'lunge')).toBe(true);
  });

  it('a button that cannot fire yet says so', () => {
    const { sim, a } = yard();
    const errors: string[] = [];
    const emit = sim.ctx.error;
    sim.ctx.error = (pid, text, reason) => {
      if (pid === a) errors.push(text);
      emit(pid, text, reason);
    };
    expect(skillEventAction(sim.ctx, a, 'lunge')).toBe(true);
    expect(errors).toEqual([]);
    expect(skillEventAction(sim.ctx, a, 'lunge')).toBe(false); // already winding up
    expect(errors).toEqual([SKILL_EVENT_NOT_YET_LINE]);
  });

  it('a feint cancels the wind-up', () => {
    const { sim, a, b } = yard();
    skillEventAction(sim.ctx, a, 'lunge');
    tickSeconds(sim, 0.2);
    expect(skillEventAction(sim.ctx, a, 'feint')).toBe(true);
    tickSeconds(sim, RIPOSTE_LUNGE_WINDUP + 0.2);
    expect(hearts(sim, b)).toBe(SKILL_EVENT_HEARTS);
    expect(skillEventAction(sim.ctx, a, 'feint')).toBe(false); // nothing to feint, and on cooldown
  });

  it('a fencer who has not lunged lately cannot guard', () => {
    const { sim, b } = yard();
    tickSeconds(sim, RIPOSTE_PASSIVE_LIMIT + 0.5);
    expect(skillEventAction(sim.ctx, b, 'guard')).toBe(false);
    skillEventAction(sim.ctx, b, 'lunge');
    tickSeconds(sim, RIPOSTE_LUNGE_WINDUP + 0.5);
    expect(skillEventAction(sim.ctx, b, 'guard')).toBe(true);
  });

  it('the last fencer standing wins', () => {
    const { sim, a, b } = yard();
    const ev = sim.skillEventState.active!;
    for (let i = 0; i < SKILL_EVENT_HEARTS; i++) {
      skillEventAction(sim.ctx, a, 'lunge');
      tickSeconds(sim, RIPOSTE_LUNGE_WINDUP + 0.5);
    }
    expect(ent(sim, b).dead).toBe(true);
    tickSeconds(sim, 1.1);
    expect(sim.skillEventState.active).toBeNull();
    expect(ev.winner).toBe(a);
  });
});

describe('the skill event kit', () => {
  it('never offers a full immunity or a damage ability as the keepsake', () => {
    for (const id of KEEPSAKE_EXCLUDED_IDS) {
      if (ABILITIES[id]) expect(keepsakeEligible(ABILITIES[id]), id).toBe(false);
    }
    expect(keepsakeEligible(ABILITIES.charge)).toBe(true); // Onrush: movement and a stun
    expect(keepsakeEligible(ABILITIES.blink)).toBe(true); // Flitstep moves
    expect(keepsakeEligible(ABILITIES.fire_blast)).toBe(false); // damage
  });

  it('locks every cast but the keepsake while the event runs', () => {
    const { sim, a } = yard();
    expect(skillEventCastAllowed(sim.ctx, a, 'heroic_strike')).toBe(false);
    const known = sim.players.get(a)!.known.map((k) => k.def);
    const pick = known.find((def) => keepsakeEligible(def))!;
    expect(pick).toBeDefined();
    expect(skillEventPickKeepsake(sim.ctx, a, pick.id)).toBe(true);
    expect(skillEventCastAllowed(sim.ctx, a, pick.id)).toBe(true);
    const damage = known.find((def) => !keepsakeEligible(def))!;
    expect(skillEventPickKeepsake(sim.ctx, a, damage.id)).toBe(false);
  });
});
