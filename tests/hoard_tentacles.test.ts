// Abyssal Maw's Tentacles of the Abyss (src/sim/rift/hoard_tentacles.ts + its shared core).
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import {
  HOARD_TOTEM_TENTACLE_MARGIN,
  HOARD_TOTEM_TRIGGER_HP,
  hoardBossCueViews,
  tickHoardBossMechanics,
} from '../src/sim/rift/hoard_boss';
import { HOARD_RARITY_PRESSURE } from '../src/sim/rift/hoard_scaling';
import {
  HOARD_TENTACLE_GRASP_AURA_ID,
  isHeldByTentacle,
} from '../src/sim/rift/hoard_tentacle_grasp';
import { TENTACLES_EVERY_SEC } from '../src/sim/rift/hoard_tentacles';
import {
  grabReaches,
  HOARD_TENTACLE_TEMPLATE,
  hasEscape,
  isTentacleVariant,
  maxGrabbed,
  pointInTelegraph,
  pointInWhip,
  SWEEP_TOTAL_SEC,
  sweepArmBearing,
  sweepPasses,
  sweepProgress,
  TENTACLE_TOTAL_SEC,
  TENTACLES,
  type TentacleTelegraph,
  tentacleAttackKind,
  tentacleCount,
  tentacleHealth,
  tentacleOffsets,
  WHIP_TOTAL_SEC,
} from '../src/sim/rift/hoard_tentacles_core';
import type { RiftInstance } from '../src/sim/rift/types';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, RUN_SPEED, type SimEvent } from '../src/sim/types';

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
  boss.templateId = 'rift_boss_tide';
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  sim.player.pos = { ...boss.pos, z: boss.pos.z - 20 };
  sim.player.hp = sim.player.maxHp;
  tickHoardBossMechanics(sim.ctx);
  sim.drainEvents();
  quietKit(inst);
  return { sim, inst, boss };
}

/** His Crashing Tide and his totem are not under test: park them. */
function quietKit(inst: RiftInstance): void {
  if (!inst.hoardBoss) throw new Error('missing state');
  inst.hoardBoss.sweepTimer = 999;
  inst.hoardBoss.markTimer = 999;
  inst.hoardBoss.specialTriggered = true;
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
  const state = entry.inst.hoardBoss?.tentacles;
  if (!state) throw new Error('missing tentacle state');
  return state;
}

function rise(entry: ReturnType<typeof encounter>): SimEvent[] {
  held(entry).timer = 0;
  return run(entry.sim, entry.boss, DT * 2);
}

const heal = (entry: ReturnType<typeof encounter>) => () => {
  for (const id of [entry.sim.player.id, ...entry.inst.memberIds]) {
    const player = entry.sim.entities.get(id);
    if (player) player.hp = player.maxHp;
  }
};

const cuesOf = (inst: RiftInstance, variant: string) =>
  hoardBossCueViews(inst).filter((cue) => cue.variant === variant);

const tentacleMobs = (entry: ReturnType<typeof encounter>) =>
  [...entry.sim.entities.values()].filter((e) => e.templateId === HOARD_TENTACLE_TEMPLATE);

describe('the tentacle numbers (pure, shared with the renderer)', () => {
  it('raises about one for every two players, pressed by rarity, within bounds', () => {
    expect(TENTACLES.playersPerTentacle).toBe(2);
    expect(tentacleCount(1)).toBe(1);
    expect(tentacleCount(2)).toBe(1);
    expect(tentacleCount(3)).toBe(2);
    expect(tentacleCount(4)).toBe(2);
    expect(tentacleCount(5)).toBe(3);
    expect(tentacleCount(1, HOARD_RARITY_PRESSURE.common.extra)).toBe(TENTACLES.minTentacles);
    expect(tentacleCount(4, HOARD_RARITY_PRESSURE.legendary.extra)).toBe(3);
    expect(tentacleCount(40, 9)).toBe(TENTACLES.maxTentacles);
  });

  it('gives each a share of the boss health, thinner the more of them there are', () => {
    const one = tentacleHealth(100_000, 1);
    expect(one).toBe(Math.round(100_000 * TENTACLES.healthFraction));
    expect(tentacleHealth(100_000, 3)).toBeLessThan(one);
    // The whole set is always more work than one, never less.
    for (let n = 2; n <= TENTACLES.maxTentacles; n++) {
      expect(tentacleHealth(100_000, n) * n).toBeGreaterThan(
        tentacleHealth(100_000, n - 1) * (n - 1),
      );
    }
    expect(tentacleHealth(0, 1)).toBe(1);
  });

  it('places them off the boss, off the walls and apart, the same for the same seed', () => {
    for (let count = 1; count <= TENTACLES.maxTentacles; count++) {
      for (let seed = 1; seed <= 25; seed++) {
        const offsets = tentacleOffsets(count, seed, 24, 40);
        expect(offsets).toHaveLength(count);
        expect(tentacleOffsets(count, seed, 24, 40)).toEqual(offsets);
        for (let i = 0; i < offsets.length; i++) {
          expect(Math.abs(offsets[i].x)).toBeLessThanOrEqual(24 - TENTACLES.wallMargin + 1e-9);
          expect(offsets[i].f).toBeGreaterThanOrEqual(TENTACLES.minBossDistance - 1e-9);
          expect(offsets[i].f).toBeLessThanOrEqual(TENTACLES.maxBossDistance + 1e-9);
          for (let j = i + 1; j < offsets.length; j++) {
            const d = Math.hypot(offsets[i].x - offsets[j].x, offsets[i].f - offsets[j].f);
            // Apart enough that two trunks never share melee ground.
            expect(d).toBeGreaterThan(TENTACLES.sweepInnerRadius * 2);
          }
        }
      }
    }
    // A cramped room still yields legal places.
    for (const spot of tentacleOffsets(3, 4, 5, 12)) {
      expect(Math.abs(spot.x)).toBeLessThanOrEqual(1 + 1e-9);
      expect(spot.f).toBeGreaterThanOrEqual(TENTACLES.minBossDistance - 1e-9);
    }
  });

  it('cycles each tentacle through lash, sweep and grasp, neighbours out of step', () => {
    expect(tentacleAttackKind(0, 0)).toBe('whip');
    expect(tentacleAttackKind(0, 1)).toBe('sweep');
    expect(tentacleAttackKind(0, 2)).toBe('grab');
    expect(tentacleAttackKind(0, 3)).toBe('whip');
    expect(tentacleAttackKind(1, 0)).toBe('sweep');
    expect(tentacleAttackKind(2, 0)).toBe('grab');
  });

  it('never lets them hold the whole party, and reaches only so far', () => {
    expect(maxGrabbed(1)).toBe(1); // alone they can still strike what holds them
    expect(maxGrabbed(2)).toBe(1);
    expect(maxGrabbed(4)).toBe(1);
    expect(maxGrabbed(5)).toBe(2);
    for (let living = 2; living <= 12; living++)
      expect(living - maxGrabbed(living)).toBeGreaterThanOrEqual(maxGrabbed(living));
    expect(grabReaches(0, 0, TENTACLES.grabRange - 0.1, 0)).toBe(true);
    expect(grabReaches(0, 0, TENTACLES.grabRange + 0.1, 0)).toBe(false);
    // A readable reach: time to run out of it from well inside.
    expect(TENTACLES.grabTelegraphSec).toBeGreaterThanOrEqual(1.2);
    // Held inside the ground its own sweep never touches.
    expect(TENTACLES.grabHoldDistance).toBeLessThan(TENTACLES.sweepInnerRadius);
  });

  it('whips a rectangle out from the trunk along its facing, and nothing else', () => {
    const facing = Math.PI / 2; // +x
    expect(pointInWhip(0, 0, facing, 8, 0)).toBe(true);
    expect(pointInWhip(0, 0, facing, TENTACLES.whipLength - 0.1, 0)).toBe(true);
    expect(pointInWhip(0, 0, facing, TENTACLES.whipLength + 0.1, 0)).toBe(false);
    expect(pointInWhip(0, 0, facing, 8, TENTACLES.whipHalfWidth - 0.05)).toBe(true);
    expect(pointInWhip(0, 0, facing, 8, TENTACLES.whipHalfWidth + 0.05)).toBe(false);
    expect(pointInWhip(0, 0, facing, -1, 0)).toBe(false);
    // A readable telegraph, and a sidestep always gets you out in time.
    expect(TENTACLES.whipTelegraphSec).toBeGreaterThanOrEqual(1);
    expect(TENTACLES.whipHalfWidth).toBeLessThan(RUN_SPEED * TENTACLES.whipTelegraphSec * 0.5);
  });

  it('sweeps one full eased turn after its telegraph, either way round', () => {
    expect(sweepProgress(0)).toBe(0);
    expect(sweepProgress(TENTACLES.sweepTelegraphSec)).toBe(0);
    expect(sweepProgress(TENTACLES.sweepTelegraphSec + TENTACLES.sweepSec / 2)).toBeCloseTo(0.5, 9);
    expect(sweepProgress(TENTACLES.sweepTelegraphSec + TENTACLES.sweepSec)).toBe(1);
    expect(sweepProgress(99)).toBe(1);
    expect(sweepArmBearing(1, 1, 0.25)).toBeCloseTo(1 + Math.PI / 2, 9);
    expect(sweepArmBearing(1, -1, 0.25)).toBeCloseTo(1 - Math.PI / 2, 9);
    expect(SWEEP_TOTAL_SEC).toBeCloseTo(
      TENTACLES.sweepTelegraphSec + TENTACLES.sweepSec + TENTACLES.sweepLingerSec,
      9,
    );
    expect(WHIP_TOTAL_SEC).toBeCloseTo(
      TENTACLES.whipTelegraphSec + TENTACLES.whipStrikeSec + TENTACLES.whipLingerSec,
      9,
    );
    // From anywhere in the ring, the way out is shorter than the telegraph is long.
    const worst = (TENTACLES.sweepRadius - TENTACLES.sweepInnerRadius) / 2;
    expect(worst).toBeLessThan(RUN_SPEED * TENTACLES.sweepTelegraphSec * 0.6);
  });

  it('catches every point of the ring exactly once in a full turn, stepped a tick at a time', () => {
    for (const direction of [1, -1]) {
      for (let k = 0; k < 24; k++) {
        const bearing = (k / 24) * Math.PI * 2;
        for (const d of [TENTACLES.sweepInnerRadius + 0.1, 5, TENTACLES.sweepRadius - 0.1]) {
          const px = Math.sin(bearing) * d;
          const pz = Math.cos(bearing) * d;
          let hits = 0;
          let before = 0;
          for (let t = 0; t <= SWEEP_TOTAL_SEC + DT; t += DT) {
            const now = sweepProgress(t);
            if (hits === 0 && sweepPasses(0, 0, 0.7, direction, before, now, px, pz)) hits++;
            before = now;
          }
          expect(hits).toBe(1);
        }
      }
    }
    // Hugging the trunk, or outside its reach, is never swept.
    expect(sweepPasses(0, 0, 0, 1, 0, 1, 0, TENTACLES.sweepInnerRadius - 0.1)).toBe(false);
    expect(sweepPasses(0, 0, 0, 1, 0, 1, 0, TENTACLES.sweepRadius + 0.1)).toBe(false);
    // An arm that has not moved has hit nobody.
    expect(sweepPasses(0, 0, 0, 1, 0.3, 0.3, 0, 5)).toBe(false);
  });

  it('reaches a point behind the start of the turn at the END of the lap, not the start', () => {
    // Just behind the starting bearing (turning clockwise from 0): nearly a full lap away.
    const px = Math.sin(-0.6) * 5;
    const pz = Math.cos(-0.6) * 5;
    expect(sweepPasses(0, 0, 0, 1, 0, 0.05, px, pz)).toBe(false);
    expect(sweepPasses(0, 0, 0, 1, 0.85, 0.95, px, pz)).toBe(true);
  });

  it('only accepts a set of telegraphs that leaves open ground within reach', () => {
    const whip: TentacleTelegraph = { kind: 'whip', x: 0, z: 0, facing: 0 };
    const sweep: TentacleTelegraph = { kind: 'sweep', x: 0, z: 12, facing: 0 };
    expect(pointInTelegraph(whip, 0, 6)).toBe(true);
    expect(pointInTelegraph(sweep, 0, 6)).toBe(true);
    expect(pointInTelegraph(sweep, 0, 12)).toBe(false);
    // Standing in both at once is still escapable: the way out is sideways.
    expect(hasEscape(0, 6, [whip, sweep])).toBe(true);
    // Walled in by a ring of sweeps with no reachable gap: refused.
    const wall: TentacleTelegraph[] = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      for (const r of [4, 9, 14]) {
        wall.push({ kind: 'sweep', x: Math.sin(a) * r, z: Math.cos(a) * r, facing: 0 });
      }
    }
    wall.push({ kind: 'sweep', x: 2.5, z: 0, facing: 0 });
    expect(hasEscape(0, 0, wall)).toBe(false);
  });

  it('names its cue variants', () => {
    for (const v of [
      'tide-tentacle',
      'tide-tentacle-up',
      'tide-tentacle-fall',
      'tide-whip',
      'tide-sweep',
      'tide-grab',
      'tide-grab-hold',
    ])
      expect(isTentacleVariant(v)).toBe(true);
    expect(isTentacleVariant('tide-wave')).toBe(false);
    expect(isTentacleVariant(undefined)).toBe(false);
  });
});

describe('the tentacles in the fight', () => {
  it('registers the tentacle as a harmless, rooted, lootless mob', () => {
    const template = MOBS[HOARD_TENTACLE_TEMPLATE];
    expect(template).toBeDefined();
    expect(template.dmgBase).toBe(0);
    expect(template.moveSpeed).toBe(0);
    expect(template.aggroRadius).toBe(0);
    expect(template.xpMult).toBe(0);
    expect(template.loot).toEqual([]);
    expect(template.phasesThroughObstacles).toBe(true);
  });

  it('warns, then erupts into real mobs with scaled health, hurting whoever stood there', () => {
    const entry = encounter();
    const events = rise(entry);
    const risen = cuesOf(entry.inst, 'tide-tentacle');
    expect(risen).toHaveLength(1);
    expect(risen[0].total).toBeCloseTo(TENTACLE_TOTAL_SEC, 9);
    expect(events.some((e) => e.type === 'log' && /tentacles/.test(e.text))).toBe(true);
    expect(tentacleMobs(entry)).toHaveLength(0);
    // Stand on the warning.
    entry.sim.player.pos = { ...entry.sim.player.pos, x: risen[0].x + 1, z: risen[0].z };
    const hpBefore = entry.sim.player.hp;
    run(entry.sim, entry.boss, TENTACLES.spawnWarningSec + DT);
    expect(entry.sim.player.hp).toBeLessThan(hpBefore);
    expect(entry.sim.player.dead).toBe(false);
    const mobs = tentacleMobs(entry);
    expect(mobs).toHaveLength(1);
    expect(mobs[0].maxHp).toBe(tentacleHealth(entry.boss.maxHp, 1));
    expect(mobs[0].hp).toBe(mobs[0].maxHp);
    expect(entry.inst.mobIds).toContain(mobs[0].id);
    expect(entry.boss.summonedIds).toContain(mobs[0].id);
    expect(Math.hypot(mobs[0].pos.x - risen[0].x, mobs[0].pos.z - risen[0].z)).toBeLessThan(0.01);
  });

  it('rises only into a clean room, never into the middle of his waves', () => {
    const entry = encounter();
    const state = entry.inst.hoardBoss;
    if (!state) throw new Error('missing state');
    state.sequenceStep = 1;
    state.sequenceTimer = 999;
    rise(entry);
    expect(cuesOf(entry.inst, 'tide-tentacle')).toHaveLength(0);
    state.sequenceStep = 0;
    run(entry.sim, entry.boss, DT * 2);
    expect(cuesOf(entry.inst, 'tide-tentacle')).toHaveLength(1);
  });

  it('never rises just above his totem threshold while it is unanswered', () => {
    const entry = encounter();
    const state = entry.inst.hoardBoss;
    if (!state) throw new Error('missing state');
    state.specialTriggered = false;
    // (The totem itself is kept down here by a parked wave step.)
    state.sequenceStep = 0;
    entry.boss.hp = Math.round(entry.boss.maxHp * (HOARD_TOTEM_TRIGGER_HP + 0.05));
    rise(entry);
    expect(cuesOf(entry.inst, 'tide-tentacle')).toHaveLength(0);
    // Well above it, or once the totem has been answered, they rise as usual.
    entry.boss.hp = Math.round(
      entry.boss.maxHp * (HOARD_TOTEM_TRIGGER_HP + HOARD_TOTEM_TENTACLE_MARGIN + 0.05),
    );
    run(entry.sim, entry.boss, DT * 2);
    expect(cuesOf(entry.inst, 'tide-tentacle')).toHaveLength(1);
  });

  it('raises more for a bigger party and a rarer hoard', () => {
    const solo = encounter('common');
    rise(solo);
    expect(cuesOf(solo.inst, 'tide-tentacle')).toHaveLength(1);
    const party = encounter('legendary');
    addAllies(party, 3);
    rise(party);
    const risen = cuesOf(party.inst, 'tide-tentacle');
    expect(risen).toHaveLength(tentacleCount(4, HOARD_RARITY_PRESSURE.legendary.extra));
    // Each says which of the set it is.
    expect(risen.map((cue) => cue.halfAngle).sort()).toEqual([0, 1, 2]);
  });

  it('lashes a line at its nearest player after a telegraph, and a sidestep dodges it', () => {
    for (const dodge of [false, true]) {
      const entry = encounter();
      rise(entry);
      const trunk = cuesOf(entry.inst, 'tide-tentacle')[0];
      entry.sim.player.pos = { ...entry.sim.player.pos, x: trunk.x, z: trunk.z - 9 };
      run(entry.sim, entry.boss, TENTACLES.spawnWarningSec + TENTACLES.firstAttackSec, heal(entry));
      let whip = cuesOf(entry.inst, 'tide-whip')[0];
      for (let i = 0; i < 20 && !whip; i++) {
        run(entry.sim, entry.boss, DT, heal(entry));
        whip = cuesOf(entry.inst, 'tide-whip')[0];
      }
      expect(whip).toBeDefined();
      expect(whip.radius).toBe(TENTACLES.whipLength);
      expect(whip.halfAngle).toBe(TENTACLES.whipHalfWidth);
      // Aimed at where the player stood.
      expect(whip.facing).toBeCloseTo(Math.PI, 5);
      if (dodge) entry.sim.player.pos = { ...entry.sim.player.pos, x: trunk.x + 4 };
      const hp = entry.sim.player.hp;
      const events = run(entry.sim, entry.boss, TENTACLES.whipTelegraphSec + DT * 2);
      const hits = events.filter(
        (e) =>
          e.type === 'damage' && e.targetId === entry.sim.player.id && e.ability === 'Abyssal Lash',
      );
      expect(hits).toHaveLength(dodge ? 0 : 1);
      if (dodge) expect(entry.sim.player.hp).toBe(hp);
      else expect(entry.sim.player.hp).toBeLessThan(hp);
    }
  });

  it('then sweeps a turning arm: once per player in the ring, never at the trunk', () => {
    const entry = encounter();
    const ally = addAllies(entry, 1)[0];
    rise(entry);
    const trunk = cuesOf(entry.inst, 'tide-tentacle')[0];
    const place = () => {
      // One inside the ring, one hugging the trunk.
      entry.sim.player.pos = { ...entry.sim.player.pos, x: trunk.x + 5, z: trunk.z };
      ally.pos = { ...ally.pos, x: trunk.x, z: trunk.z + 1.2 };
      heal(entry)();
    };
    const events: SimEvent[] = [];
    let sweep: ReturnType<typeof cuesOf>[number] | undefined;
    for (let t = 0; t < 30 && !sweep; t += DT) {
      events.push(...run(entry.sim, entry.boss, DT, place));
      sweep = cuesOf(entry.inst, 'tide-sweep')[0];
    }
    expect(sweep).toBeDefined();
    if (!sweep) return;
    expect(Math.abs(sweep.radius)).toBe(TENTACLES.sweepRadius);
    events.length = 0;
    events.push(...run(entry.sim, entry.boss, SWEEP_TOTAL_SEC + DT, place));
    const swept = events.filter((e) => e.type === 'damage' && e.ability === 'Drowning Sweep');
    expect(
      swept.filter((e) => e.type === 'damage' && e.targetId === entry.sim.player.id),
    ).toHaveLength(1);
    expect(swept.filter((e) => e.type === 'damage' && e.targetId === ally.id)).toHaveLength(0);
  });

  it('never has two telegraphs down at once below the double threshold', () => {
    const entry = encounter('rare');
    addAllies(entry, 3);
    rise(entry);
    let most = 0;
    run(entry.sim, entry.boss, 16, () => {
      heal(entry)();
      const live =
        cuesOf(entry.inst, 'tide-whip').length +
        cuesOf(entry.inst, 'tide-sweep').length +
        cuesOf(entry.inst, 'tide-grab').length +
        cuesOf(entry.inst, 'tide-grab-hold').length;
      most = Math.max(most, live);
    });
    expect(most).toBe(1);
  });

  it('at full pressure two attack together: one of each, staggered, never more', () => {
    const entry = encounter('legendary');
    const allies = addAllies(entry, 3);
    rise(entry);
    const trunks = cuesOf(entry.inst, 'tide-tentacle');
    expect(trunks.length).toBeGreaterThanOrEqual(2);
    let most = 0;
    let sameKind = false;
    const starts: number[] = [];
    let clock = 0;
    const seen = new Set<number>();
    run(entry.sim, entry.boss, 18, () => {
      clock += DT;
      // Everyone stands between the first two trunks, in reach of both.
      const mx = (trunks[0].x + trunks[1].x) / 2;
      const mz = (trunks[0].z + trunks[1].z) / 2;
      const everyone = [entry.sim.player, ...allies];
      for (let i = 0; i < everyone.length; i++) {
        everyone[i].pos = { ...everyone[i].pos, x: mx + i * 0.8, z: mz };
      }
      heal(entry)();
      const whips = cuesOf(entry.inst, 'tide-whip');
      const sweeps = cuesOf(entry.inst, 'tide-sweep');
      const grabs = [...cuesOf(entry.inst, 'tide-grab'), ...cuesOf(entry.inst, 'tide-grab-hold')];
      most = Math.max(most, whips.length + sweeps.length + grabs.length);
      if (whips.length > 1 || sweeps.length > 1 || grabs.length > 1) sameKind = true;
      for (const cue of [...whips, ...sweeps, ...grabs]) {
        if (seen.has(cue.cueId)) continue;
        seen.add(cue.cueId);
        starts.push(clock);
      }
    });
    expect(most).toBe(2);
    expect(sameKind).toBe(false);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(
        TENTACLES.doubleStaggerSec - DT - 1e-6,
      );
    }
  });

  it('dies to the party: its threatened attack goes with it, its cue becomes the fall', () => {
    const entry = encounter();
    rise(entry);
    const trunk = cuesOf(entry.inst, 'tide-tentacle')[0];
    entry.sim.player.pos = { ...entry.sim.player.pos, x: trunk.x, z: trunk.z - 9 };
    let whip: ReturnType<typeof cuesOf>[number] | undefined;
    for (let t = 0; t < 10 && !whip; t += DT) {
      run(entry.sim, entry.boss, DT, heal(entry));
      whip = cuesOf(entry.inst, 'tide-whip')[0];
    }
    expect(whip).toBeDefined();
    const mob = tentacleMobs(entry)[0];
    entry.sim.player.targetId = mob.id;
    mob.hp = 0;
    mob.dead = true;
    const events = run(entry.sim, entry.boss, DT);
    expect(cuesOf(entry.inst, 'tide-whip').filter((cue) => cue.remaining > 0)).toHaveLength(0);
    // The withdrawn telegraph reaches every client as a zero-length cue.
    expect(
      events.some(
        (e) => e.type === 'hoardBossCue' && e.cueId === whip?.cueId && e.durationSecs === 0,
      ),
    ).toBe(true);
    const fall = cuesOf(entry.inst, 'tide-tentacle-fall');
    expect(fall).toHaveLength(1);
    expect(fall[0].cueId).toBe(trunk.cueId);
    expect(fall[0].halfAngle).toBe(1);
    expect(fall[0].total).toBeCloseTo(TENTACLES.retractSec, 9);
    expect(entry.sim.entities.has(mob.id)).toBe(false);
    expect(entry.inst.mobIds).not.toContain(mob.id);
    expect(entry.sim.player.targetId).toBeNull();
    // No hit from the dead tentacle's lash.
    const hp = entry.sim.player.hp;
    run(entry.sim, entry.boss, WHIP_TOTAL_SEC);
    expect(entry.sim.player.hp).toBe(hp);
    // Once the last is gone the clock starts again, pressed by rarity.
    run(entry.sim, entry.boss, TENTACLES.retractSec);
    expect(held(entry).tentacles).toHaveLength(0);
    expect(held(entry).timer).toBeGreaterThan(TENTACLES_EVERY_SEC * 0.8);
    expect(hoardBossCueViews(entry.inst).filter((c) => isTentacleVariant(c.variant))).toHaveLength(
      0,
    );
  });

  it('STANDS until it is killed: there is no waiting a tentacle out', () => {
    const entry = encounter();
    rise(entry);
    const events = run(entry.sim, entry.boss, 45, () => {
      heal(entry)();
      // Far from it: nothing to hit, nothing to grasp.
      entry.sim.player.pos = { ...entry.boss.pos, x: entry.boss.pos.x + 2 };
    });
    expect(tentacleMobs(entry)).toHaveLength(1);
    expect(held(entry).tentacles).toHaveLength(1);
    expect(
      events.some((e) => e.type === 'hoardBossCue' && e.variant === 'tide-tentacle-fall'),
    ).toBe(false);
    // Its standing cue is a heartbeat: re-sent again and again, never left to lapse.
    const beats = events.filter(
      (e) =>
        e.type === 'hoardBossCue' &&
        e.variant === 'tide-tentacle-up' &&
        e.pid === entry.sim.player.id,
    );
    expect(beats.length).toBeGreaterThan(40);
    for (const beat of beats) {
      if (beat.type !== 'hoardBossCue') continue;
      expect(beat.durationSecs).toBeCloseTo(TENTACLES.upLifeSec, 9);
      // Longer than the gap between beats, so a client never sees it blink out.
      expect(beat.durationSecs).toBeGreaterThan(TENTACLES.upHeartbeatTicks * DT * 1.5);
    }
    expect(cuesOf(entry.inst, 'tide-tentacle-up')).toHaveLength(1);
  });

  it('his waves keep coming while tentacles stand', () => {
    const entry = encounter();
    rise(entry);
    run(entry.sim, entry.boss, TENTACLE_TOTAL_SEC + 0.5, heal(entry));
    const state = entry.inst.hoardBoss;
    if (!state) throw new Error('missing state');
    state.sweepTimer = 0.1;
    run(entry.sim, entry.boss, 1, heal(entry));
    expect(cuesOf(entry.inst, 'tide-wave').length).toBeGreaterThan(0);
    expect(tentacleMobs(entry)).toHaveLength(1);
  });

  it('leaves nothing behind when the fight resets', () => {
    const entry = encounter('legendary');
    addAllies(entry, 3);
    rise(entry);
    run(entry.sim, entry.boss, TENTACLES.spawnWarningSec + 1, heal(entry));
    const mobs = tentacleMobs(entry);
    expect(mobs.length).toBeGreaterThan(1);
    entry.sim.player.targetId = mobs[0].id;
    entry.boss.aiState = 'idle';
    tickHoardBossMechanics(entry.sim.ctx);
    expect(tentacleMobs(entry)).toHaveLength(0);
    expect(entry.inst.hoardBoss).toBeUndefined();
    expect(entry.sim.player.targetId).toBeNull();
    for (const mob of mobs) {
      expect(entry.inst.mobIds).not.toContain(mob.id);
      expect(entry.boss.summonedIds).not.toContain(mob.id);
    }
  });

  it('takes real damage under the whole sim, never pins itself immune, and dies like a mob', () => {
    const entry = encounter();
    rise(entry);
    run(entry.sim, entry.boss, TENTACLES.spawnWarningSec + DT * 2, heal(entry));
    const mob = tentacleMobs(entry)[0];
    expect(mob).toBeDefined();
    // A caster's spot, toward the boss (so still inside the room): far outside
    // the melee reach of a mob that cannot move.
    const toBoss = Math.atan2(entry.boss.pos.x - mob.pos.x, entry.boss.pos.z - mob.pos.z);
    const stand = {
      ...entry.sim.player.pos,
      x: mob.pos.x + Math.sin(toBoss) * 12,
      z: mob.pos.z + Math.cos(toBoss) * 12,
    };
    entry.sim.player.targetId = mob.id;
    let last = mob.hp;
    let landed = 0;
    for (let tick = 0; tick < 300 && !mob.dead; tick++) {
      entry.boss.aiState = 'attack';
      // The boss's own blows are not under test (and would fell a bare warrior).
      entry.sim.player.damageImmune = true;
      entry.sim.player.pos = { ...stand };
      entry.sim.player.hp = entry.sim.player.maxHp;
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
      landed++;
      // Rooted: it never walks, leashes home or heals back up.
      expect(Math.hypot(mob.pos.x - mob.spawnPos.x, mob.pos.z - mob.spawnPos.z)).toBeLessThan(0.01);
    }
    expect(landed).toBe(30);
    entry.sim.ctx.dealDamage(entry.sim.player, mob, mob.maxHp * 2, false, 'physical', null, 'hit');
    expect(mob.dead).toBe(true);
    const events = entry.sim.drainEvents();
    entry.sim.tick();
    expect(entry.sim.entities.has(mob.id)).toBe(false);
    expect(entry.sim.player.targetId).toBeNull();
    // No experience and no loot: it is a mechanic, never a kill to farm.
    expect(events.some((event) => event.type === 'xp' || event.type === 'loot')).toBe(false);
    expect(cuesOf(entry.inst, 'tide-tentacle-fall')).toHaveLength(1);
  });

  describe('the grasp', () => {
    /** A risen tentacle whose next attack is its grasp, and a player in its reach. */
    function reaching(allies = 0) {
      const entry = encounter();
      const friends = allies > 0 ? addAllies(entry, allies) : [];
      rise(entry);
      const trunk = cuesOf(entry.inst, 'tide-tentacle')[0];
      const at = { x: trunk.x, z: trunk.z - 8 };
      const place = () => {
        heal(entry)();
        if (!isHeldByTentacle(entry.sim.player))
          entry.sim.player.pos = { ...entry.sim.player.pos, ...at };
        // Friends wait well out of its reach, so it is the player it wants.
        friends.forEach((friend, n) => {
          friend.pos = { ...friend.pos, x: trunk.x + 30 + n * 3, z: trunk.z };
        });
      };
      run(entry.sim, entry.boss, TENTACLES.spawnWarningSec + DT, place);
      held(entry).tentacles[0].attacks = 2;
      held(entry).tentacles[0].attackTimer = 0;
      run(entry.sim, entry.boss, DT * 2, place);
      const [grab] = cuesOf(entry.inst, 'tide-grab');
      return { entry, friends, trunk, place, grab };
    }

    it('reaches for a player with a mark that rides THEM, then holds them by the trunk', () => {
      const { entry, trunk, place, grab } = reaching();
      expect(grab).toBeDefined();
      expect(grab.targetId).toBe(entry.sim.player.id);
      expect(grab.innerRadius).toBe(0);
      expect(grab.total).toBeCloseTo(TENTACLES.grabTelegraphSec, 9);
      expect(isHeldByTentacle(entry.sim.player)).toBe(false);
      const events = run(entry.sim, entry.boss, TENTACLES.grabTelegraphSec + DT, place);
      expect(isHeldByTentacle(entry.sim.player)).toBe(true);
      const aura = entry.sim.player.auras.find((a) => a.id === HOARD_TENTACLE_GRASP_AURA_ID);
      // A root, never a stun: a held player can still strike what holds them.
      expect(aura?.kind).toBe('root');
      expect(aura?.unbreakableControl).toBe(true);
      const away = Math.hypot(entry.sim.player.pos.x - trunk.x, entry.sim.player.pos.z - trunk.z);
      expect(away).toBeCloseTo(TENTACLES.grabHoldDistance, 3);
      const [hold] = cuesOf(entry.inst, 'tide-grab-hold');
      expect(hold.cueId).toBe(grab.cueId);
      expect(hold.total).toBeCloseTo(TENTACLES.grabHoldSec, 9);
      expect(events.some((e) => e.type === 'log' && /seizes a player/.test(e.text))).toBe(true);
    });

    it('closes on nothing if they ran out of its reach', () => {
      const { entry, trunk, grab } = reaching();
      expect(grab).toBeDefined();
      run(entry.sim, entry.boss, TENTACLES.grabTelegraphSec + DT * 2, () => {
        heal(entry)();
        entry.sim.player.pos = { ...entry.sim.player.pos, x: trunk.x, z: trunk.z - 20 };
      });
      expect(isHeldByTentacle(entry.sim.player)).toBe(false);
      expect(cuesOf(entry.inst, 'tide-grab-hold')).toHaveLength(0);
      expect(held(entry).tentacles[0].grasp).toBeNull();
    });

    it('squeezes but never kills, and hurting it enough breaks its grip', () => {
      const { entry } = reaching();
      run(entry.sim, entry.boss, TENTACLES.grabTelegraphSec + DT);
      expect(isHeldByTentacle(entry.sim.player)).toBe(true);
      const hp = entry.sim.player.hp;
      const events = run(entry.sim, entry.boss, TENTACLES.grabEverySec * 2 + DT);
      const squeezes = events.filter(
        (e) =>
          e.type === 'damage' &&
          e.ability === 'Crushing Coil' &&
          e.targetId === entry.sim.player.id,
      );
      expect(squeezes).toHaveLength(2);
      expect(entry.sim.player.hp).toBeLessThan(hp);
      entry.sim.player.hp = 2;
      run(entry.sim, entry.boss, TENTACLES.grabEverySec * 2);
      expect(entry.sim.player.dead).toBe(false);
      // Alone, the held player breaks it themselves.
      const [mob] = tentacleMobs(entry);
      mob.hp -= Math.ceil(mob.maxHp * TENTACLES.grabBreakFraction);
      const freed = run(entry.sim, entry.boss, DT);
      expect(isHeldByTentacle(entry.sim.player)).toBe(false);
      expect(
        freed.some(
          (e) =>
            e.type === 'hoardBossCue' && e.variant === 'tide-grab-hold' && e.durationSecs === 0,
        ),
      ).toBe(true);
      expect(mob.dead).toBe(false);
    });

    it('tires of them in the end: a last squeeze, and it throws them clear', () => {
      const { entry, trunk } = reaching();
      run(entry.sim, entry.boss, TENTACLES.grabTelegraphSec + DT);
      run(entry.sim, entry.boss, TENTACLES.grabHoldSec + DT, heal(entry));
      expect(isHeldByTentacle(entry.sim.player)).toBe(false);
      expect(entry.sim.player.dead).toBe(false);
      expect(held(entry).tentacles[0].grasp).toBeNull();
      // (applyKnockback moves them over the following ticks.)
      run(entry.sim, entry.boss, 0.5, heal(entry));
      expect(
        Math.hypot(entry.sim.player.pos.x - trunk.x, entry.sim.player.pos.z - trunk.z),
      ).toBeGreaterThanOrEqual(TENTACLES.grabHoldDistance - 1e-6);
    });

    it('killing the tentacle lets them go at once', () => {
      const { entry } = reaching(1);
      run(entry.sim, entry.boss, TENTACLES.grabTelegraphSec + DT);
      expect(isHeldByTentacle(entry.sim.player)).toBe(true);
      const [mob] = tentacleMobs(entry);
      mob.hp = 0;
      mob.dead = true;
      run(entry.sim, entry.boss, DT);
      expect(isHeldByTentacle(entry.sim.player)).toBe(false);
      // (A withdrawn cue lingers at zero for the rest of the tick it was withdrawn.)
      expect(cuesOf(entry.inst, 'tide-grab-hold').filter((c) => c.remaining > 0)).toHaveLength(0);
    });

    it('lifts them clear: his waves and the other tentacles pass them by', () => {
      const { entry } = reaching();
      run(entry.sim, entry.boss, TENTACLES.grabTelegraphSec + DT);
      expect(isHeldByTentacle(entry.sim.player)).toBe(true);
      const state = entry.inst.hoardBoss;
      if (!state) throw new Error('missing state');
      state.sweepTimer = 0;
      const events = run(entry.sim, entry.boss, 5.5);
      expect(
        cuesOf(entry.inst, 'tide-wave').length +
          events.filter((e) => e.type === 'hoardBossCue' && e.variant === 'tide-wave').length,
      ).toBeGreaterThan(0);
      expect(
        events.some(
          (e) =>
            e.type === 'damage' &&
            e.ability === 'Crashing Tide' &&
            e.targetId === entry.sim.player.id,
        ),
      ).toBe(false);
    });

    it('never leaves anyone held when the fight resets', () => {
      const { entry } = reaching(1);
      run(entry.sim, entry.boss, TENTACLES.grabTelegraphSec + DT);
      expect(isHeldByTentacle(entry.sim.player)).toBe(true);
      entry.boss.aiState = 'idle';
      tickHoardBossMechanics(entry.sim.ctx);
      expect(entry.inst.hoardBoss).toBeUndefined();
      expect(isHeldByTentacle(entry.sim.player)).toBe(false);
    });
  });

  it('is the same fight for the same seed', () => {
    const trace = () => {
      const entry = encounter('epic');
      addAllies(entry, 2);
      rise(entry);
      const events = run(entry.sim, entry.boss, 12, heal(entry));
      return events
        .filter((e) => e.type === 'hoardBossCue' && e.pid === entry.sim.player.id)
        .map((e) =>
          e.type === 'hoardBossCue'
            ? `${e.variant}:${e.x.toFixed(3)}:${e.z.toFixed(3)}:${e.facing}`
            : '',
        );
    };
    expect(trace()).toEqual(trace());
  });
});
