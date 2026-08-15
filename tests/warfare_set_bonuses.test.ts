// Phase 1 of the WARFARE tier refactor: the engine seams that let a set bonus be
// expressed as WARFARE rating, as reduced crowd-control duration, and as a proc
// that only fires against hostile players. Everything here is additive and inert
// until phase 2 authors a set that uses it, so these tests drive the seams with a
// synthetic set rather than shipped content.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleDeath } from '../src/sim/combat/damage';
import { applySetProcs } from '../src/sim/combat/set_procs';
import { aggregateSetBonuses, ITEM_SETS } from '../src/sim/content/item_sets';
import { ITEMS } from '../src/sim/data';
import { createPlayer, recalcPlayerStats } from '../src/sim/entity';
import { PVP_DEFENSE_CAP, PVP_OFFENSE_CAP, pvpFractionsFromRatings } from '../src/sim/pvp';
import { Sim } from '../src/sim/sim';
import type { CrowdControlDrCategory, Entity, EquipSlot, ItemSet, SetProc } from '../src/sim/types';

const PROBE_SET = 'warfare_phase1_probe';
const counts = (m: Record<string, number>) => new Map(Object.entries(m));

// Injected into the live catalog and removed again, so the seam is exercised
// without depending on content phase 2 has not authored yet.
function injectSet(bonuses: ItemSet['bonuses']): void {
  ITEM_SETS[PROBE_SET] = { id: PROBE_SET, name: 'Phase One Probe', bonuses };
}

const WARFARE_ARMOR = [
  'furyforged_warhelm',
  'furyforged_warspaulders',
  'furyforged_warplate',
  'furyforged_girdle',
  'furyforged_legguards',
  'furyforged_gauntlets',
  'furyforged_sabatons',
] as const;

const WARFARE_KIT: Partial<Record<EquipSlot, string>> = {
  mainhand: 'final_argument_greatblade',
  helmet: WARFARE_ARMOR[0],
  shoulder: WARFARE_ARMOR[1],
  chest: WARFARE_ARMOR[2],
  waist: WARFARE_ARMOR[3],
  legs: WARFARE_ARMOR[4],
  gloves: WARFARE_ARMOR[5],
  feet: WARFARE_ARMOR[6],
  neck: 'final_oath_medallion',
  ring1: 'iron_vow_band',
  ring2: 'unbroken_circle',
};

// Phase 2 gave these pieces a REAL set tag (warfare_furyforged), so both helpers
// below have to save and restore it rather than deleting unconditionally: an
// unconditional delete would strip the shipped tag for the rest of the file and
// quietly change what every later case measures.
const savedSetTags = new Map<string, string | undefined>();
function rememberTag(id: string): void {
  if (!savedSetTags.has(id)) savedSetTags.set(id, (ITEMS[id] as { set?: string }).set);
}

function tagArmorWithProbeSet(): void {
  for (const id of WARFARE_ARMOR) {
    rememberTag(id);
    (ITEMS[id] as { set?: string }).set = PROBE_SET;
  }
}

/** Measure the gear WITHOUT its shipped set, so a case about gear alone is about gear alone. */
function untagShippedSet(): void {
  for (const id of WARFARE_ARMOR) {
    rememberTag(id);
    delete (ITEMS[id] as { set?: string }).set;
  }
}

function geared(equipment: Partial<Record<EquipSlot, string>>): Entity {
  const e = createPlayer(0, 'warrior', { x: 0, y: 0, z: 0 }, '');
  e.level = 20;
  recalcPlayerStats(e, 'warrior', equipment as never, undefined, {});
  return e;
}

afterEach(() => {
  delete ITEM_SETS[PROBE_SET];
  for (const [id, tag] of savedSetTags) {
    if (tag === undefined) delete (ITEMS[id] as { set?: string }).set;
    else (ITEMS[id] as { set?: string }).set = tag;
  }
  savedSetTags.clear();
  vi.restoreAllMocks();
});

describe('WARFARE set-bonus aggregation', () => {
  it('sums the WARFARE ratings across every met tier', () => {
    injectSet([
      { pieces: 2, effect: { pvpDefenseRating: 40 }, text: '' },
      { pieces: 4, effect: { pvpOffenseRating: 40 }, text: '' },
      { pieces: 7, effect: { pvpOffenseRating: 80, pvpDefenseRating: 80 }, text: '' },
    ]);
    // All three tiers met: ratings add, exactly like critRating and hasteRating.
    const full = aggregateSetBonuses(counts({ [PROBE_SET]: 7 }));
    expect(full.pvpOffenseRating).toBe(120);
    expect(full.pvpDefenseRating).toBe(120);
    // An unmet tier contributes nothing, so a partial set is a partial bonus.
    const partial = aggregateSetBonuses(counts({ [PROBE_SET]: 4 }));
    expect(partial.pvpOffenseRating).toBe(40);
    expect(partial.pvpDefenseRating).toBe(40);
    const belowFirst = aggregateSetBonuses(counts({ [PROBE_SET]: 1 }));
    expect(belowFirst.pvpOffenseRating).toBe(0);
    expect(belowFirst.pvpDefenseRating).toBe(0);
  });

  it('max-combines crowd-control reduction rather than summing it', () => {
    injectSet([
      { pieces: 2, effect: { ccDurationReduction: 0.15 }, text: '' },
      { pieces: 4, effect: { ccDurationReduction: 0.25 }, text: '' },
    ]);
    // Both tiers met. Summing would give 0.40; max-combining gives 0.25, which is
    // the rule castPushbackReduction and knockbackResistance already follow so two
    // sources can never stack toward immunity.
    expect(aggregateSetBonuses(counts({ [PROBE_SET]: 4 })).ccDurationReduction).toBe(0.25);
    expect(aggregateSetBonuses(counts({ [PROBE_SET]: 2 })).ccDurationReduction).toBe(0.15);
  });

  it('clamps crowd-control reduction into 0..1', () => {
    injectSet([{ pieces: 2, effect: { ccDurationReduction: 1.5 }, text: '' }]);
    expect(aggregateSetBonuses(counts({ [PROBE_SET]: 2 })).ccDurationReduction).toBe(1);
    delete ITEM_SETS[PROBE_SET];
    injectSet([{ pieces: 2, effect: { ccDurationReduction: -0.5 }, text: '' }]);
    expect(aggregateSetBonuses(counts({ [PROBE_SET]: 2 })).ccDurationReduction).toBe(0);
  });
});

describe('gear-plus-set WARFARE rating clamps exactly once', () => {
  it('caps the combined total instead of capping each source separately', () => {
    // Gear alone is under the cap, measured without the shipped set so this case
    // is about the gear-versus-set seam rather than about phase 2's own capstone.
    untagShippedSet();
    const gearOnly = geared(WARFARE_KIT);
    expect(gearOnly.stats.pvpOffense).toBeLessThan(PVP_OFFENSE_CAP);
    expect(gearOnly.stats.pvpDefense).toBeLessThan(PVP_DEFENSE_CAP);

    // A set contribution that is ALSO under the cap on its own.
    // Large enough that gear (182) plus set clears the 0.30 cap, small enough
    // that the set alone does not: that pairing is what makes the case decisive.
    const SET_RATING = 200;
    expect(pvpFractionsFromRatings(SET_RATING, SET_RATING).offense).toBeLessThan(PVP_OFFENSE_CAP);

    injectSet([
      {
        pieces: 7,
        effect: { pvpOffenseRating: SET_RATING, pvpDefenseRating: SET_RATING },
        text: '',
      },
    ]);
    tagArmorWithProbeSet();
    const combined = geared(WARFARE_KIT);

    // Together they exceed the cap, so the resolved fraction must BE the cap.
    // An implementation that resolved the set separately and added the two
    // fractions would land on gearOnly + 0.20 here, which is above the cap and
    // would disagree with the character sheet. That is the regression this pins.
    expect(combined.stats.pvpOffense).toBe(PVP_OFFENSE_CAP);
    expect(combined.stats.pvpDefense).toBe(PVP_DEFENSE_CAP);
    expect(combined.stats.pvpOffense).not.toBe(gearOnly.stats.pvpOffense + 0.2);
  });

  it('adds the set rating below the cap without clamping it away', () => {
    // The same seam under the cap: a small set bonus must actually raise the
    // fraction, so "clamps once" is not silently "ignores the set".
    untagShippedSet();
    const gearOnly = geared(WARFARE_KIT);
    injectSet([{ pieces: 7, effect: { pvpOffenseRating: 10 }, text: '' }]);
    tagArmorWithProbeSet();
    const combined = geared(WARFARE_KIT);
    expect(combined.stats.pvpOffense).toBeCloseTo(gearOnly.stats.pvpOffense + 0.01, 10);
    expect(combined.stats.pvpOffense).toBeLessThan(PVP_OFFENSE_CAP);
  });
});

describe('the crowd-control duration hook', () => {
  // EVERY member of CrowdControlDrCategory. Exhaustiveness is the point of this
  // sweep, so the list is pinned against the union below rather than hand-kept:
  // a new category added to types.ts without a case here would otherwise ship
  // unreduced and silently green.
  const CATEGORIES: CrowdControlDrCategory[] = [
    'root',
    'polymorph',
    'fear',
    'lockout',
    'openerStun',
    'controlledStun',
    'randomStun',
  ];

  function duelists(): { sim: Sim; source: Entity; target: Entity } {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const a = sim.addPlayer('warrior', 'Striker');
    const b = sim.addPlayer('mage', 'Struck');
    sim.duels.set(a, { a, b, state: 'active', timer: 0 });
    sim.duels.set(b, sim.duels.get(a)!);
    return { sim, source: sim.entities.get(a)!, target: sim.entities.get(b)! };
  }

  const cc = (sim: Sim, source: Entity, target: Entity, cat: CrowdControlDrCategory, dur: number) =>
    (
      sim as unknown as {
        diminishedCrowdControlDuration: (
          s: Entity,
          t: Entity,
          c: CrowdControlDrCategory,
          d: number,
        ) => number | null;
      }
    ).diminishedCrowdControlDuration(source, target, cat, dur);

  it('sweeps every crowd-control category the union declares', () => {
    // A compile-time exhaustiveness check would be erased at runtime, so pin the
    // list against the type's own members by construction: every key here must be
    // assignable, and the count must match what types.ts declares.
    const declared: Record<CrowdControlDrCategory, true> = {
      root: true,
      polymorph: true,
      fear: true,
      lockout: true,
      openerStun: true,
      controlledStun: true,
      randomStun: true,
    };
    expect([...CATEGORIES].sort()).toEqual(Object.keys(declared).sort());
  });

  it.each(CATEGORIES)('reduces %s duration, not just the generic ladder exit', (category) => {
    const { sim, source, target } = duelists();
    // Baseline first with no reduction, then the same category again from a clean
    // DR state. Comparing against the measured baseline rather than restating the
    // ladder's own formula is what makes this decisive per category: stuns take an
    // early return that exempts them from the ladder but NOT from this reduction,
    // and an implementation applying the cut at the generic exit alone passes a
    // root-only test while silently missing them.
    target.ccDurationReduction = 0;
    const baseline = cc(sim, source, target, category, 6);
    expect(baseline).not.toBeNull();

    target.ccDr.clear();
    target.ccDurationReduction = 0.5;
    const reduced = cc(sim, source, target, category, 6);
    expect(reduced).toBeCloseTo((baseline as number) * 0.5, 10);
    expect(reduced).toBeLessThan(baseline as number);
  });

  it('leaves a player-versus-mob application untouched', () => {
    const { sim, source } = duelists();
    const mob = [...sim.entities.values()].find((e) => e.kind === 'mob')!;
    mob.ccDurationReduction = 0.5;
    // The PvE path takes the non-hostile-pair early return, so the full authored
    // duration lands regardless of what the mob carries.
    expect(cc(sim, source, mob, 'root', 6)).toBe(6);
    expect(cc(sim, source, mob, 'openerStun', 6)).toBe(6);
  });

  it('returns null unchanged when the target is already DR-immune', () => {
    const { sim, source, target } = duelists();
    target.ccDurationReduction = 0.5;
    // Walk the root ladder past its last stage; null means "immune, apply
    // nothing" and must pass straight through. Multiplying it would be a type
    // error at best and a silently un-applied aura at worst.
    let last: number | null = 6;
    for (let i = 0; i < 12 && last !== null; i++) last = cc(sim, source, target, 'root', 6);
    expect(last).toBeNull();
  });
});

describe('pvpOnly set procs', () => {
  const ABSORB_PROC: SetProc = {
    id: 'phase1_probe_absorb',
    name: 'Probe Ward',
    trigger: 'kill',
    chance: 1,
    aura: 'absorb',
    duration: 8,
    value: 100,
    pvpOnly: true,
  };

  function world(): { sim: Sim; a: Entity; b: Entity } {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pa = sim.addPlayer('warrior', 'Victor');
    const pb = sim.addPlayer('mage', 'Fallen');
    sim.duels.set(pa, { a: pa, b: pb, state: 'active', timer: 0 });
    sim.duels.set(pb, sim.duels.get(pa)!);
    return { sim, a: sim.entities.get(pa)!, b: sim.entities.get(pb)! };
  }

  it('fires against a hostile player', () => {
    const { sim, a, b } = world();
    a.setProcs = [ABSORB_PROC];
    applySetProcs(sim.ctx, a, b, 'kill');
    expect(a.auras.some((aura) => aura.id === ABSORB_PROC.id)).toBe(true);
  });

  it('does not fire against a mob, and draws no rng doing so', () => {
    const { sim, a } = world();
    const mob = [...sim.entities.values()].find((e) => e.kind === 'mob')!;
    a.setProcs = [ABSORB_PROC];
    // The gate sits BEFORE the chance roll on purpose: a gated proc must not
    // consume a draw outside hostile PvP, or every PvE run forks the shared
    // stream and the parity goldens move.
    const chance = vi.spyOn(sim.rng, 'chance');
    applySetProcs(sim.ctx, a, mob, 'kill');
    expect(chance).not.toHaveBeenCalled();
    expect(a.auras.some((aura) => aura.id === ABSORB_PROC.id)).toBe(false);
  });

  it('does not fire on a friendly player or on itself', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pa = sim.addPlayer('warrior', 'Solo');
    const pb = sim.addPlayer('priest', 'Ally');
    const a = sim.entities.get(pa)!;
    const b = sim.entities.get(pb)!;
    a.setProcs = [ABSORB_PROC];
    const chance = vi.spyOn(sim.rng, 'chance');
    applySetProcs(sim.ctx, a, b, 'kill'); // not hostile: no duel between them
    applySetProcs(sim.ctx, a, a, 'kill'); // self
    expect(chance).not.toHaveBeenCalled();
    expect(a.auras.some((aura) => aura.id === ABSORB_PROC.id)).toBe(false);
  });

  it('leaves an ungated proc firing in PvE exactly as before', () => {
    const { sim, a } = world();
    const mob = [...sim.entities.values()].find((e) => e.kind === 'mob')!;
    const { pvpOnly: _drop, ...ungated } = ABSORB_PROC;
    a.setProcs = [ungated as SetProc];
    applySetProcs(sim.ctx, a, mob, 'kill');
    expect(a.auras.some((aura) => aura.id === ABSORB_PROC.id)).toBe(true);
  });
});

describe('the kill trigger dispatch', () => {
  const KILL_PROC: SetProc = {
    id: 'phase1_probe_killward',
    name: 'Probe Killward',
    trigger: 'kill',
    chance: 1,
    aura: 'absorb',
    duration: 8,
    value: 100,
  };

  function world(): { sim: Sim; killer: Entity; victim: Entity } {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pa = sim.addPlayer('warrior', 'Killer');
    const pb = sim.addPlayer('mage', 'Victim');
    sim.duels.set(pa, { a: pa, b: pb, state: 'active', timer: 0 });
    sim.duels.set(pb, sim.duels.get(pa)!);
    return { sim, killer: sim.entities.get(pa)!, victim: sim.entities.get(pb)! };
  }

  it('fires for a hostile player kill', () => {
    const { sim, killer, victim } = world();
    killer.setProcs = [KILL_PROC];
    handleDeath(sim.ctx, victim, killer);
    expect(killer.auras.some((a) => a.id === KILL_PROC.id)).toBe(true);
  });

  it('does not fire on a self-kill', () => {
    const { sim, killer } = world();
    killer.setProcs = [KILL_PROC];
    handleDeath(sim.ctx, killer, killer);
    expect(killer.auras.some((a) => a.id === KILL_PROC.id)).toBe(false);
  });

  it('does not fire when the killer is absent', () => {
    const { sim, killer, victim } = world();
    killer.setProcs = [KILL_PROC];
    handleDeath(sim.ctx, victim, null);
    expect(killer.auras.some((a) => a.id === KILL_PROC.id)).toBe(false);
  });

  it('does not fire when the killer died in the same tick', () => {
    const { sim, killer, victim } = world();
    killer.setProcs = [KILL_PROC];
    killer.dead = true;
    handleDeath(sim.ctx, victim, killer);
    expect(killer.auras.some((a) => a.id === KILL_PROC.id)).toBe(false);
  });

  it('draws no rng for a character carrying no kill proc', () => {
    const { sim, killer, victim } = world();
    killer.setProcs = [];
    // The early return in applySetProcs is what keeps every shipped character's
    // rng stream byte-identical across this new dispatch. No shipped set declares
    // a kill proc, so this is the case that must not move.
    const chance = vi.spyOn(sim.rng, 'chance');
    handleDeath(sim.ctx, victim, killer);
    expect(chance).not.toHaveBeenCalled();
  });
});
