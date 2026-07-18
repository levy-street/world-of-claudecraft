// Pure derivation of the aura strip (the #buff-bar player buffs/debuffs and the
// #tf-debuffs target debuffs).
//
// This is the per-frame HOT core: hud.update() rendered each entity's auras every
// frame. The old renderAuras used an ad-hoc `__sig` cache + an innerHTML wipe; this
// core replaces the derivation half, and auras_painter.ts replaces the DOM half with
// a typed keyed per-aura node pool (Top risk 3: the pool's tooltip closure reads a
// LIVE mutable slot, never a captured aura).
//
// Component contract: the core is INSTANCE-PARAMETERIZED by the aura
// MODE ('all' for the buff bar, 'debuffs' for the target frame). createAurasView(mode,
// deps) preallocates a per-aura slot pool ONCE and returns a tick(entity) that mutates
// it IN PLACE and returns the SAME { slots, count } container every call, so a correct
// frame allocates no new array/object garbage (the reused-reference allocation proxy,
// tests/util/alloc_probe.ts). Two modes yield two independent views (the buff bar and
// the target debuffs are two instances, not a code fork).
//
// The DEBUFF allowlist lives in the host-agnostic sim/aura_classify leaf shared by
// the view, chat readouts, and player cancellation. This core stays DOM-free and
// i18n-MECHANISM-free (no i18n runtime import): the localized aura name + the
// formatted stack count are produced by INJECTED deps each frame (so the i18n keys
// keep firing and the painter never concats), while icon identity and duration are pure.
//
// Parity: the input is a structural subset of IWorld's Entity.auras that
// BOTH the offline Sim and the online ClientWorld mirror expose. Aura.stacks is
// OPTIONAL (the wire sends it only when > 1), so the core treats a missing stacks the
// same as 1 (no stacks badge), and a Sim-shaped aura {stacks:1} and a ClientWorld
// mirror aura {stacks:undefined} derive identical output.

import { isDebuffAura as classifyDebuffAura, DEBUFF_AURA_KINDS } from '../sim/aura_classify';
import type { AuraKind } from '../sim/types';
import type { AuraSchool } from './aura_effect';

// Re-export the shared set for the view contract and its exact-set regression test.
// Classification itself stays in the sim leaf so the HUD, chat readouts, and aura
// cancellation cannot drift apart.
export { DEBUFF_AURA_KINDS };

// Toggle auras (cast again to cancel: stealth, the druid forms, stances, Ghost
// Wolf) read as MODES, not timed effects: WoW shows no countdown under them, so
// neither do we, even though the sim backs each with a long finite duration
// (3600s). Every other aura shows a compact WoW-style remaining label (20s /
// 5m / 1h / 2d) via compactAuraDuration below.
const TOGGLE_KINDS: ReadonlySet<AuraKind> = new Set([
  'stealth',
  'form_bear',
  'form_cat',
  'form_moonkin',
  'form_shadow',
  'form_travel',
  'form_fireball',
  'battle_stance',
  'berserker_stance',
  'defensive_stance',
]);
// Ghost Wolf toggles too, but its aura rides the generic buff_speed kind (which
// Sprint also uses, 15s and very much worth a countdown), so it hides by id.
const TOGGLE_IDS: ReadonlySet<string> = new Set(['ghost_wolf']);
// The inverse override: an aura that rides a TOGGLE_KIND but is a genuine timed
// buff worth a countdown. Greater Invisibility reuses the rogue-stealth machinery
// for its vanish (kind 'stealth' with full move speed), but it is a fixed 20s
// buff, not a toggle, so it must show its remaining time like any other buff.
const TIMED_IDS: ReadonlySet<string> = new Set(['greater_invisibility']);

/** The localized single-letter unit suffixes the compact duration label uses. */
export interface DurationUnits {
  s: string;
  m: string;
  h: string;
  d: string;
}

/** WoW-style compact remaining-duration label: seconds round UP (a dot about to
 *  fall still reads 1s, never 0s), minutes/hours/days round to nearest, and a
 *  rounded value that would print a full next unit promotes instead (3599s is
 *  "1h", never "60m"). A non-finite remaining reads as permanent (no label).
 *  Pure; exported for tests. */
export function compactAuraDuration(remaining: number, units: DurationUnits): string {
  if (!Number.isFinite(remaining)) return '';
  if (remaining < 60) return `${Math.ceil(remaining)}${units.s}`;
  const m = Math.round(remaining / 60);
  if (m < 60) return `${m}${units.m}`;
  const h = Math.round(remaining / 3600);
  if (h < 24) return `${h}${units.h}`;
  return `${Math.round(remaining / 86400)}${units.d}`;
}

/** Which aura strip a view drives: every aura, buffs only (the player buff row), or
 *  debuffs only (the player debuff row and the target frame). */
export type AuraMode = 'all' | 'buffs' | 'debuffs';

/** The aura fields the core reads. A structural subset of sim `Aura` that both worlds
 *  mirror. `stacks` is optional (the wire omits it when 1). */
export interface AuraInput {
  id: string;
  name: string;
  kind: AuraKind;
  remaining: number;
  value: number;
  // Optional effect-descriptor inputs (DoT/HoT tick interval, secondary values, magic
  // school). Present on the offline Sim aura; the online ClientWorld mirror may omit
  // them, in which case auraEffectDescriptor falls back to its defaults.
  value2?: number;
  value3?: number;
  tickInterval?: number;
  school?: AuraSchool;
  stacks?: number;
  // Remaining charges on a charge-limited aura (e.g. Lightning Shield's 3 reflects). Present
  // on the offline Sim aura and mirrored over the wire; undefined for ordinary auras. When
  // present it drives the badge overlay INSTEAD of stacks (a charge count, not a stack count),
  // and unlike stacks it shows even at 1 so the player sees the shield about to drop.
  charges?: number;
  // The caster's entity id, for the "own aura" prominence on the target strip. Present on
  // the offline Sim aura and mirrored over the wire (terse `src`); an old server omits it
  // and the mirror decodes 0, which matches no player id, so the strip degrades to the
  // un-prioritized layout instead of misattributing.
  sourceId?: number;
}

/** The entity fields the core reads: just its aura list. */
export interface AurasEntityInput {
  auras: readonly AuraInput[];
}

/** Injected host helpers. The core produces localized text without importing the i18n
 *  runtime (testable with spies); each fires its key/lookup every frame so an in-game
 *  language switch lands on the next tick. */
export interface AurasDeps {
  /** The icon identity the painter resolves to a background-image URL (host:
   *  `ABILITIES[id] ? id : 'aura_' + kind`). */
  iconId(aura: AuraInput): string;
  /** The localized aura display name, for the tooltip (host: `ABILITIES[id] ?
   *  abilityDisplayName(...) : auraDisplayNameFromSource(name)`). */
  auraName(aura: AuraInput): string;
  /** The formatted stack count (host: `formatNumber(stacks, {maximumFractionDigits:0})`). */
  formatStacks(stacks: number): string;
  /** The one-line aura effect-summary HTML the tooltip prepends (or '' when the aura has
   *  no descriptor). Injected so the i18n-free core never calls t(): the host builds the
   *  localized, esc'd HTML from the pure aura_effect descriptor. */
  auraEffectHtml(aura: AuraInput): string;
  /** The localized single-letter duration unit suffixes the compact label appends
   *  (host: `t('hudChrome.unitFrame.durationUnitSeconds'/'...Minutes'/'...Hours'/
   *  '...Days')`, English s/m/h/d). Frame-constant: tick() reads them ONCE per frame
   *  (not per aura, unlike the per-aura deps above), and re-reads each frame so an
   *  in-game language switch still lands on the next tick. The host should return a
   *  REUSED object (allocation-light contract), never a fresh literal per call. */
  durationUnits(): DurationUnits;
  /** Whether the LOCAL player cast this aura (host: `a.sourceId === world.playerId`).
   *  Drives the own-aura prominence (bigger icon, sorted first) on an ownFirst view;
   *  a missing/zero sourceId (an old server's mirror) is never "own". */
  isOwn(aura: AuraInput): boolean;
}

/** One aura's derived state. All fields are mutated IN PLACE each tick; the object
 *  reference is stable across ticks (no per-frame garbage). The painter keys its node
 *  pool by `key` and copies `name`/`remaining` into a LIVE pooled record the tooltip
 *  reads. */
export interface AuraSlotState {
  /** The pool BASE key: the aura id. Stable per logical aura across frames. NOTE the id
   *  is NOT unique per entity: the sim dedups by id+sourceId (sim.ts), so one entity can
   *  carry several auras sharing an ability id from different sources (two casters' same
   *  DoT, two healers' same HoT). The painter disambiguates same-id duplicates within a
   *  frame onto distinct nodes (auras_painter.ts), so the core leaves the base id here. */
  key: string;
  /** The icon identity the painter resolves + elides by. */
  iconKey: string;
  /** Whether this aura reads as a debuff (drives the `debuff` class, not a color). */
  isDebuff: boolean;
  /** The debuff's magic school ('' for a buff), driving the WoW-style per-school
   *  border tint (data-school on the node; the stylesheet maps it to a token).
   *  PARITY: the wire sends `school` sparsely (server/game.ts omits 'physical');
   *  the decode default and this fallback are both 'physical', so a debuff tints
   *  identically under a Sim-shaped and a ClientWorld-mirror aura. */
  school: string;
  /** The remaining-duration label, or '' when effectively permanent. */
  durationText: string;
  /** The stack-count label, or '' when the aura does not stack past 1. */
  stacksText: string;
  /** The localized aura name, for the tooltip (read live by the pooled closure). */
  name: string;
  /** Raw seconds remaining, for the tooltip (read live by the pooled closure). */
  remaining: number;
  /** Whether this aura is the player's own cancelable buff (mode 'buffs', not a debuff):
   *  the buff bar offers right-click-cancel, a target's debuff strip is read-only. */
  cancelable: boolean;
  /** The one-line effect-summary HTML for the tooltip (or '' when none), read live by the
   *  pooled closure. */
  effectHtml: string;
  /** Whether the LOCAL player cast this aura (ownFirst views only, false elsewhere):
   *  drives the `own` class (bigger icon) and the own-first slot order. */
  own: boolean;
}

/** The whole strip's derived state: the reused slot pool plus the active count. Both
 *  the object and the array are reused across ticks; `count` is how many leading slots
 *  are active this frame (slots.length is the high-water capacity, never truncated, so
 *  the pooled slot references stay stable). */
export interface AurasState {
  slots: AuraSlotState[];
  count: number;
}

export interface AurasView {
  /** Derive this frame's state, mutating the reused pool in place. */
  tick(entity: AurasEntityInput): AurasState;
}

/** Whether an aura reads as a debuff: an allowlisted kind, or a negative-value stat
 *  buff (a buff_* kind whose value saps rather than grants, e.g. a mob stat-sap riding
 *  buff_int/buff_ap with a negative value). Byte-faithful to the old inline
 *  classification, lifted into the core.
 *
 *  PARITY: the `value < 0` branch fires identically in both worlds. The wire carries the
 *  aura value SPARSELY (server/game.ts WireAura sends it only when negative, the sole case
 *  that flips this classification; src/net/online.ts decodes `a.value ?? 0`), so a
 *  negative-value buff_* stat-sap shows the debuff border online and offline, and the
 *  low-tier debuff-priority aura cap (auras_painter.ts) can never hide it. The allowlisted
 *  kinds (dot, debuff_ap, ...) never depended on value and have always classified the same
 *  in both worlds (the kind is on the wire). The end-to-end encode/decode round trip is
 *  pinned in tests/snapshots.test.ts. */
export function isAuraDebuff(aura: AuraInput): boolean {
  return classifyDebuffAura(aura.kind, aura.value);
}

function makeSlotState(): AuraSlotState {
  return {
    key: '',
    iconKey: '',
    isDebuff: false,
    school: '',
    durationText: '',
    stacksText: '',
    name: '',
    remaining: 0,
    cancelable: false,
    effectHtml: '',
    own: false,
  };
}

/**
 * Build an aura view bound to one mode. The slot pool is preallocated lazily and grows
 * only to the high-water aura count (amortized zero allocation in steady state);
 * tick() mutates it in place and returns the SAME { slots, count } container every
 * call. Each createAurasView yields an INDEPENDENT view: the buff bar and
 * the target debuffs never share a pool.
 *
 * opts.ownFirst (the target strip): the LOCAL player's own auras (deps.isOwn, the
 * dots/hots you are maintaining) fill the leading slots and carry `own: true`, so
 * the painter renders yours first and bigger. Implemented as two passes over the
 * SAME aura list (own, then the rest): no sort, no per-frame allocation, and the
 * relative order within each group stays the sim-application order.
 */
export function createAurasView(
  mode: AuraMode,
  deps: AurasDeps,
  opts?: { ownFirst?: boolean },
): AurasView {
  const slots: AuraSlotState[] = [];
  const state: AurasState = { slots, count: 0 };
  const ownFirst = opts?.ownFirst === true;

  return {
    tick(entity: AurasEntityInput): AurasState {
      let count = 0;
      // Frame-constant, so read once per tick instead of per aura (it still re-reads each frame,
      // so an in-game language switch lands on the next tick).
      const units = deps.durationUnits();
      const fill = (a: AuraInput, own: boolean): void => {
        // Temporal Echo marks are shown only to the chronomancer who placed them
        // (owner 2026-07-12): another caster's echo still heals in the sim but never
        // appears in this viewer's target/focus frame. ONLY the ownFirst views (the
        // target/focus strip) carry a real sourceId and a meaningful deps.isOwn, so the
        // filter is scoped to them. The party/raid mini-strips are ownFirst:false with a
        // sourceId-less PartyMemberAura (isOwn is always false there); their foreign
        // echoes are already filtered upstream in Sim.partyInfo / the server partyWire
        // via echoVisibleTo, so re-filtering here would wrongly hide the viewer's OWN
        // marks too.
        if (ownFirst && a.kind === 'temporal_echo' && !deps.isOwn(a)) return;
        const debuff = isAuraDebuff(a);
        if (mode === 'debuffs' && !debuff) return;
        if (mode === 'buffs' && debuff) return;
        // Grow the pool only when this frame needs a slot it has never held before.
        if (count >= slots.length) slots.push(makeSlotState());
        const slot = slots[count];
        slot.key = a.id;
        slot.iconKey = deps.iconId(a);
        slot.isDebuff = debuff;
        slot.school = debuff ? (a.school ?? 'physical') : '';
        slot.durationText =
          (TOGGLE_KINDS.has(a.kind) || TOGGLE_IDS.has(a.id)) && !TIMED_IDS.has(a.id)
            ? ''
            : compactAuraDuration(a.remaining, units);
        // A charge-limited aura badges its remaining charges (shown even at 1); otherwise the
        // badge shows a stack count, and only when it stacks past 1.
        slot.stacksText =
          a.charges !== undefined
            ? deps.formatStacks(a.charges)
            : a.stacks && a.stacks > 1
              ? deps.formatStacks(a.stacks)
              : '';
        slot.name = deps.auraName(a);
        slot.remaining = a.remaining;
        // The buff bar (mode 'buffs', the player's own auras) offers right-click-cancel;
        // a helpful buff is cancelable, a debuff never. The target debuff strip
        // (mode 'debuffs') is read-only, so nothing there is cancelable.
        slot.cancelable = mode === 'buffs' && !debuff;
        slot.effectHtml = deps.auraEffectHtml(a);
        slot.own = own;
        count++;
      };
      if (ownFirst) {
        for (const a of entity.auras) if (deps.isOwn(a)) fill(a, true);
        for (const a of entity.auras) if (!deps.isOwn(a)) fill(a, false);
      } else {
        for (const a of entity.auras) fill(a, false);
      }
      state.count = count;
      return state;
    },
  };
}
