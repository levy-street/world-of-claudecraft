// Temporal Cascade's initial heal now answers the emergency it is cast into: the
// authored roll is scaled by how much health each ally is missing, so the same
// button prepares a healthy group exactly as it always did and lands as a real
// area heal on a group that is already low. docs/prd/mage-chronomancy.md.
//
// Covered here: the pure multiplier's endpoints, its clamping, and the sim-level
// consequences that matter, that a full-health ally's heal is UNCHANGED against
// the pre-change behavior, that a wounded ally's is larger in proportion to the
// health it is missing, and that the scaling never spends itself as overheal.
import { describe, expect, it } from 'vitest';
import { cascadeReliefMultiplier } from '../src/sim/combat/chronomancy_echo_distribution';
import { TEMPORAL_CASCADE_RELIEF_MAX_BONUS } from '../src/sim/content/chronomancy_tuning';
import { ABILITIES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { free } from './helpers/chronomancy_harness';

describe('Temporal Cascade relief multiplier (pure)', () => {
  it('leaves a full-health ally on the authored roll', () => {
    expect(cascadeReliefMultiplier(1_000, 1_000)).toBe(1);
  });

  it('pays the full authored ceiling to an ally at zero health', () => {
    expect(cascadeReliefMultiplier(0, 1_000)).toBe(1 + TEMPORAL_CASCADE_RELIEF_MAX_BONUS);
    expect(TEMPORAL_CASCADE_RELIEF_MAX_BONUS).toBe(3);
  });

  it('slides linearly with the missing fraction, not with the size of the pool', () => {
    // Half health is half the bonus, and a tank's larger pool must not change it.
    expect(cascadeReliefMultiplier(500, 1_000)).toBeCloseTo(2.5, 10);
    expect(cascadeReliefMultiplier(5_000, 10_000)).toBeCloseTo(2.5, 10);
    // A quarter left is three quarters of the bonus.
    expect(cascadeReliefMultiplier(250, 1_000)).toBeCloseTo(3.25, 10);
  });

  it('clamps overhealed, empty and malformed pools instead of inverting', () => {
    expect(cascadeReliefMultiplier(1_500, 1_000)).toBe(1); // over max, never below 1
    expect(cascadeReliefMultiplier(-50, 1_000)).toBe(1 + TEMPORAL_CASCADE_RELIEF_MAX_BONUS);
    expect(cascadeReliefMultiplier(10, 0)).toBe(1); // no pool, no scaling
    expect(cascadeReliefMultiplier(Number.NaN, 1_000)).toBe(1);
  });

  it('honors an explicit ceiling and never scales below the authored roll', () => {
    expect(cascadeReliefMultiplier(0, 1_000, 0)).toBe(1);
    expect(cascadeReliefMultiplier(0, 1_000, -5)).toBe(1);
    expect(cascadeReliefMultiplier(250, 1_000, 1)).toBeCloseTo(1.75, 10);
  });
});

// ---- Sim-level behavior -----------------------------------------------------

const CASCADE_NAME = 'Temporal Cascade';
const BIG_POOL = 1_000_000;

function chronoMage(level = 20) {
  const sim = new Sim({ seed: 41, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(level);
  expect(sim.setSpec('arcane')).toBe(true);
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

/** A party ally parked on the caster so it always lands inside Cascade's radius. */
function addAlly(sim: Sim, name: string): Entity {
  const leader = sim.player.id;
  const id = sim.addPlayer('warrior', name);
  const e = sim.entities.get(id)!;
  e.pos.x = sim.player.pos.x + 1;
  e.pos.z = sim.player.pos.z + 1;
  sim.partyInvite(id, leader);
  sim.partyAccept(id);
  return e;
}

interface Watched {
  e: Entity;
  /** Health fraction to hold this ally at while the cast resolves. */
  fraction: number;
}

/**
 * Hold the ally on a pool far larger than any heal, at the wanted health fraction.
 * Re-applied every tick: joining a party applies group buffs, and a buff triggers a
 * stat recalculation that would otherwise restore the real (tiny) pool mid-cast and
 * clamp the heal we are trying to measure.
 */
function hold(w: Watched): void {
  w.e.maxHp = BIG_POOL;
  w.e.hp = Math.max(1, Math.round(BIG_POOL * w.fraction));
}

/**
 * Cast Temporal Cascade on `primary` and return the INITIAL heal each ally received,
 * read from the heal events rather than from a health delta, so the fixture's health
 * pinning cannot be mistaken for healing. Echo conversion heals carry the Temporal
 * Echo name and are excluded; with no enemy in the fixture none are produced anyway.
 */
function castCascade(sim: Sim, primary: Entity, watched: Watched[]): Map<number, number> {
  sim.player.resource = sim.player.maxResource;
  for (const w of watched) hold(w);
  sim.targetEntity(primary.id);
  sim.castAbility('temporal_cascade');
  const healed = new Map<number, number>();
  for (let i = 0; i < 120 && !free(sim.player); i++) {
    for (const w of watched) hold(w);
    for (const ev of sim.tick()) {
      if (ev.type !== 'heal2' && ev.type !== 'heal') continue;
      const e = ev as { sourceId: number; targetId: number; amount: number; ability?: string };
      if (e.sourceId !== sim.player.id || e.ability !== CASCADE_NAME) continue;
      healed.set(e.targetId, (healed.get(e.targetId) ?? 0) + e.amount);
    }
  }
  return healed;
}

describe('Temporal Cascade initial heal in the sim', () => {
  it('scales the landed heal with missing health, at the same rank and pool', () => {
    // Identical pools, one ally at 90% health and one at 10%. Same rank, same spell
    // power, same cast: the relief multiplier is the only difference between them.
    const { sim } = chronoMage();
    const light = { e: addAlly(sim, 'light'), fraction: 0.9 };
    const heavy = { e: addAlly(sim, 'heavy'), fraction: 0.1 };
    sim.tick();

    const healed = castCascade(sim, light.e, [light, heavy]);
    const lightHeal = healed.get(light.e.id) ?? 0;
    const heavyHeal = healed.get(heavy.e.id) ?? 0;

    expect(lightHeal).toBeGreaterThan(0);
    expect(heavyHeal).toBeGreaterThan(lightHeal);
    // 1 + 3*0.9 = 3.7 against 1 + 3*0.1 = 1.3, so a shade under 3x. The per-ally
    // roll differs, so assert the band rather than one exact ratio.
    const ratio = heavyHeal / lightHeal;
    expect(ratio).toBeGreaterThan(2.3);
    expect(ratio).toBeLessThan(3.6);
  });

  it('leaves a nearly full ally on the unscaled roll, and a half-health one on 2.5x', () => {
    // The regression that matters: preparation must still cost what it cost. Two
    // identical fixtures on the SAME seed differ only in the health they are held
    // at, so the same authored roll is drawn and the ratio between the landed heals
    // IS the multiplier. 1 + 3*0.5 = 2.5 against 1 + 3*0.001 = 1.003.
    const measure = (fraction: number): number => {
      const { sim } = chronoMage();
      const ally = { e: addAlly(sim, 'subject'), fraction };
      sim.tick();
      return castCascade(sim, ally.e, [ally]).get(ally.e.id) ?? 0;
    };

    const nearlyFull = measure(0.999);
    const half = measure(0.5);

    expect(nearlyFull).toBeGreaterThan(0);
    expect(half).toBeGreaterThan(nearlyFull);
    const ratio = half / nearlyFull;
    expect(ratio).toBeGreaterThan(2.35);
    expect(ratio).toBeLessThan(2.65);

    // The cap rank still resolves through the group-echo effect, so the band above
    // is measuring Temporal Cascade's own initial heal and not another code path.
    const cascade = ABILITIES.temporal_cascade;
    const capRank = cascade.ranks?.[cascade.ranks.length - 1] ?? cascade;
    expect(capRank.effects?.[0]?.type).toBe('massTemporalEcho');
  });

  it('never turns the extra healing into overheal', () => {
    // An ally one point below full can only ever receive that one point. The bonus
    // exists in proportion to health that is actually missing, so it cannot inflate
    // an overheal: the landed heal is clamped to the gap, not to the scaled roll.
    const { sim } = chronoMage();
    const nearlyFull = { e: addAlly(sim, 'nearlyFull'), fraction: 1 };
    sim.tick();
    const healed = castCascade(sim, nearlyFull.e, [
      { ...nearlyFull, fraction: (BIG_POOL - 1) / BIG_POOL },
    ]);

    expect(healed.get(nearlyFull.e.id)).toBe(1);
  });

  it('still marks every ally it heals, so the preparation job is untouched', () => {
    const { sim, p } = chronoMage();
    const ally = { e: addAlly(sim, 'marked'), fraction: 0.5 };
    sim.tick();

    castCascade(sim, ally.e, [ally]);

    expect(
      ally.e.auras.some((a) => a.id === 'temporal_echo' && a.sourceId === p.id && a.echoGroup),
    ).toBe(true);
  });
});
