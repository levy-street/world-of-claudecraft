// Bone Spike, Grave Eruption, and Grave Flame against a real Sim: the driver
// functions in src/sim/encounters/nythraxis.ts run on a live SimContext with a
// ten-player attuned raid inside the arena, the way the Varkhul suites call
// their driver by hand and assert on entities, auras, events, and readouts.

import { describe, expect, it } from 'vitest';
import {
  HEROIC_DUNGEON_TUNING,
  NORMAL_DUNGEON_TUNING,
} from '../src/sim/content/dungeon_difficulty';
import * as nythraxis from '../src/sim/encounters/nythraxis';
import { NYTHRAXIS_BOUND_STUN_AURA_ID } from '../src/sim/nythraxis_binding_sigil';
import {
  isNythraxisImpaled,
  NYTHRAXIS_BONE_SPIKE_COOLDOWN_SECONDS,
  NYTHRAXIS_BONE_SPIKE_EVERY_HEROIC,
  NYTHRAXIS_BONE_SPIKE_EVERY_NORMAL,
  NYTHRAXIS_BONE_SPIKE_FIRST_SECONDS,
  NYTHRAXIS_BONE_SPIKE_ID,
  NYTHRAXIS_BONE_SPIKE_VICTIMS_HEROIC,
  NYTHRAXIS_BONE_SPIKE_VICTIMS_NORMAL,
  NYTHRAXIS_IMPALED_AURA_ID,
  NYTHRAXIS_IMPALED_TICK_MAX_HP_HEROIC,
  NYTHRAXIS_IMPALED_TICK_MAX_HP_NORMAL,
  nythraxisBoneSpikeCandidates,
  nythraxisBoneSpikeCooldownIds,
  nythraxisImpaledAuraFor,
  tickNythraxisBoneSpikeCooldowns,
  withNythraxisBoneSpikeCooldowns,
} from '../src/sim/nythraxis_bone_spike';
import { NYTHRAXIS_BONE_STORM_SPIKE_AT_SECONDS } from '../src/sim/nythraxis_bone_storm';
import {
  NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
  NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
  NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS,
  NYTHRAXIS_GRAVE_FLAME_CAST_ID,
  nythraxisGraveFlameSeconds,
} from '../src/sim/nythraxis_grave_eruption';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { DT, type Entity, NYTHRAXIS_BOSS_ID, type SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { EMPTY_TEST_WORLD } from './sim_shared';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;
type Callout = Extract<SimEvent, { type: 'nythraxisCallout' }> & { pid?: number };

const ctxOf = (sim: Sim): SimContext => (sim as unknown as { ctx: SimContext }).ctx;

function teleport(sim: AnySim, e: AnyEntity, x: number, z: number, y?: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = y ?? groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

// A ten-player attuned raid pulled into the throne room: the tank in melee,
// the others spread 20 yd in front of the dais.
function setup(opts: { difficulty?: 'normal' | 'heroic' } = {}) {
  const { difficulty = 'normal' } = opts;
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  }) as AnySim;
  const tankPid = sim.addPlayer('warrior', 'Tank') as number;
  sim.players.get(tankPid)!.questsDone.add('q_nythraxis_bound_guardian');
  const raiderPids: number[] = [];
  for (let i = 0; i < 9; i++) {
    const pid = sim.addPlayer(i < 2 ? 'priest' : 'mage', `Raider${i}`) as number;
    sim.partyInvite(pid, tankPid);
    sim.partyAccept(pid);
    raiderPids.push(pid);
  }
  sim.convertPartyToRaid(tankPid);
  if (difficulty === 'heroic') sim.setDungeonDifficulty('heroic', tankPid);
  sim.enterDungeon('nythraxis_boss_arena', tankPid);
  const tank = sim.entities.get(tankPid) as AnyEntity;
  const boss = [...sim.entities.values()].find(
    (e: AnyEntity) => e.kind === 'mob' && e.templateId === NYTHRAXIS_BOSS_ID && !e.dead,
  ) as AnyEntity;
  teleport(sim, tank, boss.pos.x, boss.pos.z - 5, boss.pos.y);
  const raiders = raiderPids.map((pid) => sim.entities.get(pid) as AnyEntity);
  raiders.forEach((e, i) => {
    teleport(sim, e, boss.spawnPos.x + (i - 4) * 6, boss.spawnPos.z - 20, boss.pos.y);
  });
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = tank.id;
  boss.threat.set(tank.id, 1000);
  boss.swingTimer = 999;
  const ctx = ctxOf(sim);
  const st = nythraxis.initNythraxisEncounter(boss);
  st.introSpoken = true;
  // Park every other cadence so only the mechanic under test fires.
  st.gravebreakerTimer = 999;
  st.raiseFallenTimer = 999;
  st.soulRendTimer = 999;
  st.deathlessTimer = 999;
  st.dreadCurseTimer = 999;
  st.boneSpikeTimer = 999;
  st.eruptionTimer = 999;
  const room = () => nythraxis.playersInNythraxisRoom(ctx, boss);
  const spikes = () =>
    [...sim.entities.values()].filter(
      (e: AnyEntity) => e.kind === 'mob' && e.templateId === NYTHRAXIS_BONE_SPIKE_ID && !e.dead,
    ) as AnyEntity[];
  const callouts = (call: Callout['call']) =>
    (sim.events as SimEvent[]).filter(
      (e): e is Callout => e.type === 'nythraxisCallout' && e.call === call,
    );
  return { sim, ctx, tank, raiders, boss, st, room, spikes, callouts };
}

function tickDriver(ctx: SimContext, boss: Entity, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) nythraxis.updateNythraxisEncounter(ctx, boss);
}

describe('Nythraxis Bone Spike', () => {
  it('pins the impale tuning literally on both difficulties', () => {
    expect(NYTHRAXIS_BONE_SPIKE_FIRST_SECONDS).toBe(12);
    expect([NYTHRAXIS_BONE_SPIKE_EVERY_NORMAL, NYTHRAXIS_BONE_SPIKE_EVERY_HEROIC]).toEqual([
      24, 20,
    ]);
    expect([NYTHRAXIS_BONE_SPIKE_VICTIMS_NORMAL, NYTHRAXIS_BONE_SPIKE_VICTIMS_HEROIC]).toEqual([
      2, 3,
    ]);
    expect([NYTHRAXIS_IMPALED_TICK_MAX_HP_NORMAL, NYTHRAXIS_IMPALED_TICK_MAX_HP_HEROIC]).toEqual([
      0.08, 0.1,
    ]);
    const aura = nythraxisImpaledAuraFor(7, 99);
    expect(aura).toMatchObject({
      id: NYTHRAXIS_IMPALED_AURA_ID,
      kind: 'stun',
      unbreakableControl: true,
      encounterOwned: true,
      sourceId: 7,
      value2: 99,
    });
  });

  it('never picks the aggro holder, an impaled raider, or a live Soul Rend carrier', () => {
    const room = [
      { id: 1, dead: false, auras: [] },
      { id: 2, dead: false, auras: [] },
      { id: 3, dead: true, auras: [] },
      { id: 4, dead: false, auras: [nythraxisImpaledAuraFor(9, 50)] },
      { id: 5, dead: false, auras: [] },
    ] as unknown as Entity[];
    const picked = nythraxisBoneSpikeCandidates(room, 9, 1, new Set([5]));
    expect(picked.map((p) => p.id)).toEqual([2]);
  });

  it('impales two raiders on normal and three on heroic, never the aggro holder', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { ctx, boss, st, tank, room, spikes, callouts } = setup({ difficulty });
      const victims = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), difficulty);
      const expected = difficulty === 'heroic' ? 3 : 2;
      expect(victims, difficulty).toHaveLength(expected);
      expect(
        victims.map((v) => v.id),
        difficulty,
      ).not.toContain(tank.id);
      expect(new Set(victims.map((v) => v.id)).size, difficulty).toBe(expected);
      expect(spikes(), difficulty).toHaveLength(expected);
      for (const victim of victims) {
        const aura = victim.auras.find((a) => a.id === NYTHRAXIS_IMPALED_AURA_ID);
        expect(aura?.unbreakableControl, difficulty).toBe(true);
        expect(aura?.encounterOwned, difficulty).toBe(true);
        const spike = ctx.entities.get(aura!.value2!)!;
        expect(spike.templateId, difficulty).toBe(NYTHRAXIS_BONE_SPIKE_ID);
        // The spike rises at the victim's feet and is owned by the boss.
        expect(Math.hypot(spike.pos.x - victim.pos.x, spike.pos.z - victim.pos.z)).toBeLessThan(
          0.5,
        );
        expect(boss.summonedIds, difficulty).toContain(spike.id);
        expect(spike.lootable, difficulty).toBe(false);
      }
      // Personal callout to each victim, the raid-wide one to everyone else.
      expect(
        callouts('youAreImpaled')
          .map((e) => e.pid)
          .sort(),
      ).toEqual(victims.map((v) => v.id).sort());
      const raidWide = callouts('impaled');
      expect(raidWide.length).toBe(10 - expected);
      expect(raidWide.some((e) => victims.some((v) => v.id === e.pid))).toBe(false);
    }
  });

  it('drains the victim every second at the difficulty fraction until the spike dies', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { ctx, boss, st, room } = setup({ difficulty });
      const [victim] = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), difficulty);
      const hpBefore = victim.hp;
      tickDriver(ctx, boss, 1);
      const frac = difficulty === 'heroic' ? 0.1 : 0.08;
      expect(hpBefore - victim.hp, difficulty).toBe(Math.ceil(victim.maxHp * frac));
      tickDriver(ctx, boss, 1);
      expect(hpBefore - victim.hp, difficulty).toBe(2 * Math.ceil(victim.maxHp * frac));
      expect(isNythraxisImpaled(victim, boss.id), difficulty).toBe(true);
    }
  });

  it('frees the victim the instant the spike dies and announces the break', () => {
    const { sim, ctx, boss, st, room, raiders, spikes, callouts } = setup();
    const [victim] = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    const spike = spikes().find((s) => s.id === victim.auras[0]?.value2) ?? spikes()[0];
    const killer = raiders.find((r) => r.id !== victim.id)!;
    ctx.dealDamage(killer, spike, spike.hp + 1, false, 'physical', null, 'hit');
    expect(spike.dead).toBe(true);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(isNythraxisImpaled(victim, boss.id)).toBe(false);
    expect(st.boneSpikes?.some((p) => p.playerId === victim.id)).toBe(false);
    expect(callouts('spikeBroken').length).toBe(10);
    // The other victim is still held.
    const other = raiders.find((r) => r.id !== victim.id && isNythraxisImpaled(r, boss.id));
    expect(other).toBeDefined();
    // The shattered spike's corpse is dropped and forgotten everywhere the spawn
    // recorded it, so a long pull never accumulates spike corpses.
    expect(sim.entities.has(spike.id)).toBe(false);
    expect(boss.summonedIds).not.toContain(spike.id);
    const inst = ctx.instances.find((i) => i.partyKey !== null && i.mobIds.includes(boss.id));
    expect(inst?.mobIds).not.toContain(spike.id);
  });

  it('pins the spike health pool the tuning tables promise: 1000 on both difficulties', () => {
    // Heroic spikes carry the NORMAL pool (owner call, 2026-09-10): heroic
    // already pins one more raider, casts sooner, drains faster, and spawns at
    // level 22, so a bigger pool compounded into an overtuned check.
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { ctx, boss, st, room, spikes } = setup({ difficulty });
      nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), difficulty);
      const spike = spikes()[0];
      expect(spike.maxHp, difficulty).toBe(1000);
      expect(spike.hp, difficulty).toBe(spike.maxHp);
    }
    // The heroic pool comes from an explicit per-mob override that mirrors the
    // normal table's shared multiplier: a deleted override would fall through
    // to the raid-wide 3.2x, so the literal is pinned beside the spawn check.
    const heroicArena = HEROIC_DUNGEON_TUNING.nythraxis_boss_arena;
    expect(heroicArena.healthMultiplierByMob?.nythraxis_bone_spike).toBe(
      NORMAL_DUNGEON_TUNING.nythraxis_boss_arena.healthMultiplier,
    );
    expect(NORMAL_DUNGEON_TUNING.nythraxis_boss_arena.healthMultiplier).toBe(2.0);
  });

  it('frees a victim who dies impaled, so a resurrection never brings the pin back', () => {
    const { sim, ctx, boss, st, room, raiders, spikes } = setup();
    const [victim] = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    const spikeId = victim.auras.find((a) => a.id === NYTHRAXIS_IMPALED_AURA_ID)!.value2!;
    // A real death: dealDamage runs death cleanup, which deliberately KEEPS
    // unbreakable-control auras (the transition stun relies on that).
    ctx.dealDamage(boss, victim, victim.hp + 1, false, 'shadow', null, 'hit');
    expect(victim.dead).toBe(true);
    expect(isNythraxisImpaled(victim, boss.id)).toBe(true);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(isNythraxisImpaled(victim, boss.id)).toBe(false);
    expect(sim.entities.has(spikeId)).toBe(false);
    expect(st.boneSpikes?.some((p) => p.playerId === victim.id)).toBe(false);
    // The other spike still stands and still holds its raider.
    expect(spikes()).toHaveLength(1);
    expect(raiders.filter((r) => isNythraxisImpaled(r, boss.id))).toHaveLength(1);
  });

  it('sweeps a stale impale aura off a dead body at the transition and on reset', () => {
    const { ctx, boss, st, room, raiders } = setup();
    const [victim] = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    ctx.dealDamage(boss, victim, victim.hp + 1, false, 'shadow', null, 'hit');
    expect(victim.dead).toBe(true);
    // Transition before the per-tick cleanup ran: the dead body is swept too.
    boss.hp = Math.floor(boss.maxHp * 0.69);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.phase).toBe('transition');
    expect(raiders.some((r) => isNythraxisImpaled(r, boss.id))).toBe(false);
    expect(isNythraxisImpaled(victim, boss.id)).toBe(false);
  });

  it('never marks an impaled raider with Soul Rend', () => {
    const { ctx, boss, st, room, raiders } = setup();
    st.phase = 2;
    const victims = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    // Leave exactly three eligible raiders so the pick is forced.
    for (const raider of raiders) {
      if (victims.includes(raider)) continue;
      if (raiders.indexOf(raider) >= 5) {
        raider.hp = 0;
        raider.dead = true;
      }
    }
    const eligible = room().filter(
      (p) => p.id !== boss.aggroTargetId && !isNythraxisImpaled(p, boss.id),
    );
    nythraxis.castNythraxisSoulRend(ctx, boss, st);
    const markedIds = st.soulRendMarks.map((m) => m.playerId);
    expect(markedIds.length).toBeGreaterThan(0);
    for (const victim of victims) expect(markedIds).not.toContain(victim.id);
    for (const id of markedIds) expect(eligible.some((p) => p.id === id)).toBe(true);
  });

  it('retries in three seconds when nobody is eligible instead of skipping a cycle', () => {
    const { ctx, boss, st, room, tank, raiders } = setup();
    for (const raider of raiders) {
      raider.hp = 0;
      raider.dead = true;
    }
    expect(room()).toEqual([tank]);
    st.boneSpikeTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(isNythraxisImpaled(tank, boss.id)).toBe(false);
    expect(st.boneSpikeTimer).toBe(3);
  });

  it('holds the spike in place through the production mob tick', () => {
    const { sim, ctx, boss, st, room, spikes } = setup();
    nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    const spike = spikes()[0];
    const spawn = { ...spike.spawnPos };
    spike.pos.x += 3;
    spike.pos.z -= 3;
    sim.tick();
    expect(spike.pos.x).toBeCloseTo(spawn.x);
    expect(spike.pos.z).toBeCloseTo(spawn.z);
    expect(spike.aggroTargetId).toBeNull();
    expect(spike.dead).toBe(false);
  });

  it('crumbles a spike whose victim died and shatters every spike at the transition', () => {
    const { ctx, boss, st, room, spikes } = setup();
    const victims = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    victims[0].hp = 0;
    victims[0].dead = true;
    nythraxis.updateNythraxisBoneSpikes(ctx, boss, st);
    expect(spikes()).toHaveLength(1);
    expect(st.boneSpikes).toHaveLength(1);
    expect(isNythraxisImpaled(victims[0], boss.id)).toBe(false);

    boss.hp = Math.floor(boss.maxHp * 0.69);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.phase).toBe('transition');
    expect(spikes()).toHaveLength(0);
    expect(st.boneSpikes).toHaveLength(0);
    expect(isNythraxisImpaled(victims[1], boss.id)).toBe(false);
  });

  it('frees and drops everything on an encounter reset', () => {
    const { ctx, boss, st, room, spikes } = setup();
    const victims = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    nythraxis.resetNythraxisEncounter(ctx, boss);
    expect(spikes()).toHaveLength(0);
    expect(victims.every((v) => !isNythraxisImpaled(v, boss.id))).toBe(true);
    expect(boss.nythraxis).toBeUndefined();
  });

  it('holds a due cast while Deathless Rage is being cast, then fires when it resolves', () => {
    const { ctx, boss, st, room, spikes } = setup();
    st.phase = 2;
    nythraxis.startNythraxisDeathlessRage(ctx, boss, st);
    st.boneSpikeTimer = DT / 2;
    tickDriver(ctx, boss, 3);
    expect(spikes()).toHaveLength(0);
    // Let the cast resolve (nobody channels): the spike lands on the next tick.
    st.deathlessCastRemaining = DT;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(spikes()).toHaveLength(2);
    expect(room().length).toBeGreaterThan(0);
  });

  it('re-arms on the difficulty cadence after the first cast at twelve seconds', () => {
    const { ctx, boss, st, room } = setup();
    st.boneSpikeTimer = NYTHRAXIS_BONE_SPIKE_FIRST_SECONDS;
    tickDriver(ctx, boss, NYTHRAXIS_BONE_SPIKE_FIRST_SECONDS - DT);
    expect(room().every((p) => !isNythraxisImpaled(p, boss.id))).toBe(true);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(room().filter((p) => isNythraxisImpaled(p, boss.id))).toHaveLength(2);
    expect(st.boneSpikeTimer).toBeCloseTo(NYTHRAXIS_BONE_SPIKE_EVERY_NORMAL, 5);
  });
});

describe('Nythraxis Bone Spike cooldown (one impale per raider per 55 s)', () => {
  it('pins the per-raider cooldown literally', () => {
    expect(NYTHRAXIS_BONE_SPIKE_COOLDOWN_SECONDS).toBe(55);
  });

  it('keeps a raider on cooldown out of the candidate list', () => {
    const room = [
      { id: 1, dead: false, auras: [] },
      { id: 2, dead: false, auras: [] },
      { id: 3, dead: false, auras: [] },
    ] as unknown as Entity[];
    const picked = nythraxisBoneSpikeCandidates(
      room,
      9,
      null,
      new Set(),
      () => false,
      new Set([2]),
    );
    expect(picked.map((p) => p.id)).toEqual([1, 3]);
    // No cooldown set: everyone stays eligible (the default arm).
    expect(nythraxisBoneSpikeCandidates(room, 9, null, new Set()).map((p) => p.id)).toEqual([
      1, 2, 3,
    ]);
  });

  it('arms the full cooldown per victim, counts it down, and drops it at zero without mutating', () => {
    const armed = withNythraxisBoneSpikeCooldowns([{ playerId: 4, remaining: 10 }], [4, 7]);
    expect(armed).toEqual([
      { playerId: 4, remaining: NYTHRAXIS_BONE_SPIKE_COOLDOWN_SECONDS },
      { playerId: 7, remaining: NYTHRAXIS_BONE_SPIKE_COOLDOWN_SECONDS },
    ]);
    expect(nythraxisBoneSpikeCooldownIds(armed)).toEqual(new Set([4, 7]));
    const ticked = tickNythraxisBoneSpikeCooldowns(armed, 1);
    expect(ticked).toEqual([
      { playerId: 4, remaining: NYTHRAXIS_BONE_SPIKE_COOLDOWN_SECONDS - 1 },
      { playerId: 7, remaining: NYTHRAXIS_BONE_SPIKE_COOLDOWN_SECONDS - 1 },
    ]);
    // The input list is never touched.
    expect(armed[0].remaining).toBe(NYTHRAXIS_BONE_SPIKE_COOLDOWN_SECONDS);
    const expired = tickNythraxisBoneSpikeCooldowns(
      [
        { playerId: 4, remaining: 0.5 },
        { playerId: 7, remaining: 3 },
      ],
      1,
    );
    expect(expired).toEqual([{ playerId: 7, remaining: 2 }]);
    expect(nythraxisBoneSpikeCooldownIds(expired)).toEqual(new Set([7]));
  });

  it('spreads consecutive waves across the raid: nobody is impaled twice inside the cooldown', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { ctx, boss, st, room, raiders } = setup({ difficulty });
      const perWave = difficulty === 'heroic' ? 3 : 2;
      // Nine non-tank raiders: three waves on normal (6 victims), three on heroic (9).
      const seen: number[] = [];
      for (let wave = 0; wave < 3; wave++) {
        st.boneSpikeTimer = DT / 2;
        nythraxis.updateNythraxisEncounter(ctx, boss);
        const impaled = raiders.filter((r) => isNythraxisImpaled(r, boss.id)).map((r) => r.id);
        expect(impaled, `${difficulty} wave ${wave}`).toHaveLength(perWave);
        for (const id of impaled) expect(seen, `${difficulty} wave ${wave}`).not.toContain(id);
        seen.push(...impaled);
        // Free everyone before the next wave so the cooldown, not the impale
        // aura, is what keeps them out of the next pick.
        nythraxis.shatterNythraxisBoneSpikes(ctx, boss);
        expect(raiders.some((r) => isNythraxisImpaled(r, boss.id))).toBe(false);
      }
      expect(new Set(seen).size, difficulty).toBe(3 * perWave);
      const cooling = st.boneSpikeCooldowns ?? [];
      expect(cooling.map((c) => c.playerId).sort(), difficulty).toEqual([...seen].sort());
      // The shatter frees the body, never the cooldown.
      expect(
        nythraxisBoneSpikeCandidates(room(), boss.id, boss.aggroTargetId, new Set()).map(
          (p) => p.id,
        ),
        difficulty,
      ).toEqual(expect.arrayContaining(seen));
      const eligible = nythraxis.nythraxisBoneSpikeEligible(boss, st, room(), difficulty);
      for (const id of seen)
        expect(
          eligible.map((p) => p.id),
          difficulty,
        ).not.toContain(id);
    }
  });

  it('impales fewer than the wave size, then retries, rather than repeating a cooling raider', () => {
    const { ctx, boss, st, raiders } = setup();
    // Eight of the nine raiders are already cooling: only one is eligible.
    const cooling = raiders.slice(0, 8).map((r) => r.id);
    st.boneSpikeCooldowns = withNythraxisBoneSpikeCooldowns([], cooling);
    st.boneSpikeTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    const impaled = raiders.filter((r) => isNythraxisImpaled(r, boss.id));
    expect(impaled.map((r) => r.id)).toEqual([raiders[8].id]);
    expect(st.boneSpikeTimer).toBeCloseTo(NYTHRAXIS_BONE_SPIKE_EVERY_NORMAL, 5);
    // Everyone cooling: the cast lands on nobody and re-polls in three seconds.
    nythraxis.shatterNythraxisBoneSpikes(ctx, boss);
    st.boneSpikeCooldowns = withNythraxisBoneSpikeCooldowns(
      [],
      raiders.map((r) => r.id),
    );
    st.boneSpikeTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(raiders.some((r) => isNythraxisImpaled(r, boss.id))).toBe(false);
    expect(st.boneSpikeTimer).toBe(3);
  });

  it('counts the cooldown down on the encounter clock and frees the raider at 55 s', () => {
    const { ctx, boss, st, raiders } = setup();
    st.boneSpikeTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    const victims = raiders.filter((r) => isNythraxisImpaled(r, boss.id)).map((r) => r.id);
    expect(victims).toHaveLength(2);
    nythraxis.shatterNythraxisBoneSpikes(ctx, boss);
    st.boneSpikeTimer = 999;
    tickDriver(ctx, boss, 10);
    for (const entry of st.boneSpikeCooldowns ?? []) {
      expect(entry.remaining).toBeCloseTo(NYTHRAXIS_BONE_SPIKE_COOLDOWN_SECONDS - 10, 3);
    }
    tickDriver(ctx, boss, NYTHRAXIS_BONE_SPIKE_COOLDOWN_SECONDS - 10);
    expect(st.boneSpikeCooldowns).toEqual([]);
    // Back in the pool: with everyone else cooling, the old victims are picked again.
    const others = raiders.filter((r) => !victims.includes(r.id)).map((r) => r.id);
    st.boneSpikeCooldowns = withNythraxisBoneSpikeCooldowns([], others);
    st.boneSpikeTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(
      raiders
        .filter((r) => isNythraxisImpaled(r, boss.id))
        .map((r) => r.id)
        .sort(),
    ).toEqual([...victims].sort());
  });

  // The cooldown is measured from the impale, so it keeps counting through
  // every window that holds NEW casts (the spike cast path never runs in
  // any of these): a Deathless Rage cast, the 70% transition, a Bound stun,
  // and a Bone Storm.
  const remainingAfter = (st: NonNullable<Entity['nythraxis']>) =>
    st.boneSpikeCooldowns?.[0]?.remaining;

  it('keeps counting through a Deathless Rage cast', () => {
    const { ctx, boss, st, raiders } = setup();
    st.phase = 2;
    st.boneSpikeCooldowns = withNythraxisBoneSpikeCooldowns([], [raiders[0].id]);
    nythraxis.startNythraxisDeathlessRage(ctx, boss, st);
    expect(st.deathlessCastRemaining).toBeGreaterThan(5);
    tickDriver(ctx, boss, 5);
    expect(st.deathlessCastRemaining).toBeGreaterThan(0);
    expect(remainingAfter(st)).toBeCloseTo(NYTHRAXIS_BONE_SPIKE_COOLDOWN_SECONDS - 5, 3);
  });

  it('keeps counting through the transition (the early return above the mechanics)', () => {
    const { ctx, boss, st, raiders } = setup();
    st.boneSpikeCooldowns = withNythraxisBoneSpikeCooldowns([], [raiders[0].id]);
    boss.hp = Math.floor(boss.maxHp * 0.69);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.phase).toBe('transition');
    tickDriver(ctx, boss, 3);
    expect(st.phase).toBe('transition');
    // One tick entered the transition, three seconds ran inside it.
    expect(remainingAfter(st)).toBeCloseTo(NYTHRAXIS_BONE_SPIKE_COOLDOWN_SECONDS - 3 - DT, 3);
  });

  it('keeps counting through a Bound stun', () => {
    const { ctx, boss, st, raiders } = setup();
    st.phase = 2;
    st.boneSpikeCooldowns = withNythraxisBoneSpikeCooldowns([], [raiders[0].id]);
    ctx.applyAura(boss, {
      id: NYTHRAXIS_BOUND_STUN_AURA_ID,
      name: 'Bound',
      kind: 'stun',
      remaining: 8,
      duration: 8,
      value: 0,
      sourceId: boss.id,
      school: 'shadow',
      encounterOwned: true,
    });
    tickDriver(ctx, boss, 4);
    expect(boss.auras.some((a) => a.id === NYTHRAXIS_BOUND_STUN_AURA_ID)).toBe(true);
    expect(remainingAfter(st)).toBeCloseTo(NYTHRAXIS_BONE_SPIKE_COOLDOWN_SECONDS - 4, 3);
  });

  it('keeps counting through a Bone Storm, and the storm spike honours and arms it', () => {
    // Same seed twice: the control run (nobody cooling) proves the storm's own
    // spike reaches at least one raider in this scenario, so the cooling run's
    // "no raider impaled" is the cooldown at work, not a slam's fire or the
    // charge target's aggro keeping everyone out anyway.
    const runStorm = (coolEveryone: boolean) => {
      const { ctx, boss, st, raiders, room } = setup();
      st.phase = 3;
      st.boneStormTimer = 999;
      const raiderIds = raiders.map((r) => r.id);
      if (coolEveryone) st.boneSpikeCooldowns = withNythraxisBoneSpikeCooldowns([], raiderIds);
      nythraxis.startNythraxisBoneStorm(ctx, boss, st);
      expect(st.boneStorm).not.toBeNull();
      tickDriver(ctx, boss, NYTHRAXIS_BONE_STORM_SPIKE_AT_SECONDS + DT);
      expect(st.boneStorm?.spikeCast).toBe(true);
      const impaled = room()
        .filter((p) => isNythraxisImpaled(p, boss.id))
        .map((p) => p.id);
      return { st, raiderIds, impaled };
    };
    const control = runStorm(false);
    expect(control.impaled.some((id) => control.raiderIds.includes(id))).toBe(true);

    const cooled = runStorm(true);
    // The storm spike consulted the ledger: no cooling raider was pinned.
    expect(cooled.impaled.filter((id) => cooled.raiderIds.includes(id))).toEqual([]);
    const ledger = cooled.st.boneSpikeCooldowns ?? [];
    // Whoever it did pin (the tank, once the storm freed him from threat) was
    // armed at the full cooldown by the storm path (the ledger ticks at the
    // top of the update, the cast arms later in the same tick).
    for (const id of cooled.impaled) {
      expect(ledger.find((c) => c.playerId === id)?.remaining).toBe(
        NYTHRAXIS_BONE_SPIKE_COOLDOWN_SECONDS,
      );
    }
    // And the nine who were cooling kept counting through the storm.
    for (const id of cooled.raiderIds) {
      expect(ledger.find((c) => c.playerId === id)?.remaining).toBeCloseTo(
        NYTHRAXIS_BONE_SPIKE_COOLDOWN_SECONDS - NYTHRAXIS_BONE_STORM_SPIKE_AT_SECONDS - DT,
        3,
      );
    }
  });

  it('forgets every cooldown on an encounter reset', () => {
    const { ctx, boss, st, raiders } = setup();
    st.boneSpikeCooldowns = withNythraxisBoneSpikeCooldowns(
      [],
      raiders.map((r) => r.id),
    );
    nythraxis.resetNythraxisEncounter(ctx, boss);
    expect(boss.nythraxis).toBeUndefined();
    const fresh = nythraxis.initNythraxisEncounter(boss);
    expect(fresh.boneSpikeCooldowns).toEqual([]);
  });
});

describe('Nythraxis Grave Eruption and Grave Flame', () => {
  it('telegraphs circles under raiders with stable ids the readout mirrors', () => {
    const { sim, ctx, boss, st, room } = setup();
    nythraxis.startNythraxisGraveEruption(ctx, boss, st, room());
    expect(st.eruptionPoints).toHaveLength(4);
    const warnings = sim.activeNythraxisGraveEruptions;
    expect(warnings).toHaveLength(4);
    const falls = (sim.events as SimEvent[]).filter(
      (e) =>
        e.type === 'spellfxAt' &&
        e.fx === 'meteorFall' &&
        e.ability === NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
    ) as Array<Extract<SimEvent, { type: 'spellfxAt' }>>;
    expect(falls.map((f) => f.persistentId).sort()).toEqual(warnings.map((w) => w.id).sort());
    expect(warnings.every((w) => w.radius === NYTHRAXIS_GRAVE_ERUPTION_RADIUS)).toBe(true);
    expect(warnings.every((w) => w.remaining === NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS)).toBe(
      true,
    );
    // Every circle sits under a raider who is not the aggro holder.
    const others = room().filter((p) => p.id !== boss.aggroTargetId);
    for (const point of st.eruptionPoints!) {
      expect(others.some((p) => Math.hypot(p.pos.x - point.x, p.pos.z - point.z) < 0.01)).toBe(
        true,
      );
    }
  });

  it('bursts on whoever stayed, spares whoever moved, and leaves flames that keep burning', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { sim, ctx, boss, st, room, raiders } = setup({ difficulty });
      nythraxis.startNythraxisGraveEruption(ctx, boss, st, room());
      const points = [...st.eruptionPoints!];
      const stayer = raiders.find((r) =>
        points.some((p) => Math.hypot(r.pos.x - p.x, r.pos.z - p.z) < 0.01),
      )!;
      const mover = raiders.find(
        (r) =>
          r.id !== stayer.id && points.some((p) => Math.hypot(r.pos.x - p.x, r.pos.z - p.z) < 0.01),
      )!;
      teleport(sim, mover, mover.pos.x, mover.pos.z + 40, mover.pos.y);
      const stayerHp = stayer.hp;
      const moverHp = mover.hp;
      tickDriver(ctx, boss, NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS);
      const burst = difficulty === 'heroic' ? 0.75 : 0.45;
      expect(stayerHp - stayer.hp, difficulty).toBe(Math.ceil(stayer.maxHp * burst));
      expect(mover.hp, difficulty).toBe(moverHp);
      expect(st.eruptionPoints, difficulty).toHaveLength(0);
      expect(st.graveFlames, difficulty).toHaveLength(points.length);
      expect(sim.activeNythraxisGraveFlames.length, difficulty).toBe(points.length);
      expect(sim.activeNythraxisGraveEruptions, difficulty).toHaveLength(0);
      const impacts = (sim.events as SimEvent[]).filter(
        (e) => e.type === 'spellfxAt' && e.fx === 'meteorImpact',
      );
      expect(impacts.length, difficulty).toBe(points.length);

      // The eruption resolve and the ignition share one tick, and that
      // same tick's decrement loop already ran once against the freshly
      // ignited flame, so its birth remaining is one DT short of the raw
      // tuned duration (12s normal, 8s heroic), never the raw value.
      const duration = nythraxisGraveFlameSeconds(difficulty);
      for (const flame of st.graveFlames!) {
        expect(flame.remaining, difficulty).toBeCloseTo(duration - DT, 5);
      }
      let ticksSinceIgnition = 1;

      // Standing in the flame: one tick a second at the flame fraction.
      const afterBurst = stayer.hp;
      tickDriver(ctx, boss, 1);
      ticksSinceIgnition += Math.round(1 / DT);
      const tick = difficulty === 'heroic' ? 0.09 : 0.06;
      expect(afterBurst - stayer.hp, difficulty).toBe(Math.ceil(stayer.maxHp * tick));
      // Keep one damageable raider alive through expiry so damage cessation
      // cannot pass merely because everyone standing in the fire has died.
      stayer.hp = stayer.maxHp;
      const flameHits = () =>
        (sim.events as SimEvent[]).filter(
          (e) => e.type === 'damage' && e.ability === NYTHRAXIS_GRAVE_FLAME_CAST_ID,
        );
      expect(flameHits().length, difficulty).toBeGreaterThan(0);

      // Flames burn out on the exact tuned duration, never a looser
      // overshoot: still present one tick before the boundary, then gone.
      // Removal itself is checked with a two-tick grace window rather than
      // exactly one: 150-240 ticks of DT-accumulated float error can leave a
      // sub-tick (~1e-14s) positive residue right on the nominal expiry
      // tick, and one further DT decrement always clears dust that many
      // orders of magnitude below a single tick. No flame damage fires once
      // the patch is actually gone.
      const totalTicks = Math.round(duration / DT);
      for (let i = ticksSinceIgnition; i < totalTicks - 1; i++) {
        nythraxis.updateNythraxisEncounter(ctx, boss);
      }
      expect(st.graveFlames, difficulty).toHaveLength(points.length);
      for (const flame of st.graveFlames!) {
        expect(flame.remaining, difficulty).toBeGreaterThan(0);
        expect(flame.remaining, difficulty).toBeCloseTo(DT, 5);
      }
      const EXPIRY_GRACE_TICKS = 2;
      for (let i = 0; i < EXPIRY_GRACE_TICKS; i++) nythraxis.updateNythraxisEncounter(ctx, boss);
      expect(st.graveFlames, difficulty).toHaveLength(0);
      expect(stayer.dead, difficulty).toBe(false);
      const hpAfterExpiry = stayer.hp;
      const hitsAfterExpiry = flameHits().length;
      tickDriver(ctx, boss, 2);
      expect(stayer.dead, difficulty).toBe(false);
      expect(stayer.hp, difficulty).toBe(hpAfterExpiry);
      expect(flameHits().length, difficulty).toBe(hitsAfterExpiry);
    }
  });

  it('never aims at an impaled raider or a wardstone channeler', () => {
    const { ctx, boss, st, room } = setup();
    const victims = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    const channeler = room().find((p) => p.id !== boss.aggroTargetId && !victims.includes(p))!;
    st.wardChannels = [{ objectId: 1, playerId: channeler.id, remaining: 5, complete: false }];
    nythraxis.startNythraxisGraveEruption(ctx, boss, st, room());
    for (const point of st.eruptionPoints!) {
      for (const protectedPlayer of [...victims, channeler]) {
        expect(
          Math.hypot(protectedPlayer.pos.x - point.x, protectedPlayer.pos.z - point.z),
        ).toBeGreaterThan(0.01);
      }
    }
  });

  it('re-arms on the difficulty cadence and clears every hazard at the transition', () => {
    const { ctx, boss, st, room } = setup();
    st.eruptionTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.eruptionPoints).toHaveLength(4);
    expect(st.eruptionTimer).toBeCloseTo(15, 5);
    tickDriver(ctx, boss, NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS);
    expect(st.graveFlames!.length).toBe(4);
    boss.hp = Math.floor(boss.maxHp * 0.69);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.phase).toBe('transition');
    expect(st.graveFlames).toHaveLength(0);
    expect(st.eruptionPoints).toHaveLength(0);
    expect(room().length).toBeGreaterThan(0);
  });

  it('replays the same placement for the same seed and cast key', () => {
    const first = setup();
    const second = setup();
    nythraxis.startNythraxisGraveEruption(first.ctx, first.boss, first.st, first.room());
    nythraxis.startNythraxisGraveEruption(second.ctx, second.boss, second.st, second.room());
    expect(second.st.eruptionPoints).toEqual(first.st.eruptionPoints);
    expect(second.st.eruptionCastKey).toBe(first.st.eruptionCastKey);
  });
});
