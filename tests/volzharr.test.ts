// Wing 3 of The Undermount Descent: Volzharr, the Buried Furnace (the
// movement finale). Permanent Vent Fissures carve the floor, geysers launch
// vent-standers, dormant Cinderlings wake and shamble home to feed him
// permanent Emberfeed stacks, the Undermount Eruption exempts anyone with a
// pillar between them and the throne, Forgeheat rewards vent-greed, and the
// scheduler never overlaps a control effect with an Eruption telegraph.
// Test-first: RED until src/sim/encounters/volzharr.ts is authored.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import {
  EMBER_CONSUME_RADIUS,
  FORGEHEAT_STACK_CAP,
  VENT_RADIUS,
} from '../src/sim/encounters/undermount';
import {
  EMBERFEED_AURA_ID,
  FORGEHEAT_AURA_ID,
  resetVolzharrEncounter,
} from '../src/sim/encounters/volzharr';
import { enterDungeon, heroicLockoutId, instanceKeyFor } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

const WING3 = 'undermount_wing3';
const VOLZHARR = 'volzharr_buried_furnace';
const CINDERLING = 'undermount_cinderling';

function makeSim(seed = 11): AnySim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true }) as AnySim;
}

function metaOf(sim: AnySim, pid: number): any {
  const r = sim.ctx.resolve(pid);
  if (!r) throw new Error(`no player ${pid}`);
  return r.meta;
}

function claimFor(sim: AnySim, dungeonId: string, pid: number): any {
  return (sim.instances as any[]).find(
    (i) => i.dungeonId === dungeonId && i.partyKey === instanceKeyFor(sim.ctx, pid),
  );
}

function bossIn(sim: AnySim, inst: any, templateId: string): AnyEntity {
  const boss = inst.mobIds
    .map((id: number) => sim.entities.get(id))
    .find((e: AnyEntity | undefined) => e?.templateId === templateId);
  if (!boss) throw new Error(`no ${templateId} in ${inst.dungeonId}`);
  return boss as AnyEntity;
}

function hasAura(e: AnyEntity, id: string): boolean {
  return (e.auras as any[]).some((a) => a.id === id);
}

function auraStacks(e: AnyEntity, id: string): number {
  return (e.auras as any[]).find((a) => a.id === id)?.stacks ?? 0;
}

function cinderlingsIn(sim: AnySim, inst: any): AnyEntity[] {
  return inst.mobIds
    .map((id: number) => sim.entities.get(id))
    .filter((e: AnyEntity | undefined) => e?.templateId === CINDERLING) as AnyEntity[];
}

function pullVolzharr(
  sim: AnySim,
  playerCount = 2,
): { boss: AnyEntity; pids: number[]; inst: any } {
  const pids: number[] = [];
  for (let i = 0; i < playerCount; i++) pids.push(sim.addPlayer('warrior', `R${i}`));
  for (const pid of pids) {
    const meta = metaOf(sim, pid);
    meta.undermountCleared.add('undermount_wing1');
    meta.undermountCleared.add('undermount_wing2');
  }
  enterDungeon(sim.ctx, WING3, pids[0]);
  const inst = claimFor(sim, WING3, pids[0]);
  const boss = bossIn(sim, inst, VOLZHARR);
  for (const pid of pids) {
    const p = sim.entities.get(pid) as AnyEntity;
    p.pos = { ...boss.pos };
    p.pos.z = boss.pos.z - 10;
    p.maxHp = 1_000_000;
    p.hp = 1_000_000;
  }
  const puller = sim.entities.get(pids[0]) as AnyEntity;
  sim.ctx.dealDamage(puller, boss, 1, false, 'physical', 'Pull', 'hit', true);
  return { boss, pids, inst };
}

function ticks(sim: AnySim, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}

function ventsOf(sim: AnySim, boss: AnyEntity): any[] {
  return (sim.ctx.groundAoEs as any[]).filter((g) => g.sourceId === boss.id);
}

describe('Volzharr, the Buried Furnace (wing 3)', () => {
  it('pays two guaranteed groups, the exact chase group, Moltenheart, and 15 gold', () => {
    const loot = MOBS[VOLZHARR].loot ?? [];
    const group = (id: string) => loot.filter((entry) => entry.rollGroup === id);
    expect(
      group('undermount_wing3_t2_chests').map(({ itemId, chance }) => [itemId, chance]),
    ).toEqual([
      ['crownforged_heartplate', 0.25],
      ['nighttalon_emberweave', 0.25],
      ['soulflame_vestments', 0.25],
      ['stormcallers_hauberk', 0.25],
    ]);
    expect(
      group('undermount_wing3_offpieces').map(({ itemId, chance }) => [itemId, chance]),
    ).toEqual([
      ['volzharrs_knucklestone', 0.25],
      ['magmastrider_greaves', 0.25],
      ['footwraps_of_the_waking_floor', 0.25],
      ['forgeheat_cinch', 0.25],
    ]);
    expect(group('undermount_wing3_chase').map(({ itemId, chance }) => [itemId, chance])).toEqual([
      ['corebreaker_heart_of_the_undermount', 0.03],
      ['the_last_restraint', 0.03],
      ['band_of_the_ninth_quench', 0.1],
      ['moltenheart_chroma', 0.01],
    ]);
    expect(loot).toContainEqual({ copper: 150000, chance: 1 });
  });

  it('settles heroic variants, the heroic lockout, and the heroic deed through the live kill path', () => {
    const sim = makeSim(13);
    const pid = sim.addPlayer('warrior', 'Heroic Raider');
    const meta = metaOf(sim, pid);
    meta.undermountCleared.add('undermount_wing1');
    meta.undermountCleared.add('undermount_wing2');
    sim.setDungeonDifficulty('heroic', pid);
    enterDungeon(sim.ctx, WING3, pid);
    const inst = claimFor(sim, WING3, pid);
    const boss = bossIn(sim, inst, VOLZHARR);
    const player = sim.entities.get(pid) as AnyEntity;
    player.pos = { ...boss.pos };

    sim.dealDamage(player, boss, boss.hp + 1, false, 'physical', null, 'hit', true);

    const ids = (boss.loot?.items ?? []).map((slot: any) => String(slot.itemId));
    expect(ids.filter((id: string) => id.startsWith('heroic_'))).toHaveLength(2);
    expect(meta.raidLockouts.has(heroicLockoutId(WING3))).toBe(true);
    expect(meta.deedStats.dungeonClears[`${WING3}:heroic`]).toBe(1);
    sim.tick();
    expect(meta.deedsEarned.has('dgn_undermount_volzharr_heroic')).toBe(true);
  });

  it('clears vents, shamblers and encounter state when the boss dies', () => {
    // The dead branch of updateMob returns before the encounter dispatch, so
    // without an explicit death-path reset the vents outlive the kill and the
    // raid loots on a floor still rendered full of fire (#2671 review round 2).
    const sim = makeSim();
    const { boss, pids } = pullVolzharr(sim, 1);
    ticks(sim, 2);
    const st = (boss as any).volzharr;
    st.ventTimer = 0.01;
    ticks(sim, 2);
    expect(ventsOf(sim, boss).length).toBeGreaterThan(0);
    const player = sim.entities.get(pids[0]) as AnyEntity;
    sim.dealDamage(player, boss, boss.hp + 1, false, 'physical', null, 'hit', true);
    ticks(sim, 5);
    expect(ventsOf(sim, boss), 'vents die with the boss').toHaveLength(0);
    expect((boss as any).volzharr, 'encounter state cleared').toBeUndefined();
  });

  it('spawns dormant Cinderlings with the boss and gives him the walk speed', () => {
    const sim = makeSim();
    const { boss, inst } = pullVolzharr(sim, 1);
    expect(cinderlingsIn(sim, inst).length).toBeGreaterThanOrEqual(8);
    expect(MOBS[VOLZHARR].moveSpeed).toBeLessThan(7);
    expect(boss.dead).toBe(false);
  });

  it('accumulates permanent vents on cadence and baits a player periodically', () => {
    const sim = makeSim();
    const { boss } = pullVolzharr(sim, 2);
    ticks(sim, 2);
    const st = (boss as any).volzharr;
    expect(st).toBeDefined();
    for (let i = 0; i < 3; i++) {
      st.ventTimer = 0.01;
      ticks(sim, 2);
    }
    expect(ventsOf(sim, boss).length).toBe(3);
    // Vents never expire: their remaining stays effectively permanent.
    ticks(sim, 40);
    expect(ventsOf(sim, boss).length).toBe(3);
    // The third vent is the bait: it opened under a live player's position.
    const bait = ventsOf(sim, boss)[2];
    const near = [...sim.ctx.players.values()].some((m: any) => {
      const p = sim.entities.get(m.entityId) as AnyEntity;
      return p && Math.hypot(p.pos.x - bait.pos.x, p.pos.z - bait.pos.z) < 8;
    });
    expect(near).toBe(true);
  });

  it('geysers a vent-stander and stacks Forgeheat on the vent-adjacent, capped', () => {
    const sim = makeSim();
    const { boss, pids } = pullVolzharr(sim, 2);
    ticks(sim, 2);
    const st = (boss as any).volzharr;
    st.ventTimer = 0.01;
    ticks(sim, 2);
    const vent = ventsOf(sim, boss)[0];
    const stander = sim.entities.get(pids[0]) as AnyEntity;
    stander.pos = { x: vent.pos.x, y: stander.pos.y, z: vent.pos.z };
    const greeder = sim.entities.get(pids[1]) as AnyEntity;
    greeder.pos = { x: vent.pos.x + VENT_RADIUS + 2, y: greeder.pos.y, z: vent.pos.z };
    ticks(sim, 2);
    expect(stander.vy).toBeGreaterThan(0); // launched
    // Decisive stack curve, not a vacuous range (#2671 review finding 1): a
    // stack per full second of continuous rim exposure, then the hard cap.
    ticks(sim, 50); // ~2.6 seconds on the rim
    expect(auraStacks(greeder, FORGEHEAT_AURA_ID)).toBe(3);
    ticks(sim, 150); // ten seconds of greed total
    expect(auraStacks(greeder, FORGEHEAT_AURA_ID)).toBe(FORGEHEAT_STACK_CAP);
  });

  it('wakes Cinderlings that shamble home and feed permanent Emberfeed stacks', () => {
    const sim = makeSim();
    const { boss, inst } = pullVolzharr(sim, 1);
    ticks(sim, 2);
    const st = (boss as any).volzharr;
    st.emberWakeTimer = 0.01;
    ticks(sim, 2);
    expect(st.shamblers.size).toBe(1);
    const walkerId = [...st.shamblers][0] as number;
    const walker = sim.entities.get(walkerId) as AnyEntity;
    const d0 = Math.hypot(walker.pos.x - boss.pos.x, walker.pos.z - boss.pos.z);
    ticks(sim, 40);
    const walkerNow = sim.entities.get(walkerId) as AnyEntity | undefined;
    if (walkerNow && !walkerNow.dead) {
      const d1 = Math.hypot(walkerNow.pos.x - boss.pos.x, walkerNow.pos.z - boss.pos.z);
      expect(d1).toBeLessThan(d0); // walking home, not at players
    }
    // Teleport the shambler to the boss: consumed, one permanent stack.
    if (walkerNow && !walkerNow.dead) {
      walkerNow.pos = { x: boss.pos.x + 1, y: walkerNow.pos.y, z: boss.pos.z };
      ticks(sim, 2);
    }
    expect(auraStacks(boss, EMBERFEED_AURA_ID)).toBe(1);
    expect(st.shamblers.size).toBe(0);
  });

  it('denies the stack when a shambler dies en route', () => {
    const sim = makeSim();
    const { boss } = pullVolzharr(sim, 1);
    ticks(sim, 2);
    const st = (boss as any).volzharr;
    st.emberWakeTimer = 0.01;
    ticks(sim, 2);
    const walkerId = [...st.shamblers][0] as number;
    const walker = sim.entities.get(walkerId) as AnyEntity;
    walker.hp = 1;
    const killer = [...sim.ctx.players.values()][0] as any;
    const kp = sim.entities.get(killer.entityId) as AnyEntity;
    sim.ctx.dealDamage(kp, walker, 10, false, 'physical', 'Strike', 'hit', true);
    ticks(sim, 4);
    expect(auraStacks(boss, EMBERFEED_AURA_ID)).toBe(0);
    expect(st.shamblers.size).toBe(0);
  });

  it('Eruption hits the exposed and exempts a pillar-covered player', () => {
    const sim = makeSim();
    const { boss, pids } = pullVolzharr(sim, 2);
    ticks(sim, 2);
    const exposed = sim.entities.get(pids[0]) as AnyEntity;
    const covered = sim.entities.get(pids[1]) as AnyEntity;
    // Find a covered spot by probing a ring of candidates for broken LoS.
    let found = false;
    outer: for (let r = 8; r <= 60 && !found; r += 2) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) {
        covered.pos = {
          x: boss.pos.x + Math.cos(a) * r,
          y: covered.pos.y,
          z: boss.pos.z + Math.sin(a) * r,
        };
        if (!sim.ctx.hasLineOfSight(boss, covered)) {
          found = true;
          break outer;
        }
      }
    }
    expect(found).toBe(true);
    exposed.pos = { x: boss.pos.x, y: exposed.pos.y, z: boss.pos.z - 12 };
    const st = (boss as any).volzharr;
    const hpE = exposed.hp;
    const hpC = covered.hp;
    st.eruptTimer = 0.01;
    ticks(sim, 2); // telegraph starts
    expect(st.eruptTelegraphUntil).toBeGreaterThan(0);
    ticks(sim, Math.ceil(3.2 * 20)); // ride out the telegraph
    expect(exposed.hp).toBeLessThan(hpE);
    expect(covered.hp).toBe(hpC);
  });

  it('suppresses Tremor during a telegraph and re-anchors it after', () => {
    const sim = makeSim();
    const { boss } = pullVolzharr(sim, 1);
    ticks(sim, 2);
    const st = (boss as any).volzharr;
    st.eruptTimer = 0.01;
    ticks(sim, 2);
    expect(st.eruptTelegraphUntil).toBeGreaterThan(0);
    st.tremorTimer = 0.01;
    ticks(sim, 2);
    expect(st.tremorSuppressed).toBe(true);
    ticks(sim, Math.ceil(3.5 * 20));
    expect(st.tremorSuppressed).toBe(false);
    expect(st.tremorTimer).toBeGreaterThan(0);
    expect(Number.isFinite(st.tremorTimer)).toBe(true);
  });

  it('resets clean: vents cleared, shamblers gone, Emberfeed stripped', () => {
    const sim = makeSim();
    const { boss } = pullVolzharr(sim, 1);
    ticks(sim, 2);
    const st = (boss as any).volzharr;
    st.ventTimer = 0.01;
    st.emberWakeTimer = 0.01;
    ticks(sim, 2);
    expect(ventsOf(sim, boss).length).toBeGreaterThan(0);
    resetVolzharrEncounter(sim.ctx, boss);
    expect(ventsOf(sim, boss).length).toBe(0);
    expect(hasAura(boss, EMBERFEED_AURA_ID)).toBe(false);
    expect((boss as any).volzharr).toBeUndefined();
  });

  it('produces identical vent floors and wake order on two seeded sims', () => {
    const run = () => {
      const sim = makeSim(23);
      const { boss } = pullVolzharr(sim, 2);
      ticks(sim, 2);
      const st = (boss as any).volzharr;
      for (let i = 0; i < 4; i++) {
        st.ventTimer = 0.01;
        st.emberWakeTimer = 0.01;
        ticks(sim, 3);
      }
      return JSON.stringify({
        vents: ventsOf(sim, boss).map((v) => [
          Math.round(v.pos.x * 100),
          Math.round(v.pos.z * 100),
        ]),
        shamblers: [...st.shamblers].sort(),
      });
    };
    expect(run()).toBe(run());
  });
});
