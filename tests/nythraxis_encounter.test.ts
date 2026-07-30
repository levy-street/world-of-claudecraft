// Direct unit tests for the extracted Nythraxis encounter module (N1). These import
// the module functions and drive them against a real Sim's SimContext, asserting the
// behaviors the parity full-pull golden covers end to end: the CC-immunity predicates,
// the 70% phase transition (room stun + Aldric + lit wardstones), the Soul Rend rng.int
// marks pick, the Deathless Rage wardstone-channel interrupt, the same-item-id ward
// fall-through, and the raid lockout grant.

import { describe, expect, it } from 'vitest';
import * as nythraxis from '../src/sim/encounters/nythraxis';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { dist2d, type Entity, NYTHRAXIS_BOSS_ID } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

const ctxOf = (sim: Sim): SimContext => (sim as unknown as { ctx: SimContext }).ctx;

function teleport(sim: AnySim, e: AnyEntity, x: number, z: number, y?: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = y ?? groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

// Enter the Nythraxis arena with a full attuned raid, then pull the tank + the
// dps into the throne room so playersInNythraxisRoom sees them (enterDungeon
// only places the entering tank, at the door). Heroic claims and a larger raid
// are opt-in so the default keeps every pre-heroic assertion byte-identical.
function setup(opts: { difficulty?: 'normal' | 'heroic'; dpsCount?: number } = {}) {
  const { difficulty = 'normal', dpsCount = 4 } = opts;
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true }) as AnySim;
  const tankPid = sim.addPlayer('warrior', 'Tank') as number;
  sim.players.get(tankPid)!.questsDone.add('q_nythraxis_bound_guardian');
  const dpsPids: number[] = [];
  for (let i = 0; i < dpsCount; i++) {
    const pid = sim.addPlayer('mage', `Dps${i}`) as number;
    sim.partyInvite(pid, tankPid);
    sim.partyAccept(pid);
    dpsPids.push(pid);
  }
  sim.convertPartyToRaid(tankPid);
  if (difficulty === 'heroic') sim.setDungeonDifficulty('heroic', tankPid);
  sim.enterDungeon('nythraxis_boss_arena', tankPid);
  const tank = sim.entities.get(tankPid) as AnyEntity;
  const boss = [...sim.entities.values()].find(
    (e: AnyEntity) => e.kind === 'mob' && e.templateId === NYTHRAXIS_BOSS_ID && !e.dead,
  ) as AnyEntity;
  teleport(sim, tank, boss.pos.x, boss.pos.z - 6, boss.pos.y);
  const dps = dpsPids.map((pid) => sim.entities.get(pid) as AnyEntity);
  dps.forEach((e, i) => {
    teleport(sim, e, boss.spawnPos.x + (i - 1.5), boss.spawnPos.z - 20, boss.pos.y);
  });
  // engage so the encounter keeps the boss locked on the tank.
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = tank.id;
  boss.threat.set(tank.id, 1000);
  return { sim, ctx: ctxOf(sim), tank, dps, boss };
}

describe('Nythraxis encounter module (N1)', () => {
  it('CC-immunity predicates classify raid enemies and control auras', () => {
    const { ctx, boss } = setup();
    expect(nythraxis.isNythraxisRaidEnemy(boss)).toBe(true);
    expect(nythraxis.isNythraxisRaidEnemy({ kind: 'player' } as Entity)).toBe(false);
    // isNythraxisControlAura adds 'slow' on top of the general control kinds via ctx.
    expect(nythraxis.isNythraxisControlAura(ctx, 'slow')).toBe(true);
    expect(nythraxis.isNythraxisControlAura(ctx, 'stun')).toBe(true);
    expect(nythraxis.isNythraxisControlAura(ctx, 'dot')).toBe(false);
  });

  it('Raise Fallen seeds and re-arms on the 30 second cadence (both difficulties)', () => {
    const { ctx, boss } = setup();
    nythraxis.updateNythraxisEncounter(ctx, boss); // engage initializes the state
    const st = boss.nythraxis!;
    // The first wave is telegraphed one full interval after engage.
    expect(st.raiseFallenTimer).toBeCloseTo(30, 0);

    const before = (boss.summonedIds as number[]).length;
    st.raiseFallenTimer = 0.0001;
    nythraxis.updateNythraxisRaiseFallen(ctx, boss, st);

    expect((boss.summonedIds as number[]).length).toBe(before + 2);
    expect(st.raiseFallenTimer).toBe(30); // re-armed to the 30s cadence
  });

  it('transitions to phase two at 70%: room War Stomp stun + Aldric + lit wardstones', () => {
    const { ctx, boss, tank } = setup();
    boss.hp = Math.floor(boss.maxHp * 0.69);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(boss.nythraxis?.phase).toBe('transition');
    expect(tank.auras.find((a) => a.id === 'nythraxis_transition_stun')).toMatchObject({
      unbreakableControl: true,
    });
    const aldric = [...ctx.entities.values()].find(
      (e) => e.templateId === 'brother_aldric_raid' && !e.dead,
    );
    expect(aldric?.kind).toBe('npc');
    const wards = [...ctx.entities.values()].filter(
      (e) =>
        e.kind === 'object' &&
        e.objectItemId === 'bastion_ward_stone' &&
        dist2d(e.pos, boss.spawnPos) < 100,
    );
    expect(wards.length).toBe(3);
    expect(wards.every((w) => w.auras.some((a) => a.id === 'nythraxis_wardstone_lit'))).toBe(true);
  });

  it('keeps the room stunned while queued dialogue extends the transition', () => {
    const { sim, ctx, boss, tank } = setup();
    nythraxis.updateNythraxisEncounter(ctx, boss);
    const st = boss.nythraxis!;
    st.dialogueBusyUntil = ctx.time + 6;
    boss.hp = Math.floor(boss.maxHp * 0.69);
    nythraxis.updateNythraxisEncounter(ctx, boss);

    const transitionStun = tank.auras.find((a) => a.id === 'nythraxis_transition_stun');
    expect(transitionStun?.remaining).toBeGreaterThan(st.transitionTimer);

    for (let tick = 0; tick < 22 * 20; tick++) sim.tick();
    expect(st.phase).toBe('transition');
    expect(tank.auras.some((a) => a.id === 'nythraxis_transition_stun')).toBe(true);

    for (let tick = 0; tick < 6 * 20; tick++) sim.tick();
    expect(st.phase).toBe(2);
    expect(tank.auras.some((a) => a.id === 'nythraxis_transition_stun')).toBe(false);
  });

  it('enforces transition control through death, immediate revival, and unexpected removal', () => {
    const { sim, ctx, boss, tank, dps } = setup();
    nythraxis.updateNythraxisEncounter(ctx, boss);
    const latePlayer = dps[0];
    sim.setPlayerLevel(20, latePlayer.id);
    latePlayer.dead = true;
    latePlayer.hp = 0;
    latePlayer.corpsePos = { ...latePlayer.pos };
    ctx.pendingResurrections.set(latePlayer.id, {
      casterId: tank.id,
      hpFrac: 0.35,
      fallbackDestination: { ...tank.pos },
      expiresAt: ctx.time + 30,
    });
    boss.hp = Math.floor(boss.maxHp * 0.69);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    const st = boss.nythraxis!;
    expect(latePlayer.auras.some((a) => a.id === 'nythraxis_transition_stun')).toBe(true);

    sim.respondToResurrection(true, latePlayer.id);
    expect(latePlayer.dead).toBe(false);
    expect(latePlayer.auras.some((a) => a.id === 'nythraxis_transition_stun')).toBe(true);
    const revivedAt = { ...latePlayer.pos };
    const revivedResource = latePlayer.resource;
    sim.meta(latePlayer.id)!.moveInput.forward = true;
    sim.castAbility('blink', latePlayer.id);
    expect(latePlayer.resource).toBe(revivedResource);
    expect(latePlayer.cooldowns.has('blink')).toBe(false);
    sim.tick();
    expect(dist2d(latePlayer.pos, revivedAt)).toBeLessThan(0.01);

    latePlayer.auras = [
      ...latePlayer.auras.filter((a) => a.id !== 'nythraxis_transition_stun'),
      {
        id: 'nythraxis_transition_stun',
        name: 'Downgraded Stun',
        kind: 'stun',
        remaining: 1,
        duration: 1,
        value: 0,
        sourceId: boss.id,
        school: 'physical',
      },
    ];
    nythraxis.updateNythraxisTransition(ctx, boss, st);
    expect(latePlayer.auras.filter((a) => a.id === 'nythraxis_transition_stun')).toEqual([
      expect.objectContaining({
        name: 'Shuddering Stomp',
        sourceId: boss.id,
        unbreakableControl: true,
      }),
    ]);

    latePlayer.pos.x += 500;
    st.transitionTimer = 0.01;
    nythraxis.updateNythraxisTransition(ctx, boss, st);
    expect(latePlayer.auras.some((a) => a.id === 'nythraxis_transition_stun')).toBe(false);
  });

  it('pre-marks a released raider whose pending resurrection returns them to the room', () => {
    const { sim, ctx, boss, tank, dps } = setup();
    const releasedRaider = dps[0];
    releasedRaider.dead = true;
    releasedRaider.hp = 0;
    sim.releaseSpirit(releasedRaider.id);
    expect(dist2d(releasedRaider.pos, boss.spawnPos)).toBeGreaterThan(300);
    ctx.pendingResurrections.set(releasedRaider.id, {
      casterId: tank.id,
      hpFrac: 0.35,
      fallbackDestination: { ...tank.pos },
      expiresAt: ctx.time + 30,
    });

    boss.hp = Math.floor(boss.maxHp * 0.69);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(releasedRaider.auras.some((a) => a.id === 'nythraxis_transition_stun')).toBe(true);
    expect(releasedRaider.hp).toBe(releasedRaider.maxHp);

    sim.respondToResurrection(true, releasedRaider.id);
    const revivedAt = { ...releasedRaider.pos };
    sim.castAbility('blink', releasedRaider.id);

    expect(releasedRaider.dead).toBe(false);
    expect(releasedRaider.auras.some((a) => a.id === 'nythraxis_transition_stun')).toBe(true);
    expect(releasedRaider.pos).toEqual(revivedAt);
    expect(releasedRaider.cooldowns.has('blink')).toBe(false);
  });

  it('keeps a chained resurrection arrival controlled before the next encounter tick', () => {
    const { sim, ctx, boss, tank, dps } = setup();
    const [arrivalAnchor, chainedRaider] = dps;
    for (const raider of [arrivalAnchor, chainedRaider]) {
      raider.dead = true;
      raider.hp = 0;
      sim.releaseSpirit(raider.id);
      expect(dist2d(raider.pos, boss.spawnPos)).toBeGreaterThan(300);
    }
    // The chained raider's offer was made while its caster was still a distant
    // ghost, so its fallback does not reveal that the caster will revive in-room.
    ctx.pendingResurrections.set(chainedRaider.id, {
      casterId: arrivalAnchor.id,
      hpFrac: 0.35,
      fallbackDestination: { ...arrivalAnchor.pos },
      expiresAt: ctx.time + 30,
    });
    ctx.pendingResurrections.set(arrivalAnchor.id, {
      casterId: tank.id,
      hpFrac: 0.35,
      fallbackDestination: { ...tank.pos },
      expiresAt: ctx.time + 30,
    });

    boss.hp = Math.floor(boss.maxHp * 0.69);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(arrivalAnchor.auras.some((a) => a.id === 'nythraxis_transition_stun')).toBe(true);
    expect(chainedRaider.auras.some((a) => a.id === 'nythraxis_transition_stun')).toBe(false);

    sim.respondToResurrection(true, arrivalAnchor.id);
    sim.respondToResurrection(true, chainedRaider.id);
    const revivedAt = { ...chainedRaider.pos };
    sim.castAbility('blink', chainedRaider.id);

    expect(chainedRaider.dead).toBe(false);
    expect(chainedRaider.auras.some((a) => a.id === 'nythraxis_transition_stun')).toBe(true);
    expect(chainedRaider.pos).toEqual(revivedAt);
    expect(chainedRaider.cooldowns.has('blink')).toBe(false);
  });

  it('releases every transition marker when the boss dies mid-transition', () => {
    const { ctx, boss, tank, dps } = setup();
    const deadRaider = dps[0];
    deadRaider.dead = true;
    deadRaider.hp = 0;
    boss.hp = Math.floor(boss.maxHp * 0.69);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(boss.nythraxis?.phase).toBe('transition');
    expect(tank.auras.some((a) => a.id === 'nythraxis_transition_stun')).toBe(true);
    expect(deadRaider.auras.some((a) => a.id === 'nythraxis_transition_stun')).toBe(true);

    boss.dead = true;
    boss.hp = 0;
    nythraxis.onBossDeath(ctx, boss);

    expect(boss.nythraxis?.phase).toBe('dead');
    for (const entity of ctx.entities.values()) {
      expect(
        entity.auras.some((a) => a.id === 'nythraxis_transition_stun' && a.sourceId === boss.id),
      ).toBe(false);
    }
  });

  it('heroic Soul Rend marks six distinct non-tank players', () => {
    // Eight raiders total: seven non-tank candidates, so all six heroic marks
    // land and stay distinct (the same rng.int splice pick as normal).
    const { ctx, boss, tank } = setup({ difficulty: 'heroic', dpsCount: 7 });
    const st = nythraxis.initNythraxisEncounter(boss);
    st.phase = 2;
    nythraxis.castNythraxisSoulRend(ctx, boss, st);

    expect(st.soulRendMarks.length).toBe(6);
    const markedIds = st.soulRendMarks.map((m) => m.playerId);
    expect(new Set(markedIds).size).toBe(6); // distinct
    expect(markedIds).not.toContain(tank.id); // never the aggro target
    for (const id of markedIds) {
      const p = ctx.entities.get(id) as AnyEntity;
      expect(p.auras.some((a) => a.id === 'nythraxis_soul_rend')).toBe(true);
    }
  });

  it('heroic Soul Rend deals 150% of max hp split across the stack (75% for a pair)', () => {
    const { ctx, boss, dps } = setup({ difficulty: 'heroic', dpsCount: 7 });
    const st = nythraxis.initNythraxisEncounter(boss);
    st.phase = 2;
    // Two marked players standing on each other: each takes ceil(1.5x/2) = 75%.
    const [a, b] = dps;
    b.pos = { ...a.pos };
    a.maxHp = 1000;
    a.hp = 1000;
    b.maxHp = 1000;
    b.hp = 1000;
    st.soulRendMarks = [
      { playerId: a.id, remaining: 0 },
      { playerId: b.id, remaining: 0 },
    ];

    nythraxis.updateNythraxisSoulRend(ctx, boss, st);

    expect(a.hp).toBe(250);
    expect(b.hp).toBe(250);
  });

  it('heroic Deathless Rage is lethal on a failed wardstone channel (115% max hp)', () => {
    const heroic = setup({ difficulty: 'heroic' });
    let st = nythraxis.initNythraxisEncounter(heroic.boss);
    st.phase = 2;
    st.deathlessCastRemaining = 0.01; // completes this update, no channels ran
    for (const p of [heroic.tank, ...heroic.dps]) {
      p.maxHp = 1000;
      p.hp = 1000;
    }
    nythraxis.updateNythraxisDeathlessRage(heroic.ctx, heroic.boss, st);
    for (const p of [heroic.tank, ...heroic.dps]) expect(p.dead).toBe(true);

    // Normal keeps the survivable 82%.
    const normal = setup();
    st = nythraxis.initNythraxisEncounter(normal.boss);
    st.phase = 2;
    st.deathlessCastRemaining = 0.01;
    for (const p of [normal.tank, ...normal.dps]) {
      p.maxHp = 1000;
      p.hp = 1000;
    }
    nythraxis.updateNythraxisDeathlessRage(normal.ctx, normal.boss, st);
    for (const p of [normal.tank, ...normal.dps]) {
      expect(p.dead).toBe(false);
      expect(p.hp).toBe(180);
    }
  });

  it('Soul Rend marks up to three distinct non-tank players (the rng.int pick)', () => {
    const { ctx, boss, tank, dps } = setup();
    const st = nythraxis.initNythraxisEncounter(boss);
    st.phase = 2;
    nythraxis.castNythraxisSoulRend(ctx, boss, st);
    expect(st.soulRendMarks.length).toBe(3);
    const markedIds = st.soulRendMarks.map((m) => m.playerId);
    expect(new Set(markedIds).size).toBe(3); // distinct
    expect(markedIds).not.toContain(tank.id); // never the aggro target
    for (const id of markedIds) expect(dps.some((d) => d.id === id)).toBe(true);
    // The marked players carry the Soul Rend vulnerability aura.
    for (const id of markedIds) {
      const p = ctx.entities.get(id) as AnyEntity;
      expect(p.auras.some((a) => a.id === 'nythraxis_soul_rend')).toBe(true);
    }
  });

  it('a three-player wardstone channel interrupts Deathless Rage and self-stuns the boss', () => {
    const { sim, ctx, boss, dps } = setup();
    const st = nythraxis.initNythraxisEncounter(boss);
    st.phase = 2;
    nythraxis.startNythraxisDeathlessRage(ctx, boss, st);
    expect(st.deathlessCastRemaining).toBeGreaterThan(0);
    expect(st.wardChannels.length).toBe(3);
    const wards = [...ctx.entities.values()]
      .filter(
        (e) =>
          e.kind === 'object' &&
          e.objectItemId === 'bastion_ward_stone' &&
          dist2d(e.pos, boss.spawnPos) < 100,
      )
      .sort((a, b) => a.id - b.id) as AnyEntity[];
    // Three distinct players each claim a distinct wardstone via the object-click entry.
    wards.forEach((ward, i) => {
      const channeler = dps[i];
      teleport(sim, channeler, ward.pos.x, ward.pos.z, ward.pos.y);
      const handled = nythraxis.tryStartNythraxisWardChannel(ctx, ward, channeler);
      expect(handled).toBe(true);
    });
    // Mark every channel complete (the per-tick channel progress is covered by the
    // parity golden) and run one Deathless Rage tick: the interrupt should fire.
    for (const c of st.wardChannels) c.complete = true;
    nythraxis.updateNythraxisDeathlessRage(ctx, boss, st);
    expect(st.deathlessStunRemaining).toBeGreaterThan(0);
    expect(st.deathlessCastRemaining).toBe(0);
    expect(boss.auras.some((a) => a.id === 'nythraxis_deathless_stun')).toBe(true);
  });

  it('heroic Dread Curse stacks on the active tank and resets on a tank swap', () => {
    const { ctx, boss, tank, dps } = setup({ difficulty: 'heroic' });
    const st = nythraxis.initNythraxisEncounter(boss);
    st.phase = 1;
    st.dreadCurseTimer = 0.01;
    nythraxis.updateNythraxisDreadCurse(ctx, boss, st);
    let curse = tank.auras.find((a) => a.id === 'nythraxis_dread_curse');
    expect(curse?.stacks).toBe(1);
    expect(curse?.value).toBeCloseTo(0.1);

    st.dreadCurseTimer = 0.01;
    nythraxis.updateNythraxisDreadCurse(ctx, boss, st);
    curse = tank.auras.find((a) => a.id === 'nythraxis_dread_curse');
    expect(curse?.stacks).toBe(2);
    expect(curse?.value).toBeCloseTo(0.2);

    boss.aggroTargetId = dps[0].id;
    st.dreadCurseTimer = 0.01;
    nythraxis.updateNythraxisDreadCurse(ctx, boss, st);
    const swapped = dps[0].auras.find((a) => a.id === 'nythraxis_dread_curse');
    expect(swapped?.stacks).toBe(1);
    expect(swapped?.value).toBeCloseTo(0.1);
  });

  it('heroic wardstone interrupt leads to a three second add summon channel', () => {
    const { sim, ctx, boss, dps } = setup({ difficulty: 'heroic' });
    const st = nythraxis.initNythraxisEncounter(boss);
    st.phase = 2;
    nythraxis.startNythraxisDeathlessRage(ctx, boss, st);
    const wards = [...ctx.entities.values()]
      .filter(
        (e) =>
          e.kind === 'object' &&
          e.objectItemId === 'bastion_ward_stone' &&
          dist2d(e.pos, boss.spawnPos) < 100,
      )
      .sort((a, b) => a.id - b.id) as AnyEntity[];
    wards.forEach((ward, i) => {
      const channeler = dps[i];
      teleport(sim, channeler, ward.pos.x, ward.pos.z, ward.pos.y);
      expect(nythraxis.tryStartNythraxisWardChannel(ctx, ward, channeler)).toBe(true);
    });
    for (const c of st.wardChannels) c.complete = true;
    nythraxis.updateNythraxisDeathlessRage(ctx, boss, st);
    expect(st.deathlessStunRemaining).toBeGreaterThan(0);

    st.deathlessStunRemaining = 0.01;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.heroicSummonChannelRemaining).toBeGreaterThan(0);
    expect(boss.castingAbility).toBe('nythraxis_heroic_summon');

    const before = boss.summonedIds.length;
    for (let i = 0; i < 20 * 3 + 1; i++) nythraxis.updateNythraxisHeroicSummon(ctx, boss, st);
    const spawned = boss.summonedIds
      .slice(before)
      .map((id) => ctx.entities.get(id)?.templateId)
      .sort();
    expect(spawned).toEqual([
      'nythraxis_heroic_priest_add',
      'nythraxis_heroic_rogue_add',
      'nythraxis_heroic_warrior_add',
    ]);
  });

  it('a wardstone with no boss in range falls through (overworld Sunken Bastion stone)', () => {
    const { ctx, dps } = setup();
    // A lone ward stone far from any Nythraxis boss: tryStart must return false so the
    // normal quest pickup runs (same objectItemId, not a raid wardstone).
    const lone = {
      kind: 'object',
      objectItemId: 'bastion_ward_stone',
      pos: { x: -5000, y: 0, z: -5000 },
    } as Entity;
    expect(nythraxis.tryStartNythraxisWardChannel(ctx, lone, dps[0])).toBe(false);
    // A non-wardstone object also falls through.
    const other = { kind: 'object', objectItemId: 'iron_ore', pos: { x: 0, y: 0, z: 0 } } as Entity;
    expect(nythraxis.tryStartNythraxisWardChannel(ctx, other, dps[0])).toBe(false);
  });

  it('grants the 24h raid lockout to every player in the room on kill', () => {
    const { sim, ctx, boss, tank, dps } = setup();
    nythraxis.grantNythraxisLockout(ctx, boss);
    for (const e of [tank, ...dps]) {
      const meta = sim.players.get(e.id);
      expect(meta?.raidLockouts.has('nythraxis_boss_arena')).toBe(true);
      expect(meta?.raidLockouts.get('nythraxis_boss_arena')).toBeGreaterThan(ctx.lockoutNowMs());
    }
  });

  it('the lockout roster never crosses into the adjacent arena slot (z-band clip)', () => {
    const { sim, ctx, boss, tank } = setup();
    // A bystander parked in the ADJACENT slot's territory: arena slots sit
    // 500 apart in z with the spawn skewed high, so the raw 260 yd circle
    // around this slot's boss reaches past this slot's own z band. Membership
    // (the lockout) must clip to the band, exactly like the deed task window,
    // or a kill would lock out a player who was never in this raid's room.
    const outsiderPid = sim.addPlayer('mage', 'Bystander') as number;
    const outsider = sim.entities.get(outsiderPid) as AnyEntity;
    const inst = ctx.instances.find((i) => i.mobIds.includes(boss.id));
    expect(inst).toBeDefined();
    const origin = ctx.instanceOriginOf(inst!);
    const skewSide = boss.spawnPos.z >= origin.z ? 1 : -1;
    teleport(sim, outsider, origin.x, origin.z + skewSide * 252);
    // Geometry preconditions, so this test cannot rot into a vacuous pass:
    // inside the raw circle, outside the slot's z band.
    expect(dist2d(outsider.pos, boss.spawnPos)).toBeLessThanOrEqual(260);
    expect(Math.abs(outsider.pos.z - origin.z)).toBeGreaterThanOrEqual(250);

    nythraxis.grantNythraxisLockout(ctx, boss);
    expect(sim.players.get(tank.id)!.raidLockouts.has('nythraxis_boss_arena')).toBe(true);
    expect(sim.players.get(outsiderPid)!.raidLockouts.has('nythraxis_boss_arena')).toBe(false);
  });
});
