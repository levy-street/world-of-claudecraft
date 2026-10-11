import { describe, expect, it } from 'vitest';
import { tickHoardBossMechanics } from '../src/sim/rift/hoard_boss';
import { pointInHoardTideWave } from '../src/sim/rift/hoard_boss_kits';
import {
  HOARD_TIDE_ESCAPE_SPEED,
  HOARD_TIDE_LANE_CORRIDOR,
  HOARD_TIDE_LANE_HALF_SPAN,
  HOARD_TIDE_NO_GAP,
  hoardTidePattern,
} from '../src/sim/rift/hoard_tide_pattern';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import { DT, RUN_SPEED } from '../src/sim/types';

const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;

function tideFight(rarity: (typeof RARITIES)[number] = 'legendary') {
  const sim = new Sim({ seed: 93, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.enterRift(makeVaultSeed(3, 183), 23, sim.player.id, undefined, {
    ...sim.player,
    id: -1,
    vaultOwnerPid: sim.player.id,
    vaultRarity: rarity,
  });
  const inst = sim.riftInstances.find((i) => i.vault);
  if (!inst || inst.bossId === null) throw new Error('missing hoard');
  const boss = sim.entities.get(inst.bossId);
  if (!boss) throw new Error('missing boss');
  boss.templateId = 'rift_boss_tide';
  boss.aiState = 'attack';
  tickHoardBossMechanics(sim.ctx);
  const state = inst.hoardBoss;
  if (!state) throw new Error('missing state');
  state.specialTriggered = true;
  if (state.tentacles) state.tentacles.timer = 999;
  return { sim, inst, boss, state };
}

describe('Hoard tide volley fairness', () => {
  it('is deterministic, lays more lanes and faster crests the rarer the hoard', () => {
    let lastSpeed = 0;
    let lastCount = 0;
    for (const rarity of RARITIES) {
      const calm = hoardTidePattern(32, rarity, false);
      const angry = hoardTidePattern(32, rarity, true);
      expect(calm).toEqual(hoardTidePattern(32, rarity, false));
      expect(calm.length).toBeGreaterThanOrEqual(Math.max(2, lastCount));
      lastCount = calm.length;
      // Every lane of a volley runs a different way.
      expect(new Set(calm.map((w) => w.facing)).size).toBe(calm.length);
      const speed = calm[0].radius / (calm[0].total - calm[0].lead);
      expect(speed).toBeGreaterThan(lastSpeed);
      // Quick: faster than a player runs, so it is dodged SIDEWAYS, never outrun.
      expect(speed).toBeGreaterThan(RUN_SPEED);
      lastSpeed = speed;
      // Enraged, the crests leave closer together; nothing else changes.
      expect(angry.length).toBe(calm.length);
      if (calm.length > 1) {
        expect(angry[1].lead - angry[0].lead).toBeLessThan(calm[1].lead - calm[0].lead);
      }
    }
    expect(lastCount).toBe(4);
  });

  it('keeps every lane narrow and solid, with a walkable warning from its very middle', () => {
    for (let seed = 1; seed <= 100; seed++)
      for (const rarity of RARITIES) {
        for (const wave of hoardTidePattern(seed, rarity, true)) {
          expect(wave.span).toBe(HOARD_TIDE_LANE_HALF_SPAN);
          expect(wave.gap).toBe(HOARD_TIDE_NO_GAP);
          // From the worst place in it (dead centre) a conservative walker is out
          // sideways before its crest leaves, reaction time included.
          expect((wave.span + 0.5) / HOARD_TIDE_ESCAPE_SPEED + 0.5).toBeLessThan(wave.lead);
          // And it is quick: the whole volley is over in a few seconds.
          expect(wave.total).toBeLessThan(8);
        }
      }
  });

  it('never lets two near-parallel lanes touch: a calm corridor runs between them', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const lanes = hoardTidePattern(seed, 'legendary', false);
      for (let i = 0; i < lanes.length; i++)
        for (let j = i + 1; j < lanes.length; j++) {
          const nearParallel = Math.abs(Math.sin(lanes[i].facing - lanes[j].facing)) < 0.35;
          if (!nearParallel) continue;
          // Distance between the two lanes' middles, measured ACROSS them.
          const f = lanes[i].facing;
          const across =
            (lanes[j].dx - lanes[i].dx) * Math.cos(f) - (lanes[j].dz - lanes[i].dz) * Math.sin(f);
          expect(Math.abs(across) - lanes[i].span - lanes[j].span).toBeGreaterThanOrEqual(
            HOARD_TIDE_LANE_CORRIDOR - 1e-6,
          );
        }
    }
  });

  it('has no damage anywhere during the full lead, and only ever inside its lane', () => {
    const wave = hoardTidePattern(3, 'legendary', false)[1];
    const at = (x: number, z: number, remaining: number) =>
      pointInHoardTideWave(
        { x: 0, z: 0 },
        0,
        { x, z },
        wave.radius,
        remaining,
        wave.total,
        wave.gap,
        wave.span,
        wave.lead,
      );
    for (let remaining = wave.total; remaining > wave.total - wave.lead; remaining -= DT)
      expect(at(0, -wave.radius / 2, remaining)).toBe(false);
    let hits = 0;
    for (let remaining = wave.total - wave.lead; remaining > 0; remaining -= DT) {
      for (let z = -wave.radius / 2; z <= wave.radius / 2; z++) {
        if (at(0, z, remaining)) hits++;
        // Just outside the lane is never touched.
        expect(at(wave.span + 0.2, z, remaining)).toBe(false);
        expect(at(-wave.span - 0.2, z, remaining)).toBe(false);
      }
    }
    expect(hits).toBeGreaterThan(10);
  });

  it('lays the whole volley at once ROUND THE PLAYER, wherever the boss has been dragged', () => {
    const { sim, inst, boss, state } = tideFight('legendary');
    // The fight has been dragged well away from where he spawned.
    boss.pos = { ...boss.pos, z: boss.pos.z - 22 };
    sim.player.pos = { ...boss.pos, z: boss.pos.z - 4 };
    state.sweepTimer = 0;
    tickHoardBossMechanics(sim.ctx);
    const waves = state.cues.filter((c) => c.variant === 'tide-wave');
    // (A lane that would pin someone against the wall there is left out.)
    expect(waves.length).toBeGreaterThanOrEqual(2);
    expect(waves.length).toBeLessThanOrEqual(4);
    for (const wave of waves) {
      if (wave.kind !== 'sweep') throw new Error('not a sweep');
      // Every lane is laid close to the player, never back at his spawn.
      expect(Math.hypot(wave.x - sim.player.pos.x, wave.z - sim.player.pos.z)).toBeLessThan(12);
      expect(Math.hypot(wave.x - boss.spawnPos.x, wave.z - boss.spawnPos.z)).toBeGreaterThan(10);
    }
    // The crests leave one after another, never all at once.
    const leads = waves.map((w) => (w.kind === 'sweep' ? (w.waveLead ?? 0) : 0));
    expect(new Set(leads).size).toBe(waves.length);
    expect(Math.max(...leads) - Math.min(...leads)).toBeGreaterThan(0.4);
    expect(inst.hoardBoss).toBe(state);
  });

  it('gives the aim point no safe spot: over enough volleys a lane runs straight over it', () => {
    let over = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const lanes = hoardTidePattern(seed, 'rare', false);
      // The aim point is inside a lane when its across-offset is under the half span.
      if (lanes.some((lane) => Math.hypot(lane.dx, lane.dz) < lane.span)) over++;
    }
    expect(over).toBeGreaterThan(120);
    // And the angles are the seed's, not four fixed compass points.
    const facings = new Set<number>();
    for (let seed = 1; seed <= 20; seed++)
      for (const lane of hoardTidePattern(seed, 'rare', false))
        facings.add(Math.round(lane.facing * 100));
    expect(facings.size).toBeGreaterThan(20);
  });

  it('hits a player who stays in a lane once, never twice, and never from full to dead', () => {
    const { sim, state } = tideFight('legendary');
    state.sweepTimer = 0;
    tickHoardBossMechanics(sim.ctx);
    const wave = state.cues.find((c) => c.variant === 'tide-wave');
    if (!wave || wave.kind !== 'sweep') throw new Error('missing wave');
    // Park every other lane so only this one is judged.
    for (const other of state.cues) if (other !== wave) other.remaining = 0.01;
    wave.remaining = wave.total - (wave.waveLead ?? 0) - 0.2;
    const travel = wave.radius / (wave.total - (wave.waveLead ?? 0));
    const along = -wave.radius / 2 + travel * (0.2 + DT);
    sim.player.pos = {
      ...sim.player.pos,
      x: wave.x + Math.sin(wave.facing) * along,
      z: wave.z + Math.cos(wave.facing) * along,
    };
    const hp = sim.player.hp;
    tickHoardBossMechanics(sim.ctx);
    expect(sim.player.hp).toBeLessThan(hp);
    expect(sim.player.hp).toBeGreaterThan(0);
    expect(wave.hitIds?.has(sim.player.id)).toBe(true);
    const hitHp = sim.player.hp;
    tickHoardBossMechanics(sim.ctx);
    expect(sim.player.hp).toBe(hitHp);
  });

  it('comes round again a few seconds after the last lane ends, and starts early', () => {
    const { sim, boss, state } = tideFight('rare');
    // The first volley is not long in coming.
    expect(state.sweepTimer).toBeLessThan(5);
    const starts: number[] = [];
    let seen = new Set<number>();
    for (let n = 0; n < 20 * 40; n++) {
      boss.aiState = 'attack';
      sim.player.hp = sim.player.maxHp;
      tickHoardBossMechanics(sim.ctx);
      const ids = state.cues.filter((c) => c.variant === 'tide-wave').map((c) => c.id);
      if (ids.length > 0 && !ids.some((id) => seen.has(id))) starts.push(n * DT);
      seen = new Set([...seen, ...ids]);
    }
    expect(starts.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeLessThan(16);
      expect(starts[i] - starts[i - 1]).toBeGreaterThan(6);
    }
  });
});
