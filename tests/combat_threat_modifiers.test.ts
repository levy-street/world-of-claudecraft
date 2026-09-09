// Pins threat behavior through the live SimContext seam before and after extraction.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

function makeSim(cls: PlayerClass, seed = 42): Sim {
  return new Sim({ seed, playerClass: cls, autoEquip: true });
}

// A minimal stand-alone Entity `threatMod`/`threatModifier` can read without touching
// `sim.entities` or `sim.ctx.players`: only `.id`, `.kind`, and `.auras` are read on this
// path (see src/sim/threat.ts `threatModifier` and the `threatMod` body in sim.ts).
function entityStub(kind: Entity['kind'], id: number, auraKinds: string[] = []): Entity {
  return {
    id,
    kind,
    auras: auraKinds.map((auraKind) => ({ kind: auraKind })),
  } as unknown as Entity;
}

describe('Sim.threatMod (sim.ctx.threatMod)', () => {
  describe('aura/stance threat (threatModifier pass-through)', () => {
    it('multiplies threat for a non-player source carrying a form aura', () => {
      const sim = makeSim('warrior');
      const bear = entityStub('mob', 90001, ['form_bear']);
      expect(sim.ctx.threatMod(bear, 'physical')).toBe(1.3);
    });

    it('returns exactly 1 for a non-player source with no threat-relevant aura, any school', () => {
      const sim = makeSim('warrior');
      const plain = entityStub('mob', 90002, []);
      expect(sim.ctx.threatMod(plain, 'holy')).toBe(1);
    });
  });

  describe('non-player / missing player-meta fallback', () => {
    it('skips the player-meta branch entirely for a non-player kind, even with a real player registered', () => {
      const sim = makeSim('paladin');
      sim.setPlayerLevel(16);
      expect(sim.setSpec('protection')).toBe(true);
      // Reuse the real player's id so only the kind guard can exclude its bonuses.
      const mob = entityStub('mob', sim.playerId, ['form_bear']);
      expect(sim.ctx.threatMod(mob, 'holy')).toBe(1.3);
    });

    it('falls back to the bare aura modifier for a player-kind source absent from sim.ctx.players', () => {
      const sim = makeSim('warrior');
      // playerId 90004 is never registered via addPlayer/the ctor: this.players.get(id)
      // resolves to undefined, so the `if (meta)` guard must short-circuit cleanly.
      const ghost = entityStub('player', 90004, ['form_bear']);
      expect(sim.ctx.threatMod(ghost, 'physical')).toBe(1.3);
    });
  });

  describe('player talent threat (Protection mastery, real Sim/PlayerMeta state)', () => {
    it('applies only the mastery threatPct multiplier on a non-holy school', () => {
      const sim = makeSim('paladin');
      sim.setPlayerLevel(16);
      expect(sim.setSpec('protection')).toBe(true);
      // Oathward: threatPct 0.4 scaled by the level-16 mastery ramp (16/20) = 0.32,
      // giving 1.32 exactly (the same fixture tests/threat.test.ts's Burning Oath case
      // establishes independently). No righteous_fury bonus: school is physical.
      const protectionMasteryThreat = 1.32;
      expect(sim.ctx.threatMod(sim.player, 'physical')).toBeCloseTo(protectionMasteryThreat, 5);
    });

    it('still excludes the righteous_fury bonus on a non-holy, non-physical school (wrong school)', () => {
      const sim = makeSim('paladin');
      sim.setPlayerLevel(16);
      expect(sim.setSpec('protection')).toBe(true);
      const protectionMasteryThreat = 1.32;
      // Arcane is neither the melee-default 'physical' nor 'holy': confirms the
      // righteous_fury branch gates on the school STRING exactly, not on "any
      // non-physical school" or any other loose match.
      expect(sim.ctx.threatMod(sim.player, 'arcane')).toBeCloseTo(protectionMasteryThreat, 5);
    });
  });

  describe('Burning Oath (holy known-passive righteous_fury)', () => {
    it('multiplies holy threat by mastery AND the righteous_fury bonus when Burning Oath is known passive', () => {
      const sim = makeSim('paladin');
      sim.setPlayerLevel(16);
      expect(sim.setSpec('protection')).toBe(true);
      expect(sim.resolvedAbility('righteous_fury')?.def.passive).toBe(true);
      expect(sim.ctx.threatMod(sim.player, 'holy')).toBeCloseTo(1.716, 5);
    });

    it('does not apply the righteous_fury bonus when the known entry is not passive (control)', () => {
      const sim = makeSim('paladin');
      sim.setPlayerLevel(16);
      expect(sim.setSpec('protection')).toBe(true);
      // Real production PlayerMeta from the live seam (never a hand-rolled parallel
      // object), with ONLY the `passive` flag flipped on the real resolved
      // righteous_fury entry: isolates the `passive === true` gate from every other
      // read (threatPct, the id match) without risking a ctx-vs-Sim state mismatch.
      const meta = expectDefined(sim.ctx.players.get(sim.playerId));
      const idx = meta.known.findIndex((k) => k.def.id === 'righteous_fury');
      const original = expectDefined(meta.known[idx]);
      expect(original.def.passive).toBe(true);
      meta.known[idx] = { ...original, def: { ...original.def, passive: false } };
      const protectionMasteryThreat = 1.32;
      expect(sim.ctx.threatMod(sim.player, 'holy')).toBeCloseTo(protectionMasteryThreat, 5);
    });

    it('does not apply the righteous_fury bonus when Burning Oath is not known at all (absent-passive control)', () => {
      const sim = makeSim('paladin');
      sim.setPlayerLevel(16);
      // No setSpec call: righteous_fury is spec-gated to protection
      // (src/sim/content/classes.ts `specs: ['protection']`), so with no committed
      // spec it is absent from `known`, AND the Protection mastery's threatPct never
      // accrues (computeTalentModifiers only applies a spec's mastery effect when a
      // spec is actually chosen). Independent literal: exactly 1.
      expect(sim.resolvedAbility('righteous_fury')).toBeNull();
      expect(sim.ctx.threatMod(sim.player, 'holy')).toBe(1);
    });
  });
});

describe('threat calculation isolation', () => {
  it('combines aura, mastery, and holy passive bonuses without drawing randomness', () => {
    const sim = makeSim('paladin');
    sim.setPlayerLevel(16);
    expect(sim.setSpec('protection')).toBe(true);
    const source = entityStub('player', sim.playerId, ['form_bear']);
    const draws: number[] = [];
    sim.ctx.rng.setObserver((value) => draws.push(value));
    expect(sim.ctx.threatMod(source, 'physical')).toBeCloseTo(1.716, 5);
    expect(sim.ctx.threatMod(source, 'holy')).toBeCloseTo(2.2308, 5);
    expect(draws).toEqual([]);
  });

  it('uses the owning world even when another world has the same player id', () => {
    const protection = makeSim('paladin');
    protection.setPlayerLevel(16);
    expect(protection.setSpec('protection')).toBe(true);
    const unspecialized = makeSim('paladin');
    unspecialized.setPlayerLevel(16);
    expect(unspecialized.playerId).toBe(protection.playerId);
    expect(protection.ctx.threatMod(protection.player, 'holy')).toBeCloseTo(1.716, 5);
    expect(unspecialized.ctx.threatMod(unspecialized.player, 'holy')).toBe(1);
    expect(protection.ctx.threatMod(protection.player, 'holy')).toBeCloseTo(1.716, 5);
  });
});
