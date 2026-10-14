// Persisting buffs across save/load.
//
// Entity auras used to be session-only: serializeCharacter wrote no auras key,
// so a logout (or a linkdead grace that ran out, or a realm restart) dropped
// every Well Fed, elixir, flask, and every class buff a group had cast. Classic
// kept buffs through a logout with their timers frozen while offline, which is
// the scheme here: each buff is saved as its REMAINING seconds and resumes from
// that remaining on load (the cooldown_persist.ts approach; the sim never reads
// a wall clock, so nothing could tick offline anyway).
//
// WHICH auras persist is an allowlist DERIVED FROM CONTENT, never a guess over
// aura kinds. An aura id is persistable only when some content record mints it:
//  - consumables: every food's Well Fed (WELL_FED_AURA_ID) and every elixir,
//    scroll, and flask (`elixir_<kind>`, the items.ts useItem arm);
//  - player buffs: the aura of a non-permanent `buffTarget`, `selfBuff`, or
//    `aoeAllyAttackPower` effect lasting at least MIN_PERSISTED_BUFF_SECONDS
//    whose kind is a plain stat buff (PERSISTED_BUFF_KINDS). That is the
//    maintenance kit (Litany of Resolve, Aether Insight, Wildward, Battle
//    Shout, the blessings, Thorns, the armor self-buffs, the aspects that ride
//    a stat), not the five-minute group bursts.
// Every consumable kind passes the same PERSISTED_BUFF_KINDS filter, so a
// future elixir of a coupled kind cannot slip in unreviewed.
// Deliberately NOT persisted: forms, stances, stealth, and every other toggle
// (the whole ability is skipped when it carries a toggle self-buff, so a
// form's companion stat aura can never outlive the form), debuffs (a buff kind
// with a negative value included), permanent and encounter-owned auras, class
// engine counters, and short combat procs. The two recovery sicknesses keep
// their own dedicated fields (sicknessSaveFragment below) because they restore
// through spirit.ts with their stat drain.
//
// CASTER IDENTITY. Entity ids are boot-local, so the original caster cannot be
// named in a save. A buff the wearer cast on themselves (every consumable, a
// self-buff) re-anchors to the wearer's new id. A buff someone else cast comes
// back UNATTRIBUTED (RESTORED_AURA_SOURCE_ID); aura_stacking.ts lets any
// same-id application replace an unattributed copy, so a relog can never
// leave room for the same buff to stack twice once the caster recasts it.
// CASTER-BOUND auras are the exception: a paladin devotion lives exactly as
// long as its paladin keeps it (every teardown in combat/paladin_support.ts
// keys on the caster's id), so an unattributed copy could never be torn down.
// A devotion therefore persists only when the wearer is its own paladin.
//
// INSTANCED MATCHES are a parenthesis for buffs (resurrection.ts, the clean
// slate): nothing carried in rides through, and nothing gained inside comes
// back out. A save taken while the character stands in an arena-family,
// Protect Yumi, or Thornhollow Fields band, or during a Fiesta bout (whose
// seat already wiped every buff to the clean slate), therefore writes none.
//
// Pure leaf (no SimContext, no rng, no clock): a Vitest drives it directly.

import { TOGGLE_AURA_IDS, TOGGLE_AURA_KINDS } from './aura_classify';
import { buffTargetAuraId, selfBuffAuraId } from './combat/aura_ids';
import { RESTORED_AURA_SOURCE_ID } from './combat/aura_stacking';
import { PALADIN_DEVOTION_ABILITY_IDS } from './combat/paladin_support';
import { ABILITIES, ITEMS, isArenaPos, isBgPos, isYumiMazePos } from './data';
import { RESURRECTION_SICKNESS_ID, UNSTUCK_SICKNESS_ID } from './resurrection';
import type { AbilityEffect, Aura, AuraKind, Entity } from './types';
import { WELL_FED_AURA_ID } from './wellfed';

/** One persisted buff (inside CharacterState, JSONB). Times are remaining
 *  seconds, independent of any particular Sim clock. Only the fields the
 *  persisted kinds actually read are kept. */
export interface SavedAura {
  id: string;
  name: string;
  kind: AuraKind;
  remaining: number;
  duration: number;
  value: number;
  value2?: number;
  value3?: number;
  stacks?: number;
  /** thorns: remaining reflect charges (Lightning Shield). */
  charges?: number;
  icd?: number;
  icdMax?: number;
  /** buff_mana_grace: the periodic restore cadence. */
  tickInterval?: number;
  tickTimer?: number;
  school: Aura['school'];
  /** The wearer cast it on themselves: restore re-anchors it to the new id. */
  self?: true;
  flask?: true;
  undispellable?: true;
}

/** Plain stat-buff kinds: their whole effect is read off the aura record by
 *  recalcPlayerStats (or the thorns / mana-grace tick), with no state kept
 *  anywhere else, so a restored copy behaves exactly like the live one. */
export const PERSISTED_BUFF_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>([
  'buff_ap',
  'buff_ap_pct',
  'buff_armor',
  'buff_armor_pct',
  'buff_int',
  'buff_int_pct',
  'buff_str',
  'buff_agi',
  'buff_spi',
  'buff_sta',
  'buff_sta_pct',
  'buff_allstats',
  'buff_stats_pct',
  'buff_spellpower',
  'buff_dodge',
  'buff_mana_grace',
  'thorns',
]);

/** Ability buffs shorter than this (ten minutes: Thorns and Lightning Shield
 *  are the shortest maintenance buffs) are combat procs, cooldowns, and group
 *  bursts, not the maintenance buffs a relog should keep. */
export const MIN_PERSISTED_BUFF_SECONDS = 600;

/** Auras bound to their caster's live state (see the header): persisted only
 *  when the wearer cast them. */
export const CASTER_BOUND_AURA_IDS: ReadonlySet<string> = PALADIN_DEVOTION_ABILITY_IDS;

/** Bounds on what one save writes and one load trusts: no live character
 *  carries anywhere near this many maintenance buffs, and no authored buff
 *  outlasts two hours. */
export const MAX_PERSISTED_AURAS = 32;
export const MAX_PERSISTED_AURA_SECONDS = 7200;

function addAllowed(out: Map<string, Set<AuraKind>>, id: string, kind: AuraKind): void {
  let kinds = out.get(id);
  if (!kinds) {
    kinds = new Set();
    out.set(id, kinds);
  }
  kinds.add(kind);
}

function isToggleSelfBuff(abilityId: string, eff: AbilityEffect): boolean {
  return (
    eff.type === 'selfBuff' &&
    (TOGGLE_AURA_KINDS.has(eff.kind) ||
      TOGGLE_AURA_IDS.has(abilityId) ||
      eff.healthDrainPctMax !== undefined)
  );
}

function addAbilityEffects(
  out: Map<string, Set<AuraKind>>,
  abilityId: string,
  effects: readonly AbilityEffect[],
): void {
  if (effects.some((eff) => isToggleSelfBuff(abilityId, eff))) return;
  let targetBuffIndex = 0;
  for (const eff of effects) {
    if (eff.type === 'buffTarget') {
      // The index advances for EVERY buffTarget, persisted or not, exactly as
      // the dispatcher counts it (effect_dispatch.ts), so suffixed ids match.
      const id = buffTargetAuraId({ id: abilityId }, eff, targetBuffIndex);
      targetBuffIndex += 1;
      if (!eff.permanent && eff.duration >= MIN_PERSISTED_BUFF_SECONDS) {
        if (PERSISTED_BUFF_KINDS.has(eff.kind)) addAllowed(out, id, eff.kind);
      }
    } else if (eff.type === 'selfBuff') {
      if (eff.permanent || eff.duration < MIN_PERSISTED_BUFF_SECONDS) continue;
      if (!PERSISTED_BUFF_KINDS.has(eff.kind)) continue;
      addAllowed(out, selfBuffAuraId({ id: abilityId, effects }, eff), eff.kind);
    } else if (eff.type === 'aoeAllyAttackPower') {
      if (eff.duration < MIN_PERSISTED_BUFF_SECONDS) continue;
      addAllowed(out, `${abilityId}_ap`, eff.apPct !== undefined ? 'buff_ap_pct' : 'buff_ap');
    }
  }
}

/** Derive the aura id -> allowed kinds table from the content tables. Exported
 *  for the test suite; the module evaluates it once below. */
export function buildPersistedAuraAllowlist(): ReadonlyMap<string, ReadonlySet<AuraKind>> {
  const out = new Map<string, Set<AuraKind>>();
  for (const item of Object.values(ITEMS)) {
    const wellFed = 'wellFed' in item ? item.wellFed : undefined;
    if (wellFed && PERSISTED_BUFF_KINDS.has(wellFed.kind)) {
      addAllowed(out, WELL_FED_AURA_ID, wellFed.kind);
    }
    if (item.elixir && PERSISTED_BUFF_KINDS.has(item.elixir.kind)) {
      addAllowed(out, `elixir_${item.elixir.kind}`, item.elixir.kind);
    }
  }
  for (const ability of Object.values(ABILITIES)) {
    addAbilityEffects(out, ability.id, ability.effects);
    for (const rank of ability.ranks ?? []) addAbilityEffects(out, ability.id, rank.effects);
  }
  return out;
}

const PERSISTED_AURA_ALLOWLIST = buildPersistedAuraAllowlist();

const finitePositive = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Whether a LIVE aura is one a save keeps (see the header for the rule). */
export function isPersistableAura(aura: Aura): boolean {
  return (
    PERSISTED_AURA_ALLOWLIST.get(aura.id)?.has(aura.kind) === true &&
    aura.permanent !== true &&
    aura.encounterOwned !== true &&
    aura.unbreakableControl !== true &&
    finitePositive(aura.value) &&
    finitePositive(aura.remaining) &&
    finitePositive(aura.duration)
  );
}

/** Whether a save taken at this x sits inside an instanced PvP match band. */
export function isInstancedMatchPos(x: number): boolean {
  return isArenaPos(x) || isBgPos(x) || isYumiMazePos(x);
}

/** Snapshot the wearer's persistable buffs as remaining-time records, in aura
 *  order. Returns undefined when there is nothing to keep, so a character with
 *  no buffs serializes byte-identically to a save from before this field. */
export function serializePersistedAuras(
  auras: readonly Aura[],
  wearerId: number,
): SavedAura[] | undefined {
  const out: SavedAura[] = [];
  for (const a of auras) {
    if (out.length >= MAX_PERSISTED_AURAS) break;
    if (!isPersistableAura(a)) continue;
    if (CASTER_BOUND_AURA_IDS.has(a.id) && a.sourceId !== wearerId) continue;
    const remaining = round2(a.remaining);
    if (!(remaining > 0)) continue;
    out.push({
      id: a.id,
      name: a.name,
      kind: a.kind,
      remaining,
      duration: round2(a.duration),
      value: a.value,
      ...(finite(a.value2) ? { value2: a.value2 } : {}),
      ...(finite(a.value3) ? { value3: a.value3 } : {}),
      ...(finite(a.stacks) ? { stacks: a.stacks } : {}),
      ...(finite(a.charges) ? { charges: a.charges } : {}),
      ...(finite(a.icd) ? { icd: a.icd } : {}),
      ...(finite(a.icdMax) ? { icdMax: a.icdMax } : {}),
      ...(finite(a.tickInterval) ? { tickInterval: a.tickInterval } : {}),
      ...(finite(a.tickTimer) ? { tickTimer: a.tickTimer } : {}),
      school: a.school,
      ...(a.sourceId === wearerId ? { self: true as const } : {}),
      ...(a.flask === true ? { flask: true as const } : {}),
      ...(a.undispellable === true ? { undispellable: true as const } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

/** The aura half of a save: the two recovery sicknesses' dedicated fields
 *  (null when not worn; they restore through spirit.ts so their stat drain
 *  re-applies, which is why they stay out of the buff list) plus the sparse
 *  `auras` list, absent when there are no buffs to keep or when the save is
 *  taken inside an instanced match or a Fiesta bout (see the header). */
export function auraSaveFragment(
  e: Pick<Entity, 'auras' | 'id' | 'pos'>,
  inFiestaBout: boolean,
): { resSickness: number | null; unstuckSickness: number | null; auras?: SavedAura[] } {
  // The Keeper's Toll persists across logout (it cannot be shed by relogging).
  const resSickness = e.auras.find((a) => a.id === RESURRECTION_SICKNESS_ID)?.remaining ?? null;
  // Unstuck Sickness persists across logout for the same reason.
  const unstuckSickness = e.auras.find((a) => a.id === UNSTUCK_SICKNESS_ID)?.remaining ?? null;
  const auras =
    inFiestaBout || isInstancedMatchPos(e.pos.x)
      ? undefined
      : serializePersistedAuras(e.auras, e.id);
  return auras ? { resSickness, unstuckSickness, auras } : { resSickness, unstuckSickness };
}

const SCHOOLS: ReadonlySet<string> = new Set([
  'physical',
  'fire',
  'frost',
  'arcane',
  'shadow',
  'holy',
  'nature',
]);

/** Rebuild saved buffs into live auras for the wearer's new entity id. Every
 *  record is re-validated rather than trusted: an id or kind the shipped
 *  content no longer mints drops (a retired buff self-heals out of the save),
 *  as does a caster-bound aura the wearer did not cast, and any non-finite or
 *  non-positive time or value; durations clamp to MAX_PERSISTED_AURA_SECONDS
 *  and the remaining to its duration. A repeated id from one source keeps the
 *  later copy. */
export function restorePersistedAuras(saved: unknown, wearerId: number): Aura[] {
  if (!Array.isArray(saved)) return [];
  const out: Aura[] = [];
  for (const s of saved as Partial<SavedAura>[]) {
    if (out.length >= MAX_PERSISTED_AURAS) break;
    if (!s || typeof s !== 'object') continue;
    if (typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.kind !== 'string') {
      continue;
    }
    if (PERSISTED_AURA_ALLOWLIST.get(s.id)?.has(s.kind) !== true) continue;
    if (CASTER_BOUND_AURA_IDS.has(s.id) && s.self !== true) continue;
    if (!finitePositive(s.value) || !finitePositive(s.remaining)) continue;
    if (!finitePositive(s.duration) || typeof s.school !== 'string' || !SCHOOLS.has(s.school)) {
      continue;
    }
    const duration = Math.min(s.duration, MAX_PERSISTED_AURA_SECONDS);
    const sourceId = s.self === true ? wearerId : RESTORED_AURA_SOURCE_ID;
    // A live list never holds two same-id copies from one source (applyAura
    // replaces them), so a save that does was not written by this code: keep
    // the later copy, as a re-application would.
    const dupe = out.findIndex((a) => a.id === s.id && a.sourceId === sourceId);
    if (dupe >= 0) out.splice(dupe, 1);
    out.push({
      id: s.id,
      name: s.name,
      kind: s.kind,
      remaining: Math.min(s.remaining, duration),
      duration,
      value: s.value,
      ...(finite(s.value2) ? { value2: s.value2 } : {}),
      ...(finite(s.value3) ? { value3: s.value3 } : {}),
      ...(finite(s.stacks) ? { stacks: s.stacks } : {}),
      ...(finite(s.charges) ? { charges: s.charges } : {}),
      ...(finite(s.icd) ? { icd: s.icd } : {}),
      ...(finite(s.icdMax) ? { icdMax: s.icdMax } : {}),
      ...(finite(s.tickInterval) ? { tickInterval: s.tickInterval } : {}),
      ...(finite(s.tickTimer) ? { tickTimer: s.tickTimer } : {}),
      sourceId,
      school: s.school,
      ...(s.flask === true ? { flask: true as const } : {}),
      ...(s.undispellable === true ? { undispellable: true as const } : {}),
    });
  }
  return out;
}
