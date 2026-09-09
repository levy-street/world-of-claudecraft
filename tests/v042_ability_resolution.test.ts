// v0.42.0 class-balance world-resolution parity (docs/design/class-balance-v042.md):
// HUD/cross-hotbar/ClientWorld must show the SAME resolved ability
// Sim.resolvedAbility would produce (before Sim's own cost-tax/ascension/
// cast-time tail), via the shared chain in src/sim/combat/ability_resolution.ts.
// This suite drives a real Sim per scenario (real computed `known` array, real
// Entity, real precomputed TalentModifiers) and proves:
//   1. resolveAbilityChain reproduces Sim.resolvedAbility exactly for every
//      named v0.42.0 transform family.
//   2. Presentation metadata (outputScaling, incl. primaryHealing) is baked
//      exactly once on a transformed ability: never omitted, never doubled.
//   3. An untransformed sibling ability under the SAME aura state is left
//      byte-identical (a negative control per family).
import { describe, expect, it } from 'vitest';
import { resolveAbilityChain } from '../src/sim/combat/ability_resolution';
import { resolveActionReplacement } from '../src/sim/combat/action_replacement';
import {
  MINDFRACTURE_SPELL_POWER_COEFF,
  VESPERS_DOT_DAMAGE_MULT,
} from '../src/sim/combat/priest/vespers';
import { applyTalentMods } from '../src/sim/content/classes';
import {
  COLDSIGHT_2PC_MEASURED_SHOT_FOCUS_BONUS,
  setBonusFlag,
} from '../src/sim/content/ignivar_set_bonuses';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { type Aura, dist2d, type Entity, type PlayerClass } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function makeSim(cls: PlayerClass, spec: string | null, level: number, seed: number): Sim {
  const sim = new Sim({ seed, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(level);
  if (spec) expect(sim.setSpec(spec)).toBe(true);
  return sim;
}

function metaFor(sim: Sim): PlayerMeta {
  const meta = sim.players.get(sim.player.id);
  if (!meta) throw new Error('expected a player meta for the primary player');
  return meta;
}

function knownEntry(sim: Sim, id: string) {
  const known = sim.known.find((k) => k.def.id === id);
  if (!known) throw new Error(`expected ${id} to be known`);
  return known;
}

/** Stamp a bare aura of `kind` (optionally stacked) onto an entity, matching
 *  the shape resolveActionReplacement/resolveColdsightAbility/etc. read: kind
 *  and stacks are all any of them check. */
function addAura(entity: Entity, kind: Aura['kind'], stacks?: number): void {
  entity.auras.push({
    id: `test_${kind}`,
    name: kind,
    kind,
    remaining: 999,
    duration: 999,
    value: 0,
    stacks,
    sourceId: entity.id,
    school: 'physical',
  });
}

// The core parity assertion: resolveAbilityChain, fed exactly what a display
// caller (ClientWorld.resolvedAbility, HUD.abilityForSlot) would have on hand,
// matches Sim's own authoritative resolvedAbility() for the same ability. None
// of the abilities exercised below touch Sim's cost-tax/ascension/cast-time
// tail (draining curse, arcane_surge, and Divine Ascension/Radiant Resonance
// are warrior/mage/paladin-only), so the two must agree exactly.
function assertMatchesSimResolve(sim: Sim, requestedId: string): void {
  const meta = metaFor(sim);
  const mods = sim.playerMods(meta);
  const known = knownEntry(sim, requestedId);
  const resolved = resolveAbilityChain(known, sim.player, meta, mods);
  expect(resolved).toEqual(sim.resolvedAbility(requestedId));
}

describe('Vespers: Dirge of Decay (shadow_word_pain) and Mindfracture (mind_blast)', () => {
  it('bakes the Dirge DoT total x1.1 for a shadow priest, matching Sim.resolvedAbility', () => {
    const sim = makeSim('priest', 'shadow', 20, 301);
    const meta = metaFor(sim);
    const mods = sim.playerMods(meta);
    const known = knownEntry(sim, 'shadow_word_pain');
    const baseDot = known.effects.find((e) => e.type === 'dot');
    if (baseDot?.type !== 'dot') throw new Error('expected a dot effect');
    const resolved = resolveAbilityChain(known, sim.player, meta, mods);
    expect(resolved.def.id).toBe('shadow_word_pain'); // Dirge never swaps identity
    const resolvedDot = resolved.effects.find((e) => e.type === 'dot');
    if (resolvedDot?.type !== 'dot') throw new Error('expected a dot effect');
    expect(resolvedDot.total).toBe(Math.round(baseDot.total * VESPERS_DOT_DAMAGE_MULT));
    assertMatchesSimResolve(sim, 'shadow_word_pain');
  });

  it('rewrites Mindfracture (mind_blast) spell power coefficient for shadow', () => {
    const sim = makeSim('priest', 'shadow', 20, 302);
    const meta = metaFor(sim);
    const mods = sim.playerMods(meta);
    const known = knownEntry(sim, 'mind_blast');
    const resolved = resolveAbilityChain(known, sim.player, meta, mods);
    expect(resolved.def.id).toBe('mind_blast');
    const eff = resolved.effects.find((e) => e.type === 'directDamage');
    if (eff?.type !== 'directDamage') throw new Error('expected a directDamage effect');
    expect(eff.spellPowerCoeff).toBe(MINDFRACTURE_SPELL_POWER_COEFF);
    assertMatchesSimResolve(sim, 'mind_blast');
  });

  it('negative control: a non-shadow priest leaves both abilities byte-identical to `known`', () => {
    const sim = makeSim('priest', 'holy', 20, 303);
    const meta = metaFor(sim);
    const mods = sim.playerMods(meta);
    for (const id of ['shadow_word_pain', 'mind_blast']) {
      const known = knownEntry(sim, id);
      expect(resolveAbilityChain(known, sim.player, meta, mods)).toBe(known);
    }
    assertMatchesSimResolve(sim, 'shadow_word_pain');
    assertMatchesSimResolve(sim, 'mind_blast');
  });
});

describe('Coldsight: the Cold Focus window plus the 2pc set-bonus hook', () => {
  it('doubles Measured Shot focus gain and discounts Long Draw inside the window, matching Sim', () => {
    const sim = makeSim('hunter', 'marksmanship', 20, 304);
    addAura(sim.player, 'hunter_cold_focus');
    const meta = metaFor(sim);
    const mods = sim.playerMods(meta);
    const measured = resolveAbilityChain(knownEntry(sim, 'measured_shot'), sim.player, meta, mods);
    const gain = measured.effects.find((e) => e.type === 'gainResource');
    if (gain?.type !== 'gainResource') throw new Error('expected a gainResource effect');
    expect(gain.amount).toBe(30);
    const aimed = resolveAbilityChain(knownEntry(sim, 'aimed_shot'), sim.player, meta, mods);
    const aimedKnown = knownEntry(sim, 'aimed_shot');
    expect(aimed.cost).toBe(Math.max(1, Math.round(aimedKnown.cost * 0.75)));
    expect(aimed.castTime).toBeCloseTo(aimedKnown.castTime * 0.7);
    assertMatchesSimResolve(sim, 'measured_shot');
    assertMatchesSimResolve(sim, 'aimed_shot');
  });

  it('adds the Coldsight 2pc Measured Shot focus bonus from mods.selected', () => {
    const sim = makeSim('hunter', 'marksmanship', 20, 305);
    const meta = metaFor(sim);
    const baseMods = sim.playerMods(meta);
    const known = knownEntry(sim, 'measured_shot');
    const baseline = resolveAbilityChain(known, sim.player, meta, baseMods);
    const baseGain = baseline.effects.find((e) => e.type === 'gainResource');
    if (baseGain?.type !== 'gainResource') throw new Error('expected a gainResource effect');
    const setMods = {
      ...baseMods,
      selected: { ...baseMods.selected, [setBonusFlag('coldsight_trackers', 2)]: true as const },
    };
    const withSet = resolveAbilityChain(known, sim.player, meta, setMods);
    const setGain = withSet.effects.find((e) => e.type === 'gainResource');
    if (setGain?.type !== 'gainResource') throw new Error('expected a gainResource effect');
    expect(setGain.amount).toBe(baseGain.amount + COLDSIGHT_2PC_MEASURED_SHOT_FOCUS_BONUS);
  });

  it('negative control: outside the window, both abilities stay byte-identical to `known`', () => {
    const sim = makeSim('hunter', 'marksmanship', 20, 306);
    const meta = metaFor(sim);
    const mods = sim.playerMods(meta);
    for (const id of ['measured_shot', 'aimed_shot']) {
      const known = knownEntry(sim, id);
      expect(resolveAbilityChain(known, sim.player, meta, mods)).toBe(known);
    }
    assertMatchesSimResolve(sim, 'measured_shot');
  });
});

// Exactly-once bake proof shared by the two action-replacement engine
// transforms below: compares resolveAbilityChain's output against a
// hand-built SINGLE bake (resolveActionReplacement once, applyTalentMods
// once) and, when `expectDoubleBakeDiffers`, against a hand-built DOUBLE bake
// (applyTalentMods run twice on the same object), asserting equal to the
// first and NOT equal to the second. The negative comparison is what makes
// the positive one load-bearing: if applyTalentMods were a no-op for this
// actor the two would coincidentally match, and the "exactly once" claim
// would be untested.
function assertExactlyOnceBake(
  sim: Sim,
  baseId: string,
  transformedId: string,
  expectDoubleBakeDiffers = true,
): { resolved: ReturnType<typeof resolveAbilityChain> } {
  const meta = metaFor(sim);
  const mods = sim.playerMods(meta);
  const known = knownEntry(sim, baseId);
  const resolved = resolveAbilityChain(known, sim.player, meta, mods);
  expect(resolved.def.id).toBe(transformedId);
  expect(resolved.outputScaling, 'transformed ability metadata must not be omitted').toBeDefined();

  const singleBaked = resolveActionReplacement(known, sim.player);
  applyTalentMods(singleBaked, mods);
  expect(resolved).toEqual(singleBaked);

  // The negative half of the proof: a SECOND bake really does diverge for this
  // actor, so the positive equality above is load-bearing rather than
  // vacuously true (an actor/ability pair with no scalable damage magnitude,
  // e.g. Overbloom's heal-harvest effect, would pass the positive check even
  // if applyTalentMods ran twice, and skips this half).
  if (expectDoubleBakeDiffers) {
    const doubleBaked = resolveActionReplacement(known, sim.player);
    applyTalentMods(doubleBaked, mods);
    applyTalentMods(doubleBaked, mods);
    expect(resolved).not.toEqual(doubleBaked);
  }

  return { resolved };
}

describe('GroveOverbloom: Swiftmend -> Overbloom (druid Groveheart/restoration)', () => {
  it('transforms at 5 Verdance, bakes talent mods exactly once, and carries the primary-healing factor', () => {
    const sim = makeSim('druid', 'restoration', 20, 307);
    addAura(sim.player, 'verdance', 5);
    // druidOverbloom is not a scalable damage/heal magnitude (scaleEffect's
    // default arm), so a second bake would coincidentally match; the
    // double-bake half of the proof lives on Redharvest/Venomrend below,
    // whose finisherDamage effect genuinely scales with dmgMult.
    const { resolved } = assertExactlyOnceBake(sim, 'swiftmend', 'overbloom', false);
    expect(resolved.outputScaling?.primaryHealing).toBe(1.05);
    assertMatchesSimResolve(sim, 'swiftmend');
  });

  it('negative control: below 5 stacks Swiftmend stays byte-identical to `known`', () => {
    const sim = makeSim('druid', 'restoration', 20, 308);
    addAura(sim.player, 'verdance', 4);
    const meta = metaFor(sim);
    const mods = sim.playerMods(meta);
    const known = knownEntry(sim, 'swiftmend');
    expect(resolveAbilityChain(known, sim.player, meta, mods)).toBe(known);
    // Already-baked at abilitiesKnownAt time; the shared chain must not re-bake it.
    expect(known.outputScaling?.primaryHealing).toBe(1.05);
    assertMatchesSimResolve(sim, 'swiftmend');
  });
});

describe('WildfangRedharvest: Gorebite -> Redharvest (druid feral, Old Blood)', () => {
  it('transforms at 3 Old Blood and bakes talent mods exactly once, matching Sim', () => {
    const sim = makeSim('druid', 'feral', 20, 309);
    addAura(sim.player, 'old_blood', 3);
    assertExactlyOnceBake(sim, 'ferocious_bite', 'redharvest');
    assertMatchesSimResolve(sim, 'ferocious_bite');
  });

  it('negative control: an untransformed sibling (Rendclaw) stays byte-identical while Old Blood is stacked', () => {
    const sim = makeSim('druid', 'feral', 20, 310);
    addAura(sim.player, 'old_blood', 3);
    const meta = metaFor(sim);
    const mods = sim.playerMods(meta);
    const known = knownEntry(sim, 'claw');
    expect(resolveAbilityChain(known, sim.player, meta, mods)).toBe(known);
    assertMatchesSimResolve(sim, 'claw');
  });
});

describe('Knifework: Eviscerate (Dirt Nap) -> Venomrend (rogue assassination, Venom Ritual)', () => {
  it('transforms at 6 Venom Ritual and bakes talent mods exactly once, matching Sim', () => {
    const sim = makeSim('rogue', 'assassination', 20, 311);
    addAura(sim.player, 'venom_ritual', 6);
    assertExactlyOnceBake(sim, 'eviscerate', 'venomrend');
    assertMatchesSimResolve(sim, 'eviscerate');
  });

  it('negative control: below 6 stacks Dirt Nap stays byte-identical to `known`', () => {
    const sim = makeSim('rogue', 'assassination', 20, 312);
    addAura(sim.player, 'venom_ritual', 5);
    const meta = metaFor(sim);
    const mods = sim.playerMods(meta);
    const known = knownEntry(sim, 'eviscerate');
    expect(resolveAbilityChain(known, sim.player, meta, mods)).toBe(known);
    assertMatchesSimResolve(sim, 'eviscerate');
  });
});

describe('resolveActionReplacement stays a pure passthrough with no matching rule', () => {
  it('returns the identical reference for an ability with no actionReplacement rule', () => {
    const sim = makeSim('warrior', null, 5, 313);
    const known = knownEntry(sim, 'charge');
    expect(resolveActionReplacement(known, sim.player)).toBe(known);
  });
});

// -----------------------------------------------------------------------
// Cost tail: draining curse (cost_tax), Measured Fury (arms discount), and
// Aether Surge (per-charge cost ramp). Shared by both worlds via
// applyAbilityCostTail (src/sim/combat/ability_resolution.ts); the server
// stays the sole spend authority (docs/design/class-balance-v042.md). Pins
// here are independent literals (base known.cost times a hand-computed
// multiplier), never a call into the discount/tax/surge math itself. The
// offline/online parity half lives in tests/v042_online_ability_resolution.test.ts.
function addCostTaxAura(entity: Entity, pct: number, id = 'test_cost_tax'): void {
  entity.auras.push({
    id,
    name: 'Draining Curse',
    kind: 'cost_tax',
    remaining: 999,
    duration: 999,
    value: pct,
    sourceId: entity.id,
    school: 'shadow',
  });
}

function addAetherSurgeCharges(entity: Entity, charges: number): void {
  entity.auras.push({
    id: 'arcane_surge',
    name: 'Aether Surge',
    kind: 'arcane_charge',
    remaining: 10,
    duration: 10,
    value: charges,
    stacks: charges,
    sourceId: entity.id,
    school: 'arcane',
  });
}

function nearestForestWolf(sim: Sim): Entity {
  const p = sim.player;
  const wolves = [...sim.entities.values()]
    .filter((e) => e.kind === 'mob' && !e.dead && e.templateId === 'forest_wolf')
    .sort((a, b) => dist2d(p.pos, a.pos) - dist2d(p.pos, b.pos));
  const wolf = wolves[0];
  if (!wolf) throw new Error('expected a forest_wolf in the default world');
  return wolf;
}

function teleportTo(sim: Sim, x: number, z: number): void {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

function facePlayerAt(sim: Sim, target: { pos: { x: number; z: number } }): void {
  sim.player.facing = Math.atan2(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z);
}

describe('Cost tail: draining curse tax, Measured Fury discount, Aether Surge charges', () => {
  it('discounts Measured Fury (arms) by exactly 10%, rounded, only when the passive is known', () => {
    const sim = makeSim('warrior', 'arms', 20, 401);
    expect(sim.known.some((k) => k.def.id === 'measured_fury' && k.def.passive)).toBe(true);
    const known = knownEntry(sim, 'mortal_strike');
    expect(sim.resolvedAbility('mortal_strike')?.cost).toBe(Math.round(known.cost * 0.9));
  });

  it('negative control: a non-arms spec never gets the Measured Fury discount', () => {
    const sim = makeSim('warrior', 'fury', 20, 402);
    expect(sim.known.some((k) => k.def.id === 'measured_fury')).toBe(false);
    // Fury's own paid spender: Mortal Strike is Arms-only (signature ability).
    const known = knownEntry(sim, 'red_harvest');
    expect(sim.resolvedAbility('red_harvest')?.cost).toBe(known.cost);
  });

  it('negative control: removing the passive from known drops the discount even while spec stays arms', () => {
    const sim = makeSim('warrior', 'arms', 20, 409);
    const meta = metaFor(sim);
    const idx = meta.known.findIndex((k) => k.def.id === 'measured_fury');
    expect(idx).toBeGreaterThanOrEqual(0);
    meta.known.splice(idx, 1);
    const known = knownEntry(sim, 'mortal_strike');
    expect(sim.resolvedAbility('mortal_strike')?.cost).toBe(known.cost);
  });

  it('taxes cost by the HIGHEST of several active cost_tax auras, independent of aura order', () => {
    // 80 * 1.08 = 86.4: ceil gives 87 (round would give 86), so this also
    // pins ceil over round, not just which aura wins.
    const simA = makeSim('warrior', 'fury', 20, 410);
    addCostTaxAura(simA.player, 0.03, 'test_cost_tax_a');
    addCostTaxAura(simA.player, 0.08, 'test_cost_tax_b');
    const base = knownEntry(simA, 'red_harvest').cost;
    const expected = Math.ceil(base * 1.08);
    expect(expected).not.toBe(Math.round(base * 1.08));
    expect(simA.resolvedAbility('red_harvest')?.cost).toBe(expected);

    const simB = makeSim('warrior', 'fury', 20, 411);
    addCostTaxAura(simB.player, 0.08, 'test_cost_tax_b');
    addCostTaxAura(simB.player, 0.03, 'test_cost_tax_a');
    expect(simB.resolvedAbility('red_harvest')?.cost).toBe(expected);
  });

  it('applies the Measured Fury discount BEFORE the cost_tax ceiling, not after', () => {
    const sim = makeSim('warrior', 'arms', 20, 404);
    addCostTaxAura(sim.player, 0.3);
    const known = knownEntry(sim, 'mortal_strike');
    const discountThenTax = Math.ceil(Math.round(known.cost * 0.9) * 1.3);
    const taxThenDiscount = Math.round(Math.ceil(known.cost * 1.3) * 0.9);
    // Otherwise this case cannot distinguish the two orders.
    expect(discountThenTax).not.toBe(taxThenDiscount);
    expect(sim.resolvedAbility('mortal_strike')?.cost).toBe(discountThenTax);
  });

  it('Aether Surge cost ramps geometrically per held Arcane Charge (2 charges = 4x)', () => {
    const sim = makeSim('mage', 'arcane', 20, 405);
    addAetherSurgeCharges(sim.player, 2);
    const known = knownEntry(sim, 'arcane_surge');
    expect(sim.resolvedAbility('arcane_surge')?.cost).toBe(Math.round(known.cost * 2 ** 2));
  });

  it('negative control: held Arcane Charges never touch the cost of a different ability', () => {
    const sim = makeSim('mage', 'arcane', 20, 406);
    addAetherSurgeCharges(sim.player, 4);
    const known = knownEntry(sim, 'arcane_missiles');
    expect(sim.resolvedAbility('arcane_missiles')?.cost).toBe(known.cost);
  });

  it('applies cost_tax BEFORE the Aether Surge ramp, not after', () => {
    const sim = makeSim('mage', 'arcane', 20, 412);
    addCostTaxAura(sim.player, 0.11);
    addAetherSurgeCharges(sim.player, 2);
    const base = knownEntry(sim, 'arcane_surge').cost;
    const taxThenSurge = Math.round(Math.ceil(base * 1.11) * 2 ** 2);
    const surgeThenTax = Math.ceil(Math.round(base * 2 ** 2) * 1.11);
    expect(taxThenSurge).not.toBe(surgeThenTax);
    expect(sim.resolvedAbility('arcane_surge')?.cost).toBe(taxThenSurge);
  });

  it('the zero-cost Charge ability stays zero under both Measured Fury discount and cost_tax', () => {
    const sim = makeSim('warrior', 'arms', 20, 407);
    addCostTaxAura(sim.player, 0.5);
    const known = knownEntry(sim, 'charge');
    expect(known.cost).toBe(0);
    expect(sim.resolvedAbility('charge')?.cost).toBe(0);
  });

  it('an actual cast spends the Measured Fury discounted cost, not the raw known cost', () => {
    const sim = makeSim('warrior', 'arms', 20, 408);
    const wolf = nearestForestWolf(sim);
    teleportTo(sim, wolf.pos.x + 2, wolf.pos.z);
    facePlayerAt(sim, wolf);
    sim.targetEntity(wolf.id);
    sim.player.resource = 100;
    const known = knownEntry(sim, 'mortal_strike');
    sim.castAbility('mortal_strike');
    sim.tick();
    expect(sim.player.resource).toBe(100 - Math.round(known.cost * 0.9));
  });
});
