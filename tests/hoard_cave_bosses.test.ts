// The cave bosses of the common and rare hoards beside the Mother of Mushrooms:
// Deeprake (hoard_mole.ts), the Colossal Bat (hoard_bat.ts) and the Voracious
// Chest (hoard_mimic.ts), with the pieces they share (hoard_cave_kit.ts).
import { describe, expect, it } from 'vitest';
import { CAVE_THEMES } from '../src/sim/content/rift/cave_themes';
import { MOBS } from '../src/sim/data';
import { DEV_HOARD_DESTINATIONS, devHoardDestination } from '../src/sim/dev/hoard_travel';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import {
  BAT,
  HOARD_BAT_BOSS_TEMPLATE,
  HOARD_BAT_SWARMLING_TEMPLATE,
} from '../src/sim/rift/hoard_bat_core';
import { hoardBossKit, tickHoardBossMechanics } from '../src/sim/rift/hoard_boss';
import { caveRing, caveSpread, holdHoardCaveBoss } from '../src/sim/rift/hoard_cave_kit';
import { HOARD_CAST_SCREECH } from '../src/sim/rift/hoard_control_cast_ids';
import {
  HOARD_MIMIC_BOSS_TEMPLATE,
  MIMIC,
  mimicCoinPoints,
  mimicLeapHeight,
  mimicLeapProgress,
} from '../src/sim/rift/hoard_mimic_core';
import { HOARD_MOLE_BOSS_TEMPLATE, MOLE } from '../src/sim/rift/hoard_mole_core';
import { HOARD_RARITY_PRESSURE } from '../src/sim/rift/hoard_scaling';
import { RIFT_RANK_BASE_LEVEL } from '../src/sim/rift/ranks';
import type { HoardBossCue, RiftInstance } from '../src/sim/rift/types';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';

type Rarity = 'common' | 'rare';

function encounter(boss: string, rarity: Rarity = 'rare') {
  const destination = devHoardDestination(boss, rarity);
  if (!destination) throw new Error(`no ${boss} hoard`);
  const sim = new Sim({ seed: 5150, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.enterRift(
    destination.seed,
    RIFT_RANK_BASE_LEVEL[destination.tier],
    sim.player.id,
    undefined,
    { ...sim.player, id: -1, vaultOwnerPid: sim.player.id, vaultRarity: rarity },
  );
  const inst = sim.riftInstances.find((entry) => entry.partyKey !== null);
  if (!inst || inst.bossId === null) throw new Error('missing hoard');
  const b = sim.entities.get(inst.bossId);
  if (!b) throw new Error('missing boss');
  b.aiState = 'attack';
  b.aggroTargetId = sim.player.id;
  sim.player.pos = { ...b.pos, z: b.pos.z - 12 };
  sim.player.hp = sim.player.maxHp;
  sim.drainEvents();
  return { sim, inst, boss: b };
}

/** A second party member standing apart, so a boss that picks "anyone but the
 *  tank" has someone to pick. */
function ally(sim: Sim, inst: RiftInstance, dx: number, dz: number): Entity {
  const id = 9001;
  const other = {
    ...sim.player,
    id,
    pos: { ...sim.player.pos, x: sim.player.pos.x + dx, z: sim.player.pos.z + dz },
    auras: [],
  };
  sim.entities.set(id, other);
  inst.memberIds.add(id);
  inst.memberIds.add(sim.player.id);
  return other;
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

/** Run until `until` holds (or the time runs out); the events on the way. */
function runUntil(sim: Sim, boss: Entity, seconds: number, until: () => boolean): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < seconds && !until(); t += DT) events.push(...run(sim, boss, DT));
  return events;
}

const cues = (inst: RiftInstance, variant: string): HoardBossCue[] =>
  (inst.hoardBoss?.cues ?? []).filter((cue) => cue.variant === variant);
const hits = (events: SimEvent[], ability: string, target?: number) =>
  events.filter(
    (ev) =>
      ev.type === 'damage' &&
      ev.ability === ability &&
      (target === undefined || ev.targetId === target),
  );

describe('the cave boss pool', () => {
  it('holds all four cave bosses, each on its own kit with no stock mechanics', () => {
    const bosses = CAVE_THEMES.map((theme) => theme.boss);
    for (const id of [
      HOARD_MOLE_BOSS_TEMPLATE,
      HOARD_BAT_BOSS_TEMPLATE,
      HOARD_MIMIC_BOSS_TEMPLATE,
    ]) {
      expect(bosses).toContain(id);
      expect(MOBS[id]?.boss).toBe(true);
      expect(MOBS[id]?.rankMechanics).toEqual([]);
    }
    expect(hoardBossKit(HOARD_MOLE_BOSS_TEMPLATE)).toBe('mole');
    expect(hoardBossKit(HOARD_BAT_BOSS_TEMPLATE)).toBe('bat');
    expect(hoardBossKit(HOARD_MIMIC_BOSS_TEMPLATE)).toBe('mimic');
    for (const d of DEV_HOARD_DESTINATIONS.filter((row) => 'cave' in row && row.cave)) {
      expect(devHoardDestination(d.boss, 'common')).not.toBeNull();
      expect(devHoardDestination(d.boss, 'legendary')).toBeNull();
    }
  });

  it('spreads points so the room keeps walkways', () => {
    const ring = caveRing({ x: 0, z: 0 }, 10, 12, 3);
    const points = caveSpread(ring, 6, 6, [{ x: 10, z: 0, r: 5 }]);
    for (let a = 0; a < points.length; a++) {
      expect(Math.hypot(points[a].x - 10, points[a].z)).toBeGreaterThanOrEqual(5 - 1e-9);
      for (let b = a + 1; b < points.length; b++) {
        const d = Math.hypot(points[a].x - points[b].x, points[a].z - points[b].z);
        expect(d).toBeGreaterThanOrEqual(6 - 1e-9);
      }
    }
  });
});

describe('Deeprake', () => {
  it('rakes whoever stands in front of him', () => {
    const { sim, inst, boss } = encounter('deeprake', 'common');
    sim.player.pos = { ...boss.pos, z: boss.pos.z - 3 };
    const slack = HOARD_RARITY_PRESSURE.common.cadence;
    const events = run(sim, boss, MOLE.swipeFirstSec * slack + MOLE.swipeWindupSec + 0.3, () => {
      sim.player.pos = { ...boss.pos, z: boss.pos.z - 3 };
    });
    expect(hits(events, 'Claw Rake', sim.player.id).length).toBeGreaterThan(0);
    expect(inst.hoardBoss).toBeDefined();
  });

  it('burrows, tunnels untouchable to a circle under a player, and erupts there', () => {
    const { sim, inst, boss } = encounter('deeprake', 'common');
    const other = ally(sim, inst, 10, -4);
    runUntil(sim, boss, 40, () => cues(inst, 'mole-burrow').length > 0);
    const circle = cues(inst, 'mole-burrow')[0];
    expect(circle).toBeDefined();
    // Under the one who is NOT holding him.
    expect(circle.kind === 'mark' ? circle.targetId : null).toBe(other.id);
    expect(boss.damageImmune).toBe(true);
    expect(holdHoardCaveBoss(sim.ctx, boss)).toBe(true);
    expect(Math.hypot(boss.pos.x - circle.x, boss.pos.z - circle.z)).toBeLessThan(1e-6);
    // The ally stands still in it: the eruption hurts and throws.
    const events = runUntil(sim, boss, 5, () => cues(inst, 'mole-burrow').length === 0);
    expect(hits(events, 'Eruption', other.id)).toHaveLength(1);
    expect(boss.damageImmune).toBe(false);
    run(sim, boss, MOLE.emergeSec + 0.2);
    expect(holdHoardCaveBoss(sim.ctx, boss)).toBe(false);
  });

  it('brings the ceiling down only on a rare map, never onto his eruption circle', () => {
    const common = encounter('deeprake', 'common');
    run(common.sim, common.boss, MOLE.rockFirstSec * 1.3 + 5);
    expect(cues(common.inst, 'mole-rock')).toHaveLength(0);
    const { sim, inst, boss } = encounter('deeprake', 'rare');
    runUntil(sim, boss, 60, () => cues(inst, 'mole-rock').length > 0);
    const rocks = cues(inst, 'mole-rock');
    expect(rocks.length).toBeGreaterThan(0);
    const burrow = cues(inst, 'mole-burrow')[0];
    for (const rock of rocks) {
      if (burrow)
        expect(Math.hypot(rock.x - burrow.x, rock.z - burrow.z)).toBeGreaterThanOrEqual(
          MOLE.rockAvoidBurrow - 1e-9,
        );
    }
  });

  it('comes up when the fight resets', () => {
    const { sim, inst, boss } = encounter('deeprake', 'common');
    ally(sim, inst, 10, -4);
    runUntil(sim, boss, 40, () => cues(inst, 'mole-burrow').length > 0);
    expect(boss.damageImmune).toBe(true);
    boss.aiState = 'idle';
    tickHoardBossMechanics(sim.ctx);
    expect(boss.damageImmune).toBe(false);
    expect(boss.castingAbility).toBeNull();
    expect(inst.hoardBoss).toBeUndefined();
  });
});

describe('the Colossal Bat', () => {
  it('dives down its marked lane, bowling over whoever is still in it', () => {
    const { sim, inst, boss } = encounter('bat', 'common');
    const start = { ...boss.pos };
    runUntil(sim, boss, 30, () => cues(inst, 'bat-dive').length > 0);
    const lane = cues(inst, 'bat-dive')[0];
    expect(lane?.kind).toBe('sweep');
    expect(holdHoardCaveBoss(sim.ctx, boss)).toBe(true);
    // The player stays on the lane, a few yards out.
    const events = runUntil(sim, boss, 6, () => cues(inst, 'bat-dive').length === 0);
    expect(hits(events, 'Plunging Dive', sim.player.id)).toHaveLength(1);
    expect(Math.hypot(boss.pos.x - start.x, boss.pos.z - start.z)).toBeGreaterThan(3);
    expect(Math.hypot(boss.pos.x - start.x, boss.pos.z - start.z)).toBeLessThanOrEqual(
      BAT.diveMaxYards + 1e-6,
    );
  });

  it('screeches unless interrupted: kicked, nobody is hurt; left, the room is hurt and slowed', () => {
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[HOARD_CAST_SCREECH]).toBeDefined();
    const kicked = encounter('bat', 'common');
    runUntil(kicked.sim, kicked.boss, 40, () => kicked.boss.castingAbility === HOARD_CAST_SCREECH);
    expect(cues(kicked.inst, 'bat-screech')).toHaveLength(1);
    // What an interrupt does to a scripted cast: the bar is gone.
    kicked.boss.castingAbility = null;
    const quiet = run(kicked.sim, kicked.boss, BAT.screechCastSec + 0.5);
    expect(hits(quiet, 'Deafening Screech')).toHaveLength(0);
    expect(cues(kicked.inst, 'bat-screech')).toHaveLength(0);

    const left = encounter('bat', 'common');
    runUntil(left.sim, left.boss, 40, () => left.boss.castingAbility === HOARD_CAST_SCREECH);
    left.sim.player.pos = { ...left.boss.pos, z: left.boss.pos.z - 5 };
    const loud = run(left.sim, left.boss, BAT.screechCastSec + 0.3);
    expect(hits(loud, 'Deafening Screech', left.sim.player.id)).toHaveLength(1);
    expect(
      left.sim.player.auras.some(
        (aura) => aura.name === 'Deafening Screech' && aura.kind === 'slow',
      ),
    ).toBe(true);
  });

  it('lets loose its swarm only on a rare map, never past the cap', () => {
    const common = encounter('bat', 'common');
    run(common.sim, common.boss, BAT.swarmFirstSec * 1.3 + 10);
    const swarm = (sim: Sim, boss: Entity) =>
      boss.summonedIds.filter(
        (id) => sim.entities.get(id)?.templateId === HOARD_BAT_SWARMLING_TEMPLATE,
      );
    expect(swarm(common.sim, common.boss)).toHaveLength(0);
    const { sim, boss } = encounter('bat', 'rare');
    run(sim, boss, BAT.swarmFirstSec + BAT.swarmEverySec * 3 + 10);
    expect(swarm(sim, boss).length).toBeGreaterThan(0);
    expect(swarm(sim, boss).length).toBeLessThanOrEqual(BAT.swarmCap);
  });
});

describe('the Voracious Chest', () => {
  it('lays its coins in a fan ahead of it, spread apart', () => {
    for (let turn = 0; turn < 4; turn++) {
      const points = mimicCoinPoints({ x: 0, z: 0 }, 0, 7, turn);
      expect(points.length).toBeGreaterThanOrEqual(4);
      for (const p of points) {
        const reach = Math.hypot(p.x, p.z);
        expect(reach).toBeGreaterThanOrEqual(MIMIC.coinNear - 1e-9);
        expect(reach).toBeLessThanOrEqual(MIMIC.coinFar + 1e-9);
        expect(p.z).toBeGreaterThan(0);
      }
      for (let a = 0; a < points.length; a++)
        for (let b = a + 1; b < points.length; b++)
          expect(
            Math.hypot(points[a].x - points[b].x, points[a].z - points[b].z),
          ).toBeGreaterThanOrEqual(MIMIC.coinSpacing - 1e-9);
    }
    // The leap: crouched, then an arc that peaks mid-flight and lands.
    const total = MIMIC.leapCrouchSec + MIMIC.leapFlightSec;
    expect(mimicLeapProgress(total, total)).toBe(0);
    expect(mimicLeapProgress(0, total)).toBe(1);
    expect(mimicLeapHeight(0.5)).toBeCloseTo(MIMIC.leapPeak, 9);
    expect(mimicLeapHeight(1)).toBe(0);
  });

  it('leaps at the one furthest away and lands on the circle, crushing who stayed', () => {
    const { sim, inst, boss } = encounter('chest', 'common');
    const far = ally(sim, inst, 0, -8);
    runUntil(sim, boss, 40, () => cues(inst, 'mimic-leap').length > 0);
    const circle = cues(inst, 'mimic-leap')[0];
    expect(circle.kind === 'mark' ? circle.targetId : null).toBe(far.id);
    let peak = 0;
    const events = runUntil(sim, boss, 4, () => {
      peak = Math.max(peak, boss.pos.y - sim.ctx.groundPos(boss.pos.x, boss.pos.z).y);
      return cues(inst, 'mimic-leap').length === 0;
    });
    expect(peak).toBeGreaterThan(1);
    expect(hits(events, 'Crushing Leap', far.id)).toHaveLength(1);
    expect(Math.hypot(boss.pos.x - circle.x, boss.pos.z - circle.z)).toBeLessThan(0.5);
    expect(holdHoardCaveBoss(sim.ctx, boss)).toBe(false);
  });

  it('bites what stands in front of it', () => {
    const { sim, boss } = encounter('chest', 'common');
    const slack = HOARD_RARITY_PRESSURE.common.cadence;
    const events = run(sim, boss, MIMIC.biteFirstSec * slack + MIMIC.biteWindupSec + 0.3, () => {
      sim.player.pos = { ...boss.pos, z: boss.pos.z - 3 };
    });
    expect(hits(events, 'Voracious Bite', sim.player.id).length).toBeGreaterThan(0);
  });

  it('spits cursed coins only on a rare map', () => {
    const common = encounter('chest', 'common');
    run(common.sim, common.boss, MIMIC.coinFirstSec * 1.3 + 10);
    expect(cues(common.inst, 'mimic-coins')).toHaveLength(0);
    const { sim, inst, boss } = encounter('chest', 'rare');
    runUntil(sim, boss, 60, () => cues(inst, 'mimic-coins').length > 0);
    expect(cues(inst, 'mimic-coins').length).toBeGreaterThanOrEqual(MIMIC.coinCount);
  });
});

describe('the cave bosses online', () => {
  it('clears a withdrawn telegraph at once: a zero-length cue, never its old length', () => {
    const { sim, inst, boss } = encounter('deeprake', 'common');
    ally(sim, inst, 10, -4);
    runUntil(sim, boss, 40, () => cues(inst, 'mole-burrow').length > 0);
    const events = runUntil(sim, boss, 5, () => cues(inst, 'mole-burrow').length === 0);
    const last = events.filter((ev) => ev.type === 'hoardBossCue').at(-1) as
      | { durationSecs?: number; remainingSecs?: number }
      | undefined;
    expect(last).toBeDefined();
    expect(last?.durationSecs ?? 0).toBe(0);
  });

  it('keeps no melee swing going while a module holds the boss underground', () => {
    const { sim, inst, boss } = encounter('deeprake', 'common');
    runUntil(sim, boss, 40, () => cues(inst, 'mole-burrow').length > 0);
    // Solo: the circle is under the tank, who stands right on top of him.
    const events: SimEvent[] = [];
    for (let t = 0; t < 1.5; t += DT) {
      boss.aiState = 'attack';
      sim.player.hp = sim.player.maxHp;
      events.push(...sim.tick());
    }
    const melee = events.filter(
      (ev) => ev.type === 'damage' && ev.sourceId === boss.id && ev.targetId === sim.player.id,
    );
    expect(boss.damageImmune).toBe(true);
    expect(melee).toHaveLength(0);
  });
});

describe('the Voracious Chest coins on screen', () => {
  it('flies each handful out of the mouth in an arc and lands it in its puddle', async () => {
    const { MIMIC_COIN_LOOK, mimicCoinArc, mimicCoinProgress, planMimicCoins } = await import(
      '../src/render/hoard_mimic_coins_core'
    );
    const coins = planMimicCoins(7, MIMIC_COIN_LOOK.perPuddle, MIMIC.coinRadius);
    expect(coins).toHaveLength(MIMIC_COIN_LOOK.perPuddle);
    for (const coin of coins) {
      expect(Math.hypot(coin.dx, coin.dz)).toBeLessThanOrEqual(
        MIMIC.coinRadius * MIMIC_COIN_LOOK.spread + 1e-9,
      );
    }
    expect(planMimicCoins(7, 6, 2)).toEqual(planMimicCoins(7, 6, 2));
    const from = { x: 0, y: 2, z: 0 };
    const to = { x: 10, y: 0, z: 0 };
    const out = { x: 0, y: 0, z: 0 };
    expect(mimicCoinArc(from, to, 0, out)).toEqual({ x: 0, y: 2, z: 0 });
    expect(mimicCoinArc(from, to, 1, out)).toEqual({ x: 10, y: 0, z: 0 });
    expect(mimicCoinArc(from, to, 0.5, out).y).toBeGreaterThan(1 + MIMIC_COIN_LOOK.arcPeak - 1e-9);
    // It leaves after its delay and lands exactly as the warning ends.
    expect(mimicCoinProgress(0.05, 1.1, 0.1)).toBe(0);
    expect(mimicCoinProgress(1.1, 1.1, 0.1)).toBe(1);
  });

  it('draws the coins while a puddle stands and lets them sink when it goes', async () => {
    const THREE = await import('three');
    const { HoardMimicCoinsFx } = await import('../src/render/hoard_mimic_coins');
    const scene = new THREE.Scene();
    const fx = new HoardMimicCoinsFx(
      scene,
      () => 0,
      undefined,
      undefined,
      () => false,
      'high',
    );
    await fx.readyForEntry;
    const mesh = scene.getObjectByName('MimicCoins') as InstanceType<typeof THREE.InstancedMesh>;
    const cue = {
      instanceId: 1,
      cueId: 3,
      kind: 'mark' as const,
      variant: 'mimic-coins' as const,
      phase: 'warning' as const,
      x: 4,
      z: 4,
      radius: MIMIC.coinRadius,
      remaining: MIMIC.coinWindupSec,
      total: MIMIC.coinWindupSec,
    };
    fx.sync([cue]);
    fx.update(MIMIC.coinWindupSec + 0.1);
    expect(mesh.visible).toBe(true);
    fx.sync([]);
    fx.update(1);
    expect(mesh.visible).toBe(false);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
