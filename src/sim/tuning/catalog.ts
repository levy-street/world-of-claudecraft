// The class power tuner's CATALOG: every class, its specs, and every ability
// each spec can reach, with the tuning channels that ability exposes and the
// authored numbers behind each channel.
//
// The catalog is derived, never authored. It is built from the live content
// tables (CLASSES / ABILITIES / TALENTS), so a reworked or brand-new class
// appears in the tuner the moment its content lands, with the right sliders,
// and nobody has to remember to register it. That is what keeps the dashboard
// honest about "every spell of every class".
//
// The authoritative server builds this and ships it to the admin dashboard as
// DATA (the dashboard never imports src/sim; see src/admin/CLAUDE.md).
//
// Pure leaf: no SimContext, no rng, no clock.

import { ABILITIES, CLASSES } from '../content/classes';
import { rowTreeFor, talentsFor } from '../content/talents';
import { ITEMS } from '../data';
import { type AbilityDef, ALL_CLASSES, type PlayerClass, type WeaponInfo } from '../types';
import { abilityTuningKnobs } from './ability_knobs';
import type { TuningChannel, TuningValueKind } from './channels';
import { classRangedWeaponId } from './document';
import { weaponDps, weaponTuningKnobs } from './weapon_knobs';

/** Why a spec can cast this ability. */
export type TunerAbilitySource =
  | 'base' // shared class kit, every spec has it
  | 'spec' // spec-gated base kit (def.specs / def.excludeSpecs)
  | 'signature' // the spec's signature ability
  | 'row' // granted by a class talent row, so every spec can pick it
  | 'unspecced'; // every spec excludes it, so only an uncommitted character casts it

export interface TunerChannelInfo {
  channel: TuningChannel;
  /**
   * The authored numbers this slider moves, in traversal order. `kind` travels
   * with each one so the dashboard can preview the tuned result without
   * re-deriving how the number responds (see src/admin/class_tuning.ts, whose
   * copy of the value math is pinned against the sim's by
   * tests/admin/class_tuning.test.ts).
   */
  sites: { path: string; value: number; kind: TuningValueKind }[];
}

export interface TunerAbilityInfo {
  id: string;
  name: string;
  class: PlayerClass;
  school: AbilityDef['school'];
  learnLevel: number;
  /**
   * Spec ids that can cast it, in the class's spec order. EMPTY when every spec
   * excludes the ability and only a character who has not committed to a spec
   * still knows it (warrior Heroic Strike); `source` is 'unspecced' there.
   */
  specs: string[];
  source: TunerAbilitySource;
  passive: boolean;
  ranks: number;
  channels: TunerChannelInfo[];
}

export interface TunerSpecInfo {
  id: string;
  name: string;
  role: string;
}

export interface TunerClassInfo {
  id: PlayerClass;
  name: string;
  specs: TunerSpecInfo[];
  abilities: TunerAbilityInfo[];
}

/**
 * One auto-attack ("white") profile: a carried weapon item, or a class's own
 * ranged profile (a hunter's Auto Shot, a caster's wand). Both drive the same
 * swing loop, so both carry the same two channels.
 */
export interface TunerWeaponInfo {
  /** Item id, or `class_<cls>_ranged` for a class ranged profile. */
  id: string;
  name: string;
  kind: 'item' | 'classRanged';
  /** Set only on a class ranged profile. */
  class?: PlayerClass;
  /** 'onehand' | 'twohand' | 'ranged' | 'wand'. */
  hand: string;
  dagger: boolean;
  min: number;
  max: number;
  speed: number;
  /** Average damage per second at the shipped numbers, for the readout. */
  dps: number;
  channels: TunerChannelInfo[];
}

export interface ClassTuningCatalog {
  classes: TunerClassInfo[];
  /** Every weapon profile whose white damage and swing timer can be tuned. */
  weapons: TunerWeaponInfo[];
}

/**
 * Build the catalog from the live content tables.
 *
 * Reads the SHIPPED numbers when called before `installClassTuning`, and the
 * tuned ones after: the dashboard wants the shipped baseline (so a slider at
 * 1.0 always means "as authored"), so the server builds it at boot, before it
 * installs the realm's document.
 */
export function buildClassTuningCatalog(): ClassTuningCatalog {
  return { classes: ALL_CLASSES.map(buildClassInfo), weapons: buildWeaponInfos() };
}

function buildWeaponInfos(): TunerWeaponInfo[] {
  const out: TunerWeaponInfo[] = [];
  for (const item of Object.values(ITEMS)) {
    const weapon = (item as { weapon?: WeaponInfo }).weapon;
    if (!weapon) continue;
    out.push({
      id: item.id,
      name: item.name,
      kind: 'item',
      hand: (item as { hand?: string }).hand ?? 'onehand',
      dagger: weapon.dagger === true,
      min: weapon.min,
      max: weapon.max,
      speed: weapon.speed,
      dps: weaponDps(weapon),
      channels: weaponChannels(weapon),
    });
  }
  // A class's own ranged profile is kit, not loot: a hunter's Auto Shot and a
  // caster's wand swing off these numbers with no item involved.
  for (const cls of ALL_CLASSES) {
    const ranged = CLASSES[cls].ranged;
    if (!ranged) continue;
    out.push({
      id: classRangedWeaponId(cls),
      name: `${CLASSES[cls].name} ${ranged.wand ? 'wand' : 'ranged'}`,
      kind: 'classRanged',
      class: cls,
      hand: ranged.wand ? 'wand' : 'ranged',
      dagger: false,
      min: ranged.min,
      max: ranged.max,
      speed: ranged.speed,
      dps: weaponDps(ranged),
      channels: weaponChannels(ranged),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return out;
}

function weaponChannels(weapon: WeaponInfo): TunerChannelInfo[] {
  const byChannel = new Map<TuningChannel, TunerChannelInfo>();
  for (const site of weaponTuningKnobs(weapon)) {
    let info = byChannel.get(site.channel);
    if (!info) {
      info = { channel: site.channel, sites: [] };
      byChannel.set(site.channel, info);
    }
    info.sites.push({ path: site.path, value: site.value, kind: site.kind });
  }
  return [...byChannel.values()];
}

function buildClassInfo(cls: PlayerClass): TunerClassInfo {
  const talents = talentsFor(cls);
  const specs: TunerSpecInfo[] = (talents?.specs ?? []).map((spec) => ({
    id: spec.id,
    name: spec.name,
    role: spec.role,
  }));
  const specIds = specs.map((spec) => spec.id);
  const signatureSpecOf = new Map<string, string>();
  for (const spec of talents?.specs ?? []) signatureSpecOf.set(spec.signature, spec.id);

  const rowGranted = new Set<string>();
  for (const row of rowTreeFor(cls) ?? []) {
    for (const option of row.options) {
      const granted = option.effect.grant?.ability;
      if (granted) rowGranted.add(granted);
    }
  }

  const baseKit = new Set(CLASSES[cls].abilities);
  const abilities: TunerAbilityInfo[] = [];
  for (const def of Object.values(ABILITIES)) {
    if (def.class !== cls) continue;
    const abilitySpecs = specsForAbility(def, specIds, signatureSpecOf);
    abilities.push({
      id: def.id,
      name: def.name,
      class: cls,
      school: def.school,
      learnLevel: def.learnLevel,
      specs: abilitySpecs,
      source: sourceForAbility(def, abilitySpecs, baseKit, rowGranted, signatureSpecOf),
      passive: def.passive === true,
      ranks: 1 + (def.ranks?.length ?? 0),
      channels: channelsForAbility(def),
    });
  }
  abilities.sort(
    (a, b) =>
      a.learnLevel - b.learnLevel || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );

  return { id: cls, name: CLASSES[cls].name, specs, abilities };
}

function specsForAbility(
  def: AbilityDef,
  specIds: readonly string[],
  signatureSpecOf: ReadonlyMap<string, string>,
): string[] {
  if (def.specs) return specIds.filter((id) => def.specs?.includes(id));
  const signature = signatureSpecOf.get(def.id);
  if (signature) return [signature];
  // A LEVEL-SCOPED exclusion is a kit hand-off, not a lockout: the excluded spec
  // still casts the ability below `excludeSpecsAtLevel`, so it stays reachable
  // and the tuner keeps showing it under that spec.
  if (def.excludeSpecs && def.excludeSpecsAtLevel === undefined) {
    return specIds.filter((id) => !def.excludeSpecs?.includes(id));
  }
  return [...specIds];
}

function sourceForAbility(
  def: AbilityDef,
  abilitySpecs: readonly string[],
  baseKit: ReadonlySet<string>,
  rowGranted: ReadonlySet<string>,
  signatureSpecOf: ReadonlyMap<string, string>,
): TunerAbilitySource {
  if (signatureSpecOf.has(def.id)) return 'signature';
  if (abilitySpecs.length === 0) return 'unspecced';
  if (def.specs || def.excludeSpecs) return 'spec';
  if (!baseKit.has(def.id) && rowGranted.has(def.id)) return 'row';
  return 'base';
}

function channelsForAbility(def: AbilityDef): TunerChannelInfo[] {
  const byChannel = new Map<TuningChannel, TunerChannelInfo>();
  for (const site of abilityTuningKnobs(def)) {
    let info = byChannel.get(site.channel);
    if (!info) {
      info = { channel: site.channel, sites: [] };
      byChannel.set(site.channel, info);
    }
    info.sites.push({ path: site.path, value: site.value, kind: site.kind });
  }
  return [...byChannel.values()];
}
