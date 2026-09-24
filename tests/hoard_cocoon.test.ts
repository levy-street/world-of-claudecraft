// Broodmother Vysska's Cocoon (src/sim/rift/hoard_cocoon.ts + its shared core).
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { hoardBossCueViews, tickHoardBossMechanics } from '../src/sim/rift/hoard_boss';
import { COCOON_EVERY_SEC } from '../src/sim/rift/hoard_cocoon';
import {
  BROOD_COCOON_TOTAL_SEC,
  broodCocoonHealth,
  broodHatchlings,
  COCOON,
  COCOON_TOTAL_SEC,
  cocoonCount,
  cocoonHealth,
  cocoonUrgency,
  HOARD_BROOD_COCOON_TEMPLATE,
  HOARD_COCOONED_AURA_ID,
  HOARD_SILK_COCOON_TEMPLATE,
  isCocoonVariant,
} from '../src/sim/rift/hoard_cocoon_core';
import { HOARD_RARITY_PRESSURE } from '../src/sim/rift/hoard_scaling';
import type { RiftInstance } from '../src/sim/rift/types';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';

type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

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
  boss.templateId = 'rift_boss_venom';
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  sim.player.pos = { ...boss.pos, z: boss.pos.z - 18 };
  sim.player.hp = sim.player.maxHp;
  tickHoardBossMechanics(sim.ctx);
  sim.drainEvents();
  quietKit(inst);
  return { sim, inst, boss };
}

/** Her venom is not under test: park its clocks. */
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
    ally.pos.x += (n + 1) * 4 - 8;
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
  const state = entry.inst.hoardBoss?.cocoon;
  if (!state) throw new Error('missing cocoon state');
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
const wrapped = (entry: ReturnType<typeof encounter>) =>
  everyone(entry).filter((p) => p.auras.some((a) => a.id === HOARD_COCOONED_AURA_ID));
const cocoonMobs = (entry: ReturnType<typeof encounter>, template = HOARD_SILK_COCOON_TEMPLATE) =>
  [...entry.sim.entities.values()].filter((e) => e.templateId === template);
const hatchlings = (entry: ReturnType<typeof encounter>) =>
  [...entry.sim.entities.values()].filter((e) => e.templateId === 'hoard_brood_hatchling');

describe('the cocoon numbers (pure, shared with the renderer)', () => {
  it('never wraps the whole party, and always leaves hands to cut them out', () => {
    expect(cocoonCount(1, false)).toBe(0);
    expect(cocoonCount(1, true)).toBe(0);
    expect(cocoonCount(2, false)).toBe(1);
    expect(cocoonCount(2, true)).toBe(1);
    expect(cocoonCount(3, true)).toBe(1);
    expect(cocoonCount(4, false)).toBe(1);
    expect(cocoonCount(4, true)).toBe(2);
    expect(cocoonCount(10, false)).toBe(1);
    expect(cocoonCount(10, true)).toBe(2);
    for (let living = 2; living <= 12; living++) {
      for (const double of [false, true]) {
        const count = cocoonCount(living, double);
        expect(count).toBeGreaterThanOrEqual(1);
        expect(living - count).toBeGreaterThanOrEqual(COCOON.minFreePlayers);
        // A double leaves at least as many free as it wraps.
        if (count === 2) expect(living - count).toBeGreaterThanOrEqual(COCOON.doubleMinFreePlayers);
      }
    }
  });

  it('scales a cocoon to the hands free to cut it, within bounds', () => {
    const one = cocoonHealth(100_000, 1);
    expect(one).toBe(Math.round(100_000 * COCOON.healthFraction));
    expect(cocoonHealth(100_000, 3)).toBe(one * 3);
    expect(cocoonHealth(100_000, 0)).toBe(one);
    expect(cocoonHealth(100_000, 99)).toBe(one * COCOON.maxHealthPlayers);
    expect(broodCocoonHealth(100_000)).toBe(Math.round(100_000 * COCOON.broodHealthFraction));
    expect(broodHatchlings(HOARD_RARITY_PRESSURE.common.extra)).toBe(1);
    expect(broodHatchlings(HOARD_RARITY_PRESSURE.rare.extra)).toBe(COCOON.hatchlings);
    expect(broodHatchlings(99)).toBe(COCOON.maxHatchlings);
  });

  it('reads its rescue window off the cue clock', () => {
    expect(cocoonUrgency(0.5, COCOON_TOTAL_SEC)).toBe(0);
    expect(cocoonUrgency(COCOON.warningSec + COCOON.drainSec / 2, COCOON_TOTAL_SEC)).toBeCloseTo(
      0.5,
      9,
    );
    expect(cocoonUrgency(COCOON_TOTAL_SEC, COCOON_TOTAL_SEC)).toBe(1);
    expect(COCOON_TOTAL_SEC).toBeCloseTo(COCOON.warningSec + COCOON.drainSec, 9);
    expect(BROOD_COCOON_TOTAL_SEC).toBeCloseTo(COCOON.warningSec + COCOON.hatchSec, 9);
    // The whole drain never kills on its own: each drink is capped, and even
    // uncapped the ticks of one window take less than a full bar.
    expect(COCOON.drainDamageFraction * (COCOON.drainSec / COCOON.drainEverySec)).toBeLessThan(1);
    for (const v of ['brood-cocoon', 'brood-cocoon-end']) expect(isCocoonVariant(v)).toBe(true);
    expect(isCocoonVariant('brood-web')).toBe(false);
    expect(isCocoonVariant(undefined)).toBe(false);
  });
});

describe('the cocoon in the fight', () => {
  it('registers both cocoons as harmless, rooted, lootless mobs', () => {
    for (const id of [HOARD_SILK_COCOON_TEMPLATE, HOARD_BROOD_COCOON_TEMPLATE]) {
      const template = MOBS[id];
      expect(template).toBeDefined();
      expect(template.dmgBase).toBe(0);
      expect(template.moveSpeed).toBe(0);
      expect(template.aggroRadius).toBe(0);
      expect(template.xpMult).toBe(0);
      expect(template.loot).toEqual([]);
      expect(template.phasesThroughObstacles).toBe(true);
    }
  });

  it('marks a player who is NOT her target, then wraps them where they stand', () => {
    const entry = encounter();
    const allies = addAllies(entry, 2);
    const events = cast(entry);
    expect(events.some((e) => e.type === 'log' && /Cut them out/.test(e.text))).toBe(true);
    const [cue] = cuesOf(entry.inst, 'brood-cocoon');
    expect(cue.innerRadius).toBe(0);
    expect(cue.total).toBeCloseTo(COCOON_TOTAL_SEC, 9);
    // The player holds her attention, so an ally is wrapped.
    expect(allies.map((a) => a.id)).toContain(cue.targetId);
    expect(wrapped(entry)).toHaveLength(0);
    expect(cocoonMobs(entry)).toHaveLength(0);
    const target = everyone(entry).find((p) => p.id === cue.targetId);
    if (!target) throw new Error('no target');
    // They run during the warning: the silk closes where they ARE.
    target.pos = { ...target.pos, x: target.pos.x + 5 };
    run(entry.sim, entry.boss, COCOON.warningSec + DT);
    expect(wrapped(entry).map((p) => p.id)).toEqual([target.id]);
    const aura = target.auras.find((a) => a.id === HOARD_COCOONED_AURA_ID);
    expect(aura?.kind).toBe('stun');
    expect(aura?.unbreakableControl).toBe(true);
    const [mob] = cocoonMobs(entry);
    expect(mob.pos.x).toBeCloseTo(target.pos.x, 3);
    expect(mob.maxHp).toBe(cocoonHealth(entry.boss.maxHp, 2));
    expect(entry.inst.mobIds).toContain(mob.id);
    expect(entry.boss.summonedIds).toContain(mob.id);
  });

  it('she feeds on the wrapped player, never lethally, and heals from it', () => {
    const entry = encounter();
    addAllies(entry, 1);
    cast(entry);
    run(entry.sim, entry.boss, COCOON.warningSec + DT);
    const [target] = wrapped(entry);
    entry.boss.hp = Math.round(entry.boss.maxHp * 0.5);
    const bossHp = entry.boss.hp;
    const hp = target.hp;
    const events = run(entry.sim, entry.boss, COCOON.drainEverySec * 3 + DT);
    const drinks = events.filter(
      (e) => e.type === 'damage' && e.ability === 'Draining Silk' && e.targetId === target.id,
    );
    expect(drinks).toHaveLength(3);
    expect(target.hp).toBeLessThan(hp);
    expect(entry.boss.hp).toBeGreaterThan(bossHp);
    // Starved to a sliver, the drain still never finishes them.
    target.hp = 3;
    run(entry.sim, entry.boss, COCOON.drainEverySec * 2);
    expect(target.dead).toBe(false);
    expect(target.hp).toBeGreaterThan(0);
  });

  it('allies cut the cocoon open: the player is freed at once and she gets nothing more', () => {
    const entry = encounter();
    addAllies(entry, 1);
    cast(entry);
    run(entry.sim, entry.boss, COCOON.warningSec + 2);
    const [target] = wrapped(entry);
    const [mob] = cocoonMobs(entry);
    const [cue] = cuesOf(entry.inst, 'brood-cocoon');
    entry.sim.player.targetId = mob.id;
    mob.hp = 0;
    mob.dead = true;
    const events = run(entry.sim, entry.boss, DT);
    expect(wrapped(entry)).toHaveLength(0);
    expect(entry.sim.entities.has(mob.id)).toBe(false);
    expect(entry.inst.mobIds).not.toContain(mob.id);
    expect(entry.sim.player.targetId).toBeNull();
    expect(events.some((e) => e.type === 'log' && /cut open/.test(e.text))).toBe(true);
    const end = cuesOf(entry.inst, 'brood-cocoon-end');
    expect(end).toHaveLength(1);
    expect(end[0].cueId).toBe(cue.cueId);
    expect(end[0].innerRadius).toBe(0);
    const hp = target.hp;
    run(entry.sim, entry.boss, 3);
    expect(target.hp).toBe(hp);
    // Dealt with: the clock runs again and no cue of hers is left.
    expect(held(entry).cocoons).toHaveLength(0);
    expect(held(entry).timer).toBeGreaterThan(COCOON_EVERY_SEC * 0.8);
    expect(
      hoardBossCueViews(entry.inst).filter((c) => isCocoonVariant(c.variant) && c.remaining > 0),
    ).toHaveLength(0);
  });

  it('nobody cuts them out: she drinks deep, heals, and drops them alive', () => {
    const entry = encounter();
    addAllies(entry, 1);
    cast(entry);
    run(entry.sim, entry.boss, COCOON.warningSec + DT);
    const [target] = wrapped(entry);
    entry.boss.hp = Math.round(entry.boss.maxHp * 0.4);
    const events = run(entry.sim, entry.boss, COCOON.drainSec + DT, () => {
      target.hp = Math.max(target.hp, Math.round(target.maxHp * 0.8));
    });
    expect(events.some((e) => e.type === 'log' && /feeds, and is healed/.test(e.text))).toBe(true);
    expect(target.dead).toBe(false);
    expect(wrapped(entry)).toHaveLength(0);
    expect(cocoonMobs(entry)).toHaveLength(0);
    expect(entry.boss.hp).toBeGreaterThanOrEqual(
      Math.round(entry.boss.maxHp * 0.4) + Math.round(entry.boss.maxHp * COCOON.devourHealFraction),
    );
    const end = events.find((e) => e.type === 'hoardBossCue' && e.variant === 'brood-cocoon-end');
    expect(end?.type === 'hoardBossCue' && end.innerRadius).toBe(1);
  });

  it('alone: spins a brood cocoon instead, wraps nobody, and it hatches if left', () => {
    const entry = encounter();
    const events = cast(entry);
    expect(events.some((e) => e.type === 'log' && /before it hatches/.test(e.text))).toBe(true);
    const [cue] = cuesOf(entry.inst, 'brood-cocoon');
    expect(cue.innerRadius).toBe(1);
    expect(cue.targetId).toBeUndefined();
    expect(cue.total).toBeCloseTo(BROOD_COCOON_TOTAL_SEC, 9);
    // Between the player and her, in reach.
    const away = Math.hypot(cue.x - entry.sim.player.pos.x, cue.z - entry.sim.player.pos.z);
    expect(away).toBeGreaterThan(2);
    expect(away).toBeLessThanOrEqual(COCOON.broodDistance + 1e-6);
    run(entry.sim, entry.boss, COCOON.warningSec + DT);
    expect(wrapped(entry)).toHaveLength(0);
    const [mob] = cocoonMobs(entry, HOARD_BROOD_COCOON_TEMPLATE);
    expect(mob.maxHp).toBe(broodCocoonHealth(entry.boss.maxHp));
    expect(hatchlings(entry)).toHaveLength(0);
    const rest = run(entry.sim, entry.boss, COCOON.hatchSec + DT);
    expect(rest.some((e) => e.type === 'log' && /hatches/.test(e.text))).toBe(true);
    expect(hatchlings(entry)).toHaveLength(broodHatchlings(HOARD_RARITY_PRESSURE.rare.extra));
    expect(cocoonMobs(entry, HOARD_BROOD_COCOON_TEMPLATE)).toHaveLength(0);
  });

  it('alone: destroying the brood cocoon in time means nothing hatches', () => {
    const entry = encounter();
    cast(entry);
    run(entry.sim, entry.boss, COCOON.warningSec + 1);
    const [mob] = cocoonMobs(entry, HOARD_BROOD_COCOON_TEMPLATE);
    mob.hp = 0;
    mob.dead = true;
    const events = run(entry.sim, entry.boss, COCOON.hatchSec + 1);
    expect(events.some((e) => e.type === 'log' && /is destroyed/.test(e.text))).toBe(true);
    expect(hatchlings(entry)).toHaveLength(0);
  });

  it('at full pressure wraps TWO and leaves two free; below it, one', () => {
    const entry = encounter('legendary');
    addAllies(entry, 3);
    cast(entry);
    const cues = cuesOf(entry.inst, 'brood-cocoon');
    expect(cues).toHaveLength(2);
    expect(new Set(cues.map((c) => c.targetId)).size).toBe(2);
    run(entry.sim, entry.boss, COCOON.warningSec + DT);
    expect(wrapped(entry)).toHaveLength(2);
    expect(everyone(entry).length - wrapped(entry).length).toBe(2);
    for (const mob of cocoonMobs(entry)) expect(mob.maxHp).toBe(cocoonHealth(entry.boss.maxHp, 2));
    const calm = encounter('rare');
    addAllies(calm, 3);
    cast(calm);
    expect(cuesOf(calm.inst, 'brood-cocoon')).toHaveLength(1);
  });

  it('holds her venom back while anyone is wrapped, and only spins into a clean room', () => {
    const entry = encounter();
    addAllies(entry, 1);
    cast(entry);
    const state = entry.inst.hoardBoss;
    if (!state) throw new Error('missing state');
    state.sweepTimer = 0.1;
    state.markTimer = 0.1;
    run(entry.sim, entry.boss, 4);
    expect(hoardBossCueViews(entry.inst).every((c) => isCocoonVariant(c.variant))).toBe(true);
    const busy = encounter();
    addAllies(busy, 1);
    const busyState = busy.inst.hoardBoss;
    if (!busyState) throw new Error('missing state');
    busyState.cues.push({
      id: 900,
      kind: 'mark',
      phase: 'hazard',
      x: 0,
      z: 0,
      radius: 3,
      remaining: 5,
      total: 5,
    });
    cast(busy);
    expect(cuesOf(busy.inst, 'brood-cocoon')).toHaveLength(0);
  });

  it('wraps someone else next time', () => {
    const entry = encounter();
    addAllies(entry, 2);
    cast(entry);
    const first = cuesOf(entry.inst, 'brood-cocoon')[0].targetId;
    run(entry.sim, entry.boss, COCOON.warningSec + DT);
    for (const mob of cocoonMobs(entry)) {
      mob.hp = 0;
      mob.dead = true;
    }
    run(entry.sim, entry.boss, 2);
    expect(held(entry).cocoons).toHaveLength(0);
    cast(entry);
    const second = cuesOf(entry.inst, 'brood-cocoon')[0].targetId;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it('leaves nobody wrapped and no cocoon in the world when the fight resets', () => {
    const entry = encounter('legendary');
    addAllies(entry, 3);
    cast(entry);
    run(entry.sim, entry.boss, COCOON.warningSec + 1);
    const mobs = cocoonMobs(entry);
    expect(mobs).toHaveLength(2);
    entry.sim.player.targetId = mobs[0].id;
    entry.boss.aiState = 'idle';
    tickHoardBossMechanics(entry.sim.ctx);
    expect(entry.inst.hoardBoss).toBeUndefined();
    expect(wrapped(entry)).toHaveLength(0);
    expect(cocoonMobs(entry)).toHaveLength(0);
    expect(entry.sim.player.targetId).toBeNull();
    for (const mob of mobs) {
      expect(entry.inst.mobIds).not.toContain(mob.id);
      expect(entry.boss.summonedIds).not.toContain(mob.id);
    }
  });

  it('takes real damage under the whole sim, and dying frees its player', () => {
    const entry = encounter();
    addAllies(entry, 1);
    cast(entry);
    run(entry.sim, entry.boss, COCOON.warningSec + DT * 2);
    const [mob] = cocoonMobs(entry);
    const [target] = wrapped(entry);
    expect(mob).toBeDefined();
    let last = mob.hp;
    for (let tick = 0; tick < 60 && !mob.dead; tick++) {
      entry.boss.aiState = 'attack';
      // The boss's own blows are not under test (and would fell a bare warrior).
      for (const p of everyone(entry)) p.damageImmune = true;
      entry.sim.tick();
      if (tick % 10 !== 0) continue;
      const dealt = entry.sim.ctx.dealDamage(
        entry.sim.player,
        mob,
        3,
        false,
        'physical',
        null,
        'hit',
      );
      expect(dealt, `hit at tick ${tick}`).toBeGreaterThan(0);
      expect(mob.hp).toBeLessThan(last);
      last = mob.hp;
    }
    entry.sim.ctx.dealDamage(entry.sim.player, mob, mob.maxHp * 2, false, 'physical', null, 'hit');
    expect(mob.dead).toBe(true);
    const events = entry.sim.drainEvents();
    entry.sim.tick();
    expect(entry.sim.entities.has(mob.id)).toBe(false);
    expect(target.auras.some((a) => a.id === HOARD_COCOONED_AURA_ID)).toBe(false);
    expect(events.some((event) => event.type === 'xp' || event.type === 'loot')).toBe(false);
  });

  it('is the same fight for the same seed', () => {
    const trace = () => {
      const entry = encounter('legendary');
      addAllies(entry, 3);
      cast(entry);
      return run(entry.sim, entry.boss, 6)
        .filter((e) => e.type === 'hoardBossCue' && e.pid === entry.sim.player.id)
        .map((e) =>
          e.type === 'hoardBossCue'
            ? `${e.variant}:${e.x.toFixed(3)}:${e.z.toFixed(3)}:${e.targetId}`
            : '',
        );
    };
    expect(trace()).toEqual(trace());
  });
});
