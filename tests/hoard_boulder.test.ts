// Grask's Rolling Boulder (src/sim/rift/hoard_boulder.ts + its shared core).
import { describe, expect, it } from 'vitest';
import { hoardBossCueViews, tickHoardBossMechanics } from '../src/sim/rift/hoard_boss';
import { BOULDER_EVERY_SEC, holdHoardBoulder } from '../src/sim/rift/hoard_boulder';
import {
  BOULDER,
  boulderAnswerRange,
  boulderPlan,
  boulderProgress,
  boulderReturnSec,
  boulderRunsOver,
  boulderTravelSec,
  HOARD_BOULDER_DAZE_AURA_ID,
  HOARD_BOULDER_DREAD_AURA_ID,
  HOARD_BOULDER_STAGGER_AURA_ID,
  isBoulderVariant,
  standsWith,
  supportersNeeded,
} from '../src/sim/rift/hoard_boulder_core';
import { HOARD_CAST_ROLLING_BOULDER } from '../src/sim/rift/hoard_control_cast_ids';
import type { RiftInstance } from '../src/sim/rift/types';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, RUN_SPEED, type SimEvent } from '../src/sim/types';

type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

const GEARED_HEALTH = 1400;

function encounter(rarity: Rarity = 'rare') {
  const sim = new Sim({ seed: 5150, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.enterRift(makeVaultSeed(3, 183), 23, sim.player.id, undefined, {
    ...sim.player,
    id: -1,
    vaultOwnerPid: sim.player.id,
    vaultRarity: rarity,
  });
  const inst = sim.riftInstances.find((entry) => entry.partyKey !== null);
  if (!inst || inst.bossId === null) throw new Error('missing hoard');
  const boss = sim.entities.get(inst.bossId);
  if (!boss) throw new Error('missing boss');
  boss.templateId = 'rift_boss_brute';
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  sim.player.pos = { ...boss.pos, z: boss.pos.z - 18 };
  // A geared level-20 damage dealer's health: the boulder hits a flat amount,
  // which a naked body (no gear) does not survive, and a geared one does.
  sim.player.maxHp = GEARED_HEALTH;
  sim.player.hp = sim.player.maxHp;
  tickHoardBossMechanics(sim.ctx);
  sim.drainEvents();
  quietKit(inst);
  return { sim, inst, boss };
}

/** His combo is not under test: park its clock. */
function quietKit(inst: RiftInstance): void {
  if (!inst.hoardBoss) throw new Error('missing state');
  inst.hoardBoss.sweepTimer = 999;
  inst.hoardBoss.markTimer = 999;
  inst.hoardBoss.cues.length = 0;
}

function addAllies(entry: ReturnType<typeof encounter>, count: number): Entity[] {
  const allies: Entity[] = [];
  for (let n = 0; n < count; n++) {
    const id = 7001 + n;
    const ally = { ...entry.sim.player, id, pos: { ...entry.sim.player.pos }, auras: [] };
    // Spread across the room, well outside anyone's support ring.
    ally.pos.x += (n % 2 === 0 ? 1 : -1) * (8 + 7 * Math.floor(n / 2));
    ally.pos.z += 6;
    entry.sim.entities.set(id, ally);
    entry.inst.memberIds.add(id);
    allies.push(ally);
  }
  entry.inst.memberIds.add(entry.sim.player.id);
  return allies;
}

function run(sim: Sim, boss: Entity, seconds: number, each?: () => void): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    boss.aiState = 'attack';
    each?.();
    tickHoardBossMechanics(sim.ctx);
    events.push(...sim.drainEvents());
  }
  return events;
}

function held(entry: ReturnType<typeof encounter>) {
  const state = entry.inst.hoardBoss?.boulder;
  if (!state) throw new Error('missing boulder state');
  return state;
}

function cast(entry: ReturnType<typeof encounter>): SimEvent[] {
  held(entry).timer = 0;
  return run(entry.sim, entry.boss, DT * 2);
}

const cuesOf = (inst: RiftInstance, variant: string) =>
  hoardBossCueViews(inst).filter((cue) => cue.variant === variant && cue.remaining > 0);
const everyone = (entry: ReturnType<typeof encounter>): Entity[] =>
  [...new Set([entry.sim.player.id, ...entry.inst.memberIds])]
    .map((id) => entry.sim.entities.get(id))
    .filter((e): e is Entity => !!e);
const marked = (entry: ReturnType<typeof encounter>) =>
  everyone(entry).filter((p) => p.auras.some((a) => a.id === HOARD_BOULDER_DREAD_AURA_ID));
const has = (e: Entity, id: string) => e.auras.some((a) => a.id === id);

describe('the boulder numbers (pure, shared with the renderer)', () => {
  it('asks for one ally of two, two of three to five, nobody of one', () => {
    expect(supportersNeeded(1)).toBe(0);
    expect(supportersNeeded(2)).toBe(1);
    expect(supportersNeeded(3)).toBe(2);
    expect(supportersNeeded(5)).toBe(2);
    expect(supportersNeeded(6)).toBe(3);
    // Always answerable: never more than everyone else.
    for (let living = 2; living <= 12; living++)
      expect(supportersNeeded(living)).toBeLessThanOrEqual(living - 1);
  });

  it('only doubles when the party can answer BOTH boulders at once', () => {
    expect(boulderPlan(1, true)).toEqual({ boulders: 1, needed: 0 });
    expect(boulderPlan(3, true)).toEqual({ boulders: 1, needed: 2 });
    expect(boulderPlan(4, false)).toEqual({ boulders: 1, needed: 2 });
    expect(boulderPlan(4, true)).toEqual({ boulders: 2, needed: 1 });
    expect(boulderPlan(6, true)).toEqual({ boulders: 2, needed: 2 });
    for (let living = 1; living <= 12; living++) {
      const plan = boulderPlan(living, true);
      // The marked cannot help each other: the free players cover every boulder.
      expect(plan.boulders * plan.needed).toBeLessThanOrEqual(living - plan.boulders);
      if (plan.boulders === 2) expect(plan.needed).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives the party time to get there, however close the mark stands', () => {
    expect(boulderTravelSec(0)).toBe(BOULDER.minTravelSec);
    expect(boulderTravelSec(27)).toBeCloseTo(27 / BOULDER.rollSpeed, 9);
    // Pressed by rarity it rolls faster, never instantly.
    expect(boulderTravelSec(27, 1.16)).toBeLessThan(boulderTravelSec(27));
    expect(boulderTravelSec(1, 1.16)).toBe(BOULDER.minTravelSec);
    expect(boulderReturnSec(24)).toBeCloseTo(24 / BOULDER.returnSpeed, 9);
    // An ally clear across a hoard room still makes it.
    expect(boulderAnswerRange(1.16)).toBeGreaterThan(28);
    expect(BOULDER.warningSec).toBeGreaterThanOrEqual(2);
    expect(BOULDER.rollSpeed).toBeGreaterThan(RUN_SPEED);
  });

  it('rolls from his hands to its mark, gathering pace, only after the warning', () => {
    const travel = 2;
    const total = BOULDER.warningSec + travel;
    expect(boulderProgress(BOULDER.warningSec - 0.1, total, travel)).toBe(0);
    expect(boulderProgress(total, total, travel)).toBe(1);
    const a = boulderProgress(BOULDER.warningSec + 0.5, total, travel);
    const b = boulderProgress(BOULDER.warningSec + 1, total, travel);
    const c = boulderProgress(BOULDER.warningSec + 1.5, total, travel);
    expect(b - a).toBeLessThan(c - b);
    expect(a).toBeGreaterThan(0);
  });

  it('runs down what is in its lane, swept, and nothing beside it', () => {
    expect(boulderRunsOver(0, 0, 0, 20, 0.2, 0.3, 0.5, 5)).toBe(true);
    expect(boulderRunsOver(0, 0, 0, 20, 0.2, 0.3, BOULDER.boulderRadius + 0.2, 5)).toBe(false);
    // Not yet there, and already past.
    expect(boulderRunsOver(0, 0, 0, 20, 0, 0.1, 0, 12)).toBe(false);
    expect(boulderRunsOver(0, 0, 0, 20, 0.9, 1, 0, 5)).toBe(false);
    // A big step never jumps a player.
    expect(boulderRunsOver(0, 0, 0, 20, 0, 1, 0, 10)).toBe(true);
    expect(boulderRunsOver(0, 0, 0, 20, 0.5, 0.5, 0, 10)).toBe(false);
    expect(standsWith(0, 0, BOULDER.supportRadius - 0.1, 0)).toBe(true);
    expect(standsWith(0, 0, BOULDER.supportRadius + 0.1, 0)).toBe(false);
  });

  it('names its cue variants', () => {
    for (const v of [
      'brute-boulder-throw',
      'brute-boulder',
      'brute-boulder-return',
      'brute-boulder-crush',
    ])
      expect(isBoulderVariant(v)).toBe(true);
    expect(isBoulderVariant('brute-wide')).toBe(false);
    expect(isBoulderVariant(undefined)).toBe(false);
  });
});

describe('the boulder in the fight', () => {
  it('alone: nobody is rooted, the lane runs past the player, and a sidestep dodges it', () => {
    for (const dodge of [true, false]) {
      const entry = encounter();
      const events = cast(entry);
      expect(events.some((e) => e.type === 'log' && /Get out of its way/.test(e.text))).toBe(true);
      expect(marked(entry)).toHaveLength(0);
      const [cue] = cuesOf(entry.inst, 'brute-boulder');
      expect(cue.targetId).toBeUndefined();
      expect(cue.innerRadius).toBe(0);
      // The lane ends beyond where the player stood.
      const toPlayer = Math.hypot(
        entry.sim.player.pos.x - entry.boss.pos.x,
        entry.sim.player.pos.z - entry.boss.pos.z,
      );
      const toEnd = Math.hypot(cue.x - entry.boss.pos.x, cue.z - entry.boss.pos.z);
      expect(toEnd).toBeCloseTo(toPlayer + BOULDER.soloOvershoot, 3);
      if (dodge) entry.sim.player.pos = { ...entry.sim.player.pos, x: entry.sim.player.pos.x + 6 };
      const hp = entry.sim.player.hp;
      const rest = run(entry.sim, entry.boss, cue.total + BOULDER.crushSec + 0.5);
      const hits = rest.filter(
        (e) =>
          e.type === 'damage' &&
          e.ability === 'Rolling Boulder' &&
          e.targetId === entry.sim.player.id,
      );
      expect(hits).toHaveLength(dodge ? 0 : 1);
      expect(has(entry.sim.player, HOARD_BOULDER_DAZE_AURA_ID)).toBe(!dodge);
      if (dodge) expect(entry.sim.player.hp).toBe(hp);
      else expect(entry.sim.player.dead).toBe(false);
      const broke = rest.find(
        (e) => e.type === 'hoardBossCue' && e.variant === 'brute-boulder-crush',
      );
      expect(broke?.type === 'hoardBossCue' && broke.innerRadius).toBe(dodge ? 0 : 1);
      // All done: no cue of his is left, and the clock runs again.
      expect(
        hoardBossCueViews(entry.inst).filter((c) => isBoulderVariant(c.variant) && c.remaining > 0),
      ).toHaveLength(0);
      expect(held(entry).boulders).toHaveLength(0);
      expect(held(entry).timer).toBeGreaterThan(BOULDER_EVERY_SEC * 0.8);
    }
  });

  it('hits a flat amount: stamina survives it, a thin body does not', () => {
    const lost: number[] = [];
    for (const health of [GEARED_HEALTH, 2000, 600]) {
      const entry = encounter();
      entry.sim.player.maxHp = health;
      entry.sim.player.hp = health;
      cast(entry);
      const [cue] = cuesOf(entry.inst, 'brute-boulder');
      const rest = run(entry.sim, entry.boss, cue.total + BOULDER.crushSec + 0.5);
      if (health === 600) {
        // No safety net: a lone player who stood in its lane on thin health dies.
        expect(entry.sim.player.dead).toBe(true);
        continue;
      }
      expect(entry.sim.player.dead).toBe(false);
      const hit = rest.find(
        (e) =>
          e.type === 'damage' &&
          e.ability === 'Rolling Boulder' &&
          e.targetId === entry.sim.player.id,
      );
      lost.push(hit?.type === 'damage' ? hit.amount : 0);
    }
    // The tank and the damage dealer took the same blow (it was never a share).
    expect(lost[0]).toBeGreaterThan(0);
    expect(lost[1]).toBe(lost[0]);
  });

  it('in a party: marks ONE player, roots them, and shows what it asks', () => {
    const entry = encounter();
    addAllies(entry, 2);
    const events = cast(entry);
    expect(events.some((e) => e.type === 'log' && /Stand with them/.test(e.text))).toBe(true);
    const rooted = marked(entry);
    expect(rooted).toHaveLength(1);
    const [cue] = cuesOf(entry.inst, 'brute-boulder');
    expect(cue.targetId).toBe(rooted[0].id);
    expect(cue.radius).toBe(BOULDER.supportRadius);
    expect(cue.innerRadius).toBe(2);
    expect(cue.x).toBeCloseTo(rooted[0].pos.x, 6);
    const [carrier] = cuesOf(entry.inst, 'brute-boulder-throw');
    expect(carrier.cueId).toBe(cue.cueId - 1);
    expect(carrier.x).toBe(entry.boss.pos.x);
    // The root is a real root, and no player counter sheds it.
    const dread = rooted[0].auras.find((a) => a.id === HOARD_BOULDER_DREAD_AURA_ID);
    expect(dread?.kind).toBe('root');
    expect(dread?.unbreakableControl).toBe(true);
    // He winds up with a bar on his frame, planted where he stands.
    expect(entry.boss.castingAbility).toBe(HOARD_CAST_ROLLING_BOULDER);
    entry.boss.pos.x += 3;
    expect(holdHoardBoulder(entry.sim.ctx, entry.boss)).toBe(true);
    expect(entry.boss.pos.x).toBe(carrier.x);
    run(entry.sim, entry.boss, BOULDER.warningSec + DT);
    expect(entry.boss.castingAbility).toBeNull();
    expect(holdHoardBoulder(entry.sim.ctx, entry.boss)).toBe(false);
  });

  it('too few stood with them: the mark is crushed, stunned, and let go', () => {
    const entry = encounter();
    const allies = addAllies(entry, 2);
    cast(entry);
    const target = marked(entry)[0];
    const [cue] = cuesOf(entry.inst, 'brute-boulder');
    // ONE ally comes; it asks for two.
    const helper = [entry.sim.player, ...allies].find((p) => p.id !== target.id);
    if (!helper) throw new Error('no helper');
    helper.pos = { ...target.pos, x: target.pos.x + 2 };
    const hp = target.hp;
    const events = run(entry.sim, entry.boss, cue.total + DT * 2);
    expect(target.hp).toBeLessThan(hp);
    expect(target.dead).toBe(false);
    expect(has(target, HOARD_BOULDER_DAZE_AURA_ID)).toBe(true);
    expect(has(target, HOARD_BOULDER_DREAD_AURA_ID)).toBe(false);
    expect(helper.hp).toBe(helper.maxHp);
    expect(has(entry.boss, HOARD_BOULDER_STAGGER_AURA_ID)).toBe(false);
    expect(events.some((e) => e.type === 'log' && /too few stood/.test(e.text))).toBe(true);
    expect(
      events.some((e) => e.type === 'hoardBossCue' && e.variant === 'brute-boulder-crush'),
    ).toBe(true);
  });

  it('enough stood with them: it goes back, staggers him, costs him, and his combo waits', () => {
    const entry = encounter();
    const allies = addAllies(entry, 2);
    cast(entry);
    const target = marked(entry)[0];
    const [cue] = cuesOf(entry.inst, 'brute-boulder');
    const group = [entry.sim.player, ...allies];
    const gather = () => {
      let n = 0;
      for (const p of group)
        if (p.id !== target.id) p.pos = { ...target.pos, x: target.pos.x + 1.5 * ++n };
    };
    const bossHp = entry.boss.hp;
    const events = run(entry.sim, entry.boss, cue.total + DT, gather);
    expect(events.some((e) => e.type === 'log' && /thrown back/.test(e.text))).toBe(true);
    const back = cuesOf(entry.inst, 'brute-boulder-return');
    expect(back).toHaveLength(1);
    expect(back[0].cueId).toBe(cue.cueId);
    for (const p of group) {
      expect(p.hp).toBe(p.maxHp);
      expect(has(p, HOARD_BOULDER_DREAD_AURA_ID)).toBe(false);
      expect(has(p, HOARD_BOULDER_DAZE_AURA_ID)).toBe(false);
    }
    expect(has(entry.boss, HOARD_BOULDER_STAGGER_AURA_ID)).toBe(false);
    run(entry.sim, entry.boss, back[0].total + DT, gather);
    const stagger = entry.boss.auras.find((a) => a.id === HOARD_BOULDER_STAGGER_AURA_ID);
    expect(stagger?.kind).toBe('stun');
    expect(entry.boss.hp).toBe(
      bossHp - Math.round(entry.boss.maxHp * BOULDER.reflectDamageFraction),
    );
    // While he reels his combo is held back, then the room is clean again.
    const state = entry.inst.hoardBoss;
    if (!state) throw new Error('missing state');
    state.sweepTimer = 0.1;
    // Only the hoard engine ticks here, so the stun is run down by hand: the hold
    // lasts exactly as long as the aura does.
    const reel = () => {
      gather();
      for (const aura of entry.boss.auras) aura.remaining -= DT;
      entry.boss.auras = entry.boss.auras.filter((aura) => aura.remaining > 0);
    };
    run(entry.sim, entry.boss, BOULDER.bossStunSec - 1, reel);
    expect(hoardBossCueViews(entry.inst).some((c) => c.variant === 'brute-wide')).toBe(false);
    run(entry.sim, entry.boss, 2.5, reel);
    expect(held(entry).boulders).toHaveLength(0);
    expect(
      hoardBossCueViews(entry.inst).filter((c) => isBoulderVariant(c.variant) && c.remaining > 0),
    ).toHaveLength(0);
  });

  it('throwing it back is worth NO threat, and he never hits himself if the mark has died', () => {
    const entry = encounter();
    const allies = addAllies(entry, 2);
    cast(entry);
    const target = marked(entry)[0];
    const [cue] = cuesOf(entry.inst, 'brute-boulder');
    const group = [entry.sim.player, ...allies];
    const gather = () => {
      let n = 0;
      for (const p of group)
        if (p.id !== target.id) p.pos = { ...target.pos, x: target.pos.x + 1.5 * ++n };
    };
    const threatBefore = entry.boss.threat.get(target.id) ?? 0;
    run(entry.sim, entry.boss, cue.total + DT, gather);
    const [back] = cuesOf(entry.inst, 'brute-boulder-return');
    // The mark dies while it is on its way back.
    target.dead = true;
    const events = run(entry.sim, entry.boss, back.total + DT, gather);
    const reflect = events.find(
      (e) => e.type === 'damage' && e.targetId === entry.boss.id && e.ability === 'Rolling Boulder',
    );
    expect(reflect?.type === 'damage' && reflect.sourceId).toBe(target.id);
    expect(entry.boss.threat.get(target.id) ?? 0).toBe(threatBefore);
  });

  it('a ROOTED mark is never killed by the boulder alone, and is let go even if they died', () => {
    const entry = encounter();
    addAllies(entry, 2);
    cast(entry);
    const target = marked(entry)[0];
    const [cue] = cuesOf(entry.inst, 'brute-boulder');
    target.hp = 5;
    run(entry.sim, entry.boss, cue.total + DT * 2);
    expect(target.dead).toBe(false);
    expect(target.hp).toBeGreaterThanOrEqual(1);
    expect(has(target, HOARD_BOULDER_DREAD_AURA_ID)).toBe(false);
    // Died in flight (to something else): the root, which survives death by
    // design, still comes off the moment the boulder arrives.
    const again = encounter();
    addAllies(again, 2);
    cast(again);
    const victim = marked(again)[0];
    const [mark] = cuesOf(again.inst, 'brute-boulder');
    run(again.sim, again.boss, mark.total - 0.5);
    victim.dead = true;
    run(again.sim, again.boss, 0.5 + DT);
    expect(has(victim, HOARD_BOULDER_DREAD_AURA_ID)).toBe(false);
  });

  it('the mark dying before it arrives breaks it on empty ground', () => {
    const entry = encounter();
    addAllies(entry, 1);
    cast(entry);
    const target = marked(entry)[0];
    const [cue] = cuesOf(entry.inst, 'brute-boulder');
    target.dead = true;
    const events = run(entry.sim, entry.boss, cue.total + DT * 2);
    const broke = events.find(
      (e) => e.type === 'hoardBossCue' && e.variant === 'brute-boulder-crush',
    );
    expect(broke?.type === 'hoardBossCue' && broke.innerRadius).toBe(0);
    expect(events.some((e) => e.type === 'damage' && e.ability === 'Rolling Boulder')).toBe(false);
  });

  it('at full pressure throws TWO, staggered, at two different players, each answerable', () => {
    const entry = encounter('legendary');
    addAllies(entry, 3);
    cast(entry);
    const boulders = cuesOf(entry.inst, 'brute-boulder');
    expect(boulders).toHaveLength(2);
    expect(new Set(boulders.map((c) => c.targetId)).size).toBe(2);
    expect(marked(entry)).toHaveLength(2);
    for (const cue of boulders) expect(cue.innerRadius).toBe(1);
    // Four players: two marked, two free, one each. Send one to each.
    const free = everyone(entry).filter((p) => !boulders.some((c) => c.targetId === p.id));
    expect(free).toHaveLength(2);
    const events = run(
      entry.sim,
      entry.boss,
      Math.max(...boulders.map((c) => c.total)) + DT * 2,
      () => {
        boulders.forEach((cue, i) => {
          free[i].pos = { ...free[i].pos, x: cue.x + 2, z: cue.z };
        });
        for (const p of everyone(entry)) p.hp = p.maxHp;
      },
    );
    expect(events.filter((e) => e.type === 'log' && /thrown back/.test(e.text))).toHaveLength(2);
    expect(
      events.some(
        (e) =>
          e.type === 'damage' && e.ability === 'Rolling Boulder' && e.targetId !== entry.boss.id,
      ),
    ).toBe(false);
    // Below the threshold: one boulder, whatever the party.
    const calm = encounter('rare');
    addAllies(calm, 3);
    cast(calm);
    expect(cuesOf(calm.inst, 'brute-boulder')).toHaveLength(1);
  });

  it('marks someone else next time', () => {
    const entry = encounter();
    addAllies(entry, 2);
    cast(entry);
    const first = marked(entry)[0].id;
    run(entry.sim, entry.boss, 12, () => {
      for (const p of everyone(entry)) p.hp = p.maxHp;
    });
    expect(held(entry).boulders).toHaveLength(0);
    for (const p of everyone(entry)) p.auras = [];
    cast(entry);
    expect(marked(entry)).toHaveLength(1);
    expect(marked(entry)[0].id).not.toBe(first);
  });

  it('only into a clean room, never into the middle of his combo', () => {
    const entry = encounter();
    const state = entry.inst.hoardBoss;
    if (!state) throw new Error('missing state');
    state.sequenceStep = 1;
    state.sequenceTimer = 999;
    cast(entry);
    expect(cuesOf(entry.inst, 'brute-boulder-throw')).toHaveLength(0);
  });

  it('leaves nobody rooted, no stagger and no cast bar when the fight resets', () => {
    const entry = encounter();
    addAllies(entry, 2);
    cast(entry);
    expect(marked(entry)).toHaveLength(1);
    entry.boss.aiState = 'idle';
    tickHoardBossMechanics(entry.sim.ctx);
    expect(entry.inst.hoardBoss).toBeUndefined();
    expect(marked(entry)).toHaveLength(0);
    expect(entry.boss.castingAbility).toBeNull();
    expect(has(entry.boss, HOARD_BOULDER_STAGGER_AURA_ID)).toBe(false);
  });

  it('is the same fight for the same seed', () => {
    const trace = () => {
      const entry = encounter('legendary');
      addAllies(entry, 3);
      cast(entry);
      return run(entry.sim, entry.boss, 8)
        .filter((e) => e.type === 'hoardBossCue' && e.pid === entry.sim.player.id)
        .map((e) =>
          e.type === 'hoardBossCue'
            ? `${e.variant}:${e.x.toFixed(3)}:${e.z.toFixed(3)}:${e.durationSecs.toFixed(3)}`
            : '',
        );
    };
    expect(trace()).toEqual(trace());
  });
});
