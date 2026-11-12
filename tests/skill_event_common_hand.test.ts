// The Common Hand (src/sim/pvp/skill_event_common_hand.ts): the deck and its
// four categories, the seeded deal and the bell, the equal-for-all damage and
// heal rule, dealt casts and what breaks them, the 8 second return, and the
// win at 4 killing blows.

import { describe, expect, it } from 'vitest';
import { applyHeal } from '../src/sim/combat/heal';
import { ABILITIES, BUILTIN_WORLD } from '../src/sim/data';
import {
  COMMON_HAND_DIRECT_SHARE,
  COMMON_HAND_EVENT_SECONDS,
  COMMON_HAND_HEAL_SHARE,
  COMMON_HAND_RESPAWN,
  COMMON_HAND_SECONDS,
  COMMON_HAND_SHIELD_SHARE,
  commonHandDeck,
  commonHandFor,
  HAND_CATEGORIES,
  handCategoryOf,
} from '../src/sim/pvp/skill_event_common_hand';
import { KEEPSAKE_EXCLUDED_IDS } from '../src/sim/pvp/skill_event_kit';
import { SKILL_EVENT_WARNING_SECONDS } from '../src/sim/pvp/skill_event_rules';
import { skillEventAction } from '../src/sim/pvp/skill_events';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const SEED = 7;
const EMPTY_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
/** The Common Hand is the fifth kind of the rotation. */
const COMMON_HAND_ORDINAL = 4;

function ent(sim: Sim, pid: number): Entity {
  return sim.entities.get(pid)!;
}
function tickSeconds(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) sim.tick();
}
function place(sim: Sim, pid: number, dz: number, facing: number): void {
  const ev = sim.skillEventState.active!;
  const e = ent(sim, pid);
  e.pos = { x: ev.x, y: groundHeight(ev.x, ev.z + dz, SEED), z: ev.z + dz };
  e.prevPos = { ...e.pos };
  e.facing = facing;
}

/** A warrior and a mage 3 yd apart, facing each other, in a running Common Hand. */
function table(): { sim: Sim; a: number; b: number } {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world: EMPTY_WORLD });
  sim.resetDay = '2026-11-12';
  const add = (cls: 'warrior' | 'mage', name: string) => {
    const pid = sim.addPlayer(cls, name, { autoEquip: true, characterId: 7000 + sim.players.size });
    sim.setPlayerLevel(20, pid);
    return pid;
  };
  const a = add('warrior', 'Aleph');
  const b = add('mage', 'Bet');
  sim.skillEventState.plan = {
    ordinal: COMMON_HAND_ORDINAL,
    startsAt: sim.time + SKILL_EVENT_WARNING_SECONDS,
  };
  tickSeconds(sim, 1.1);
  const ev = sim.skillEventState.active!;
  expect(ev.kind).toBe('common_hand');
  place(sim, a, 0, 0);
  place(sim, b, 3, Math.PI);
  sim.joinSkillEvent(a);
  sim.joinSkillEvent(b);
  ev.startsAt = sim.time;
  tickSeconds(sim, 1.1);
  ent(sim, a).targetId = b;
  ent(sim, b).targetId = a;
  return { sim, a, b };
}
/** Put one ability in a hand slot (the category's slot). */
function deal(sim: Sim, slot: number, id: string): void {
  const book = sim.skillEventState.active!.commonHand!;
  book.hand[slot] = id;
  book.dealt.add(id);
}
const deck = () => commonHandDeck();
const instantAttack = () =>
  deck().attack.find(
    (id) =>
      ABILITIES[id].castTime === 0 && ABILITIES[id].cooldown <= 10 && ABILITIES[id].range >= 5,
  )!;

describe('The Common Hand deck', () => {
  it('holds every category from more than one class, and no immunity', () => {
    for (const c of HAND_CATEGORIES) {
      expect(deck()[c].length, c).toBeGreaterThan(0);
      for (const id of deck()[c]) {
        expect(handCategoryOf(ABILITIES[id])).toBe(c);
        expect(KEEPSAKE_EXCLUDED_IDS.has(id)).toBe(false);
      }
    }
    const classes = new Set(deck().attack.map((id) => ABILITIES[id].class));
    expect(classes.size).toBeGreaterThan(3);
  });

  it('deals one of each, the same on every host, and a new hand at the bell', () => {
    const { sim } = table();
    const one = commonHandFor(sim.ctx, 4, 0);
    expect(one).toEqual(commonHandFor(sim.ctx, 4, 0));
    for (const [i, id] of one.entries())
      expect(handCategoryOf(ABILITIES[id])).toBe(HAND_CATEGORIES[i]);
    const book = sim.skillEventState.active!.commonHand!;
    expect(book.index).toBe(0);
    tickSeconds(sim, COMMON_HAND_SECONDS);
    expect(book.index).toBe(1);
    expect(book.hand).toEqual(commonHandFor(sim.ctx, 4, 1));
  });

  it('runs ten minutes', () => {
    const { sim } = table();
    const ev = sim.skillEventState.active!;
    expect(ev.endsAt - ev.startsAt).toBeLessThanOrEqual(COMMON_HAND_EVENT_SECONDS + 1.2);
  });
});

describe('The Common Hand fight', () => {
  it('a dealt hit takes the same share of health whatever the gear; an auto-attack does nothing', () => {
    const { sim, a, b } = table();
    const atk = instantAttack();
    deal(sim, 0, atk);
    const before = ent(sim, b).hp;
    expect(skillEventAction(sim.ctx, a, 'hand_0')).toBe(true);
    tickSeconds(sim, 1.5); // a projectile lands
    const lost = before - ent(sim, b).hp;
    expect(lost).toBe(Math.round(ent(sim, b).maxHp * COMMON_HAND_DIRECT_SHARE));
    const hp = ent(sim, b).hp;
    sim.ctx.dealDamage(ent(sim, a), ent(sim, b), 999, false, 'physical', null, 'hit');
    expect(ent(sim, b).hp).toBe(hp);
  });

  it('a dealt heal restores a fixed share', () => {
    const { sim, b } = table();
    const e = ent(sim, b);
    e.hp = Math.round(e.maxHp / 2);
    sim.skillEventState.active!.commonHand!.dealt.add('healing_touch_probe');
    const before = e.hp;
    applyHeal(sim.ctx, e, e, 99999, 'healing_touch_probe', 'healing_touch_probe');
    expect(e.hp - before).toBe(Math.round(e.maxHp * COMMON_HAND_HEAL_SHARE));
  });

  it('a dealt shield holds a fixed share of health', () => {
    const { sim, a } = table();
    const shield = deck().defensive.find(
      (id) =>
        ABILITIES[id].castTime === 0 && ABILITIES[id].effects.some((e) => e.type === 'absorb'),
    )!;
    expect(shield).toBeDefined();
    deal(sim, 2, shield);
    expect(skillEventAction(sim.ctx, a, 'hand_2')).toBe(true);
    const aura = ent(sim, a).auras.find((x) => x.kind === 'absorb');
    expect(aura?.value).toBe(Math.round(ent(sim, a).maxHp * COMMON_HAND_SHIELD_SHARE));
  });

  it('a dealt cast takes its time and moving breaks it', () => {
    const { sim, a, b } = table();
    const slow = deck().attack.find(
      (id) => ABILITIES[id].castTime >= 1 && ABILITIES[id].range >= 5,
    );
    if (!slow) return; // the deck holds no cast-time attack
    deal(sim, 0, slow);
    const before = ent(sim, b).hp;
    expect(skillEventAction(sim.ctx, a, 'hand_0')).toBe(true);
    sim.tick();
    expect(ent(sim, a).eventStance).toBe('hand');
    expect(ent(sim, a).eventCastId).toBe(slow);
    ent(sim, a).pos.x += 1;
    tickSeconds(sim, ABILITIES[slow].castTime + 1.5);
    expect(ent(sim, b).hp).toBe(before);
  });

  it('the fallen return after 8 seconds, and 4 killing blows win', () => {
    const { sim, a, b } = table();
    const ev = sim.skillEventState.active!;
    const atk = instantAttack();
    for (let kill = 1; kill <= 4; kill++) {
      deal(sim, 0, atk);
      ent(sim, b).hp = 1;
      ev.kits.get(a)?.readyAt.clear();
      expect(skillEventAction(sim.ctx, a, 'hand_0')).toBe(true);
      tickSeconds(sim, 1.5);
      expect(ent(sim, b).dead).toBe(true);
      if (kill < 4) {
        tickSeconds(sim, COMMON_HAND_RESPAWN);
        expect(ent(sim, b).dead).toBe(false);
        expect(ent(sim, b).hp).toBe(ent(sim, b).maxHp);
        place(sim, b, 3, Math.PI);
      }
    }
    expect(ev.winner).toBe(a);
  });
});
