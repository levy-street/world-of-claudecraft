// Emberforge's Forge Hammer (src/sim/rift/hoard_forge_hammer.ts + its shared core).
import { describe, expect, it } from 'vitest';
import { hoardBossCueViews, tickHoardBossMechanics } from '../src/sim/rift/hoard_boss';
import { FORGE_HAMMER_EVERY_SEC } from '../src/sim/rift/hoard_forge_hammer';
import {
  FORGE_HAMMER,
  FORGE_RING_LIFE_SEC,
  FORGE_STRIKE_TOTAL_SEC,
  forgeBearingInGap,
  forgeBeatSec,
  forgeCastTotalSec,
  forgeGapAngle,
  forgeRingBurns,
  forgeRingRadius,
  forgeStrikeCount,
  forgeStrikeScatter,
  isForgeHammerVariant,
} from '../src/sim/rift/hoard_forge_hammer_core';
import { HOARD_RARITY_PRESSURE } from '../src/sim/rift/hoard_scaling';
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
  boss.templateId = 'rift_boss_ember';
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  sim.player.pos = { ...boss.pos, z: boss.pos.z - 20 };
  sim.player.hp = sim.player.maxHp;
  tickHoardBossMechanics(sim.ctx);
  sim.drainEvents();
  quietKit(inst);
  return { sim, inst, boss };
}

/** His frontal and his fire are not under test: park their clocks. */
function quietKit(inst: RiftInstance): void {
  if (!inst.hoardBoss) throw new Error('missing state');
  inst.hoardBoss.sweepTimer = 999;
  inst.hoardBoss.markTimer = 999;
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

function cast(entry: ReturnType<typeof encounter>): SimEvent[] {
  const hammer = entry.inst.hoardBoss?.forgeHammer;
  if (!hammer) throw new Error('missing hammer state');
  hammer.timer = 0;
  return run(entry.sim, entry.boss, DT * 2);
}

const strikes = (inst: RiftInstance) =>
  hoardBossCueViews(inst).filter((cue) => cue.variant === 'ember-hammer-strike');

describe('the forge hammer numbers (pure, shared with the renderer)', () => {
  it('beats more often the rarer the hoard, within bounds', () => {
    expect(forgeStrikeCount(HOARD_RARITY_PRESSURE.common.extra)).toBe(2);
    expect(forgeStrikeCount(HOARD_RARITY_PRESSURE.rare.extra)).toBe(3);
    expect(forgeStrikeCount(HOARD_RARITY_PRESSURE.legendary.extra)).toBe(4);
    expect(forgeStrikeCount(99)).toBe(FORGE_HAMMER.maxStrikes);
    expect(forgeStrikeCount(-99)).toBe(FORGE_HAMMER.minStrikes);
    expect(forgeCastTotalSec(3)).toBeCloseTo(2 * FORGE_HAMMER.beatSec + FORGE_STRIKE_TOTAL_SEC, 9);
    // Two hammers, three strikes each: six shadows half a beat apart.
    expect(forgeCastTotalSec(3, 2)).toBeCloseTo(
      5 * (FORGE_HAMMER.beatSec / 2) + FORGE_STRIKE_TOTAL_SEC,
      9,
    );
    // The brief's two doors, and a ring a walking player can stay ahead of.
    expect(FORGE_HAMMER.gaps).toBe(2);
    expect(FORGE_HAMMER.ringSpeed).toBeLessThan(RUN_SPEED);
    // The brief's readable windows: a real warning, a hammer seen falling.
    expect(FORGE_HAMMER.warningSec).toBeGreaterThanOrEqual(1);
    expect(FORGE_HAMMER.fallSec).toBeLessThan(FORGE_HAMMER.warningSec);
    expect(FORGE_STRIKE_TOTAL_SEC).toBeCloseTo(FORGE_HAMMER.warningSec + FORGE_RING_LIFE_SEC, 9);
  });

  it('lands near its target, never dead centre every time, the same for the same id', () => {
    const seen = new Set<string>();
    for (let id = 1; id <= 40; id++) {
      const off = forgeStrikeScatter(id);
      expect(Math.hypot(off.x, off.z)).toBeLessThanOrEqual(FORGE_HAMMER.scatter + 1e-9);
      // Always inside the blow: standing still under the shadow is always a hit.
      expect(Math.hypot(off.x, off.z)).toBeLessThan(FORGE_HAMMER.impactRadius);
      seen.add(`${off.x.toFixed(3)}:${off.z.toFixed(3)}`);
      expect(forgeStrikeScatter(id)).toEqual(off);
    }
    expect(seen.size).toBeGreaterThan(30);
  });

  it('throws a ring that spreads at one pace, stops, and burns only its band', () => {
    expect(forgeRingRadius(-1)).toBe(0);
    expect(forgeRingRadius(1)).toBeCloseTo(FORGE_HAMMER.ringSpeed, 9);
    expect(forgeRingRadius(99)).toBe(FORGE_HAMMER.ringMaxRadius);
    const id = 7;
    // A bearing well inside the burning arc (not a gap).
    let bearing = 0;
    while (forgeBearingInGap(id, bearing)) bearing += 0.1;
    const at = (r: number) => [Math.sin(bearing) * r, Math.cos(bearing) * r] as const;
    const [x, z] = at(12);
    expect(forgeRingBurns(id, 0, 0, 11.6, 12.0, x, z)).toBe(true);
    // Not yet there, and already past.
    expect(forgeRingBurns(id, 0, 0, 9.0, 9.4, x, z)).toBe(false);
    expect(forgeRingBurns(id, 0, 0, 13.5, 13.9, x, z)).toBe(false);
    // Swept between ticks: a thin band cannot step over a player.
    expect(forgeRingBurns(id, 0, 0, 11.0, 13.0, x, z)).toBe(true);
    // Under the hammer the ring is still forming: the blow already judged that ground.
    const [nx, nz] = at(FORGE_HAMMER.ringSafeRadius - 0.2);
    expect(forgeRingBurns(id, 0, 0, 4.6, 5.1, nx, nz)).toBe(false);
    // Spent once it reaches its full spread.
    const [fx, fz] = at(FORGE_HAMMER.ringMaxRadius);
    expect(
      forgeRingBurns(id, 0, 0, FORGE_HAMMER.ringMaxRadius, FORGE_HAMMER.ringMaxRadius, fx, fz),
    ).toBe(false);
  });

  it('leaves gaps that are spread round the ring and wide enough to walk through', () => {
    for (let id = 1; id <= 30; id++) {
      const gaps = Array.from({ length: FORGE_HAMMER.gaps }, (_, i) => forgeGapAngle(id, i));
      for (let i = 0; i < gaps.length; i++) {
        expect(forgeBearingInGap(id, gaps[i])).toBe(true);
        expect(forgeBearingInGap(id, gaps[i] + FORGE_HAMMER.gapHalfAngle - 0.01)).toBe(true);
        for (let j = i + 1; j < gaps.length; j++) {
          let apart = Math.abs(gaps[i] - gaps[j]) % (Math.PI * 2);
          if (apart > Math.PI) apart = Math.PI * 2 - apart;
          expect(apart).toBeGreaterThan(FORGE_HAMMER.gapHalfAngle * 2 + 0.4);
        }
      }
      // A gap is a walkable door even close in: at the ring's first burning radius.
      expect(FORGE_HAMMER.gapHalfAngle * 2 * FORGE_HAMMER.ringSafeRadius).toBeGreaterThan(4);
    }
  });

  it('can always be survived on foot: from anywhere on its path a gap is reachable in time', () => {
    for (let id = 1; id <= 25; id++) {
      for (let radius = FORGE_HAMMER.ringSafeRadius + 0.5; radius <= 26; radius += 2.5) {
        for (let bearing = 0; bearing < Math.PI * 2; bearing += 0.2) {
          // How far round the circle to the nearest gap's edge, walking along the arc.
          let nearest = Number.POSITIVE_INFINITY;
          for (let gap = 0; gap < FORGE_HAMMER.gaps; gap++) {
            let off = Math.abs(bearing - forgeGapAngle(id, gap)) % (Math.PI * 2);
            if (off > Math.PI) off = Math.PI * 2 - off;
            nearest = Math.min(nearest, Math.max(0, off - FORGE_HAMMER.gapHalfAngle + 0.08));
          }
          const walk = nearest * radius;
          // The ring reaches this radius this long after the hammer LANDS, and the
          // shadow (which already shows the gaps) was up for the whole warning.
          const time = radius / FORGE_HAMMER.ringSpeed + FORGE_HAMMER.warningSec;
          expect(walk, `id ${id} r ${radius} b ${bearing.toFixed(1)}`).toBeLessThan(
            RUN_SPEED * time,
          );
        }
      }
    }
  });
});

describe('the cast, authoritative', () => {
  it('starts only into a room clear of his own fire, and beats on its clock', () => {
    const entry = encounter();
    const state = entry.inst.hoardBoss;
    if (!state?.forgeHammer) throw new Error('missing state');
    state.cues.push({
      id: 900,
      kind: 'mark',
      variant: 'ember-fire',
      phase: 'hazard',
      x: entry.boss.pos.x,
      z: entry.boss.pos.z - 9,
      radius: 3,
      remaining: 0.2,
      total: 4,
    });
    state.forgeHammer.timer = 0;
    run(entry.sim, entry.boss, DT);
    expect(hoardBossCueViews(entry.inst).some((cue) => isForgeHammerVariant(cue.variant))).toBe(
      false,
    );
    run(entry.sim, entry.boss, 0.4);
    const views = hoardBossCueViews(entry.inst);
    const carrier = views.find((cue) => cue.variant === 'ember-hammer');
    expect(carrier?.total).toBeCloseTo(forgeCastTotalSec(3), 9);
    // The first shadow is already down, under the player.
    expect(strikes(entry.inst)).toHaveLength(1);
    const first = strikes(entry.inst)[0];
    expect(
      Math.hypot(first.x - entry.sim.player.pos.x, first.z - entry.sim.player.pos.z),
    ).toBeLessThan(FORGE_HAMMER.impactRadius);
    expect(first.total).toBeCloseTo(FORGE_STRIKE_TOTAL_SEC, 9);
    expect(state.forgeHammer.timer).toBeGreaterThan(FORGE_HAMMER_EVERY_SEC - 1);
    // One more shadow per beat, each where the player is THEN.
    entry.sim.player.pos = { ...entry.sim.player.pos, x: entry.sim.player.pos.x + 15 };
    const moved = { ...entry.sim.player.pos };
    run(entry.sim, entry.boss, FORGE_HAMMER.beatSec);
    const second = strikes(entry.inst).find((cue) => cue.cueId !== first.cueId);
    expect(second).toBeDefined();
    expect(Math.hypot((second?.x ?? 0) - moved.x, (second?.z ?? 0) - moved.z)).toBeLessThan(
      FORGE_HAMMER.impactRadius,
    );
    // The kit is held back for the whole cast, and a live cast is never doubled.
    state.markTimer = 0.05;
    state.forgeHammer.timer = 0;
    run(entry.sim, entry.boss, 2);
    expect(hoardBossCueViews(entry.inst).every((cue) => isForgeHammerVariant(cue.variant))).toBe(
      true,
    );
    expect(
      hoardBossCueViews(entry.inst).filter((cue) => cue.variant === 'ember-hammer'),
    ).toHaveLength(1);
  });

  it('crushes whoever stays under the shadow, survivably, and spares them its own ring', () => {
    const entry = encounter();
    cast(entry);
    const hp = entry.sim.player.hp;
    run(entry.sim, entry.boss, FORGE_HAMMER.warningSec - DT * 4);
    expect(entry.sim.player.hp).toBe(hp); // the shadow is harmless
    const events = run(entry.sim, entry.boss, 1.2);
    const hits = events.filter((e) => e.type === 'damage');
    expect(hits.map((e) => (e.type === 'damage' ? e.ability : ''))).toEqual([
      'Hammer of the Forge',
    ]);
    expect(entry.sim.player.dead).toBe(false);
    // Thrown clear, into the ring's path, and the ring leaves them be.
    const strike = strikes(entry.inst)[0];
    expect(
      Math.hypot(entry.sim.player.pos.x - strike.x, entry.sim.player.pos.z - strike.z),
    ).toBeGreaterThan(FORGE_HAMMER.ringSafeRadius);
  });

  it('burns a player who dodged the blow but stands in the ring, once; a gap is safe', () => {
    const entry = encounter();
    cast(entry);
    const strike = strikes(entry.inst)[0];
    let burning = 0;
    while (forgeBearingInGap(strike.cueId, burning)) burning += 0.1;
    const spot = (bearing: number, r: number) => ({
      ...entry.sim.player.pos,
      x: strike.x + Math.sin(bearing) * r,
      z: strike.z + Math.cos(bearing) * r,
    });
    const held = spot(burning, 12);
    // Freeze the beat clock so only this one ring exists.
    const events = run(
      entry.sim,
      entry.boss,
      FORGE_HAMMER.warningSec + 12 / FORGE_HAMMER.ringSpeed + 0.4,
      () => {
        entry.sim.player.pos = { ...held };
        const carrier = entry.inst.hoardBoss?.cues.find((cue) => cue.variant === 'ember-hammer');
        if (carrier) carrier.remaining = carrier.total - 0.01;
      },
    );
    const burns = events.filter((e) => e.type === 'damage' && e.ability === 'Forgefire Ring');
    expect(burns).toHaveLength(1);
    expect(entry.sim.player.dead).toBe(false);

    const safe = encounter();
    cast(safe);
    const other = strikes(safe.inst)[0];
    const door = forgeGapAngle(other.cueId, 0);
    const events2 = run(safe.sim, safe.boss, FORGE_STRIKE_TOTAL_SEC + 0.2, () => {
      safe.sim.player.pos = {
        ...safe.sim.player.pos,
        x: other.x + Math.sin(door) * 12,
        z: other.z + Math.cos(door) * 12,
      };
      const carrier = safe.inst.hoardBoss?.cues.find((cue) => cue.variant === 'ember-hammer');
      if (carrier) carrier.remaining = carrier.total - 0.01;
    });
    expect(events2.some((e) => e.type === 'damage')).toBe(false);
  });

  it('strikes more for a rarer hoard and, slowly, for a bigger party: never harder', () => {
    expect(forgeStrikeCount(0, 1)).toBe(3);
    expect(forgeStrikeCount(0, 3)).toBe(3);
    expect(forgeStrikeCount(0, 4)).toBe(4);
    expect(forgeStrikeCount(1, 5)).toBe(5);
    expect(forgeStrikeCount(1, 40)).toBe(FORGE_HAMMER.maxStrikes);
    const solo = encounter('legendary');
    cast(solo);
    const seen = new Set<number>();
    run(solo.sim, solo.boss, forgeCastTotalSec(4) - 0.3, () => {
      solo.sim.player.hp = solo.sim.player.maxHp;
      for (const cue of strikes(solo.inst)) seen.add(cue.cueId);
    });
    // A lone player in a legendary hoard: four strikes, one hammer.
    expect(seen.size).toBe(4);
  });

  it('starts every strike at its FULL life, so a client clock starts where the sim does', () => {
    const entry = encounter();
    cast(entry);
    const seen = new Set<number>();
    let checked = 0;
    run(entry.sim, entry.boss, FORGE_HAMMER.beatSec * 2 + 0.5, () => {
      entry.sim.player.hp = entry.sim.player.maxHp;
      for (const cue of strikes(entry.inst)) {
        if (seen.has(cue.cueId)) continue;
        seen.add(cue.cueId);
        // First sight of it is the tick it joined the list: nothing taken off yet.
        expect(cue.remaining).toBeCloseTo(cue.total, 9);
        checked++;
      }
    });
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it('at full pressure a SECOND hammer joins and the two ALTERNATE, never land together', () => {
    const party = encounter('legendary');
    for (const id of [7001, 7002, 7003]) {
      const ally = { ...party.sim.player, id, pos: { ...party.sim.player.pos }, auras: [] };
      ally.pos.x += (id - 7000) * 8 - 16;
      party.sim.entities.set(id, ally);
      party.inst.memberIds.add(id);
    }
    party.inst.memberIds.add(party.sim.player.id);
    const events = cast(party);
    const perHammer = forgeStrikeCount(1, 4);
    const total = forgeCastTotalSec(perHammer, 2);
    events.push(
      ...run(party.sim, party.boss, total, () => {
        for (const id of party.inst.memberIds) {
          const player = party.sim.entities.get(id);
          if (player) player.hp = player.maxHp;
        }
      }),
    );
    const shadows = events.filter(
      (e) =>
        e.type === 'hoardBossCue' &&
        e.variant === 'ember-hammer-strike' &&
        e.pid === party.sim.player.id,
    );
    expect(shadows).toHaveLength(perHammer * 2);
    // They take turns: hammer A, hammer B, hammer A...
    expect(shadows.map((e) => (e.type === 'hoardBossCue' ? e.innerRadius : -1))).toEqual(
      Array.from({ length: perHammer * 2 }, (_, i) => i % 2),
    );
    // ...and no hammer ever falls on the ground the one before it struck.
    for (let i = 1; i < shadows.length; i++) {
      const a = shadows[i - 1];
      const b = shadows[i];
      if (a.type !== 'hoardBossCue' || b.type !== 'hoardBossCue') continue;
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThanOrEqual(
        FORGE_HAMMER.minStrikeSpacing - 1e-6,
      );
    }
    // Half a beat apart: a new shadow while the last ring is still spreading, but
    // never two blows in the same instant.
    expect(forgeBeatSec(2)).toBeCloseTo(FORGE_HAMMER.beatSec / 2, 9);
    expect(forgeBeatSec(2)).toBeGreaterThan(1);
    // A small party in the same hoard keeps to one hammer.
    const solo = encounter('legendary');
    cast(solo);
    expect(solo.inst.hoardBoss?.forgeHammer?.hammers).toBe(1);
  });

  it('draws no rng, and leaves nothing behind when the fight resets mid-cast', () => {
    const play = () => {
      const entry = encounter('epic');
      const events = cast(entry);
      events.push(...run(entry.sim, entry.boss, 6));
      return {
        stream: events.filter((e) => e.type === 'hoardBossCue' || e.type === 'damage'),
        next: entry.sim.rng.next(),
      };
    };
    const a = play();
    const b = play();
    expect(a.stream.length).toBeGreaterThan(3);
    expect(b).toEqual(a);

    const entry = encounter();
    cast(entry);
    run(entry.sim, entry.boss, FORGE_HAMMER.warningSec + 0.5);
    entry.boss.aiState = 'idle';
    tickHoardBossMechanics(entry.sim.ctx);
    expect(entry.sim.drainEvents().some((e) => e.type === 'hoardBossCueClear')).toBe(true);
    expect(entry.inst.hoardBoss).toBeUndefined();
    expect(hoardBossCueViews(entry.inst)).toHaveLength(0);
    entry.sim.player.hp = entry.sim.player.maxHp;
    for (let t = 0; t < 8; t += DT) tickHoardBossMechanics(entry.sim.ctx);
    expect(entry.sim.player.hp).toBe(entry.sim.player.maxHp);
  });
});
