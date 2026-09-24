// Hoarfrost's Ice Age (src/sim/rift/hoard_ice_age.ts + its shared core). One
// describe per concern, one test per acceptance criterion of the owner's brief.
import { describe, expect, it } from 'vitest';
import { hoardBossCueViews, tickHoardBossMechanics } from '../src/sim/rift/hoard_boss';
import { HOARD_CAST_ICE_AGE } from '../src/sim/rift/hoard_control_cast_ids';
import { holdHoardIceAge, ICE_AGE_EVERY_SEC } from '../src/sim/rift/hoard_ice_age';
import {
  ICE_AGE,
  iceAgePhase,
  iceAgeSheltered,
  iceAgeTimeline,
  iceAgeTotalSec,
  iceCoverHalfWidth,
  icePillarCount,
  icePillarCovers,
  icePillarOffsets,
  isIceAgeVariant,
} from '../src/sim/rift/hoard_ice_age_core';
import { HOARD_RARITY_PRESSURE } from '../src/sim/rift/hoard_scaling';
import type { RiftInstance } from '../src/sim/rift/types';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';

type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

function encounter(rarity: Rarity = 'rare', seed = 5150) {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
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
  boss.templateId = 'rift_boss_frost';
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  sim.player.pos = { ...boss.pos, z: boss.pos.z + 3 };
  sim.player.hp = sim.player.maxHp;
  tickHoardBossMechanics(sim.ctx);
  sim.drainEvents();
  quietKit(inst);
  return { sim, inst, boss };
}

/** The frost kit's own gusts and ice are not under test: park their clocks. */
function quietKit(inst: RiftInstance): void {
  if (!inst.hoardBoss) throw new Error('missing state');
  inst.hoardBoss.sweepTimer = 999;
  inst.hoardBoss.markTimer = 999;
  inst.hoardBoss.specialTriggered = true;
  inst.hoardBoss.cues.length = 0;
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

function cast(entry: ReturnType<typeof encounter>) {
  const ice = entry.inst.hoardBoss?.iceAge;
  if (!ice) throw new Error('missing ice age state');
  ice.timer = 0;
  const events = run(entry.sim, entry.boss, DT);
  const views = hoardBossCueViews(entry.inst);
  const carrier = views.find((cue) => cue.variant === 'frost-iceage');
  if (!carrier) throw new Error('no ice age cast');
  return { carrier, pillars: views.filter((cue) => cue.variant === 'frost-pillar'), events };
}

/** `behind` yards into a pillar's lee, `across` yards off its centre line. */
function leeOf(
  carrier: { x: number; z: number },
  pillar: { x: number; z: number },
  behind: number,
  across = 0,
) {
  const d = Math.hypot(pillar.x - carrier.x, pillar.z - carrier.z);
  const ux = (pillar.x - carrier.x) / d;
  const uz = (pillar.z - carrier.z) / d;
  return {
    x: pillar.x + ux * behind + uz * across,
    z: pillar.z + uz * behind - ux * across,
  };
}

describe('the Ice Age clock and numbers (pure, shared with the renderer)', () => {
  it('runs shadows, impact, cast, storm, break-up in that order, inside one life', () => {
    const total = iceAgeTotalSec(1);
    const line = iceAgeTimeline(total);
    expect(line.impactAt).toBe(ICE_AGE.pillarWarningSec);
    expect(line.castAt).toBeGreaterThan(line.impactAt);
    expect(line.castSec).toBeCloseTo(ICE_AGE.castSec, 9);
    expect(line.blastAt).toBeCloseTo(line.castAt + ICE_AGE.castSec, 9);
    // The pillars break AFTER the storm lands, and their whole break-up fits.
    expect(line.breakAt).toBeGreaterThan(line.blastAt);
    expect(line.breakAt + ICE_AGE.pillarShatterSec).toBeLessThanOrEqual(line.endAt + 1e-9);
    expect(line.blastAt + ICE_AGE.blizzardSec).toBeLessThanOrEqual(line.endAt + 1e-9);
    expect(iceAgePhase(0, total)).toBe('warning');
    expect(iceAgePhase(line.impactAt, total)).toBe('standing');
    expect(iceAgePhase(line.castAt, total)).toBe('casting');
    expect(iceAgePhase(line.blastAt, total)).toBe('storm');
    // The brief's windows: a 1.0 to 1.5 s warning, a 3.5 to 5 s cast.
    expect(ICE_AGE.pillarWarningSec).toBeGreaterThanOrEqual(1);
    expect(ICE_AGE.pillarWarningSec).toBeLessThanOrEqual(1.5);
    expect(ICE_AGE.castSec).toBeGreaterThanOrEqual(3.5);
    expect(ICE_AGE.castSec).toBeLessThanOrEqual(5);
  });

  it('a rarer hoard casts faster, never under the floor, and only the cast moves', () => {
    const rare = iceAgeTimeline(iceAgeTotalSec(HOARD_RARITY_PRESSURE.rare.speed));
    const legendary = iceAgeTimeline(iceAgeTotalSec(HOARD_RARITY_PRESSURE.legendary.speed));
    expect(legendary.castSec).toBeLessThan(rare.castSec);
    expect(legendary.castSec).toBeGreaterThanOrEqual(ICE_AGE.minCastSec);
    expect(legendary.impactAt).toBe(rare.impactAt);
    expect(legendary.castAt).toBe(rare.castAt);
    expect(iceAgeTimeline(iceAgeTotalSec(99)).castSec).toBeCloseTo(ICE_AGE.minCastSec, 9);
  });

  it('pillars scale slowly with the group: cover is shared, never one each', () => {
    expect(icePillarCount(1)).toBe(2);
    expect(icePillarCount(4)).toBe(2);
    expect(icePillarCount(5)).toBe(3);
    expect(icePillarCount(8)).toBe(3);
    expect(icePillarCount(40)).toBe(ICE_AGE.maxPillars);
    for (let heads = 3; heads <= 40; heads++) {
      expect(icePillarCount(heads)).toBeLessThan(heads);
    }
    // A rarer hoard offers one fewer, down to a single pillar for a lone player.
    expect(icePillarCount(1, 1)).toBe(1);
    expect(icePillarCount(5, 1)).toBe(2);
    expect(icePillarCount(1, -1)).toBe(2);
  });

  it('lands pillars inside the room, off the boss, apart, and the same every time', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const count of [1, 2, 3]) {
        const spots = icePillarOffsets(count, seed, 30, 40);
        expect(spots).toHaveLength(count);
        for (const spot of spots) {
          expect(Math.abs(spot.x)).toBeLessThanOrEqual(30 - ICE_AGE.wallMargin + 1e-9);
          expect(spot.f).toBeGreaterThanOrEqual(ICE_AGE.pillarMinBossDistance - 1e-9);
          expect(spot.f).toBeLessThanOrEqual(ICE_AGE.pillarMaxBossDistance + 1e-9);
        }
        for (let i = 0; i < spots.length; i++) {
          for (let j = i + 1; j < spots.length; j++) {
            expect(
              Math.hypot(spots[i].x - spots[j].x, spots[i].f - spots[j].f),
            ).toBeGreaterThanOrEqual(ICE_AGE.pillarMinSeparation - 1e-6);
          }
        }
      }
    }
    expect(icePillarOffsets(2, 7, 30, 40)).toEqual(icePillarOffsets(2, 7, 30, 40));
    expect(icePillarOffsets(2, 8, 30, 40)).not.toEqual(icePillarOffsets(2, 7, 30, 40));
    // A cramped room: still inside it, never past the depth it was measured clear to.
    for (const spot of icePillarOffsets(3, 3, 9, 14)) {
      expect(Math.abs(spot.x)).toBeLessThanOrEqual(9 - ICE_AGE.wallMargin + 1e-9);
      expect(spot.f).toBeLessThanOrEqual(ICE_AGE.pillarMinBossDistance + 1e-9);
    }
  });
});

describe('cover: behind the pillar relative to the boss, never merely near it', () => {
  const boss = { x: 0, z: 0 };
  const pillar = { x: 0, z: 15 };

  it('shelters a player with the pillar between them and the boss', () => {
    expect(icePillarCovers(boss.x, boss.z, pillar.x, pillar.z, 0, 18)).toBe(true);
    expect(icePillarCovers(boss.x, boss.z, pillar.x, pillar.z, 0, 15 + ICE_AGE.coverDistance)).toBe(
      true,
    );
  });

  it('does NOT shelter one in front of it, beside it, or far behind it', () => {
    // BOSS, PLAYER, PILLAR: on the storm's side.
    expect(icePillarCovers(boss.x, boss.z, pillar.x, pillar.z, 0, 12)).toBe(false);
    // Hugging its flank, closer to it than a sheltered player need be.
    expect(icePillarCovers(boss.x, boss.z, pillar.x, pillar.z, 3.4, 15)).toBe(false);
    expect(icePillarCovers(boss.x, boss.z, pillar.x, pillar.z, -3.6, 16)).toBe(false);
    // Behind it, but past the lee's reach.
    expect(
      icePillarCovers(
        boss.x,
        boss.z,
        pillar.x,
        pillar.z,
        0,
        15 + ICE_AGE.coverDistance + ICE_AGE.pillarRadius + 0.5,
      ),
    ).toBe(false);
    // Distance alone never counts: 2 yd from the pillar on the storm's side.
    expect(icePillarCovers(boss.x, boss.z, pillar.x, pillar.z, 0, 13)).toBe(false);
  });

  it('lets several players share one lee, which widens like a shadow and is capped', () => {
    const half = iceCoverHalfWidth(19, 15);
    expect(half).toBeGreaterThanOrEqual(ICE_AGE.pillarRadius * ICE_AGE.coverWidthMultiplier);
    for (const x of [-2.5, -1.2, 0, 1.2, 2.5]) {
      expect(icePillarCovers(boss.x, boss.z, pillar.x, pillar.z, x, 19)).toBe(true);
    }
    expect(icePillarCovers(boss.x, boss.z, pillar.x, pillar.z, half + 0.2, 19)).toBe(false);
    expect(iceCoverHalfWidth(1000, 15)).toBeCloseTo(
      ICE_AGE.pillarRadius * ICE_AGE.coverWidthMultiplier * ICE_AGE.coverMaxSpread,
      9,
    );
  });

  it('follows the bearing, not an axis, and any one pillar is enough', () => {
    const slanted = { x: 12, z: -9 };
    const lee = leeOf(boss, slanted, 4);
    expect(icePillarCovers(0, 0, slanted.x, slanted.z, lee.x, lee.z)).toBe(true);
    const flank = leeOf(boss, slanted, 0.5, 4.5);
    expect(icePillarCovers(0, 0, slanted.x, slanted.z, flank.x, flank.z)).toBe(false);
    expect(iceAgeSheltered(0, 0, [pillar, slanted], lee.x, lee.z)).toBe(true);
    expect(iceAgeSheltered(0, 0, [pillar, slanted], 20, 20)).toBe(false);
    expect(iceAgeSheltered(0, 0, [], 0, 18)).toBe(false);
    // A pillar on the boss himself shelters nobody (no bearing to stand behind).
    expect(icePillarCovers(0, 0, 0, 0, 0, 3)).toBe(false);
  });
});

describe('the cast, authoritative', () => {
  it('drops a carrier and its pillars with one shared life, only into a clean room', () => {
    const entry = encounter();
    const state = entry.inst.hoardBoss;
    if (!state?.iceAge) throw new Error('missing state');
    // Something else is on the floor: it waits.
    state.cues.push({
      id: 900,
      kind: 'mark',
      variant: 'frost-ice',
      phase: 'hazard',
      x: entry.boss.pos.x,
      z: entry.boss.pos.z - 20,
      radius: 3,
      remaining: 0.2,
      total: 5,
    });
    state.iceAge.timer = 0;
    run(entry.sim, entry.boss, DT);
    expect(hoardBossCueViews(entry.inst).some((cue) => isIceAgeVariant(cue.variant))).toBe(false);
    run(entry.sim, entry.boss, 0.3);
    const views = hoardBossCueViews(entry.inst);
    const carrier = views.find((cue) => cue.variant === 'frost-iceage');
    const pillars = views.filter((cue) => cue.variant === 'frost-pillar');
    expect(carrier).toBeDefined();
    expect(pillars).toHaveLength(icePillarCount(1, HOARD_RARITY_PRESSURE.rare.extra));
    for (const pillar of pillars) {
      expect(pillar.total).toBe(carrier?.total);
      expect(pillar.radius).toBe(ICE_AGE.pillarRadius);
      const fromBoss = Math.hypot(pillar.x - entry.boss.pos.x, pillar.z - entry.boss.pos.z);
      expect(fromBoss).toBeGreaterThanOrEqual(ICE_AGE.pillarMinBossDistance - 1e-6);
    }
    expect(carrier?.total).toBeCloseTo(iceAgeTotalSec(1), 9);
    // The next is a full interval away, and a live cast is never doubled.
    expect(state.iceAge.timer).toBeGreaterThan(ICE_AGE_EVERY_SEC - 0.5);
    expect(state.iceAge.timer).toBeLessThanOrEqual(ICE_AGE_EVERY_SEC);
    state.iceAge.timer = 0;
    run(entry.sim, entry.boss, DT);
    expect(
      hoardBossCueViews(entry.inst).filter((cue) => cue.variant === 'frost-iceage'),
    ).toHaveLength(1);
  });

  it('a legendary hoard gives a lone player a single pillar and a shorter cast', () => {
    const entry = encounter('legendary');
    const { carrier, pillars } = cast(entry);
    expect(pillars).toHaveLength(1);
    expect(carrier.total).toBeCloseTo(iceAgeTotalSec(HOARD_RARITY_PRESSURE.legendary.speed), 9);
    expect(carrier.total).toBeLessThan(iceAgeTotalSec(1));
  });

  it('the icicle crushes whoever stands on its shadow, survivably, and nobody else', () => {
    const entry = encounter();
    const { carrier, pillars } = cast(entry);
    const line = iceAgeTimeline(carrier.total);
    entry.sim.player.pos = { ...entry.sim.player.pos, x: pillars[0].x + 1, z: pillars[0].z };
    const before = entry.sim.player.hp;
    run(entry.sim, entry.boss, line.impactAt - DT * 2);
    expect(entry.sim.player.hp).toBe(before);
    run(entry.sim, entry.boss, DT * 3);
    expect(entry.sim.player.hp).toBeLessThan(before);
    expect(entry.sim.player.dead).toBe(false);
    // Thrown clear of where the pillar now stands.
    expect(
      Math.hypot(entry.sim.player.pos.x - pillars[0].x, entry.sim.player.pos.z - pillars[0].z),
    ).toBeGreaterThan(1);

    const clear = encounter();
    const second = cast(clear);
    clear.sim.player.pos = {
      ...clear.boss.pos,
      ...leeOf(second.carrier, second.pillars[0], ICE_AGE.impactRadius + 2),
    };
    const full = clear.sim.player.hp;
    run(clear.sim, clear.boss, line.impactAt + DT * 2);
    expect(clear.sim.player.hp).toBe(full);
  });

  it('shows a real Ice Age cast bar, pins the boss, and clears both at the blast', () => {
    const entry = encounter();
    const { carrier, pillars } = cast(entry);
    const line = iceAgeTimeline(carrier.total);
    entry.sim.player.pos = { ...entry.boss.pos, ...leeOf(carrier, pillars[0], 4) };
    run(entry.sim, entry.boss, line.castAt - DT * 2);
    expect(entry.boss.castingAbility).not.toBe(HOARD_CAST_ICE_AGE);
    run(entry.sim, entry.boss, DT * 3);
    expect(entry.boss.castingAbility).toBe(HOARD_CAST_ICE_AGE);
    expect(entry.boss.castTotal).toBeCloseTo(line.castSec, 9);
    expect(entry.boss.castRemaining).toBeGreaterThan(line.castSec - 0.2);
    // Dragged off his spot, he is put back: the storm blows from where he cast.
    entry.boss.pos.x += 6;
    expect(holdHoardIceAge(entry.sim.ctx, entry.boss)).toBe(true);
    expect(entry.boss.pos.x).toBeCloseTo(carrier.x, 9);
    run(entry.sim, entry.boss, line.castSec / 2);
    expect(entry.boss.castRemaining).toBeLessThan(line.castSec / 2 + 0.2);
    run(entry.sim, entry.boss, line.castSec / 2 + DT * 2);
    expect(entry.boss.castingAbility).toBeNull();
    expect(entry.boss.castRemaining).toBe(0);
    expect(holdHoardIceAge(entry.sim.ctx, entry.boss)).toBe(true); // still the storm
    run(entry.sim, entry.boss, carrier.total);
    expect(holdHoardIceAge(entry.sim.ctx, entry.boss)).toBe(false);
  });
});

describe('the storm: sheltered players live, exposed players die', () => {
  it('kills a player caught in the open', () => {
    const entry = encounter();
    const { carrier, pillars } = cast(entry);
    const line = iceAgeTimeline(carrier.total);
    // Right beside a pillar, but on its flank: near is not behind.
    entry.sim.player.pos = { ...entry.boss.pos, ...leeOf(carrier, pillars[0], 0.5, 4.6) };
    run(entry.sim, entry.boss, line.impactAt + 0.2);
    entry.sim.player.hp = entry.sim.player.maxHp;
    entry.sim.player.pos = { ...entry.boss.pos, ...leeOf(carrier, pillars[0], 0.5, 4.6) };
    run(entry.sim, entry.boss, line.blastAt - line.impactAt - 0.2 - DT * 2);
    expect(entry.sim.player.dead).toBe(false);
    run(entry.sim, entry.boss, DT * 4);
    expect(entry.sim.player.dead).toBe(true);
  });

  it('spares a player behind a pillar, judged while the pillar still stands', () => {
    const entry = encounter();
    const { carrier, pillars } = cast(entry);
    const line = iceAgeTimeline(carrier.total);
    // Deep enough in the lee to be clear of the icicle's own landing.
    const safe = { ...entry.boss.pos, ...leeOf(carrier, pillars[0], ICE_AGE.impactRadius + 1, 1) };
    entry.sim.player.pos = { ...safe };
    run(entry.sim, entry.boss, line.blastAt + DT * 2, () => {
      entry.sim.player.pos = { ...safe };
    });
    expect(entry.sim.player.dead).toBe(false);
    expect(entry.sim.player.hp).toBe(entry.sim.player.maxHp);
    // The cover outlives the judgement: every pillar is still a live cue here,
    // and past the break-up's delay too, until the shared life runs out.
    const standing = hoardBossCueViews(entry.inst).filter((cue) => cue.variant === 'frost-pillar');
    expect(standing).toHaveLength(pillars.length);
    for (const pillar of standing)
      expect(pillar.remaining).toBeGreaterThan(line.endAt - line.breakAt - 0.2);
    // Once only: nothing further happens to the survivor while the storm plays out.
    run(entry.sim, entry.boss, carrier.total - line.blastAt + DT * 2, () => {
      entry.sim.player.pos = { ...entry.boss.pos, x: entry.boss.pos.x + 9 };
    });
    expect(entry.sim.player.dead).toBe(false);
    expect(hoardBossCueViews(entry.inst).some((cue) => isIceAgeVariant(cue.variant))).toBe(false);
  });

  it('judges each player alone, skips the dead, and never casts at an empty room', () => {
    const entry = encounter();
    // A second, living player in the same hoard, and a third who is already dead.
    const clone = (id: number, dead: boolean): Entity => {
      const copy = { ...entry.sim.player, id, pos: { ...entry.sim.player.pos }, auras: [], dead };
      entry.sim.entities.set(id, copy);
      entry.inst.memberIds.add(id);
      return copy;
    };
    entry.inst.memberIds.add(entry.sim.player.id);
    const exposed = clone(7001, false);
    const corpse = clone(7002, true);
    corpse.hp = 0;
    const { carrier, pillars } = cast(entry);
    const line = iceAgeTimeline(carrier.total);
    const safe = { ...entry.boss.pos, ...leeOf(carrier, pillars[0], ICE_AGE.impactRadius + 1) };
    const open = { ...entry.boss.pos, ...leeOf(carrier, pillars[0], 1, 7) };
    const events = run(entry.sim, entry.boss, line.blastAt + DT * 2, () => {
      entry.sim.player.pos = { ...safe };
      exposed.pos = { ...open };
      corpse.pos = { ...open };
    });
    expect(entry.sim.player.dead).toBe(false);
    expect(exposed.dead).toBe(true);
    // The corpse is neither hit again nor given a death burst of its own.
    const hits = events.filter((event) => event.type === 'damage' && event.ability === 'Ice Age');
    expect(hits.map((event) => (event.type === 'damage' ? event.targetId : -1))).toEqual([7001]);

    const empty = encounter();
    empty.sim.player.dead = true;
    const ice = empty.inst.hoardBoss?.iceAge;
    if (!ice) throw new Error('missing state');
    ice.timer = 0;
    run(empty.sim, empty.boss, DT * 3);
    expect(hoardBossCueViews(empty.inst).some((cue) => isIceAgeVariant(cue.variant))).toBe(false);
  });

  it('holds the frost kit back for the whole sequence, clocks untouched', () => {
    const entry = encounter();
    const state = entry.inst.hoardBoss;
    if (!state?.iceAge) throw new Error('missing state');
    // The kit's own clocks are LIVE and due: a gust and a mark would both fire now.
    state.sweepTimer = 0.05;
    state.markTimer = 0.05;
    state.specialTriggered = false;
    entry.boss.hp = Math.floor(entry.boss.maxHp * 0.2); // past the frost ring's threshold
    state.iceAge.timer = 0;
    const { carrier } = cast(entry);
    const line = iceAgeTimeline(carrier.total);
    entry.sim.player.pos = { ...entry.boss.pos, z: entry.boss.pos.z + 60 };
    const sweep = state.sweepTimer;
    const mark = state.markTimer;
    run(entry.sim, entry.boss, line.endAt - DT * 4, () => {
      entry.sim.player.hp = entry.sim.player.maxHp;
      entry.sim.player.dead = false;
    });
    const variants = new Set(hoardBossCueViews(entry.inst).map((cue) => cue.variant));
    expect([...variants].sort()).toEqual(['frost-iceage', 'frost-pillar']);
    expect(state.sweepTimer).toBe(sweep);
    expect(state.markTimer).toBe(mark);
    expect(state.specialTriggered).toBe(false);
    // Once the carrier is gone the kit runs again.
    run(entry.sim, entry.boss, 1, () => {
      entry.sim.player.hp = entry.sim.player.maxHp;
      entry.sim.player.dead = false;
    });
    expect(hoardBossCueViews(entry.inst).some((cue) => !isIceAgeVariant(cue.variant))).toBe(true);
  });

  it('leaves nothing behind when the fight resets mid-cast', () => {
    const entry = encounter();
    const { carrier, pillars } = cast(entry);
    const line = iceAgeTimeline(carrier.total);
    entry.sim.player.pos = { ...entry.boss.pos, ...leeOf(carrier, pillars[0], 4) };
    run(entry.sim, entry.boss, line.castAt + 1);
    expect(entry.boss.castingAbility).toBe(HOARD_CAST_ICE_AGE);
    // The boss drops combat: the engine clears the whole encounter.
    entry.boss.aiState = 'idle';
    tickHoardBossMechanics(entry.sim.ctx);
    const events = entry.sim.drainEvents();
    expect(events.some((event) => event.type === 'hoardBossCueClear')).toBe(true);
    expect(entry.inst.hoardBoss).toBeUndefined();
    expect(entry.boss.castingAbility).toBeNull();
    expect(hoardBossCueViews(entry.inst)).toHaveLength(0);
    expect(holdHoardIceAge(entry.sim.ctx, entry.boss)).toBe(false);
    // No storm arrives afterwards for a player standing in the open.
    entry.sim.player.pos = { ...entry.boss.pos, x: entry.boss.pos.x + 8 };
    const hp = entry.sim.player.hp;
    for (let t = 0; t < carrier.total; t += DT) tickHoardBossMechanics(entry.sim.ctx);
    expect(entry.sim.player.hp).toBe(hp);
    expect(entry.sim.player.dead).toBe(false);
  });
});
