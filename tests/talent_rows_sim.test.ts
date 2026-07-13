// Sim-level integration of the choice-row talent system (Phase 2): the pick
// method's validation + level gating, the fold into the live flat modifiers,
// the two LIVE warrior options end to end (Crushing Charge, Anger Management),
// the shared combat primitives (buff_dmg_done, buff_crit), persistence, the
// fiesta standardize/restore round-trip, and determinism.

import { describe, expect, it } from 'vitest';
import { validateRowTree } from '../src/sim/content/talent_rows';
import { WARRIOR_ROWS } from '../src/sim/content/warrior_rows';
import { recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { fiestaRestoreChar, fiestaStandardize } from '../src/sim/social/fiesta';
import { dist2d, MAX_LEVEL, rageFromDealing, STANCE_RAGE_GEN } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const CRUSH = 'war_row_crushing_charge';
const ANGER = 'war_row_anger_management';

function warriorAtCap(seed = 7): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior' });
  sim.setPlayerLevel(MAX_LEVEL);
  return sim;
}

function nearestMob(sim: Sim) {
  let best: any = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = dist2d(sim.player.pos, e.pos);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

// Teleport DIST yards from the mob and face it (charge needs 8-25 yd).
function standOff(sim: Sim, mob: any, dist: number) {
  const p = sim.player;
  p.pos.x = mob.pos.x - dist;
  p.pos.z = mob.pos.z;
  p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
}

function metaOf(sim: Sim) {
  return (sim as any).players.get(sim.player.id);
}

describe('warrior row content', () => {
  it('is a valid registered tree with exactly the lit options live', () => {
    expect(validateRowTree(WARRIOR_ROWS)).toEqual([]);
    const live = WARRIOR_ROWS.flatMap((r) => r.options)
      .filter((o) => Object.keys(o.effect).length > 0)
      .map((o) => o.id)
      .sort();
    // All 18 warrior options are LIVE (phase 3 complete). A future empty-effect
    // placeholder must be added here deliberately, never by omission.
    expect(live).toEqual([
      ANGER,
      'war_row_avatar',
      'war_row_battle_rhythm',
      'war_row_bladestorm',
      'war_row_blood_offering',
      'war_row_bloodbath',
      'war_row_colossal_might',
      CRUSH,
      'war_row_die_by_the_sword',
      'war_row_double_charge',
      'war_row_lingering_dread',
      'war_row_piercing_howl',
      'war_row_pursuit',
      'war_row_recklessness',
      'war_row_sanguine_aura',
      'war_row_second_wind',
      'war_row_storm_bolt',
      'war_row_victory_rush',
    ]);
  });
});

describe('pickRowTalent: validation and level gating', () => {
  it('rejects a pick below the row level and accepts it at the gate', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' }); // level 1
    expect(sim.pickRowTalent(0, CRUSH)).toBe(false);
    sim.setPlayerLevel(5);
    expect(sim.pickRowTalent(0, CRUSH)).toBe(true);
    expect(sim.rowPicks[0]).toBe(CRUSH);
    // The level-20 capstone row stays locked at level 5.
    expect(sim.pickRowTalent(5, 'war_row_bladestorm')).toBe(false);
  });

  it('rejects unknown options and bad row indices', () => {
    const sim = warriorAtCap();
    expect(sim.pickRowTalent(0, 'not_a_real_option')).toBe(false);
    expect(sim.pickRowTalent(0, ANGER)).toBe(false); // belongs to row 3, not 0
    expect(sim.pickRowTalent(99, CRUSH)).toBe(false);
    expect(sim.rowPicks.every((p) => p === null)).toBe(true);
  });

  it('re-picking replaces, null clears, and combat locks the row', () => {
    const sim = warriorAtCap();
    expect(sim.pickRowTalent(0, CRUSH)).toBe(true);
    expect(sim.pickRowTalent(0, 'war_row_pursuit')).toBe(true);
    expect(sim.rowPicks[0]).toBe('war_row_pursuit');
    expect(sim.pickRowTalent(0, null)).toBe(true);
    expect(sim.rowPicks[0]).toBeNull();
    sim.player.inCombat = true;
    expect(sim.pickRowTalent(0, CRUSH)).toBe(false);
  });
});

describe('Crushing Charge (live option): end to end', () => {
  it('adds a 4s root and a 50%/15s slow to Charge; baseline Charge has neither', () => {
    const run = (pick: boolean) => {
      const sim = warriorAtCap(21);
      if (pick) expect(sim.pickRowTalent(0, CRUSH)).toBe(true);
      const mob = nearestMob(sim);
      standOff(sim, mob, 12);
      sim.targetEntity(mob.id);
      sim.castAbility('charge');
      return mob.auras.map((a: any) => a.kind);
    };
    const talented = run(true);
    expect(talented).toContain('stun');
    expect(talented).toContain('root');
    expect(talented).toContain('slow');
    const baseline = run(false);
    expect(baseline).toContain('stun');
    expect(baseline).not.toContain('root');
    expect(baseline).not.toContain('slow');
  });

  it('the slow carries the designed numbers (50% for ~15s)', () => {
    const sim = warriorAtCap(21);
    sim.pickRowTalent(0, CRUSH);
    const mob = nearestMob(sim);
    standOff(sim, mob, 12);
    sim.targetEntity(mob.id);
    sim.castAbility('charge');
    const slow = mob.auras.find((a: any) => a.kind === 'slow');
    expect(slow?.value).toBe(0.5);
    expect(slow?.remaining).toBeCloseTo(15, 0);
    const root = mob.auras.find((a: any) => a.kind === 'root');
    expect(root?.remaining).toBeCloseTo(4, 0);
  });
});

describe('Anger Management (live option): rage generation', () => {
  it('scales ability rage: Charge grants 9 baseline, 10.35 talented', () => {
    const run = (pick: boolean) => {
      const sim = warriorAtCap(33);
      if (pick) expect(sim.pickRowTalent(3, ANGER)).toBe(true);
      const mob = nearestMob(sim);
      standOff(sim, mob, 12);
      sim.targetEntity(mob.id);
      sim.player.resource = 0;
      sim.castAbility('charge');
      return sim.player.resource;
    };
    // No-spec warrior stands in Battle Stance: +STANCE_RAGE_GEN (10%) multiplies
    // the ability-rage mint on top of Anger Management's 1.15x when picked.
    expect(run(false)).toBeCloseTo(9 * (1 + STANCE_RAGE_GEN));
    expect(run(true)).toBeCloseTo(9 * 1.15 * (1 + STANCE_RAGE_GEN));
  });

  it('scales auto-attack rage by 1.25x', () => {
    const run = (pick: boolean) => {
      const sim = warriorAtCap(33);
      if (pick) sim.pickRowTalent(3, ANGER);
      const mob = nearestMob(sim);
      sim.player.resource = 0;
      // ability null = the auto-attack mint path in dealDamage.
      (sim as any).dealDamage(sim.player, mob, 50, false, 'physical', null, 'hit');
      return sim.player.resource;
    };
    const base = rageFromDealing(50, MAX_LEVEL);
    // No-spec warrior stands in Battle Stance: +STANCE_RAGE_GEN (10%) multiplies
    // the auto-attack mint on top of Anger Management's 1.25x when picked.
    expect(run(false)).toBeCloseTo(base * (1 + STANCE_RAGE_GEN));
    expect(run(true)).toBeCloseTo(base * 1.25 * (1 + STANCE_RAGE_GEN));
  });
});

describe('shared combat primitives', () => {
  it('buff_dmg_done amplifies outgoing damage additively', () => {
    const sim = warriorAtCap(5);
    const mob = nearestMob(sim);
    const p = sim.player;
    // Small hits so the starter-zone mob survives both measurements.
    expect(mob.hp).toBeGreaterThan(30);
    const hp0 = mob.hp;
    (sim as any).dealDamage(p, mob, 10, false, 'physical', null, 'hit', true);
    const plain = hp0 - mob.hp;
    p.auras.push({
      id: 'test_amp',
      name: 'Test Amp',
      kind: 'buff_dmg_done',
      value: 0.2,
      remaining: 10,
      duration: 10,
      sourceId: p.id,
      school: 'physical',
    });
    const hp1 = mob.hp;
    (sim as any).dealDamage(p, mob, 10, false, 'physical', null, 'hit', true);
    const buffed = hp1 - mob.hp;
    expect(plain).toBe(10);
    expect(buffed).toBe(12);
  });

  it('buff_crit raises critChance through recalcPlayerStats and only while worn', () => {
    const sim = warriorAtCap(5);
    const p = sim.player;
    const meta = metaOf(sim);
    const base = p.critChance;
    p.auras.push({
      id: 'test_crit',
      name: 'Test Crit',
      kind: 'buff_crit',
      value: 0.2,
      remaining: 10,
      duration: 10,
      sourceId: p.id,
      school: 'physical',
    });
    recalcPlayerStats(p, meta.cls, meta.equipment, meta.talentMods, meta.equipmentInstance);
    expect(p.critChance).toBeCloseTo(base + 0.2);
    p.auras.pop();
    recalcPlayerStats(p, meta.cls, meta.equipment, meta.talentMods, meta.equipmentInstance);
    expect(p.critChance).toBeCloseTo(base);
  });
});

describe('persistence', () => {
  it('round-trips row picks and re-bakes their effects on load', () => {
    const sim = warriorAtCap(11);
    sim.pickRowTalent(0, CRUSH);
    sim.pickRowTalent(3, ANGER);
    const state = sim.serializeCharacter(sim.player.id)!;
    expect(state.rowPicks?.[0]).toBe(CRUSH);
    expect(state.rowPicks?.[3]).toBe(ANGER);

    const s2 = new Sim({ seed: 11, playerClass: 'warrior', noPlayer: true });
    const pid = s2.addPlayer('warrior', 'Resto', { state });
    const meta2 = (s2 as any).players.get(pid);
    expect(meta2.rowPicks[0]).toBe(CRUSH);
    expect(meta2.talentMods.abilities.charge.addEffects).toHaveLength(2);
    expect(meta2.talentMods.global.autoRagePct).toBeCloseTo(0.25);
  });

  it('sanitizes garbage and above-level picks on load', () => {
    const sim = warriorAtCap(11);
    const state = sim.serializeCharacter(sim.player.id)!;
    state.level = 10; // rows 3+ (levels 14/17/20) locked
    state.rowPicks = ['garbage_id', null, null, ANGER, null, null];
    const s2 = new Sim({ seed: 11, playerClass: 'warrior', noPlayer: true });
    const pid = s2.addPlayer('warrior', 'Resto', { state });
    const meta2 = (s2 as any).players.get(pid);
    expect(meta2.rowPicks.every((p: string | null) => p === null)).toBe(true);
    expect(meta2.talentMods.global.autoRagePct).toBe(0);
  });
});

describe('fiesta standardize/restore', () => {
  it('excludes row effects during the bout and restores them on exit', () => {
    const sim = warriorAtCap(9);
    sim.pickRowTalent(0, CRUSH);
    const meta = metaOf(sim);
    expect(meta.talentMods.abilities.charge.addEffects).toHaveLength(2);
    fiestaStandardize((sim as any).ctx, meta, sim.player);
    expect(meta.talentMods.abilities.charge?.addEffects ?? []).toHaveLength(0);
    fiestaRestoreChar(meta, sim.player);
    expect(meta.talentMods.abilities.charge.addEffects).toHaveLength(2);
  });
});

describe('determinism', () => {
  it('same seed + same picks give an identical world after 100 ticks', () => {
    const run = () => {
      const sim = warriorAtCap(13);
      sim.pickRowTalent(0, CRUSH);
      sim.pickRowTalent(3, ANGER);
      for (let i = 0; i < 100; i++) sim.tick();
      const p = sim.player;
      return {
        pos: { x: p.pos.x, z: p.pos.z },
        hp: p.hp,
        resource: p.resource,
        entities: sim.entities.size,
      };
    };
    expect(run()).toEqual(run());
  });
});
