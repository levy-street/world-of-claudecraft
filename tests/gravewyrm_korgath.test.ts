// Korgath the Bound's phase B core (src/sim/encounters/gravewyrm_sanctum/
// korgath.ts; docs/design/dungeon-rework/gravewyrm_sanctum.md section 6.1, G23
// restraint parts): the four Seal Shackles and their chains, Lockbound, the
// leash until the Anvil chain breaks, the four freed abilities, Strain on the
// intact pillars, the telegraphed Shuddering Stomp, heroic Re-rivet and Last
// Link, the wipe reset, the Calving Face's steps 2 to 5, the deeds' conditions
// and determinism. Driven through tickSanctumEncounters inside a real claimed
// Sanctum (the trash test's shape: the mob AI never runs here).

import { describe, expect, it } from 'vitest';
import { SANCTUM_CAST_SPECS } from '../src/render/gravewyrm_sanctum_bosses/boss_fx_core';
import { KORGATH_SPOT, SEAL_PILLARS } from '../src/sim/content/gravewyrm_sanctum_layout';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { handleGravewyrmSanctumDevChat } from '../src/sim/dev/gravewyrm_sanctum_dev';
import {
  GOADSMITH_ID,
  GOADSMITH_RERIVET,
  KORGATH_BELLOW,
  KORGATH_CHAIN_BREAK,
  KORGATH_CHAIN_FLAIL,
  KORGATH_ID,
  KORGATH_LOCKBOUND,
  KORGATH_MAUL_ARC,
  KORGATH_REACH,
  KORGATH_STOMP,
  KORGATH_STRAIN,
  KORGATH_THRESHOLD_CHARGE,
  SANCTUM_DEED_IDS,
  SEAL_SHACKLE_IDS,
  SEAL_TOOLS,
  type SealTool,
  sealChainOf,
  storyStep,
  KORGATH_TUNING as T,
  tickSanctumEncounters,
} from '../src/sim/encounters/gravewyrm_sanctum';
import { claimBoss } from '../src/sim/encounters/gravewyrm_sanctum/claim';
import {
  breakChain,
  KORGATH_LINES,
  korgathDeeds,
  korgathState,
  startStrain,
} from '../src/sim/encounters/gravewyrm_sanctum/korgath';
import type { KorgathFightState } from '../src/sim/encounters/gravewyrm_sanctum/korgath_state';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, dist2d, type Entity, type SimEvent } from '../src/sim/types';

const DUNGEON = 'gravewyrm_sanctum';

interface Room {
  sim: Sim;
  inst: InstanceSlot;
  me: Entity;
  boss: Entity;
  o: { x: number; z: number };
  events: SimEvent[];
  bars: string[];
}

function room(difficulty: 'normal' | 'heroic' = 'normal', seed = 93): Room {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat(`/dev sanctum enter ${difficulty}`, sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no sanctum claim');
  const me = sim.player;
  me.maxHp = 1e6;
  me.hp = 1e6;
  const o = instanceOrigin(DUNGEONS[DUNGEON].index, inst.slot);
  // The tank in front of him, on the terrace.
  me.pos = sim.ctx.groundPos(o.x + KORGATH_SPOT.x, o.z + KORGATH_SPOT.z - 3);
  me.prevPos = { ...me.pos };
  const boss = claimBoss(sim.ctx, inst, KORGATH_ID) as Entity;
  sim.drainEvents();
  return { sim, inst, me, boss, o, events: [], bars: [] };
}

function at(r: Room, x: number, z: number) {
  return r.sim.ctx.groundPos(r.o.x + x, r.o.z + z);
}

function addPlayer(r: Room, x: number, z: number): Entity {
  const pid = r.sim.addPlayer('mage', `K${r.sim.ctx.nextId}`);
  const e = r.sim.ctx.entities.get(pid) as Entity;
  e.pos = at(r, x, z);
  e.prevPos = { ...e.pos };
  e.maxHp = 1e6;
  e.hp = 1e6;
  return e;
}

/** Lay out the lock (his first idle tick), then pull him onto the tank. */
function pull(r: Room): KorgathFightState {
  tickSanctumEncounters(r.sim.ctx);
  r.boss.inCombat = true;
  r.boss.aiState = 'attack';
  r.boss.aggroTargetId = r.me.id;
  r.boss.hp = r.boss.maxHp;
  tick(r, DT);
  return korgathState(r.boss) as KorgathFightState;
}

function tick(r: Room, seconds: number): void {
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    if (!r.boss.dead && r.boss.aggroTargetId !== null) {
      r.boss.inCombat = true;
      r.boss.aiState = 'attack';
    }
    tickSanctumEncounters(r.sim.ctx);
    const bar = r.boss.castingAbility;
    if (bar && r.bars[r.bars.length - 1] !== bar) r.bars.push(bar);
    if (!bar && r.bars[r.bars.length - 1] !== '-') r.bars.push('-');
    r.events.push(...r.sim.drainEvents());
  }
}

function barsSeen(r: Room): Set<string> {
  return new Set(r.bars.filter((b) => b !== '-'));
}

function shackleOf(r: Room, st: KorgathFightState, tool: SealTool): Entity | undefined {
  const id = st.chains[SEAL_TOOLS.indexOf(tool)].shackleId;
  return id === null ? undefined : r.sim.ctx.entities.get(id);
}

function killShackle(r: Room, st: KorgathFightState, tool: SealTool): void {
  const s = shackleOf(r, st, tool) as Entity;
  r.sim.ctx.dealDamage(r.me, s, 1e7, false, 'physical', 'test', 'hit');
  tick(r, DT);
}

function lockbound(r: Room): number | undefined {
  return r.boss.auras.find((a) => a.id === KORGATH_LOCKBOUND)?.value;
}

function chainObjects(r: Room): { tool: SealTool; state: string; e: Entity }[] {
  const out: { tool: SealTool; state: string; e: Entity }[] = [];
  for (const id of r.inst.objectIds) {
    const e = r.sim.ctx.entities.get(id);
    const c = e ? sealChainOf(e.templateId) : null;
    if (e && c) out.push({ tool: c.tool, state: c.state, e });
  }
  return out;
}

/** Goadsmiths Korgath sent (the trash packs have their own). */
function rivetGoadsmiths(r: Room): Entity[] {
  return r.inst.mobIds
    .map((id) => r.sim.ctx.entities.get(id))
    .filter(
      (e): e is Entity =>
        e !== undefined && e.templateId === GOADSMITH_ID && e.summonedAdd === true && !e.dead,
    );
}

function pillarAt(tool: SealTool) {
  return SEAL_PILLARS[SEAL_TOOLS.indexOf(tool)];
}

describe('Korgath the Bound: the lock before the pull', () => {
  it('lays out four held Seal Shackles and four intact chains at the pillars', () => {
    const r = room();
    expect(MOBS.korgath_the_bound.stomp).toBeUndefined();
    tickSanctumEncounters(r.sim.ctx);
    const st = korgathState(r.boss) as KorgathFightState;
    expect(st.engaged).toBe(false);
    for (const tool of SEAL_TOOLS) {
      const s = shackleOf(r, st, tool) as Entity;
      expect(s.templateId).toBe(SEAL_SHACKLE_IDS[tool]);
      expect(s.encounterHeld).toBe(true);
      expect(MOBS[s.templateId].moveSpeed).toBe(0);
      expect(MOBS[s.templateId].ignoreTaunt).toBe(true);
      expect(MOBS[s.templateId].loot).toEqual([]);
      const spot = pillarAt(tool).shackle;
      expect(dist2d(s.pos, at(r, spot.x, spot.z))).toBeLessThan(0.01);
    }
    const chains = chainObjects(r);
    expect(chains.map((c) => `${c.tool}:${c.state}`).sort()).toEqual(
      SEAL_TOOLS.map((t) => `${t}:intact`).sort(),
    );
    expect(lockbound(r)).toBeUndefined();
    // Never in the spawn list: they never count toward a clear.
    for (const id of Object.values(SEAL_SHACKLE_IDS))
      expect(DUNGEONS[DUNGEON].spawns.some((s) => s.mobId === id)).toBe(false);
  });

  it('the shackles are about 1,500 health on normal and about 2,300 on heroic', () => {
    for (const [d, lo, hi] of [
      ['normal', 1400, 1600],
      ['heroic', 2200, 2400],
    ] as const) {
      const r = room(d);
      tickSanctumEncounters(r.sim.ctx);
      const st = korgathState(r.boss) as KorgathFightState;
      const s = shackleOf(r, st, 'hammer') as Entity;
      expect(s.maxHp, d).toBeGreaterThanOrEqual(lo);
      expect(s.maxHp, d).toBeLessThanOrEqual(hi);
    }
  });
});

describe('Korgath the Bound: Lockbound and the freed abilities', () => {
  it('cuts his damage taken 20 percent per intact chain, and frees each chain', () => {
    const r = room();
    const st = pull(r);
    expect(lockbound(r)).toBeCloseTo(0.8, 10);
    for (const tool of SEAL_TOOLS) expect(shackleOf(r, st, tool)?.encounterHeld).toBe(false);
    killShackle(r, st, 'hammer');
    expect(lockbound(r)).toBeCloseTo(0.6, 10);
    const hammer = chainObjects(r).find((c) => c.tool === 'hammer');
    expect(hammer?.state).toBe('broken');
    expect(r.events.some((e) => e.type === 'spellfx' && e.ability === KORGATH_CHAIN_BREAK)).toBe(
      true,
    );
    killShackle(r, st, 'tongs');
    killShackle(r, st, 'anvil');
    expect(lockbound(r)).toBeCloseTo(0.2, 10);
    killShackle(r, st, 'bellows');
    expect(lockbound(r)).toBeUndefined();
  });

  it('a full pull with every chain on casts only Strain and the Stomp', () => {
    const r = room();
    pull(r);
    tick(r, 45);
    expect([...barsSeen(r)].sort()).toEqual([KORGATH_STOMP, KORGATH_STRAIN].sort());
  });

  it('each chain frees its ability: Maul Arc, Chain Flail, Threshold Charge, the Bellow', () => {
    const r = room();
    const st = pull(r);
    // The tank stays put; one ranged player stands far off for the lanes.
    const far = addPlayer(r, KORGATH_SPOT.x, KORGATH_SPOT.z + 14);
    expect(far).toBeTruthy();
    for (const tool of SEAL_TOOLS) killShackle(r, st, tool);
    tick(r, 40);
    const seen = barsSeen(r);
    for (const id of [
      KORGATH_MAUL_ARC,
      KORGATH_CHAIN_FLAIL,
      KORGATH_THRESHOLD_CHARGE,
      KORGATH_BELLOW,
    ])
      expect(seen.has(id), id).toBe(true);
    // With every chain gone Strain has nothing to haul on.
    expect(st.strainTimer).toBeLessThan(0);
  });

  it('Chain Flail paints a lane at the farthest non-tank, and lands on whoever stays in it', () => {
    const r = room();
    const st = pull(r);
    const far = addPlayer(r, KORGATH_SPOT.x, KORGATH_SPOT.z + 12);
    const side = addPlayer(r, KORGATH_SPOT.x + 8, KORGATH_SPOT.z);
    breakChain(r.sim.ctx, r.inst, r.boss, st, 'tongs');
    r.sim.chat('/dev sanctum trigger flail', r.me.id);
    expect(r.boss.castingAbility).toBe(KORGATH_CHAIN_FLAIL);
    expect(r.boss.castTargetId).toBe(far.id);
    const yaw = r.boss.facing;
    const before = { far: far.hp, side: side.hp };
    tick(r, T.flailCast + DT);
    expect(r.boss.facing).toBeCloseTo(yaw, 6);
    const took = before.far - far.hp;
    expect(took).toBeGreaterThanOrEqual(T.flailMin);
    expect(took).toBeLessThanOrEqual(T.flailMax);
    expect(side.hp).toBe(before.side);
  });

  it('Maul Arc lands only in front of him, at about 1.3 of his swing', () => {
    const r = room();
    const st = pull(r);
    const behind = addPlayer(r, KORGATH_SPOT.x, KORGATH_SPOT.z + 5);
    breakChain(r.sim.ctx, r.inst, r.boss, st, 'hammer');
    r.boss.facing = Math.atan2(r.me.pos.x - r.boss.pos.x, r.me.pos.z - r.boss.pos.z);
    r.sim.chat('/dev sanctum trigger maul', r.me.id);
    expect(r.boss.castingAbility).toBe(KORGATH_MAUL_ARC);
    const before = { me: r.me.hp, behind: behind.hp };
    tick(r, T.maulCast + DT);
    expect(r.me.hp).toBeLessThan(before.me);
    expect(before.me - r.me.hp).toBeLessThanOrEqual(r.boss.weapon.max * T.maulMeleeMult + 1);
    expect(behind.hp).toBe(before.behind);
  });

  it("Foreman's Bellow hits everyone and shoves them away from him", () => {
    const r = room();
    const st = pull(r);
    const near = addPlayer(r, KORGATH_SPOT.x + 4, KORGATH_SPOT.z);
    breakChain(r.sim.ctx, r.inst, r.boss, st, 'bellows');
    r.sim.chat('/dev sanctum trigger bellow', r.me.id);
    const d0 = dist2d(near.pos, r.boss.pos);
    const hp0 = near.hp;
    tick(r, T.bellowCast + DT);
    expect(hp0 - near.hp).toBeGreaterThanOrEqual(T.bellowMin);
    expect(hp0 - near.hp).toBeLessThanOrEqual(T.bellowMax);
    expect(dist2d(near.pos, r.boss.pos)).toBeGreaterThan(d0 + 3);
  });

  it('Threshold Charge runs him down the lane and never off the terrace', () => {
    const r = room();
    const st = pull(r);
    const far = addPlayer(r, KORGATH_SPOT.x, KORGATH_SPOT.z + 16);
    breakChain(r.sim.ctx, r.inst, r.boss, st, 'anvil');
    r.sim.chat('/dev sanctum trigger charge', r.me.id);
    expect(r.boss.castingAbility).toBe(KORGATH_THRESHOLD_CHARGE);
    expect(r.boss.castTargetId).toBe(far.id);
    const hp0 = far.hp;
    tick(r, T.chargeCast + T.chargeRun + DT * 3);
    expect(hp0 - far.hp).toBeGreaterThanOrEqual(T.chargeMin);
    const d = Math.hypot(
      r.boss.pos.x - r.o.x - KORGATH_SPOT.x,
      r.boss.pos.z - r.o.z - KORGATH_SPOT.z,
    );
    expect(d).toBeGreaterThan(T.leashRadius);
    expect(d).toBeLessThanOrEqual(22);
  });
});

describe('Korgath the Bound: the leash, Strain and the Stomp', () => {
  it('cannot leave 10 yd of the middle until the Anvil chain breaks', () => {
    const r = room();
    const st = pull(r);
    r.boss.pos = at(r, KORGATH_SPOT.x + 16, KORGATH_SPOT.z);
    tick(r, DT);
    expect(dist2d(r.boss.pos, at(r, KORGATH_SPOT.x, KORGATH_SPOT.z))).toBeCloseTo(T.leashRadius, 3);
    breakChain(r.sim.ctx, r.inst, r.boss, st, 'anvil');
    r.boss.pos = at(r, KORGATH_SPOT.x + 16, KORGATH_SPOT.z);
    tick(r, DT);
    expect(dist2d(r.boss.pos, at(r, KORGATH_SPOT.x, KORGATH_SPOT.z))).toBeCloseTo(16, 3);
  });

  it('Strain rings only the INTACT pillars', () => {
    const r = room();
    const st = pull(r);
    const h = pillarAt('hammer');
    const t = pillarAt('tongs');
    const atHammer = addPlayer(r, h.x, h.z + 1);
    const atTongs = addPlayer(r, t.x, t.z + 1);
    breakChain(r.sim.ctx, r.inst, r.boss, st, 'hammer');
    expect(startStrain(r.inst, r.boss, st)).toBe(true);
    expect(r.boss.castTotal).toBe(T.strainCast);
    const hp0 = { h: atHammer.hp, t: atTongs.hp };
    tick(r, T.strainCast + DT);
    expect(atHammer.hp).toBe(hp0.h);
    expect(hp0.t - atTongs.hp).toBeGreaterThanOrEqual(T.strainMin);
    expect(hp0.t - atTongs.hp).toBeLessThanOrEqual(T.strainMax);
    // Thrown away from the pillar (the terrace's rim may stop the throw short).
    expect(dist2d(atTongs.pos, at(r, t.x, t.z))).toBeGreaterThan(1.5);
  });

  it('Shuddering Stomp is a 1.5 s bar, then a ring round him', () => {
    const r = room();
    pull(r);
    const out = addPlayer(r, KORGATH_SPOT.x, KORGATH_SPOT.z + 18);
    r.sim.chat('/dev sanctum trigger stomp', r.me.id);
    expect(r.boss.castingAbility).toBe(KORGATH_STOMP);
    expect(r.boss.castTotal).toBe(T.stompCast);
    const hp0 = { me: r.me.hp, out: out.hp };
    tick(r, T.stompCast + DT);
    expect(hp0.me - r.me.hp).toBeGreaterThanOrEqual(T.stompMin);
    expect(hp0.me - r.me.hp).toBeLessThanOrEqual(T.stompMax);
    expect(out.hp).toBe(hp0.out);
  });
});

describe('Korgath the Bound: heroic Re-rivet and Last Link', () => {
  it('never re-rivets on normal', () => {
    const r = room('normal');
    const st = pull(r);
    killShackle(r, st, 'hammer');
    tick(r, T.rerivetDelay + 10);
    expect(st.chains[0].broken).toBe(true);
    expect(rivetGoadsmiths(r)).toHaveLength(0);
  });

  it('on heroic a Goadsmith re-pins a broken chain 25 s on: its shackle and 20 percent return', () => {
    const r = room('heroic');
    const st = pull(r);
    killShackle(r, st, 'hammer');
    expect(lockbound(r)).toBeCloseTo(0.6, 10);
    tick(r, T.rerivetDelay + 0.1);
    const chain = st.chains[0];
    expect(chain.rivet).not.toBeNull();
    const g = r.sim.ctx.entities.get(chain.rivet?.goadsmithId ?? -1) as Entity;
    expect(g.templateId).toBe(GOADSMITH_ID);
    // He walks to the shackle and channels.
    tick(r, 4);
    expect(g.castingAbility).toBe(GOADSMITH_RERIVET);
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[GOADSMITH_RERIVET]).toBeTruthy();
    tick(r, T.rerivetChannel + 0.2);
    expect(chain.broken).toBe(false);
    expect(chain.everBroken).toBe(true);
    expect(shackleOf(r, st, 'hammer')?.dead).toBe(false);
    expect(lockbound(r)).toBeCloseTo(0.8, 10);
    expect(chainObjects(r).find((c) => c.tool === 'hammer')?.state).toBe('intact');
    // The freed ability stays: Maul Arc still comes.
    r.bars.length = 0;
    tick(r, 25);
    expect(barsSeen(r).has(KORGATH_MAUL_ARC)).toBe(true);
  });

  it('an interrupt spoils the Re-rivet', () => {
    const r = room('heroic');
    const st = pull(r);
    killShackle(r, st, 'tongs');
    tick(r, T.rerivetDelay + 4);
    const chain = st.chains[1];
    const g = r.sim.ctx.entities.get(chain.rivet?.goadsmithId ?? -1) as Entity;
    expect(g.castingAbility).toBe(GOADSMITH_RERIVET);
    r.sim.ctx.cancelCast(g);
    tick(r, T.rerivetChannel + 1);
    expect(chain.broken).toBe(true);
    expect(chain.rivet).toBeNull();
  });

  it('Last Link: Strain every 10 s on heroic with one chain left, 20 s on normal', () => {
    for (const [d, every] of [
      ['heroic', T.strainEveryLastLink],
      ['normal', T.strainEvery],
    ] as const) {
      const r = room(d);
      const st = pull(r);
      for (const tool of ['hammer', 'tongs', 'anvil'] as const)
        breakChain(r.sim.ctx, r.inst, r.boss, st, tool);
      for (const c of st.chains) c.rivetIn = null;
      expect(startStrain(r.inst, r.boss, st)).toBe(true);
      expect(st.strainTimer, d).toBe(every);
    }
  });
});

describe('Korgath the Bound: the wipe, the story and the deeds', () => {
  it('a wipe lays the whole lock out again: four living shackles, four intact chains', () => {
    const r = room('heroic');
    const st = pull(r);
    killShackle(r, st, 'hammer');
    killShackle(r, st, 'bellows');
    tick(r, T.rerivetDelay + 1);
    r.boss.aggroTargetId = null;
    r.boss.inCombat = false;
    r.boss.aiState = 'evade';
    tick(r, DT);
    // Walking home the lock stays down; it is laid out once he is back.
    tick(r, DT);
    expect(korgathState(r.boss)).toBeNull();
    r.boss.aiState = 'idle';
    tick(r, DT);
    const fresh = korgathState(r.boss) as KorgathFightState;
    expect(fresh).not.toBe(st);
    expect(fresh.engaged).toBe(false);
    expect(fresh.chains.every((c) => !c.broken && !c.everBroken)).toBe(true);
    for (const tool of SEAL_TOOLS) {
      const s = shackleOf(r, fresh, tool) as Entity;
      expect(s.dead).toBe(false);
      expect(s.hp).toBe(s.maxHp);
      expect(s.encounterHeld).toBe(true);
    }
    expect(chainObjects(r).map((c) => c.state)).toEqual(['intact', 'intact', 'intact', 'intact']);
    expect(lockbound(r)).toBeUndefined();
    expect(rivetGoadsmiths(r)).toHaveLength(0);
    const shackles = r.inst.mobIds.filter((id) =>
      Object.values(SEAL_SHACKLE_IDS).includes(r.sim.ctx.entities.get(id)?.templateId ?? ''),
    );
    expect(shackles).toHaveLength(4);
  });

  it('each chain cracks the Calving Face one step (2 to 5), and the step only rises', () => {
    const r = room();
    const st = pull(r);
    expect(storyStep(r.sim.ctx, r.inst)).toBeLessThan(2);
    SEAL_TOOLS.forEach((tool, i) => {
      killShackle(r, st, tool);
      expect(storyStep(r.sim.ctx, r.inst)).toBe(2 + i);
    });
    r.boss.aggroTargetId = null;
    r.boss.inCombat = false;
    r.boss.aiState = 'evade';
    tick(r, DT * 2);
    expect(storyStep(r.sim.ctx, r.inst)).toBe(5);
  });

  it('speaks at the pull and grows lucid with each chain', () => {
    const r = room();
    const st = pull(r);
    for (const tool of SEAL_TOOLS) killShackle(r, st, tool);
    const said = r.events.filter((e) => e.type === 'chat').map((e) => (e as { text: string }).text);
    expect([...new Set(said)]).toEqual([
      KORGATH_LINES.pull,
      KORGATH_LINES.chain1,
      KORGATH_LINES.chain2,
      KORGATH_LINES.chain3,
      KORGATH_LINES.free,
    ]);
  });

  it('A Kinder End needs all four broken at his death; The Lock Holds two never broken on heroic', () => {
    const st = (broken: boolean[], ever: boolean[]): KorgathFightState =>
      ({
        kind: 'korgath',
        chains: SEAL_TOOLS.map((tool, i) => ({ tool, broken: broken[i], everBroken: ever[i] })),
      }) as unknown as KorgathFightState;
    const all = [true, true, true, true];
    expect(korgathDeeds(st(all, all), false)).toEqual([SANCTUM_DEED_IDS.korgathAllChains]);
    // A re-riveted chain is not broken at the kill.
    expect(korgathDeeds(st([true, true, true, false], all), false)).toEqual([]);
    const two = [true, true, false, false];
    expect(korgathDeeds(st(two, two), true)).toEqual([SANCTUM_DEED_IDS.korgathStillBound]);
    expect(korgathDeeds(st(two, two), false)).toEqual([]);
    // Broken once and re-riveted still counts as broken for The Lock Holds.
    expect(korgathDeeds(st(two, [true, true, true, false]), true)).toEqual([]);
  });

  it('his death slackens every chain and clears the shackles', () => {
    const r = room();
    const st = pull(r);
    killShackle(r, st, 'hammer');
    r.sim.ctx.dealDamage(r.me, r.boss, 1e8, false, 'physical', 'test', 'hit');
    tick(r, DT);
    expect(r.boss.dead).toBe(true);
    expect(st.finished).toBe(true);
    expect(chainObjects(r).every((c) => c.state === 'broken')).toBe(true);
    const shackles = r.inst.mobIds.filter((id) =>
      Object.values(SEAL_SHACKLE_IDS).includes(r.sim.ctx.entities.get(id)?.templateId ?? ''),
    );
    expect(shackles).toHaveLength(0);
    expect(storyStep(r.sim.ctx, r.inst)).toBe(6);
  });
});

describe('Korgath the Bound: determinism and /dev', () => {
  it('two runs of the same seed play the same fight', () => {
    const script = (): string => {
      const r = room('heroic', 7);
      const st = pull(r);
      const a = addPlayer(r, KORGATH_SPOT.x + 6, KORGATH_SPOT.z + 10);
      killShackle(r, st, 'anvil');
      tick(r, 12);
      killShackle(r, st, 'tongs');
      tick(r, 30);
      return JSON.stringify([r.bars, r.me.hp, a.hp, r.boss.pos.x, r.boss.pos.z, st.casts]);
    };
    expect(script()).toBe(script());
  });

  it('/dev sanctum trigger answers every Korgath mechanic', () => {
    const r = room();
    pull(r);
    addPlayer(r, KORGATH_SPOT.x, KORGATH_SPOT.z + 12);
    for (const verb of ['break hammer', 'break tongs', 'break anvil', 'break bellows']) {
      expect(
        handleGravewyrmSanctumDevChat(r.sim.ctx, `/dev sanctum trigger ${verb}`, r.me.id),
      ).toBe(true);
    }
    const st = korgathState(r.boss) as KorgathFightState;
    expect(st.chains.every((c) => c.broken)).toBe(true);
    for (const verb of ['maul', 'flail', 'charge', 'bellow', 'stomp']) {
      r.sim.chat(`/dev sanctum trigger ${verb}`, r.me.id);
      expect(r.boss.castingAbility, verb).not.toBeNull();
    }
  });
});

describe('/dev sanctum trigger through the chat router', () => {
  // The real path a tester types: Sim.chat, the chat router, handleDevChat,
  // then the /dev sanctum handler. A mechanic that takes words of its own must
  // reach the boss whole, whatever the word count, spacing or case.
  function devLines(r: Room): string[] {
    return r.sim
      .drainEvents()
      .filter((e) => e.type === 'log')
      .map((e) => String((e as { text?: string }).text ?? ''));
  }

  it('breaks and re-rivets a named chain from a multi-word line', () => {
    const r = room('heroic');
    const st = pull(r);
    addPlayer(r, KORGATH_SPOT.x, KORGATH_SPOT.z + 12);
    devLines(r);
    r.sim.chat('/dev sanctum trigger break hammer', r.me.id);
    expect(devLines(r)).toContain('[dev] The hammer chain breaks.');
    expect(st.chains[SEAL_TOOLS.indexOf('hammer')].broken).toBe(true);
    r.sim.chat('/dev  Sanctum   TRIGGER  Break\tTongs  ', r.me.id);
    expect(devLines(r)).toContain('[dev] The tongs chain breaks.');
    expect(st.chains[SEAL_TOOLS.indexOf('tongs')].broken).toBe(true);
    r.sim.chat('/dev sanctum trigger rerivet hammer', r.me.id);
    expect(devLines(r)).toContain('[dev] A Goadsmith comes to re-rivet the hammer chain.');
  });

  it('keeps a longer line inside /dev sanctum and answers with the chain help', () => {
    const r = room();
    pull(r);
    devLines(r);
    // Four words after the verb: the old two-word capture dropped this line
    // out of the handler entirely.
    r.sim.chat('/dev sanctum trigger break the big hammer', r.me.id);
    expect(devLines(r)).toContain('[dev] Name a chain: hammer, tongs, anvil, bellows.');
  });
});

describe('Korgath the Bound: the live sim (mob AI on)', () => {
  it('a real pull: the shackles stay put and hittable, he stays leashed, a break lands', () => {
    const r = room();
    const sim = r.sim;
    // Lay the lock out on a real tick first (he is idle).
    sim.tick();
    const st0 = korgathState(r.boss) as KorgathFightState;
    expect(st0.engaged).toBe(false);
    r.me.pos = at(r, KORGATH_SPOT.x, KORGATH_SPOT.z - 3);
    r.me.prevPos = { ...r.me.pos };
    sim.ctx.aggroMob(r.boss, r.me, false);
    for (let i = 0; i < 20 * 6; i++) sim.tick();
    const st = korgathState(r.boss) as KorgathFightState;
    expect(st.engaged).toBe(true);
    for (const tool of SEAL_TOOLS) {
      const s = shackleOf(r, st, tool) as Entity;
      expect(s.encounterHeld, tool).toBe(false);
      expect(s.hostile, tool).toBe(true);
      expect(s.hp, tool).toBe(s.maxHp);
      const spot = pillarAt(tool).shackle;
      expect(dist2d(s.pos, at(r, spot.x, spot.z)), tool).toBeLessThan(0.01);
    }
    // The tank walks off: he follows only to his leash.
    r.me.pos = at(r, KORGATH_SPOT.x, KORGATH_SPOT.z + 17);
    r.me.prevPos = { ...r.me.pos };
    for (let i = 0; i < 20 * 4; i++) sim.tick();
    expect(dist2d(r.boss.pos, at(r, KORGATH_SPOT.x, KORGATH_SPOT.z))).toBeLessThanOrEqual(
      T.leashRadius + 1e-6,
    );
    // A shackle hit down to nothing breaks its chain on the next tick.
    const s = shackleOf(r, st, 'bellows') as Entity;
    sim.ctx.dealDamage(r.me, s, s.maxHp * 0.5, false, 'physical', 'test', 'hit');
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(s.hp).toBeLessThan(s.maxHp);
    sim.ctx.dealDamage(r.me, s, s.maxHp, false, 'physical', 'test', 'hit');
    sim.tick();
    expect(st.chains[3].broken).toBe(true);
    expect(lockbound(r)).toBeCloseTo(0.6, 10);
  });

  it('a real wipe and re-pull: the lock is laid out again and no chain breaks on the pull', () => {
    const r = room();
    const sim = r.sim;
    sim.tick();
    r.me.pos = at(r, KORGATH_SPOT.x, KORGATH_SPOT.z - 3);
    r.me.prevPos = { ...r.me.pos };
    sim.ctx.aggroMob(r.boss, r.me, false);
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect((korgathState(r.boss) as KorgathFightState).engaged).toBe(true);
    // He is dragged to the terrace's far edge, then the tank runs off: he
    // evades and walks home (the reset at his spawn despawns his adds).
    r.boss.pos = at(r, KORGATH_SPOT.x + 9, KORGATH_SPOT.z + 9);
    r.boss.prevPos = { ...r.boss.pos };
    r.me.pos = at(r, 0, -120);
    r.me.prevPos = { ...r.me.pos };
    r.me.devNoAggro = true;
    r.boss.aggroTargetId = null;
    r.boss.inCombat = false;
    r.boss.aiState = 'evade';
    let sawWalk = false;
    for (let i = 0; i < 20 * 20; i++) {
      sim.tick();
      if (r.boss.aiState === 'evade') sawWalk = true;
    }
    expect(sawWalk).toBe(true);
    expect(r.boss.aiState).not.toBe('evade');
    const fresh = korgathState(r.boss) as KorgathFightState;
    expect(fresh.engaged).toBe(false);
    for (const tool of SEAL_TOOLS) {
      const s = shackleOf(r, fresh, tool);
      expect(s && !s.dead, tool).toBe(true);
    }
    // The re-pull keeps all four chains.
    r.me.devNoAggro = false;
    r.me.pos = at(r, KORGATH_SPOT.x, KORGATH_SPOT.z - 3);
    r.me.prevPos = { ...r.me.pos };
    sim.ctx.aggroMob(r.boss, r.me, false);
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    const st = korgathState(r.boss) as KorgathFightState;
    expect(st.engaged).toBe(true);
    expect(st.chains.filter((c) => c.broken)).toHaveLength(0);
  });
});

describe('Korgath the Bound: every strike leaves time to react (the playtest)', () => {
  /** Each bar's dev verb and the chain that frees it (none: kept kit). */
  const BARS: readonly [string, string, SealTool | null][] = [
    ['maul', KORGATH_MAUL_ARC, 'hammer'],
    ['flail', KORGATH_CHAIN_FLAIL, 'tongs'],
    ['charge', KORGATH_THRESHOLD_CHARGE, 'anvil'],
    ['bellow', KORGATH_BELLOW, 'bellows'],
    ['stomp', KORGATH_STOMP, null],
    ['strain', KORGATH_STRAIN, null],
  ];

  it('every bar runs at least 1.5 s on normal and never under 1.2 s on heroic', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const floor = difficulty === 'normal' ? 1.5 : 1.2;
      for (const [verb, castId, tool] of BARS) {
        const r = room(difficulty);
        const st = pull(r);
        if (tool) breakChain(r.sim.ctx, r.inst, r.boss, st, tool);
        r.sim.chat(`/dev sanctum trigger ${verb}`, r.me.id);
        expect(r.boss.castingAbility, `${difficulty} ${verb}`).toBe(castId);
        expect(r.boss.castTotal, `${difficulty} ${verb}`).toBeGreaterThanOrEqual(floor);
        expect(r.boss.castRemaining).toBe(r.boss.castTotal);
      }
    }
    // The cleave that was too quick in the playtest.
    expect(T.maulCast).toBeGreaterThanOrEqual(1.5);
  });

  it('the floor shape is the whole danger: a body inside the drawn reach is struck, one past it is not', () => {
    for (const [verb, castId] of [
      ['maul', KORGATH_MAUL_ARC],
      ['stomp', KORGATH_STOMP],
    ] as const) {
      const r = room();
      const st = pull(r);
      breakChain(r.sim.ctx, r.inst, r.boss, st, 'hammer');
      const reach = SANCTUM_CAST_SPECS[castId].range;
      expect(reach).toBe(verb === 'maul' ? KORGATH_REACH.maul : KORGATH_REACH.stomp);
      // Straight ahead of him (his facing is +z here), just inside and just
      // outside the drawn edge.
      r.boss.facing = 0;
      const inside = addPlayer(r, KORGATH_SPOT.x, KORGATH_SPOT.z + reach - 0.4);
      const outside = addPlayer(r, KORGATH_SPOT.x + 1, KORGATH_SPOT.z + reach + 0.6);
      r.me.pos = at(r, KORGATH_SPOT.x - 1, KORGATH_SPOT.z + 2);
      r.sim.chat(`/dev sanctum trigger ${verb}`, r.me.id);
      const hp = { in: inside.hp, out: outside.hp };
      tick(r, r.boss.castTotal + DT);
      expect(inside.hp, `${verb} inside`).toBeLessThan(hp.in);
      expect(outside.hp, `${verb} outside`).toBe(hp.out);
    }
  });

  it('his feet and facing lock the moment a frontal bar starts, whatever the tank does (the live AI)', () => {
    for (const [verb, castId, tool] of BARS.slice(0, 2)) {
      const r = room();
      const sim = r.sim;
      const st = pull(r);
      sim.ctx.aggroMob(r.boss, r.me, false);
      if (tool) breakChain(sim.ctx, r.inst, r.boss, st, tool);
      // A second player for the flail's lane to take.
      if (verb === 'flail') addPlayer(r, KORGATH_SPOT.x + 6, KORGATH_SPOT.z - 12);
      for (let i = 0; i < 4; i++) sim.tick();
      sim.chat(`/dev sanctum trigger ${verb}`, r.me.id);
      expect(r.boss.castingAbility).toBe(castId);
      const yaw = r.boss.facing;
      const pos = { ...r.boss.pos };
      let held = 0;
      let angle = 0;
      // The tank circles him through the whole bar; the mob AI turns him to
      // the tank every tick, the hold puts him back.
      while (r.boss.castingAbility === castId) {
        angle += 0.25;
        r.me.pos = sim.ctx.groundPos(
          r.boss.pos.x + Math.sin(yaw + angle) * 3,
          r.boss.pos.z + Math.cos(yaw + angle) * 3,
        );
        r.me.prevPos = { ...r.me.pos };
        r.me.hp = r.me.maxHp;
        sim.ctx.rebucket(r.me);
        sim.tick();
        if (r.boss.castingAbility !== castId) break;
        expect(r.boss.facing, `${verb} tick ${held}`).toBeCloseTo(yaw, 9);
        expect(r.boss.pos.x).toBeCloseTo(pos.x, 9);
        expect(r.boss.pos.z).toBeCloseTo(pos.z, 9);
        held++;
      }
      expect(held * DT).toBeGreaterThan(1.4);
      // Decisive: with the bar gone the AI turns him to the tank again.
      let turned = false;
      for (let i = 0; i < 10 && !turned; i++) {
        sim.tick();
        turned = Math.abs(r.boss.facing - yaw) > 0.2;
      }
      expect(turned, `${verb} turns again after the bar`).toBe(true);
    }
  }, 60_000);

  it('no strike chains straight into another: at least barGap of plain melee between bars', () => {
    const r = room();
    const st = pull(r);
    for (const tool of SEAL_TOOLS) breakChain(r.sim.ctx, r.inst, r.boss, st, tool);
    addPlayer(r, KORGATH_SPOT.x + 8, KORGATH_SPOT.z - 14);
    // Every clock due at once: the worst case for a chain of strikes.
    st.maulTimer = 0;
    st.flailTimer = 0;
    st.chargeTimer = 0;
    st.bellowTimer = 0;
    st.stompTimer = 0;
    const busy: boolean[] = [];
    for (let i = 0; i < Math.round(30 / DT); i++) {
      tick(r, DT);
      r.me.hp = r.me.maxHp;
      busy.push(r.boss.castingAbility !== null || st.charge !== null);
    }
    // Every idle run between two strikes lasts at least the gap.
    const runs: number[] = [];
    let idle = -1;
    for (const b of busy) {
      if (b) {
        if (idle > 0) runs.push(idle);
        idle = 0;
      } else if (idle >= 0) idle++;
    }
    expect(runs.length).toBeGreaterThanOrEqual(4);
    for (const n of runs) expect(n * DT).toBeGreaterThanOrEqual(T.barGap - 1e-6);
    expect(T.barGap).toBeGreaterThanOrEqual(1);
  });
});

describe('Korgath the Bound: the cast hold stays his', () => {
  it('carries no trash kit, breath cone or perch, so the trash pass never clears his hold', () => {
    const t = MOBS[KORGATH_ID];
    expect(t.trashKit).toBeUndefined();
    expect(t.breathCone).toBeUndefined();
  });
});
