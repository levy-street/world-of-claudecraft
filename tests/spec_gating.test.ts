import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import {
  computeTalentModifiers,
  emptyAllocation,
  type TalentAllocation,
} from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';

// Spec-gated base kit (operator design, 2026-07-07): some warrior base
// abilities belong to specific specializations. A player who has not yet
// committed to a spec keeps the full kit; once a spec is chosen, abilities
// whose `specs` list excludes it drop out of the known list (and with it the
// spellbook, the action bar resolve, and the server cast path, which all read
// meta.known). Talent/row GRANTS are never spec-filtered here: the tree they
// come from is already spec-scoped.

const alloc = (spec: string | null): TalentAllocation => ({
  ...emptyAllocation(),
  spec,
});

const mods = (spec: string | null) => computeTalentModifiers('warrior', alloc(spec));

const knownIds = (spec: string | null, level = 20): Set<string> =>
  new Set(abilitiesKnownAt('warrior', level, mods(spec)).map((k) => k.def.id));

// The locked gating table: ability id -> specs that keep it.
const GATED: Record<string, string[]> = {
  defensive_stance: ['arms', 'prot'],
  sunder_armor: ['prot'], // Arms restructure 2026-07-08: Armor Shear is prot-only now
  thunder_clap: ['prot'], // Quaking Blow gated to prot 2026-07-08 (was ungated)
  // commanding_shout (Bolstering Cry) was RETIRED from the warrior kit 2026-07-08
  // like rend: its def still carries specs ['prot'], but no warrior learns it (it
  // is in no kit list), so it stays HIDDEN for every spec below (incl. prot).
  commanding_shout: ['prot'],
  demoralizing_shout: ['prot'],
  // rend (Deep Gash) was retired from the warrior kit 2026-07-08; its ABILITIES def
  // still carries specs ['arms'], but no warrior learns it (it is in no kit list), so
  // it stays HIDDEN for every spec below.
  rend: ['arms'],
  // overpower (Redhand) became a BASELINE rage spender (all specs, level 2) on
  // 2026-07-09, so it is no longer spec-gated and is not listed here.
  slam: ['arms'], // Brute Swing dropped from prot 2026-07-08 (prot uses Revenge)
  cleave: ['arms'], // removed from prot 2026-07-08; prot uses Revenge
  revenge: ['prot'], // prot-only, replaces Reaver Strike (heroic_strike) for prot
  bloodrage: ['arms', 'prot'], // Fury replaces it with its signature (Bloodletting)
};

describe('spec-gated warrior base kit (content table)', () => {
  it('every gated ability declares exactly the approved specs', () => {
    for (const [id, specs] of Object.entries(GATED)) {
      expect(ABILITIES[id]?.specs, id).toEqual(specs);
    }
  });

  it('ungated staples carry no specs field', () => {
    for (const id of ['heroic_strike', 'battle_shout', 'charge', 'execute', 'taunt']) {
      expect(ABILITIES[id]?.specs, id).toBeUndefined();
    }
  });

  it('Reaver Strike is excluded from all three committed specs via excludeSpecs, and Revenge is prot-only', () => {
    // heroic_strike stays ungated (no `specs`) but drops out for EVERY committed
    // spec: prot uses Revenge, arms leans on Maiming/Brute strikes, and fury (owner
    // 2026-07-08) dropped it for Bloodletting/Twinstrike. Only no-spec keeps it.
    expect(ABILITIES.heroic_strike?.specs).toBeUndefined();
    expect(ABILITIES.heroic_strike?.excludeSpecs).toEqual(['prot', 'arms', 'fury']);
    // revenge is the prot replacement.
    expect(ABILITIES.revenge?.specs).toEqual(['prot']);
    expect(ABILITIES.revenge?.excludeSpecs).toBeUndefined();
  });

  it('Redhand hands off for Fury at 10 (owner 2026-07-10): kept while it is the only spender, retired when Red Harvest lands', () => {
    expect(ABILITIES.overpower?.specs).toBeUndefined();
    expect(ABILITIES.overpower?.excludeSpecs).toEqual(['fury']);
    // The hand-off is pinned to Red Harvest's arrival: Bloodletting/Twinstrike
    // cost 0, so through 5-9 Redhand is committed Fury's only real rage spender.
    expect(ABILITIES.overpower?.excludeSpecsAtLevel).toBe(ABILITIES.red_harvest.learnLevel);
    expect(knownIds('fury', 5).has('overpower')).toBe(true);
    expect(knownIds('fury', 9).has('overpower')).toBe(true);
    expect(knownIds('fury', 10).has('overpower')).toBe(false);
    expect(knownIds('fury').has('overpower')).toBe(false); // and stays gone at 20
    // no-spec keeps it as the early rage spender; Arms and Prot keep it committed.
    expect(knownIds(null).has('overpower')).toBe(true);
    expect(knownIds('arms').has('overpower')).toBe(true);
    expect(knownIds('prot').has('overpower')).toBe(true);
  });
});

describe('abilitiesKnownAt spec filter', () => {
  it('no spec chosen: only the shared base kit, every spec-exclusive is hidden', () => {
    const ids = knownIds(null);
    for (const id of Object.keys(GATED)) expect(ids.has(id), id).toBe(false);
    // the ungated base kit stays available before a spec is committed
    for (const id of ['heroic_strike', 'battle_shout', 'charge', 'execute', 'taunt']) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('fury loses every arms/prot exclusive (incl. Blood Toll, replaced by its signature) and Reaver Strike', () => {
    const ids = knownIds('fury');
    for (const id of Object.keys(GATED)) expect(ids.has(id), id).toBe(false);
    // Reaver Strike (heroic_strike) now excludes fury too (owner 2026-07-08).
    expect(ids.has('heroic_strike')).toBe(false);
    expect(ids.has('bloodthirst')).toBe(true); // the signature grant is untouched
  });

  it('arms keeps its own exclusives but not the prot-only kit or the shared strikes', () => {
    const ids = knownIds('arms');
    for (const id of ['defensive_stance', 'overpower', 'slam', 'cleave']) {
      expect(ids.has(id), id).toBe(true);
    }
    // Armor Shear (sunder) and Quaking Blow (thunder_clap) are prot-only now; Deep
    // Gash (rend) was retired from the kit; and Reaver Strike (heroic_strike) now
    // excludes arms too (excludeSpecs ['prot','arms']).
    for (const id of [
      'commanding_shout',
      'demoralizing_shout',
      'revenge',
      'sunder_armor',
      'thunder_clap',
      'rend',
      'heroic_strike',
    ]) {
      expect(ids.has(id), id).toBe(false);
    }
    expect(ids.has('bloodrage')).toBe(true);
  });

  it('prot keeps tank staples and Revenge but not Reaver Strike, Reaping Arc, retired/arms strikes', () => {
    const ids = knownIds('prot');
    for (const id of [
      'defensive_stance',
      'sunder_armor',
      'thunder_clap',
      'demoralizing_shout',
      'revenge',
      'bloodrage',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
    // Reaver Strike (excludeSpecs prot), Reaping Arc (arms-only now), the arms-only
    // strikes, plus Bolstering Cry (commanding_shout) and Brute Swing (slam) which
    // prot dropped 2026-07-08, all stay out for committed prot.
    for (const id of ['heroic_strike', 'cleave', 'rend', 'commanding_shout', 'slam']) {
      expect(ids.has(id), id).toBe(false);
    }
  });

  it('excludeSpecs: only no-spec keeps Reaver Strike; every committed spec lacks it, and only prot gains Revenge', () => {
    // No spec keeps Reaver Strike and does not see Revenge.
    const nospec = knownIds(null);
    expect(nospec.has('heroic_strike')).toBe(true);
    expect(nospec.has('revenge')).toBe(false);
    // Every committed spec now excludes Reaver Strike (excludeSpecs ['prot','arms','fury']).
    for (const spec of ['arms', 'fury', 'prot'] as const) {
      expect(knownIds(spec).has('heroic_strike'), `${spec} heroic_strike`).toBe(false);
    }
    // Revenge is prot-only: arms and fury do not gain it; prot does.
    expect(knownIds('arms').has('revenge')).toBe(false);
    expect(knownIds('fury').has('revenge')).toBe(false);
    expect(knownIds('prot').has('revenge')).toBe(true);
  });

  it('a talent grant bypasses the spec filter (grants are already spec-scoped)', () => {
    // Simulate a grant of a gated ability: even under fury, a grant wins.
    const m = mods('fury');
    m.grants.push({ ability: 'rend', rank: 1 });
    const ids = new Set(abilitiesKnownAt('warrior', 20, m).map((k) => k.def.id));
    expect(ids.has('rend')).toBe(true);
  });
});

describe('spec gating end to end in the sim', () => {
  it('a no-spec warrior lacks the arms-only Die by the Sword; arms grants it in the known list and cast resolve, fury never does', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    // No committed spec: the arms-only Die by the Sword is hidden and unresolvable.
    // (Deep Gash / rend was retired from the kit 2026-07-08, so this exercises the
    // gating through a live arms-only ability instead.)
    expect(sim.known.some((k) => k.def.id === 'die_by_sword')).toBe(false);
    expect(sim.resolvedAbility('die_by_sword')).toBeNull();
    // Committing arms reveals it in the known list AND the cast resolve.
    expect(sim.setSpec('arms')).toBe(true);
    expect(sim.known.some((k) => k.def.id === 'die_by_sword')).toBe(true);
    expect(sim.resolvedAbility('die_by_sword')).not.toBeNull();
    // Switching to fury drops it again (fury never keeps the arms-only kit).
    expect(sim.setSpec('fury')).toBe(true);
    expect(sim.known.some((k) => k.def.id === 'die_by_sword')).toBe(false);
    expect(sim.resolvedAbility('die_by_sword')).toBeNull();
    // Ungated staples survive every spec choice.
    expect(sim.known.some((k) => k.def.id === 'battle_shout')).toBe(true);
  });

  it('choosing prot keeps the tank kit and stays deterministic', () => {
    const run = () => {
      const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
      sim.setPlayerLevel(20);
      sim.setSpec('prot');
      for (let i = 0; i < 20 * 3; i++) sim.tick();
      return sim.known.map((k) => k.def.id).join(',');
    };
    const a = run();
    // Tank staple present; retired Bolstering Cry (commanding_shout) absent, but
    // Redhand (overpower) is now a baseline spender so prot has it too.
    expect(a).toContain('shield_slam');
    expect(a).not.toContain('commanding_shout');
    expect(a).toContain('overpower');
    expect(run()).toBe(a);
  });
});
