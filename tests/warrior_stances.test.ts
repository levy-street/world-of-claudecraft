// Restored from the pre-revert payload (f274835b1^) and adapted to the current
// APIs. The payload's stanceBarView describe is NOT restored here: the live
// tests/stance_bar_view.test.ts already covers that render model decisively.
import { describe, expect, it } from 'vitest';
import {
  availableWarriorStanceKinds,
  BATTLE_STANCE,
  BERSERKER_STANCE,
  DEFENSIVE_STANCE,
  defaultWarriorStanceId,
  isWarriorStanceKind,
  WARRIOR_STANCE_IDS,
  warriorStanceReconcile,
} from '../src/sim/combat/warrior_stances';
import { ABILITIES } from '../src/sim/content/classes';
import { Sim } from '../src/sim/sim';
import { berserkerCritDamage, rageGenAuraMult } from '../src/sim/types';

// Warrior combat stances (owner design 2026-07-08): a warrior always lives in
// exactly one stance valid for their spec. Battle = Arms/Prot/no-spec offensive
// default (+10% rage); Guarded = Arms/Prot defensive; Berserker = Fury-only
// offensive default (+3% crit chance, +3% crit damage, no downside). Stances are
// mutually exclusive (exclusiveGroup 'warrior_stance') and auto-applied and
// reconciled each player-tick.

const makeSim = (seed = 42): Sim => new Sim({ seed, playerClass: 'warrior', autoEquip: true });
const stanceAuras = (sim: Sim) => sim.player.auras.filter((a) => isWarriorStanceKind(a.kind));

describe('warrior stance pure core', () => {
  it('exposes exactly the three stance ids/kinds', () => {
    expect([...WARRIOR_STANCE_IDS].sort()).toEqual(
      [BATTLE_STANCE, BERSERKER_STANCE, DEFENSIVE_STANCE].sort(),
    );
    expect(isWarriorStanceKind('battle_stance')).toBe(true);
    expect(isWarriorStanceKind('berserker_stance')).toBe(true);
    expect(isWarriorStanceKind('defensive_stance')).toBe(true);
    expect(isWarriorStanceKind('stealth')).toBe(false);
  });

  it('maps each spec to its available stances and default', () => {
    expect(availableWarriorStanceKinds('fury')).toEqual(['berserker_stance']);
    expect(availableWarriorStanceKinds('arms')).toEqual(['battle_stance', 'defensive_stance']);
    expect(availableWarriorStanceKinds('prot')).toEqual(['battle_stance', 'defensive_stance']);
    expect(availableWarriorStanceKinds(null)).toEqual(['battle_stance']);
    expect(defaultWarriorStanceId('fury')).toBe(BERSERKER_STANCE);
    expect(defaultWarriorStanceId('arms')).toBe(BATTLE_STANCE);
    expect(defaultWarriorStanceId(null)).toBe(BATTLE_STANCE);
  });

  it('reconciles: keep a valid stance, else drop invalid and apply the default', () => {
    // Fresh (no stance) -> gain the spec default, nothing to remove.
    expect(warriorStanceReconcile(null, [])).toEqual({ removeKinds: [], applyId: BATTLE_STANCE });
    expect(warriorStanceReconcile('fury', [])).toEqual({
      removeKinds: [],
      applyId: BERSERKER_STANCE,
    });
    // Already in a valid stance -> no change.
    expect(warriorStanceReconcile(null, ['battle_stance'])).toEqual({
      removeKinds: [],
      applyId: null,
    });
    expect(warriorStanceReconcile('arms', ['defensive_stance'])).toEqual({
      removeKinds: [],
      applyId: null,
    });
    expect(warriorStanceReconcile('fury', ['berserker_stance'])).toEqual({
      removeKinds: [],
      applyId: null,
    });
    // Worn stance invalid for the new spec -> strip it, apply the default.
    expect(warriorStanceReconcile('fury', ['battle_stance'])).toEqual({
      removeKinds: ['battle_stance'],
      applyId: BERSERKER_STANCE,
    });
    expect(warriorStanceReconcile('arms', ['berserker_stance'])).toEqual({
      removeKinds: ['berserker_stance'],
      applyId: BATTLE_STANCE,
    });
  });
});

describe('stance ability defs match the pure gating', () => {
  it('gates Battle (exclude Fury), Berserker (Fury), Guarded (Arms/Prot); one group', () => {
    expect(ABILITIES.battle_stance?.excludeSpecs).toEqual(['fury']);
    expect(ABILITIES.battle_stance?.specs).toBeUndefined();
    expect(ABILITIES.berserker_stance?.specs).toEqual(['fury']);
    expect(ABILITIES.defensive_stance?.specs).toEqual(['arms', 'prot']);
    for (const id of WARRIOR_STANCE_IDS) {
      expect(ABILITIES[id]?.exclusiveGroup, id).toBe('warrior_stance');
      const eff = ABILITIES[id]?.effects.find((e) => e.type === 'selfBuff');
      expect(eff, id).toBeTruthy();
      expect(eff?.type === 'selfBuff' && eff.kind, id).toBe(id);
    }
  });
});

describe('warrior stances in the live sim', () => {
  it('auto-applies Battle Stance to a fresh (no-spec) warrior, exactly one stance', () => {
    const sim = makeSim();
    sim.tick();
    const worn = stanceAuras(sim);
    expect(worn.length).toBe(1);
    expect(worn[0].kind).toBe('battle_stance');
    // Battle Stance grants +10% rage generation at every mint site.
    expect(rageGenAuraMult(sim.player)).toBeCloseTo(1.1, 5);
    expect(berserkerCritDamage(sim.player)).toBe(0);
  });

  it('Fury lives in Berserker Stance (crit damage on, no Battle rage bonus)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    expect(sim.setSpec('fury')).toBe(true);
    sim.tick();
    const worn = stanceAuras(sim);
    expect(worn.length).toBe(1);
    expect(worn[0].kind).toBe('berserker_stance');
    // Berserker's crit-damage half is live; Fury does NOT get Battle's rage bonus.
    expect(berserkerCritDamage(sim.player)).toBeCloseTo(0.03, 5);
    expect(rageGenAuraMult(sim.player)).toBeCloseTo(1, 5);
  });

  it('Berserker Stance folds +3% crit chance in recalcPlayerStats', () => {
    // Isolated from Fury spec bonuses: apply the aura to a no-spec warrior and
    // let applyAura re-run recalc, so the delta is purely the stance fold.
    const sim = makeSim();
    sim.setPlayerLevel(20);
    sim.tick();
    const crit0 = sim.player.critChance;
    (sim as unknown as { applyAura: (p: unknown, a: unknown) => void }).applyAura(sim.player, {
      id: 'berserker_stance',
      name: 'Berserker Stance',
      kind: 'berserker_stance',
      remaining: 3600,
      duration: 3600,
      value: 0,
      sourceId: sim.player.id,
      school: 'physical',
    });
    expect(sim.player.critChance).toBeCloseTo(crit0 + 0.03, 5);
  });

  it('Arms swaps Battle <-> Guarded via the exclusive group', () => {
    const sim = makeSim();
    sim.tick();
    sim.setPlayerLevel(20);
    expect(sim.setSpec('arms')).toBe(true);
    sim.tick();
    expect(stanceAuras(sim).map((a) => a.kind)).toEqual(['battle_stance']);
    // Cast Guarded: it cancels Battle (never both), staying exactly one stance.
    sim.castAbility('defensive_stance');
    sim.tick();
    expect(stanceAuras(sim).map((a) => a.kind)).toEqual(['defensive_stance']);
    // Cast Battle again: swaps back.
    sim.castAbility('battle_stance');
    sim.tick();
    expect(stanceAuras(sim).map((a) => a.kind)).toEqual(['battle_stance']);
  });

  it('reconciles the worn stance when the spec changes (Fury -> Arms)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    expect(sim.setSpec('fury')).toBe(true);
    sim.tick();
    expect(stanceAuras(sim).map((a) => a.kind)).toEqual(['berserker_stance']);
    // Respec to Arms: Berserker is now invalid, reconciled to Battle next tick.
    expect(sim.setSpec('arms')).toBe(true);
    sim.tick();
    expect(stanceAuras(sim).map((a) => a.kind)).toEqual(['battle_stance']);
  });
});
