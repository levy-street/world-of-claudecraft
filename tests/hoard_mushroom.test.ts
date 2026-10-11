// The Mother of Mushrooms (src/sim/rift/hoard_mushroom.ts + its shared core): the
// first cave boss of the common and rare hoards.
import { describe, expect, it } from 'vitest';
import { CAVE_THEMES } from '../src/sim/content/rift/cave_themes';
import { RIFT_THEMES } from '../src/sim/content/rift/themes';
import { MOBS } from '../src/sim/data';
import { devHoardDestination } from '../src/sim/dev/hoard_travel';
import { hoardBossKit, tickHoardBossMechanics } from '../src/sim/rift/hoard_boss';
import {
  bloatHealth,
  bloatSwell,
  HOARD_BLOAT_CAP_TEMPLATE,
  HOARD_MUSHROOM_BOSS_TEMPLATE,
  HOARD_SPORELING_TEMPLATE,
  MUSHROOM,
  sporeCloudCount,
  sporeCloudPoints,
} from '../src/sim/rift/hoard_mushroom_core';
import { HOARD_RARITY_PRESSURE } from '../src/sim/rift/hoard_scaling';
import { RIFT_RANK_BASE_LEVEL } from '../src/sim/rift/ranks';
import { generateRiftFloor } from '../src/sim/rift/rift_gen';
import type { HoardBossCue, RiftInstance } from '../src/sim/rift/types';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';

type Rarity = 'common' | 'rare';

function encounter(rarity: Rarity = 'rare') {
  const destination = devHoardDestination('mushroom', rarity);
  if (!destination) throw new Error('no mushroom hoard');
  const sim = new Sim({ seed: 5150, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.enterRift(
    destination.seed,
    RIFT_RANK_BASE_LEVEL[destination.tier],
    sim.player.id,
    undefined,
    {
      ...sim.player,
      id: -1,
      vaultOwnerPid: sim.player.id,
      vaultRarity: rarity,
    },
  );
  const inst = sim.riftInstances.find((entry) => entry.partyKey !== null);
  if (!inst || inst.bossId === null) throw new Error('missing hoard');
  const boss = sim.entities.get(inst.bossId);
  if (!boss) throw new Error('missing boss');
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  sim.player.pos = { ...boss.pos, z: boss.pos.z - 14 };
  sim.player.hp = sim.player.maxHp;
  sim.drainEvents();
  return { sim, inst, boss };
}

function run(sim: Sim, boss: Entity, seconds: number, each?: () => void): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    boss.aiState = 'attack';
    sim.player.hp = sim.player.maxHp;
    each?.();
    tickHoardBossMechanics(sim.ctx);
    events.push(...sim.drainEvents());
  }
  return events;
}

const cues = (inst: RiftInstance, variant: string): HoardBossCue[] =>
  (inst.hoardBoss?.cues ?? []).filter((cue) => cue.variant === variant);
const sporelings = (sim: Sim, boss: Entity) =>
  boss.summonedIds.filter((id) => sim.entities.get(id)?.templateId === HOARD_SPORELING_TEMPLATE);

describe('the Mother of Mushrooms, pure', () => {
  it('lays more clouds on a rare map and for a bigger party, never past the cap', () => {
    expect(sporeCloudCount(false, 1)).toBe(MUSHROOM.sporeCommon);
    expect(sporeCloudCount(true, 1)).toBe(MUSHROOM.sporeRare);
    expect(sporeCloudCount(true, 3)).toBe(MUSHROOM.sporeRare + 1);
    expect(sporeCloudCount(true, 40)).toBe(MUSHROOM.sporeMax);
  });

  it('always leaves walkways: no two clouds of a cast closer than the spacing', () => {
    const center = { x: 10, z: 20 };
    const crowd = [
      { x: 10, z: 8 },
      { x: 11, z: 8 },
      { x: 30, z: 20 },
    ];
    for (let cast = 0; cast < 12; cast++) {
      for (const count of [3, 4, 6]) {
        const points = sporeCloudPoints(count, center, crowd, cast);
        expect(points).toHaveLength(count);
        for (let a = 0; a < points.length; a++) {
          for (let b = a + 1; b < points.length; b++) {
            const d = Math.hypot(points[a].x - points[b].x, points[a].z - points[b].z);
            expect(d).toBeGreaterThanOrEqual(MUSHROOM.sporeSpacing - 1e-9);
          }
        }
      }
    }
    // Two players standing together share one cloud; the rest fall on her ring.
    const points = sporeCloudPoints(4, center, crowd, 0);
    expect(points[0]).toEqual(crowd[0]);
    expect(points.filter((p) => p.x === crowd[1].x && p.z === crowd[1].z)).toHaveLength(0);
    for (const p of points.slice(1)) {
      if (p.x === crowd[2].x && p.z === crowd[2].z) continue;
      const reach = Math.hypot(p.x - center.x, p.z - center.z);
      expect(
        Math.abs(reach - MUSHROOM.sporeRingRadius) < 1e-9 ||
          Math.abs(reach - MUSHROOM.sporeOuterRingRadius) < 1e-9,
      ).toBe(true);
    }
    // Casts turn the ring: two casts do not lay the same pattern.
    expect(sporeCloudPoints(3, center, [], 1)).not.toEqual(sporeCloudPoints(3, center, [], 2));
  });

  it('sizes the Bloated Cap to her and to who can work on it, and swells it on its fuse', () => {
    expect(bloatHealth(10_000, 1)).toBe(400);
    expect(bloatHealth(10_000, 2)).toBe(800);
    expect(bloatHealth(10_000, 20)).toBe(400 * MUSHROOM.bloatMaxHealthPlayers);
    expect(bloatSwell(12, 12)).toBe(0);
    expect(bloatSwell(6, 12)).toBeCloseTo(0.25, 9);
    expect(bloatSwell(0, 12)).toBe(1);
  });
});

describe('the cave boss pool', () => {
  it('gives the common and rare caves their own bosses, and leaves the valleys alone', () => {
    expect(CAVE_THEMES.map((theme) => theme.boss)).toContain(HOARD_MUSHROOM_BOSS_TEMPLATE);
    // Kept out of the ordinary rift pool.
    expect(RIFT_THEMES.map((theme) => theme.id)).not.toContain('spore');
    const caveBosses = new Set(CAVE_THEMES.map((theme) => theme.boss));
    const valleyBosses = new Set(RIFT_THEMES.map((theme) => theme.boss));
    for (let random = 0; random < 40; random++) {
      for (const tier of [0, 1] as const) {
        const seed = makeVaultSeed(tier, random * 101, { open: false, zoneId: 'willowfen' });
        const boss = generateRiftFloor(seed, 22, 0).spawns.find((s) => s.boss)?.templateId;
        expect(caveBosses.has(boss ?? '')).toBe(true);
      }
      for (const tier of [2, 3] as const) {
        const seed = makeVaultSeed(tier, random * 101, { open: true, zoneId: 'willowfen' });
        const boss = generateRiftFloor(seed, 25, 0).spawns.find((s) => s.boss)?.templateId;
        expect(valleyBosses.has(boss ?? '')).toBe(true);
      }
    }
  });

  it('runs her on her own kit, with none of the stock rift boss mechanics', () => {
    expect(hoardBossKit(HOARD_MUSHROOM_BOSS_TEMPLATE)).toBe('mushroom');
    const template = MOBS[HOARD_MUSHROOM_BOSS_TEMPLATE];
    expect(template?.boss).toBe(true);
    expect(template?.rankMechanics).toEqual([]);
    expect(MOBS[HOARD_SPORELING_TEMPLATE]).toBeDefined();
    expect(MOBS[HOARD_BLOAT_CAP_TEMPLATE]?.moveSpeed).toBe(0);
  });
});

describe('the Mother of Mushrooms, in her cave', () => {
  it('lays her spore clouds, which then linger and burn whoever stays in them', () => {
    const { sim, inst, boss } = encounter('rare');
    run(sim, boss, MUSHROOM.sporeFirstSec + DT);
    const warned = cues(inst, 'mushroom-spore');
    expect(warned).toHaveLength(sporeCloudCount(true, 1));
    expect(warned.every((cue) => cue.kind === 'mark' && cue.phase === 'warning')).toBe(true);
    // One lands on the player.
    const mine = warned.find(
      (cue) => Math.hypot(cue.x - sim.player.pos.x, cue.z - sim.player.pos.z) < 1e-6,
    );
    expect(mine).toBeDefined();
    let hit = 0;
    const events = run(sim, boss, MUSHROOM.sporeWarningSec + 3);
    for (const ev of events) {
      if (ev.type === 'damage' && ev.targetId === sim.player.id && ev.ability === 'Spore Cloud')
        hit++;
    }
    // The landing, then the lingering pulses.
    expect(hit).toBeGreaterThanOrEqual(3);
    const lingering = cues(inst, 'mushroom-spore');
    expect(lingering.length).toBeGreaterThan(0);
    expect(lingering.every((cue) => cue.kind === 'mark' && cue.phase === 'hazard')).toBe(true);
  });

  it('calls two sporelings, and no more while four of hers still stand', () => {
    const { sim, inst, boss } = encounter('common');
    // A common map gives her clocks some slack (hoard_scaling.ts cadence).
    const slack = HOARD_RARITY_PRESSURE.common.cadence;
    run(sim, boss, MUSHROOM.sporelingFirstSec * slack + 2);
    expect(sporelings(sim, boss)).toHaveLength(MUSHROOM.sporelingCount);
    run(sim, boss, MUSHROOM.sporelingEverySec * slack + 2);
    expect(sporelings(sim, boss)).toHaveLength(MUSHROOM.sporelingCap);
    run(sim, boss, MUSHROOM.sporelingEverySec * slack + 2);
    expect(sporelings(sim, boss)).toHaveLength(MUSHROOM.sporelingCap);
    expect(inst.hoardBoss).toBeDefined();
  });

  it('never grows a Bloated Cap on a common map', () => {
    const { sim, inst, boss } = encounter('common');
    run(sim, boss, MUSHROOM.bloatFirstSec + 20);
    expect(cues(inst, 'mushroom-bloat')).toHaveLength(0);
    expect([...sim.entities.values()].some((e) => e.templateId === HOARD_BLOAT_CAP_TEMPLATE)).toBe(
      false,
    );
  });

  it('bursts a Bloated Cap left standing: heavy damage in its reach, and a cloud', () => {
    const { sim, inst, boss } = encounter('rare');
    let cap: Entity | undefined;
    run(sim, boss, MUSHROOM.bloatFirstSec + 8, () => {
      cap ??= [...sim.entities.values()].find((e) => e.templateId === HOARD_BLOAT_CAP_TEMPLATE);
    });
    if (!cap) throw new Error('no Bloated Cap grew');
    const fuse = cues(inst, 'mushroom-bloat')[0];
    expect(fuse?.kind).toBe('mark');
    expect(fuse && fuse.kind === 'mark' ? fuse.targetId : null).toBe(cap.id);
    const capEntity = cap;
    // Stand in its reach until it goes.
    const events: SimEvent[] = [];
    for (let t = 0; t < MUSHROOM.bloatFuseSec + 1 && sim.entities.has(capEntity.id); t += DT) {
      events.push(
        ...run(sim, boss, DT, () => {
          sim.player.pos = { ...capEntity.pos, x: capEntity.pos.x + 2 };
        }),
      );
    }
    const burst = events.filter(
      (ev) => ev.type === 'damage' && ev.targetId === sim.player.id && ev.ability === 'Bloated Cap',
    );
    expect(burst).toHaveLength(1);
    expect(sim.entities.has(capEntity.id)).toBe(false);
    expect(inst.mobIds).not.toContain(capEntity.id);
    expect(
      cues(inst, 'mushroom-spore').some(
        (cue) => cue.radius === MUSHROOM.bloatCloudRadius && cue.x === fuse.x && cue.z === fuse.z,
      ),
    ).toBe(true);
  });

  it('bursts harmlessly once cut down in time', () => {
    const { sim, inst, boss } = encounter('rare');
    let cap: Entity | undefined;
    run(sim, boss, MUSHROOM.bloatFirstSec + 8, () => {
      cap ??= [...sim.entities.values()].find((e) => e.templateId === HOARD_BLOAT_CAP_TEMPLATE);
    });
    if (!cap) throw new Error('no Bloated Cap grew');
    sim.ctx.handleDeath(cap, sim.player);
    const events = run(sim, boss, MUSHROOM.bloatFuseSec + 1, () => {
      if (cap) sim.player.pos = { ...cap.pos };
    });
    expect(events.some((ev) => ev.type === 'damage' && ev.ability === 'Bloated Cap')).toBe(false);
    const ended = cues(inst, 'mushroom-burst');
    expect(ended.length + cues(inst, 'mushroom-bloat').length).toBeLessThanOrEqual(1);
    expect(sim.entities.has(cap.id)).toBe(false);
  });

  it('takes her cap with her when the fight resets', () => {
    const { sim, inst, boss } = encounter('rare');
    let cap: Entity | undefined;
    run(sim, boss, MUSHROOM.bloatFirstSec + 8, () => {
      cap ??= [...sim.entities.values()].find((e) => e.templateId === HOARD_BLOAT_CAP_TEMPLATE);
    });
    if (!cap) throw new Error('no Bloated Cap grew');
    boss.aiState = 'idle';
    tickHoardBossMechanics(sim.ctx);
    expect(sim.entities.has(cap.id)).toBe(false);
    expect(inst.hoardBoss).toBeUndefined();
  });
});
