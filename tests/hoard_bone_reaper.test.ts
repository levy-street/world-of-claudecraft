// Bonelord Xarreth's Wandering Scythe and Soul Harvest
// (src/sim/rift/hoard_bone_reaper.ts + its shared core). One describe per
// mechanic, one test per acceptance criterion of the owner's briefs.
import { describe, expect, it } from 'vitest';
import { HoardBossCueMirror } from '../src/net/hoard_boss_cue_mirror';
import {
  BONE_REAPER_FIRST_SEC,
  boneReaperFrame,
  HOARD_HARVESTED_SOUL_AURA_ID,
  holdHoardBoneReaper,
  tickHoardBoneReaper,
} from '../src/sim/rift/hoard_bone_reaper';
import {
  BONE_SCYTHE,
  BONE_SCYTHE_TOTAL_SEC,
  decodeScytheFrame,
  encodeScytheFrame,
  HOARD_SOUL_BURDEN_AURA_ID,
  pointInScytheBlade,
  SOUL_HARVEST,
  scytheAngle,
  scytheFrameFor,
  scythePathPoint,
  scythePatternOf,
  scythePhase,
  scythePivot,
  scytheProgress,
  scytheSpin,
  soulCountFor,
  soulLifeSec,
  soulPosition,
  soulSpawnOffsets,
} from '../src/sim/rift/hoard_bone_reaper_core';
import { hoardBossCueViews, tickHoardBossMechanics } from '../src/sim/rift/hoard_boss';
import {
  HOARD_DOUBLE_MECHANIC_INTENSITY,
  HOARD_RARITY_PRESSURE,
  HOARD_REFERENCE_HEALTH,
  hoardIntensity,
  hoardMechanicDamage,
  hoardPressure,
} from '../src/sim/rift/hoard_scaling';
import type { RiftInstance } from '../src/sim/rift/types';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';

const FRAME = scytheFrameFor(24, 28, -1);

function encounter(seed = 5150) {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.enterRift(makeVaultSeed(3, 183), 23, sim.player.id, undefined, {
    ...sim.player,
    id: -1,
    vaultOwnerPid: sim.player.id,
    vaultRarity: 'legendary',
  });
  const inst = sim.riftInstances.find((entry) => entry.partyKey !== null);
  if (!inst || inst.bossId === null) throw new Error('missing hoard');
  const boss = sim.entities.get(inst.bossId);
  if (!boss) throw new Error('missing boss');
  boss.templateId = 'rift_boss_necro';
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  boss.firedSummons = 99; // the bone legion is not under test
  // Out of every mechanic's way: tucked behind the boss, inside no blade.
  sim.player.pos = { ...boss.pos, z: boss.pos.z + 3 };
  sim.player.hp = sim.player.maxHp;
  tickHoardBossMechanics(sim.ctx);
  sim.drainEvents();
  return { sim, inst, boss };
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

function cueOf(inst: RiftInstance, variant: string) {
  return hoardBossCueViews(inst).find((cue) => cue.variant === variant);
}

function startScythe(entry: ReturnType<typeof encounter>) {
  const reaper = entry.inst.hoardBoss?.boneReaper;
  if (!reaper) throw new Error('missing reaper state');
  reaper.step = 0;
  reaper.timer = 0;
  run(entry.sim, entry.boss, DT);
  const cue = cueOf(entry.inst, 'bone-scythe');
  if (!cue) throw new Error('missing scythe');
  return cue;
}

function startHarvest(entry: ReturnType<typeof encounter>) {
  const reaper = entry.inst.hoardBoss?.boneReaper;
  if (!reaper) throw new Error('missing reaper state');
  reaper.step = 1;
  reaper.timer = 0;
  run(entry.sim, entry.boss, DT);
  return hoardBossCueViews(entry.inst).filter((cue) => cue.variant === 'bone-soul');
}

describe('the scythe choreography (pure, shared with the renderer)', () => {
  it('spins up smoothly, holds a constant turn, and never snaps', () => {
    const omega = (Math.PI * 2) / BONE_SCYTHE.rotationPeriod;
    let last = scytheSpin(0);
    let lastRate = 0;
    for (let t = DT; t <= BONE_SCYTHE_TOTAL_SEC; t += DT) {
      const now = scytheSpin(t);
      const rate = (now - last) / DT;
      expect(rate, `turning at ${t}`).toBeGreaterThan(0);
      // Angular speed never jumps: no more than a spin-up's worth per tick.
      expect(Math.abs(rate - lastRate), `no snap at ${t}`).toBeLessThan(omega * 0.12);
      if (scythePhase(t) === 'active' && scythePhase(t - DT) === 'active')
        expect(rate).toBeCloseTo(omega, 6);
      last = now;
      lastRate = rate;
    }
    expect(BONE_SCYTHE.rotationPeriod).toBeGreaterThanOrEqual(2.5);
    expect(BONE_SCYTHE.rotationPeriod).toBeLessThanOrEqual(4);
    expect(scytheAngle(1.25, 0)).toBe(1.25);
  });

  it('carries the pivot across the room with weight: eased off the mark and into rest', () => {
    expect(scytheProgress(0)).toBe(0);
    expect(scytheProgress(BONE_SCYTHE.castSec)).toBe(0);
    expect(scytheProgress(BONE_SCYTHE.castSec + BONE_SCYTHE.activeSec)).toBeCloseTo(1, 9);
    let last = 0;
    for (let t = 0; t <= BONE_SCYTHE_TOTAL_SEC; t += DT) {
      const u = scytheProgress(t);
      expect(u).toBeGreaterThanOrEqual(last);
      last = u;
    }
    const first = scytheProgress(BONE_SCYTHE.castSec + 0.5);
    const cruising =
      scytheProgress(BONE_SCYTHE.castSec + 6.5) - scytheProgress(BONE_SCYTHE.castSec + 6);
    expect(first).toBeLessThan(cruising * 0.5);
  });

  it('every route stays inside its frame, off the boss, and at a pace a player outruns', () => {
    for (let pattern = 0; pattern < BONE_SCYTHE.patterns; pattern++) {
      let travelled = 0;
      let before = scythePathPoint(pattern, 0, FRAME);
      for (let step = 1; step <= 400; step++) {
        const p = scythePathPoint(pattern, step / 400, FRAME);
        expect(Math.abs(p.x), `pattern ${pattern} lateral`).toBeLessThanOrEqual(
          FRAME.lateral + 1e-9,
        );
        expect(p.f, `pattern ${pattern} depth`).toBeLessThanOrEqual(FRAME.depth + 1e-9);
        // The blade tip never reaches the boss's post or the melee standing on him.
        expect(
          Math.hypot(p.x, p.f) - BONE_SCYTHE.reach,
          `pattern ${pattern} clear of the boss`,
        ).toBeGreaterThanOrEqual(BONE_SCYTHE.bossClearance - 1e-9);
        travelled += Math.hypot(p.x - before.x, p.f - before.f);
        before = p;
      }
      const pace = travelled / (BONE_SCYTHE.activeSec - BONE_SCYTHE.easeSec);
      expect(pace, `pattern ${pattern} pace`).toBeGreaterThan(2);
      expect(pace, `pattern ${pattern} pace`).toBeLessThan(5.5);
    }
    expect([0, 1, 2, 3, 4, 5].map(scythePatternOf)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('the frame survives the two spare cue numbers it rides in', () => {
    for (const sign of [1, -1] as const) {
      const frame = scytheFrameFor(21.5, 26, sign);
      const packed = encodeScytheFrame(frame);
      expect(decodeScytheFrame(packed.radius, packed.halfAngle)).toEqual(frame);
    }
    // A cramped room still yields a usable frame rather than a negative one.
    const cramped = scytheFrameFor(6, 4, 1);
    expect(cramped.lateral).toBe(BONE_SCYTHE.minLateral);
    expect(cramped.depth).toBe(BONE_SCYTHE.minDepth);
  });

  it('only the blade is dangerous: not the pivot, not the shaft, not the far side', () => {
    const pivot = { x: 100, z: 50 };
    const angle = 0; // shaft points +z
    const at = (radius: number, ahead: number) => ({
      x: pivot.x + Math.sin(angle + ahead * BONE_SCYTHE.rotationDirection) * radius,
      z: pivot.z + Math.cos(angle + ahead * BONE_SCYTHE.rotationDirection) * radius,
    });
    const mid = (BONE_SCYTHE.bladeInner + BONE_SCYTHE.reach) / 2;
    expect(pointInScytheBlade(pivot, angle, at(mid, BONE_SCYTHE.bladeArc / 2))).toBe(true);
    expect(pointInScytheBlade(pivot, angle, at(mid, 0))).toBe(true);
    // Hugging the moving pivot is safe: the shaft passes overhead.
    expect(pointInScytheBlade(pivot, angle, pivot)).toBe(false);
    expect(pointInScytheBlade(pivot, angle, at(BONE_SCYTHE.bladeInner - 0.3, 0.2))).toBe(false);
    // Beyond its reach, behind it, and across the ring are all safe.
    expect(pointInScytheBlade(pivot, angle, at(BONE_SCYTHE.reach + 0.3, 0.2))).toBe(false);
    expect(pointInScytheBlade(pivot, angle, at(mid, -0.5))).toBe(false);
    expect(pointInScytheBlade(pivot, angle, at(mid, Math.PI))).toBe(false);
    expect(pointInScytheBlade(pivot, angle, at(mid, BONE_SCYTHE.bladeArc + 0.3))).toBe(false);
    // The blade is a small part of the ring: most of it is always safe.
    expect(BONE_SCYTHE.bladeArc + BONE_SCYTHE.bladeTrail).toBeLessThan(Math.PI / 3);
  });
});

describe('Wandering Scythe (authoritative)', () => {
  it('is cast on its own clock, sized to the room, and pins the boss while it is abroad', () => {
    const entry = encounter();
    expect(cueOf(entry.inst, 'bone-scythe')).toBeUndefined();
    run(entry.sim, entry.boss, BONE_REAPER_FIRST_SEC + DT);
    const cue = cueOf(entry.inst, 'bone-scythe');
    expect(cue).toBeDefined();
    if (!cue) return;
    expect(cue.kind).toBe('sweep');
    expect(cue.total).toBeCloseTo(BONE_SCYTHE_TOTAL_SEC, 6);
    // Anchored where the boss stands, never on a player.
    expect([cue.x, cue.z]).toEqual([entry.boss.pos.x, entry.boss.pos.z]);
    const frame = decodeScytheFrame(cue.radius, cue.halfAngle ?? 0);
    expect(frame.lateral).toBeGreaterThanOrEqual(BONE_SCYTHE.minLateral);
    expect(frame.lateral).toBeLessThanOrEqual(BONE_SCYTHE.maxLateral);
    expect(frame.depth).toBeGreaterThanOrEqual(BONE_SCYTHE.minDepth);
    expect(holdHoardBoneReaper(entry.sim.ctx, entry.boss)).toBe(true);
    // No follow-up cast while we watch this one end (a legendary hoard's cadence
    // would otherwise start the harvest, which pins him too).
    const clock = entry.inst.hoardBoss?.boneReaper;
    if (clock) clock.timer = 9999;
    // Dragged off his spot, he is put back: the route's clearance depends on it.
    entry.boss.pos.x += 6;
    expect(holdHoardBoneReaper(entry.sim.ctx, entry.boss)).toBe(true);
    expect(entry.boss.pos.x).toBe(cue.x);
    run(entry.sim, entry.boss, BONE_SCYTHE_TOTAL_SEC + DT);
    expect(holdHoardBoneReaper(entry.sim.ctx, entry.boss)).toBe(false);
  });

  it('never aims at a player: the route is the same wherever they stand', () => {
    const a = encounter();
    const b = encounter();
    b.sim.player.pos = {
      ...b.sim.player.pos,
      x: b.sim.player.pos.x + 9,
      z: b.sim.player.pos.z - 14,
    };
    const cueA = startScythe(a);
    const cueB = startScythe(b);
    expect([cueA.x, cueA.z, cueA.radius, cueA.halfAngle, cueA.facing]).toEqual([
      cueB.x,
      cueB.z,
      cueB.radius,
      cueB.halfAngle,
      cueB.facing,
    ]);
  });

  it('hits once per sweep, never every tick, and harms nobody while it assembles', () => {
    const entry = encounter();
    const cue = startScythe(entry);
    const frame = decodeScytheFrame(cue.radius, cue.halfAngle ?? 0);
    const pattern = scythePatternOf(cue.cueId);
    const mid = (BONE_SCYTHE.bladeInner + BONE_SCYTHE.reach) / 2;
    let elapsed = DT;
    // Ride the ring: always mid-blade-radius from the MOVING pivot, at a fixed bearing.
    const ride = () => {
      const pivot = scythePivot(cue.x, cue.z, pattern, frame, elapsed);
      entry.sim.player.pos = { ...entry.sim.player.pos, x: pivot.x + mid, z: pivot.z };
      entry.sim.player.hp = entry.sim.player.maxHp;
      elapsed += DT;
    };
    const summon = run(entry.sim, entry.boss, BONE_SCYTHE.castSec - DT, ride);
    expect(summon.filter((ev) => ev.type === 'damage')).toHaveLength(0);
    const turns = 2;
    const active = run(entry.sim, entry.boss, BONE_SCYTHE.rotationPeriod * turns, ride);
    const hits = active.filter((ev) => ev.type === 'damage' && ev.targetId === entry.sim.player.id);
    // One per pass of the blade, however many ticks it spends overhead.
    expect(hits.length).toBe(turns);
    expect(BONE_SCYTHE.hitCooldownSec).toBeLessThan(BONE_SCYTHE.rotationPeriod);
  });

  it('is avoided by position alone: beside the pivot, or outside its reach', () => {
    for (const where of ['pivot', 'outside'] as const) {
      const entry = encounter();
      const cue = startScythe(entry);
      const frame = decodeScytheFrame(cue.radius, cue.halfAngle ?? 0);
      const pattern = scythePatternOf(cue.cueId);
      let elapsed = DT;
      const events = run(entry.sim, entry.boss, BONE_SCYTHE_TOTAL_SEC, () => {
        const pivot = scythePivot(cue.x, cue.z, pattern, frame, elapsed);
        const offset = where === 'pivot' ? 1.5 : BONE_SCYTHE.reach + 1.2;
        entry.sim.player.pos = { ...entry.sim.player.pos, x: pivot.x + offset, z: pivot.z };
        elapsed += DT;
      });
      expect(
        events.filter((ev) => ev.type === 'damage' && ev.targetId === entry.sim.player.id),
        where,
      ).toHaveLength(0);
    }
  });

  it('breaks apart on time and leaves nothing behind', () => {
    const entry = encounter();
    startScythe(entry);
    run(entry.sim, entry.boss, BONE_SCYTHE_TOTAL_SEC + DT * 2);
    expect(cueOf(entry.inst, 'bone-scythe')).toBeUndefined();
  });
});

describe('the soul choreography (pure, shared with the renderer)', () => {
  it('scales the souls with the head count, and with the rarity on top', () => {
    // One more soul for every player after the first.
    expect([1, 2, 3, 4, 5].map((heads) => soulCountFor(heads))).toEqual([3, 4, 5, 6, 7]);
    // The rarity presses it either way: a common hoard asks for fewer, a
    // legendary one for more, a lone player included.
    expect(soulCountFor(1, HOARD_RARITY_PRESSURE.common.extra)).toBe(2);
    expect(soulCountFor(1, HOARD_RARITY_PRESSURE.legendary.extra)).toBe(4);
    expect(soulCountFor(5, HOARD_RARITY_PRESSURE.legendary.extra)).toBe(8);
    expect(soulCountFor(40, 3)).toBe(SOUL_HARVEST.maxCount);
    expect(soulCountFor(1, -9)).toBe(SOUL_HARVEST.minCount);
  });

  it('scatters them over the WHOLE room: never bunched, never on the boss', () => {
    for (let count = SOUL_HARVEST.minCount; count <= SOUL_HARVEST.maxCount; count++) {
      for (const seed of [1, 2, 7, 40, 911]) {
        const souls = soulSpawnOffsets(count, seed, FRAME, 24);
        expect(souls).toHaveLength(count);
        for (const soul of souls) {
          expect(Math.hypot(soul.x, soul.f), `count ${count} seed ${seed}`).toBeGreaterThanOrEqual(
            SOUL_HARVEST.minSpawnDistance - 1e-6,
          );
          expect(Math.abs(soul.x)).toBeLessThanOrEqual(24 - SOUL_HARVEST.wallMargin + 1e-6);
        }
        for (let i = 0; i < souls.length; i++)
          for (let j = i + 1; j < souls.length; j++)
            expect(
              Math.hypot(souls[i].x - souls[j].x, souls[i].f - souls[j].f),
              `count ${count} seed ${seed} souls ${i},${j}`,
            ).toBeGreaterThanOrEqual(SOUL_HARVEST.minSeparation - 1e-6);
        if (count >= 4) {
          // They surround the room: both sides, and both the near and the far end.
          expect(souls.some((s) => s.x > 3) && souls.some((s) => s.x < -3)).toBe(true);
          const depths = souls.map((s) => s.f);
          expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(12);
          // And at mixed distances, so they arrive at different times.
          const arrivals = souls.map((s) => soulLifeSec(Math.hypot(s.x, s.f)));
          expect(Math.max(...arrivals) - Math.min(...arrivals)).toBeGreaterThan(1.5);
        }
      }
    }
  });

  it('is drawn faster in a rarer hoard, and the pace rides in its own life', () => {
    const slow = soulLifeSec(24, HOARD_RARITY_PRESSURE.common.speed);
    const base = soulLifeSec(24, HOARD_RARITY_PRESSURE.rare.speed);
    const fast = soulLifeSec(24, HOARD_RARITY_PRESSURE.legendary.speed);
    expect(slow).toBeGreaterThan(base);
    expect(fast).toBeLessThan(base);
    // Given its life, it still arrives exactly on time: sim and renderer agree.
    const spawn = { x: 24, z: 0 };
    const boss = { x: 0, z: 0 };
    expect(soulPosition(spawn, boss, fast, undefined, fast).x).toBeCloseTo(
      SOUL_HARVEST.absorbRadius,
      6,
    );
    expect(soulPosition(spawn, boss, fast * 0.5, undefined, fast).x).toBeLessThan(
      soulPosition(spawn, boss, fast * 0.5, undefined, base).x,
    );
  });

  it('spreads them round the room, none near the boss, differently each cast', () => {
    // A shallow room: nothing is placed past the depth it was measured clear to.
    for (let seed = 1; seed <= 20; seed++) {
      for (const soul of soulSpawnOffsets(5, seed, FRAME, 24, 18)) {
        expect(soul.f).toBeLessThanOrEqual(18 + 1e-9);
        expect(Math.hypot(soul.x, soul.f)).toBeGreaterThanOrEqual(
          SOUL_HARVEST.minSpawnDistance - 1e-6,
        );
      }
    }
    const first = soulSpawnOffsets(6, 11, FRAME);
    expect(first).toHaveLength(6);
    for (const soul of first) {
      expect(Math.hypot(soul.x, soul.f)).toBeGreaterThanOrEqual(
        SOUL_HARVEST.minSpawnDistance - 1e-9,
      );
      expect(soul.f).toBeGreaterThan(0);
    }
    // Spread: no two share a spot, and they sit on both sides of the room.
    for (let i = 0; i < first.length; i++)
      for (let j = i + 1; j < first.length; j++)
        expect(Math.hypot(first[i].x - first[j].x, first[i].f - first[j].f)).toBeGreaterThan(4);
    expect(first.some((s) => s.x > 2) && first.some((s) => s.x < -2)).toBe(true);
    expect(soulSpawnOffsets(6, 12, FRAME)).not.toEqual(first);
    expect(soulSpawnOffsets(6, 11, FRAME)).toEqual(first);
  });

  it('holds still, then is drawn in a straight line and arrives exactly on time', () => {
    const spawn = { x: 20, z: 0 };
    const boss = { x: 0, z: 0 };
    const life = soulLifeSec(20);
    expect(soulPosition(spawn, boss, 0)).toEqual(spawn);
    expect(soulPosition(spawn, boss, SOUL_HARVEST.castSec + SOUL_HARVEST.holdSec)).toEqual(spawn);
    let last = 20;
    for (let t = 0; t <= life + DT; t += DT) {
      const at = soulPosition(spawn, boss, t);
      expect(at.z).toBeCloseTo(0, 9);
      expect(at.x).toBeLessThanOrEqual(last + 1e-9);
      // No teleport: never more than a tick and a half of travel at once.
      expect(last - at.x).toBeLessThan(SOUL_HARVEST.speed * DT * 1.6);
      last = at.x;
    }
    expect(last).toBeCloseTo(SOUL_HARVEST.absorbRadius, 6);
    // A reaction window: the average soul takes several seconds to arrive.
    expect(life - SOUL_HARVEST.castSec).toBeGreaterThan(3);
  });
});

describe('Soul Harvest (authoritative)', () => {
  it('raises souls round the room, clear of the boss and of the player, and pins the boss', () => {
    const entry = encounter();
    const souls = startHarvest(entry);
    // A lone player in a LEGENDARY hoard: the solo count plus the rarity's one.
    expect(souls).toHaveLength(soulCountFor(1, HOARD_RARITY_PRESSURE.legendary.extra));
    expect(souls).toHaveLength(4);
    for (const soul of souls) {
      expect(soul.kind).toBe('mark');
      // Untargeted on purpose: a targeted mark is drawn ON its target.
      expect(soul.targetId).toBeUndefined();
      expect(Math.hypot(soul.x - entry.boss.pos.x, soul.z - entry.boss.pos.z)).toBeGreaterThan(10);
      expect(
        Math.hypot(soul.x - entry.sim.player.pos.x, soul.z - entry.sim.player.pos.z),
      ).toBeGreaterThanOrEqual(SOUL_HARVEST.playerClearance);
    }
    expect(cueOf(entry.inst, 'bone-harvest')).toBeDefined();
    expect(holdHoardBoneReaper(entry.sim.ctx, entry.boss)).toBe(true);
  });

  it('a player who reaches a soul releases it: it is withdrawn everywhere and feeds nobody', () => {
    const entry = encounter();
    const mirror = new HoardBossCueMirror(() => 0);
    const souls = startHarvest(entry);
    const target = souls[0];
    // Standing on it while it is still forming does nothing.
    entry.sim.player.pos = { ...entry.sim.player.pos, x: target.x, z: target.z };
    run(entry.sim, entry.boss, SOUL_HARVEST.castSec - DT * 2);
    expect(hoardBossCueViews(entry.inst).some((cue) => cue.cueId === target.cueId)).toBe(true);
    const events = run(entry.sim, entry.boss, DT * 4);
    expect(hoardBossCueViews(entry.inst).some((cue) => cue.cueId === target.cueId)).toBe(false);
    const withdrawn = events.filter(
      (ev) => ev.type === 'hoardBossCue' && ev.cueId === target.cueId,
    );
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0]).toMatchObject({ durationSecs: 0 });
    for (const ev of events) mirror.apply(ev);
    expect(mirror.views().some((cue) => cue.cueId === target.cueId)).toBe(false);
    expect(entry.boss.auras.some((aura) => aura.id === HOARD_HARVESTED_SOUL_AURA_ID)).toBe(false);
  });

  it('a soul that arrives is absorbed once, for one configurable stack each', () => {
    const entry = encounter();
    const souls = startHarvest(entry);
    const longest = Math.max(...souls.map((soul) => soul.total));
    run(entry.sim, entry.boss, longest + 1);
    const aura = entry.boss.auras.find((a) => a.id === HOARD_HARVESTED_SOUL_AURA_ID);
    expect(aura?.stacks).toBe(souls.length);
    expect(aura?.kind).toBe('buff_dmg_done');
    expect(aura?.value).toBeCloseTo(souls.length * SOUL_HARVEST.damagePerStack, 9);
    expect(entry.inst.hoardBoss?.boneReaper?.stacks).toBe(souls.length);
    // Spent: no soul, no carrier, and the boss is free to move again.
    expect(hoardBossCueViews(entry.inst).filter((c) => c.variant?.startsWith('bone-'))).toEqual([]);
    expect(holdHoardBoneReaper(entry.sim.ctx, entry.boss)).toBe(false);
  });

  it('caps the stacks, and lets them lapse', () => {
    const entry = encounter();
    for (let cast = 0; cast < 3; cast++) {
      const souls = startHarvest(entry);
      run(entry.sim, entry.boss, Math.max(...souls.map((s) => s.total)) + 1);
    }
    const aura = entry.boss.auras.find((a) => a.id === HOARD_HARVESTED_SOUL_AURA_ID);
    expect(aura?.stacks).toBe(SOUL_HARVEST.maxStacks);
    const reaper = entry.inst.hoardBoss?.boneReaper;
    if (!reaper) throw new Error('missing reaper state');
    reaper.timer = 9999; // no new casts while the stacks run down
    run(entry.sim, entry.boss, SOUL_HARVEST.stackDurationSec + 1);
    expect(entry.boss.auras.some((a) => a.id === HOARD_HARVESTED_SOUL_AURA_ID)).toBe(false);
  });

  it('releasing every soul ends the harvest early, so the boss is never pinned for nothing', () => {
    const entry = encounter();
    const souls = startHarvest(entry);
    run(entry.sim, entry.boss, SOUL_HARVEST.castSec + DT);
    for (const soul of souls) {
      entry.sim.player.pos = { ...entry.sim.player.pos, x: soul.x, z: soul.z };
      run(entry.sim, entry.boss, DT * 2);
    }
    run(entry.sim, entry.boss, DT * 2);
    expect(hoardBossCueViews(entry.inst).filter((c) => c.variant?.startsWith('bone-'))).toEqual([]);
    expect(entry.boss.auras.some((a) => a.id === HOARD_HARVESTED_SOUL_AURA_ID)).toBe(false);
  });
});

describe('the price of a soul, and pressure by party and rarity', () => {
  it('burdens whoever releases a soul, stacking, and never feeds the boss for it', () => {
    const entry = encounter();
    const souls = startHarvest(entry);
    run(entry.sim, entry.boss, SOUL_HARVEST.castSec + DT);
    const burdenOf = () => entry.sim.player.auras.find((a) => a.id === HOARD_SOUL_BURDEN_AURA_ID);
    expect(burdenOf()).toBeUndefined();
    for (let taken = 1; taken <= 2; taken++) {
      const soul = souls[taken - 1];
      entry.sim.player.pos = { ...entry.sim.player.pos, x: soul.x, z: soul.z };
      run(entry.sim, entry.boss, DT * 2);
      expect(burdenOf()).toMatchObject({ kind: 'vulnerability', stacks: taken });
      expect(burdenOf()?.value).toBeCloseTo(taken * SOUL_HARVEST.soloBurdenPerStack, 9);
      expect(burdenOf()?.remaining).toBeGreaterThan(SOUL_HARVEST.burdenDurationSec - 1);
    }
    expect(entry.boss.auras.some((a) => a.id === HOARD_HARVESTED_SOUL_AURA_ID)).toBe(false);
    expect(SOUL_HARVEST.burdenMaxStacks * SOUL_HARVEST.burdenPerStack).toBeLessThan(0.6);
  });

  it('rarity presses every hoard the same way: harder, faster, more at once', () => {
    const order = ['common', 'rare', 'epic', 'legendary'] as const;
    for (let i = 1; i < order.length; i++) {
      const lower = HOARD_RARITY_PRESSURE[order[i - 1]];
      const higher = HOARD_RARITY_PRESSURE[order[i]];
      expect(higher.damage).toBeGreaterThan(lower.damage);
      expect(higher.cadence).toBeLessThan(lower.cadence);
      expect(higher.speed).toBeGreaterThan(lower.speed);
      expect(higher.extra).toBeGreaterThanOrEqual(lower.extra);
    }
    // Rare is the baseline every mechanic was tuned on: it changes nothing.
    expect(HOARD_RARITY_PRESSURE.rare).toEqual({ damage: 1, cadence: 1, extra: 0, speed: 1 });
    expect(hoardPressure(null)).toEqual(HOARD_RARITY_PRESSURE.rare);
    // The same blow hits harder in a legendary hoard (a flat share of the
    // reference health, not of the victim's own).
    const entry = encounter();
    const share = 0.2;
    expect(hoardMechanicDamage(entry.inst, share)).toBe(
      Math.round(HOARD_REFERENCE_HEALTH * share * HOARD_RARITY_PRESSURE.legendary.damage),
    );
    if (entry.inst.vault) entry.inst.vault.rarity = 'common';
    expect(hoardMechanicDamage(entry.inst, share)).toBe(
      Math.round(HOARD_REFERENCE_HEALTH * share * HOARD_RARITY_PRESSURE.common.damage),
    );
  });

  it('sends a mirrored PAIR of scythes only at full pressure, never at a lone player', () => {
    const heads = (vaultRarity: 'common' | 'rare' | 'epic' | 'legendary', n: number) =>
      hoardIntensity({ rarity: vaultRarity, ownerPid: 1, headCount: n, level: 20 }, n);
    expect(heads('legendary', 1)).toBeLessThan(HOARD_DOUBLE_MECHANIC_INTENSITY);
    expect(heads('legendary', 3)).toBeLessThan(HOARD_DOUBLE_MECHANIC_INTENSITY);
    expect(heads('legendary', 4)).toBeGreaterThanOrEqual(HOARD_DOUBLE_MECHANIC_INTENSITY);
    expect(heads('epic', 5)).toBeGreaterThanOrEqual(HOARD_DOUBLE_MECHANIC_INTENSITY);
    expect(heads('rare', 5)).toBeLessThan(HOARD_DOUBLE_MECHANIC_INTENSITY);

    const entry = encounter();
    const state = entry.inst.hoardBoss;
    if (!state?.boneReaper) throw new Error('missing reaper state');
    state.boneReaper.step = 0;
    state.boneReaper.timer = 0;
    // Five living players in this legendary hoard.
    const party = Array.from({ length: 5 }, (_, i) => ({ ...entry.sim.player, id: 9000 + i }));
    tickHoardBoneReaper(entry.sim.ctx, entry.inst, entry.boss, state, party, () => {});
    const blades = state.cues.filter((cue) => cue.variant === 'bone-scythe');
    expect(blades).toHaveLength(2);
    const [a, b] = blades;
    if (a.kind !== 'sweep' || b.kind !== 'sweep') throw new Error('not sweeps');
    // Mirrored left for right, begun on opposite sides of the turn, on different routes.
    expect(b.radius).toBe(-a.radius);
    expect(b.facing - a.facing).toBeCloseTo(Math.PI, 9);
    expect(scythePatternOf(b.id)).not.toBe(scythePatternOf(a.id));
    const frameA = decodeScytheFrame(a.radius, a.halfAngle);
    const frameB = decodeScytheFrame(b.radius, b.halfAngle);
    const t = BONE_SCYTHE.castSec + 3;
    const pa = scythePivot(a.x, a.z, 0, frameA, t);
    const pb = scythePivot(b.x, b.z, 0, frameB, t);
    // The same route mirrored: equal depth, opposite sides.
    expect(pb.z).toBeCloseTo(pa.z, 9);
    expect(pb.x - b.x).toBeCloseTo(-(pa.x - a.x), 9);
    // Cornered against a wall the mirrored routes would ride one line: just the one.
    const cornered = encounter();
    const corneredState = cornered.inst.hoardBoss;
    if (!corneredState?.boneReaper) throw new Error('missing reaper state');
    const open = boneReaperFrame(cornered.inst, cornered.boss);
    cornered.boss.pos.x += open.halfWidth - (BONE_SCYTHE.reach + BONE_SCYTHE.wallMargin + 4);
    expect(boneReaperFrame(cornered.inst, cornered.boss).lateral).toBeLessThan(
      BONE_SCYTHE.pairMinLateral,
    );
    corneredState.boneReaper.step = 0;
    corneredState.boneReaper.timer = 0;
    tickHoardBoneReaper(
      cornered.sim.ctx,
      cornered.inst,
      cornered.boss,
      corneredState,
      party,
      () => {},
    );
    expect(corneredState.cues.filter((cue) => cue.variant === 'bone-scythe')).toHaveLength(1);
    // A lone player gets one.
    const solo = encounter();
    expect(hoardBossCueViews(solo.inst).filter((c) => c.variant === 'bone-scythe')).toHaveLength(0);
    startScythe(solo);
    expect(hoardBossCueViews(solo.inst).filter((c) => c.variant === 'bone-scythe')).toHaveLength(1);
  });
});

describe('both at once, and cleanup', () => {
  it('past half health a harvest can begin while the scythe still wanders', () => {
    const entry = encounter();
    entry.boss.hp = Math.floor(entry.boss.maxHp * 0.4);
    run(entry.sim, entry.boss, BONE_REAPER_FIRST_SEC + DT);
    expect(cueOf(entry.inst, 'bone-scythe')).toBeDefined();
    let together = false;
    run(entry.sim, entry.boss, BONE_SCYTHE_TOTAL_SEC, () => {
      together ||=
        cueOf(entry.inst, 'bone-scythe') !== undefined &&
        cueOf(entry.inst, 'bone-soul') !== undefined;
    });
    expect(together).toBe(true);
  });

  it('the boss dying clears the blade, the souls and his stacks, and tells every client', () => {
    const entry = encounter();
    const souls = startHarvest(entry);
    run(entry.sim, entry.boss, Math.max(...souls.map((s) => s.total)) + 1);
    startScythe(entry);
    startHarvest(entry);
    expect(entry.boss.auras.some((a) => a.id === HOARD_HARVESTED_SOUL_AURA_ID)).toBe(true);
    entry.boss.hp = 0;
    entry.boss.dead = true;
    tickHoardBossMechanics(entry.sim.ctx);
    expect(entry.inst.hoardBoss).toBeUndefined();
    expect(hoardBossCueViews(entry.inst)).toEqual([]);
    expect(entry.boss.auras.some((a) => a.id === HOARD_HARVESTED_SOUL_AURA_ID)).toBe(false);
    expect(entry.sim.drainEvents().some((ev) => ev.type === 'hoardBossCueClear')).toBe(true);
  });

  it('a reset (the boss loses his target) clears it all the same way', () => {
    const entry = encounter();
    startScythe(entry);
    entry.boss.aiState = 'idle';
    tickHoardBossMechanics(entry.sim.ctx);
    expect(entry.inst.hoardBoss).toBeUndefined();
    expect(hoardBossCueViews(entry.inst)).toEqual([]);
  });

  it('draws no randomness and replays identically from the same seed', () => {
    const a = encounter(77);
    const b = encounter(77);
    const draws: number[] = [];
    a.sim.rng.setObserver((draw) => draws.push(draw));
    for (let tick = 0; tick < 700; tick++) {
      a.boss.aiState = 'attack';
      b.boss.aiState = 'attack';
      tickHoardBossMechanics(a.sim.ctx);
      tickHoardBossMechanics(b.sim.ctx);
      expect(hoardBossCueViews(a.inst)).toEqual(hoardBossCueViews(b.inst));
      expect(a.sim.drainEvents()).toEqual(b.sim.drainEvents());
    }
    expect(draws).toEqual([]);
  });
});
