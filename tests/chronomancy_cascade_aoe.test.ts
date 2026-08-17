// ---- Phase 4: Cascada temporal (mass group echo) AoE-scaling harness ----------
// Owner directive 2026-07-12: measure FIVE marked allies against 1/3/5/max enemies
// hit by AoE Arcane damage, to confirm the group echo scales PROPORTIONATELY with
// the enemy count (linear, never super-linear) at the reduced 6% area coefficient,
// and that Cascada always marks the whole group of five.
// (Split 2026-08-13 from the single chronomancy_balance suite; the shared
// rotation fixtures live in tests/helpers/chronomancy_harness.ts.)
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { free } from './helpers/chronomancy_harness';
import { expectDefined } from './helpers/defined';
import { placePlayerInOpenField } from './helpers/open_field';

// Form a RAID led by `leader` with all `members`. A 5-cap party would drop the
// fifth ally; a raid holds the leader plus five allies so every group slot can land
// on an ally (owner rule: Cascada ignores party/raid subgroup limits).
function makeRaid(sim: Sim, leader: number, members: number[]): void {
  // Convert-to-raid needs a FULL party of five first (leader + four), so fill the
  // party, convert, then invite the remaining members into the raid.
  const invite = (m: number) => {
    sim.partyInvite(m, leader);
    sim.partyAccept(m);
  };
  for (const m of members.slice(0, 4)) invite(m);
  (sim as unknown as { party: { convertPartyToRaid(pid: number): void } }).party.convertPartyToRaid(
    leader,
  );
  for (const m of members.slice(4)) invite(m);
}

function tickUntilFree(sim: Sim, p: Entity, cap = 80): void {
  for (let i = 0; i < cap && !free(p); i++) sim.tick();
}

interface CascadeMeasure {
  marks: number; // group echoes actually placed (target + nearest four)
  healPerCast: number; // effective group Echo healing driven by ONE Arcane Explosion
}

// Mark five party allies with Cascada, then measure the group Temporal Echo healing
// from a SINGLE Arcane Explosion (Aetherburst) that hits `enemyCount` clustered
// enemies. Allies are pinned to 1 hp so every converted heal is fully effective.
function cascadeAoeHeal(enemyCount: number): CascadeMeasure {
  const sim = new Sim({ seed: 41, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(20);
  sim.setSpec('arcane');
  sim.tick();
  placePlayerInOpenField(sim);
  const p = sim.player;
  p.resource = p.maxResource;
  const allyIds: number[] = [];
  for (let i = 0; i < 5; i++) {
    const id = sim.addPlayer('warrior', `Ally${i}`);
    const a = expectDefined(sim.entities.get(id));
    a.pos.x = p.pos.x + 1 + i * 0.4; // tight cluster (party invites need proximity)
    a.pos.z = p.pos.z;
    a.maxHp = 1_000_000;
    allyIds.push(id);
  }
  makeRaid(sim, p.id, allyIds);
  // Now pull the MAGE 20 yd away from the cluster: still within the 30 yd cast range
  // and within 15 yd of the primary, but the mage itself (a valid self target) is now
  // OUTSIDE the 15 yd radius, so all five group slots land on the five allies. The
  // party survives the separation (invites checked proximity only at accept time).
  p.pos.x -= 20;
  sim.targetEntity(allyIds[0]); // the primary is a party member, always included
  sim.castAbility('temporal_cascade');
  tickUntilFree(sim, p); // let the 2s cast finish and the marks land
  const marks = allyIds.filter((id) =>
    expectDefined(sim.entities.get(id)).auras.some(
      (a) => a.id === 'temporal_echo' && a.sourceId === p.id,
    ),
  ).length;
  // Cluster the enemies inside Arcane Explosion's self-centered radius (10 yd).
  for (let k = 0; k < enemyCount; k++) {
    const m = createMob(9000 + k, MOBS.training_dummy, 20, {
      x: p.pos.x + 1 + k * 0.3,
      y: p.pos.y,
      z: p.pos.z,
    });
    m.hostile = true;
    m.maxHp = m.hp = 1_000_000_000;
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(m);
  }
  // One Arcane Explosion (target stays a friendly ally, so no auto-attack contaminates
  // the reading); sum the effective group echo healing it drives.
  sim.targetEntity(allyIds[0]);
  sim.castAbility('arcane_explosion');
  let heal = 0;
  for (let i = 0; i < 12; i++) {
    for (const id of allyIds) expectDefined(sim.entities.get(id)).hp = 1;
    for (const e of sim.tick()) {
      if (
        e.type === 'heal2' &&
        e.sourceId === p.id &&
        allyIds.includes(e.targetId) &&
        e.ability === 'Temporal Echo'
      )
        heal += e.amount;
    }
  }
  return { marks, healPerCast: heal };
}

describe('Chronomancy Phase 4 Cascada AoE scaling (owner harness)', () => {
  const h1 = cascadeAoeHeal(1);
  const h3 = cascadeAoeHeal(3);
  const h5 = cascadeAoeHeal(5);
  const h10 = cascadeAoeHeal(10); // the reasonable maximum enemy pack

  it('reports the measured group healing per AoE cast', () => {
    const line = (k: number, m: CascadeMeasure) =>
      `enemies=${k.toString().padEnd(2)} marks=${m.marks} groupHeal/AoEcast=${m.healPerCast.toFixed(1)} perEnemy=${(m.healPerCast / k).toFixed(1)}`;
    const lines = [line(1, h1), line(3, h3), line(5, h5), line(10, h10)].join('\n');
    expect(lines.length).toBeGreaterThan(0);
    console.log(`\n[chronomancy cascade AoE]\n${lines}\n`);
  });

  it('always marks the whole group of five', () => {
    for (const m of [h1, h3, h5, h10]) expect(m.marks).toBe(5);
  });

  it('group healing scales PROPORTIONATELY with enemy count (linear, not explosive)', () => {
    expect(h1.healPerCast).toBeGreaterThan(0);
    // Each enemy hit converts independently at the flat 6% area rate, so healing is
    // linear in the enemy count: healPerCast(K) ~ K * healPerCast(1). A per-enemy
    // reading that stays within a tight band of the single-enemy figure proves there
    // is NO super-linear blow-up (the AoE-scaling risk the owner flagged).
    const perEnemy1 = h1.healPerCast;
    for (const [k, m] of [
      [3, h3],
      [5, h5],
      [10, h10],
    ] as const) {
      const perEnemy = m.healPerCast / k;
      expect(perEnemy).toBeGreaterThan(perEnemy1 * 0.7);
      expect(perEnemy).toBeLessThan(perEnemy1 * 1.35);
    }
  });
});
