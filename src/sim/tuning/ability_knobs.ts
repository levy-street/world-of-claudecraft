// The class power tuner's ONE traversal over an AbilityDef.
//
// `walkTunedAbility` visits every tunable number in a def (base fields, every
// effect, and every rank's overrides), classified into a channel by
// `ability_fields.ts`. Both directions of the feature run through it:
//
//   - `abilityTuningKnobs(def)`  the dashboard's slider list, with the base
//                               values each slider would move
//   - `applyAbilityTuning(def)`  the boot-time transform that produces the
//                               tuned clone the world runs on
//
// One traversal means the sliders offered and the numbers changed can never
// drift apart: a field the walker cannot reach is a field the tuner never
// claims to control.
//
// Pure leaf: no SimContext, no rng, no clock.

import type { AbilityDef, AbilityEffect, AbilityRank } from '../types';
import {
  AURA_VALUE_EFFECTS,
  auraValueFieldSpec,
  EFFECT_TUNED_FIELDS,
  type TunedFieldSpec,
} from './ability_fields';
import {
  isEffectiveTuningSite,
  scaleTuningValue,
  type TuningChannel,
  type TuningValueKind,
} from './channels';

// Where a tunable number was found, for the dashboard's per-slider readout and
// for the coverage guard's error messages.
export interface TunedSite {
  channel: TuningChannel;
  kind: TuningValueKind;
  // 'cooldown', 'effects[0].directDamage.min', 'ranks[1].cost', ...
  path: string;
  value: number;
}

export type TunedSiteVisitor = (site: TunedSite) => number | void;

/**
 * Visit every tunable number in `def`. The visitor may return a replacement
 * value; returning nothing leaves the number alone. `def` is never mutated:
 * when any visitor returns a change, the affected objects are cloned on the way
 * out and the tuned def is returned, otherwise the original def is returned
 * as-is (so an untuned realm keeps object identity and allocates nothing).
 */
export function walkTunedAbility(def: AbilityDef, visit: TunedSiteVisitor): AbilityDef {
  let changed = false;

  const take = (spec: TunedFieldSpec, path: string, value: number): number => {
    const next = visit({ channel: spec.channel, kind: spec.kind, path, value });
    if (typeof next !== 'number' || !Number.isFinite(next) || next === value) return value;
    changed = true;
    return next;
  };

  const out: AbilityDef = { ...def };

  // --- def-level knobs ------------------------------------------------------
  out.cost = take(LINEAR_COST, 'cost', def.cost);
  out.cooldown = take(LINEAR_COOLDOWN, 'cooldown', def.cooldown);
  out.castTime = take(LINEAR_CAST, 'castTime', def.castTime);
  if (def.range > 0) out.range = take(LINEAR_RANGE, 'range', def.range);
  if (def.minRange !== undefined) out.minRange = take(LINEAR_RANGE, 'minRange', def.minRange);
  if (def.spendResourceCap !== undefined) {
    out.spendResourceCap = take(LINEAR_COST, 'spendResourceCap', def.spendResourceCap);
  }
  if (def.maxCharges !== undefined) {
    out.maxCharges = take(LINEAR_TARGETS, 'maxCharges', def.maxCharges);
  }
  // Combo points a rogue builder awards: resource generation, same as a rage
  // or mana grant, so it moves on the resource channel rather than target count.
  if (def.awardsCombo !== undefined) {
    out.awardsCombo = take(LINEAR_RESOURCE_GAIN, 'awardsCombo', def.awardsCombo);
  }
  // The execute window (a target-health fraction): widening or narrowing it is a
  // real power lever on every execute-style spender.
  if (def.requiresTargetHpBelow !== undefined) {
    out.requiresTargetHpBelow = take(
      FRACTION_MAGNITUDE,
      'requiresTargetHpBelow',
      def.requiresTargetHpBelow,
    );
  }
  // The strict execute threshold is the same window lever under another name.
  if (def.executeThreshold !== undefined) {
    out.executeThreshold = take(FRACTION_MAGNITUDE, 'executeThreshold', def.executeThreshold);
  }
  // Secondary resource meters an ability bills alongside its `cost`: the Ruin
  // meter and Soul Fragments. They spend like a cost, so they move with one.
  if (def.ruinCost !== undefined) {
    out.ruinCost = take(LINEAR_COST, 'ruinCost', def.ruinCost);
  }
  if (def.soulFragmentCost !== undefined) {
    out.soulFragmentCost = take(LINEAR_COST, 'soulFragmentCost', def.soulFragmentCost);
  }
  if (def.channel) {
    const duration = take(LINEAR_CAST, 'channel.duration', def.channel.duration);
    if (duration !== def.channel.duration) out.channel = { ...def.channel, duration };
  }
  if (def.threat) {
    const flat = def.threat.flat;
    const mult = def.threat.mult;
    const nextFlat = flat === undefined ? flat : take(LINEAR_THREAT, 'threat.flat', flat);
    const nextMult = mult === undefined ? mult : take(DEVIATION_THREAT, 'threat.mult', mult);
    if (nextFlat !== flat || nextMult !== mult) {
      out.threat = { ...def.threat };
      if (nextFlat !== undefined) out.threat.flat = nextFlat;
      if (nextMult !== undefined) out.threat.mult = nextMult;
    }
  }
  // Spell power scaling is a SYNTHETIC def-level knob: the engine derives the
  // coefficient from cast time and duration (sim/spell_scaling.ts) rather than
  // storing it, so the tuner carries a multiplier the scaling functions read.
  // Offered only where something on the ability actually scales with power.
  if (abilityScalesWithPower(def)) {
    const base = def.powerCoeffMult ?? 1;
    const next = take(MULTIPLIER_SPELL_POWER, 'powerCoeffMult', base);
    if (next !== base) out.powerCoeffMult = next;
  }

  // --- effects and rank overrides ------------------------------------------
  const effects = walkEffects(def.effects, 'effects', take);
  if (effects !== def.effects) out.effects = effects;

  if (def.ranks) {
    let ranksChanged = false;
    const ranks: AbilityRank[] = def.ranks.map((rank, index) => {
      const prefix = `ranks[${index}]`;
      const next: AbilityRank = { ...rank };
      next.cost = take(LINEAR_COST, `${prefix}.cost`, rank.cost);
      if (rank.castTime !== undefined) {
        next.castTime = take(LINEAR_CAST, `${prefix}.castTime`, rank.castTime);
      }
      if (rank.threatFlat !== undefined) {
        next.threatFlat = take(LINEAR_THREAT, `${prefix}.threatFlat`, rank.threatFlat);
      }
      const rankEffects = walkEffects(rank.effects, `${prefix}.effects`, take);
      if (rankEffects !== rank.effects) next.effects = rankEffects;
      const same =
        next.cost === rank.cost &&
        next.castTime === rank.castTime &&
        next.threatFlat === rank.threatFlat &&
        next.effects === rank.effects;
      if (same) return rank;
      ranksChanged = true;
      return next;
    });
    if (ranksChanged) out.ranks = ranks;
  }

  return changed ? out : def;
}

/**
 * Every knob this ability exposes, with the base value behind each.
 *
 * Sites a slider provably cannot move (a zero magnitude, a multiplier already
 * at its neutral 1) are dropped, so the dashboard never renders a dead control.
 * Pass `{ includeInert: true }` to see the raw traversal instead, which is what
 * the coverage guard walks.
 */
export function abilityTuningKnobs(
  def: AbilityDef,
  options: { includeInert?: boolean } = {},
): TunedSite[] {
  const sites: TunedSite[] = [];
  walkTunedAbility(def, (site) => {
    if (options.includeInert || isEffectiveTuningSite(site.value, site.kind)) sites.push(site);
  });
  return sites;
}

/** The distinct channels this ability exposes, in vocabulary order. */
export function abilityTuningChannels(def: AbilityDef): TuningChannel[] {
  const seen = new Set<TuningChannel>();
  for (const site of abilityTuningKnobs(def)) seen.add(site.channel);
  return [...seen];
}

/**
 * The tuned clone of `def` for one ability's per-channel factors. A factor map
 * with nothing but neutral entries returns the original def untouched.
 */
export function applyAbilityTuning(
  def: AbilityDef,
  factors: Readonly<Partial<Record<TuningChannel, number>>>,
): AbilityDef {
  return walkTunedAbility(def, (site) => {
    const factor = factors[site.channel];
    if (factor === undefined || factor === 1) return;
    return scaleTuningValue(site.value, factor, site.kind, site.channel);
  });
}

// --- internals -------------------------------------------------------------

const LINEAR_COST: TunedFieldSpec = { channel: 'resource_cost', kind: 'linear' };
const LINEAR_COOLDOWN: TunedFieldSpec = { channel: 'cooldown', kind: 'linear' };
const LINEAR_CAST: TunedFieldSpec = { channel: 'cast_time', kind: 'linear' };
const LINEAR_RANGE: TunedFieldSpec = { channel: 'range', kind: 'linear' };
const LINEAR_TARGETS: TunedFieldSpec = { channel: 'targets', kind: 'linear' };
const LINEAR_THREAT: TunedFieldSpec = { channel: 'threat', kind: 'linear' };
const LINEAR_RESOURCE_GAIN: TunedFieldSpec = { channel: 'resource_gain', kind: 'linear' };
const FRACTION_MAGNITUDE: TunedFieldSpec = { channel: 'effect_magnitude', kind: 'fraction' };
const DEVIATION_THREAT: TunedFieldSpec = { channel: 'threat', kind: 'deviation' };
const MULTIPLIER_SPELL_POWER: TunedFieldSpec = { channel: 'spell_power', kind: 'multiplier' };

// Effect types whose resolved amount picks up a Spell Power / Attack Power
// rider (sim/spell_scaling.ts). Only these make the spell_power knob meaningful.
//
// A BESPOKE combat module that reads power through its own math must join this
// set explicitly, or its ability never gets a spell_power slider and the rider
// that dominates at endgame stays untunable: the coverage guard cannot see
// which effect types read power, so this list is the one place that knows.
// paladinAegis is the standing example: paladin_aegis.ts adds SP riders to both
// its ticks (channelTickBonus) and its finale (directHealBonus), and both honor
// the powerCoeffMult knob through abilityPowerCoeffMult.
const POWER_SCALED_EFFECTS: ReadonlySet<string> = new Set<string>([
  'directDamage',
  'aoeDamage',
  'chainDamage',
  'groundAoE',
  'frozenOrb',
  'empoweredCone',
  'dot',
  'drainTick',
  'heal',
  'aoeHeal',
  'chainHeal',
  'hot',
  'absorb',
  'aoeAllyAbsorb',
  'massTemporalEcho',
  'consumeAura',
  'paladinAegis',
]);

function abilityScalesWithPower(def: AbilityDef): boolean {
  const hasScaled = (effects: readonly AbilityEffect[]): boolean =>
    effects.some((effect) => POWER_SCALED_EFFECTS.has(effect.type));
  if (hasScaled(def.effects)) return true;
  return (def.ranks ?? []).some((rank) => hasScaled(rank.effects));
}

type TakeFn = (spec: TunedFieldSpec, path: string, value: number) => number;

function walkEffects(
  effects: readonly AbilityEffect[],
  prefix: string,
  take: TakeFn,
): AbilityEffect[] {
  let changed = false;
  const out = effects.map((effect, index) => {
    const next = walkEffect(effect, `${prefix}[${index}].${effect.type}`, take);
    if (next !== effect) changed = true;
    return next;
  });
  return changed ? out : (effects as AbilityEffect[]);
}

function walkEffect(effect: AbilityEffect, prefix: string, take: TakeFn): AbilityEffect {
  const table = EFFECT_TUNED_FIELDS[effect.type];
  const record = effect as unknown as Record<string, unknown>;
  let draft: Record<string, unknown> | null = null;

  const write = (path: readonly string[], value: number): void => {
    draft ??= deepClonePlain(record);
    let node = draft;
    for (const step of path.slice(0, -1)) node = node[step] as Record<string, unknown>;
    node[path[path.length - 1]] = value;
  };

  if (table) {
    for (const [fieldPath, spec] of Object.entries(table)) {
      for (const hit of resolveFieldPath(record, fieldPath)) {
        const next = take(spec, `${prefix}.${hit.path.join('.')}`, hit.value);
        if (next !== hit.value) write(hit.path, next);
      }
    }
  }

  // The aura-carrying `value` field is routed by aura kind, not by type alone.
  if (AURA_VALUE_EFFECTS.has(effect.type)) {
    const kind = record.kind;
    const value = record.value;
    if (typeof kind === 'string' && typeof value === 'number') {
      const spec = auraValueFieldSpec(kind);
      if (spec) {
        const next = take(spec, `${prefix}.value`, value);
        if (next !== value) write(['value'], next);
      }
    }
  }

  return (draft ?? record) as unknown as AbilityEffect;
}

interface FieldHit {
  // resolved concrete path, with array hops expanded to indices
  path: string[];
  value: number;
}

/**
 * Resolve a spec path ('min', 'heal.min', 'stages[].max') against one effect
 * object, expanding array hops. A path that is absent on this effect (an
 * optional field, or a union arm that does not carry it) simply yields nothing.
 */
function resolveFieldPath(root: Record<string, unknown>, fieldPath: string): FieldHit[] {
  const steps = fieldPath.split('.');
  let frontier: { node: unknown; path: string[] }[] = [{ node: root, path: [] }];

  for (const step of steps) {
    const isArrayHop = step.endsWith('[]');
    const key = isArrayHop ? step.slice(0, -2) : step;
    const next: { node: unknown; path: string[] }[] = [];
    for (const entry of frontier) {
      if (typeof entry.node !== 'object' || entry.node === null) continue;
      const child = (entry.node as Record<string, unknown>)[key];
      if (child === undefined || child === null) continue;
      if (isArrayHop) {
        if (!Array.isArray(child)) continue;
        child.forEach((item, index) => {
          next.push({ node: item, path: [...entry.path, key, String(index)] });
        });
      } else {
        next.push({ node: child, path: [...entry.path, key] });
      }
    }
    frontier = next;
  }

  const hits: FieldHit[] = [];
  for (const entry of frontier) {
    if (typeof entry.node === 'number' && Number.isFinite(entry.node)) {
      hits.push({ path: entry.path, value: entry.node });
    }
  }
  return hits;
}

// A plain deep clone for the effect objects: they are JSON-shaped content
// records (numbers, strings, booleans, arrays, nested objects), never anything
// structuredClone would be needed for, and this keeps the module dependency-free
// and host-agnostic.
function deepClonePlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => deepClonePlain(item)) as unknown as T;
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = deepClonePlain(item);
    }
    return out as T;
  }
  return value;
}
