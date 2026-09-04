// Parity trace: the canonical, deterministic SNAPSHOT of Sim state.
//
// This module turns the live, in-place-mutated Sim world (Entity / PlayerMeta,
// both packed with Map/Set fields and presentation noise) into a stable,
// JSON-safe value that can be committed as a golden and compared with `toEqual`.
//
// Two rules make it a reliable drift detector:
//  1. VALUE SNAPSHOT, not a live reference. `canonical()` rebuilds fresh plain
//     objects/arrays, so a later in-place mutation cannot corrupt an earlier
//     frame (the immutability waiver lets the sim mutate; the sampler must copy).
//  2. DETERMINISTIC-STATE ONLY. Presentation / interpolation / session fields are
//     excluded (see ENTITY_EXCLUDE / META_EXCLUDE), so the same world always
//     yields the same sample and a real behavior change always yields a different
//     one. Floats are quantized to 1e-6 (round6); non-finite values are mapped to
//     string sentinels so JSON round-trips them losslessly.
//
// See tests/parity/CLAUDE.md for the field-selection rationale.

import type { PlayerMeta } from '../../src/sim/sim';
import type { Entity } from '../../src/sim/types';

// A JSON-safe number: either a finite number quantized to 1e-6, or a sentinel
// string for a non-finite value (Infinity shows up on e.g. Entity.detonateTimer).
export type JsonNum = number | 'Infinity' | '-Infinity' | 'NaN';

const FLOAT_QUANTUM = 1e6; // 1e-6 resolution

// Quantize a finite float to 1e-6; pass integers through untouched (avoids the
// precision loss of multiplying a large int by 1e6); map non-finite to a sentinel.
export function round6(n: number): JsonNum {
  if (Number.isNaN(n)) return 'NaN';
  if (n === Infinity) return 'Infinity';
  if (n === -Infinity) return '-Infinity';
  if (Number.isInteger(n)) return n;
  return Math.round(n * FLOAT_QUANTUM) / FLOAT_QUANTUM;
}

// ----- canonicalization -------------------------------------------------------

// A value is "inert" (a boring default) if it carries no information once
// canonicalized. Dropping inert OBJECT KEYS keeps goldens small and readable
// without losing teeth: a field flipping to/from its default makes the key
// appear/disappear, which `toEqual` still flags. Array ELEMENTS are never
// dropped (that would shift indices), only their inner object keys are filtered.
//
// An empty OBJECT `{}` is deliberately NOT inert: it must stay distinguishable
// from `null`. Some sim fields carry a meaningful null-vs-present-empty
// distinction (e.g. Entity.loot: `null` = "nothing rolled" vs
// `{copper:0,items:[]}` = "present but empty"), and the sim branches on it. An
// empty array IS inert (no such null/[] semantic distinction arises).
function isInert(v: unknown): boolean {
  if (v === null || v === undefined || v === 0 || v === false || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * Object keys whose VALUE opens a zero-bearing region: inside one, a numeric
 * 0 is INFORMATION and stays in the sample instead of being dropped as inert.
 * The flag is inherited by everything below the key, so naming a container
 * covers its whole subtree.
 *
 * Why (masterwrought Phase 12, closed at Phase 18): the Perfecting stamp
 * merges its per-slot R5 bonus into `rolled.stats` and SKIPS a share that
 * rounds to zero. Dropping inert keys made those two outcomes identical in
 * the sample: "no share written" and "a share written as 0" both canonicalize
 * to an absent key, so a change that started writing zero shares (or stopped
 * skipping them) moved no golden at all. That is the harness being blind to a
 * real behavior change, not a size optimization, and the fix is to stop
 * dropping the zero exactly where a per-copy payload lives.
 *
 * SCOPED, not global: `0` stays inert everywhere else on purpose. Entity and
 * PlayerMeta carry dozens of resting-zero fields per sample, and keeping all
 * of them would balloon every golden for no gameplay reason (the same
 * argument the inert rule was written on). A per-copy payload is small and
 * sparse, so keeping its zeros costs almost nothing. Add a key here when a new
 * sparse per-copy record grows a field whose zero is a real state.
 */
const ZERO_BEARING_CONTAINERS: ReadonlySet<string> = new Set([
  'instance', // InvSlot.instance: the per-copy ItemInstancePayload in any container
  'equipmentInstance', // PlayerMeta.equipmentInstance: the worn payloads, by slot
  'rolled', // the payload's own roll record, where the Perfecting shares land
]);

// Compare two canonical keys for a stable, deterministic Map/Set ordering:
// numbers numerically, everything else by JSON string.
function compareKeys(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export interface CanonicalOpts {
  // Drop inert object keys (default true). Digests pass false to stay faithful.
  omitDefaults?: boolean;
  // Set by the walk itself once it is INSIDE a ZERO_BEARING_CONTAINERS key, so
  // a numeric 0 there survives the inert filter. Not a caller knob: callers
  // pass omitDefaults and let the container list decide the rest.
  keepZeros?: boolean;
}

// Recursively convert any sim value into a stable, JSON-safe shape:
//  - Map  -> array of [canonicalKey, canonicalValue] pairs, sorted by key
//  - Set  -> array of canonical elements, sorted
//  - object -> new object with keys sorted (and inert keys dropped if omitting)
//  - number -> round6 (finite) or sentinel (non-finite)
//  - undefined -> null  (so JSON round-trips identically)
export function canonical(value: unknown, opts: CanonicalOpts = {}): unknown {
  const omit = opts.omitDefaults !== false;
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === 'number') return round6(value as number);
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'function') return null; // sim values are data; ignore stray fns
  if (value instanceof Map) {
    const entries = [...value.entries()]
      .map(([k, v]) => [canonical(k, opts), canonical(v, opts)] as [unknown, unknown])
      .sort((a, b) => compareKeys(a[0], b[0]));
    return entries;
  }
  if (value instanceof Set) {
    return [...value].map((v) => canonical(v, opts)).sort(compareKeys);
  }
  if (Array.isArray(value)) {
    return value.map((v) => canonical(v, opts));
  }
  if (t === 'object') {
    const out: Record<string, unknown> = {};
    const insideZeroBearing = opts.keepZeros === true;
    for (const k of Object.keys(value as object).sort()) {
      // The key's own value opens a zero-bearing region for everything BELOW
      // it; whether THIS key may be dropped is decided by the region this
      // object already sits in, which is why the two flags are read apart.
      const childOpts =
        insideZeroBearing || ZERO_BEARING_CONTAINERS.has(k) ? { ...opts, keepZeros: true } : opts;
      const cv = canonical((value as Record<string, unknown>)[k], childOpts);
      if (omit && isInert(cv) && !(insideZeroBearing && cv === 0)) continue;
      out[k] = cv;
    }
    return out;
  }
  return null;
}

// ----- digests ----------------------------------------------------------------

// 32-bit FNV-1a over a string (deterministic; no wall-clock, no Math.random).
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// 32-bit FNV-1a step folding a uint32 (4 bytes, low-first) into a running hash.
// Used by the rng draw-order log: each draw's mulberry32 output integer is folded
// in draw order, so the digest pins both how many draws happened and their order.
export function fnv1aStepU32(h: number, x: number): number {
  let r = h >>> 0;
  const u = x >>> 0;
  r ^= u & 0xff;
  r = Math.imul(r, 0x01000193);
  r ^= (u >>> 8) & 0xff;
  r = Math.imul(r, 0x01000193);
  r ^= (u >>> 16) & 0xff;
  r = Math.imul(r, 0x01000193);
  r ^= (u >>> 24) & 0xff;
  r = Math.imul(r, 0x01000193);
  return r >>> 0;
}

export const FNV_OFFSET = 0x811c9dc5;

// Digest of any value via its faithful canonical form (no default-omission, so
// nothing deterministic can hide). Stable because canonical sorts every key.
export function digest(value: unknown): string {
  return fnv1a(JSON.stringify(canonical(value, { omitDefaults: false })));
}

// Fold a window of SimEvents into one digest, preserving emit ORDER (event order
// is determined by tick iteration order, so reordering it IS drift).
export function eventDigest(events: readonly unknown[]): string {
  return digest(events);
}

// ----- samplers ---------------------------------------------------------------

// Presentation / interpolation / online-only / cosmetic Entity fields. Excluded
// on purpose: they never affect deterministic sim behavior, so sampling them
// would create false drift. (See src/sim/types.ts Entity for the field docs.)
export const ENTITY_EXCLUDE: ReadonlySet<string> = new Set([
  'name', // display/identity
  'guild', // server-set display only
  'pledgeGuild', // server-set display only (guild pledge board)
  'guildTier', // server-set display only (guild colour tier)
  'prevPos', // render interpolation
  'prevFacing',
  'dungeonEntrySeq', // transient online acknowledgement generation; never read by gameplay
  'netUpdatedAt', // online wire cadence
  'netInterval',
  'vx', // air velocity (locomotion interpolation)
  'vy',
  'vz',
  'overheadEmoteId', // overhead emote presentation
  'overheadEmoteUntil',
  'overheadEmoteSeq',
  'scale', // cosmetic
  'color',
  'skin', // appearance
  'skinCatalog',
  'potionCdRemaining', // derived display copy of potionCooldownUntil (the pinned authority)
  'firebottleCdRemaining', // derived display copy of PlayerMeta.firebottleReadyAt (the authority)
  'mainhandItemId', // render-only; "the sim never reads it for gameplay"
  'weaponSkinLoadout', // cosmetic weapon-skin selection; never read for gameplay
  'weaponSkinId', // render-only resolved weapon-skin mirror
  'equippedItems', // render-only mirror for inspect; sim never reads it for gameplay
  'equippedInstances', // render-only mirror (Enchanting); the sim reads the SOURCE (meta.equipmentInstance), never this
  'holderTier', // cosmetic wallet flair; sim never reads it
  'holderBalance',
  'stealthed', // derived cache of auras.some(a => a.kind === 'stealth'); auras is sampled
  // Rewind's per-player damage-loss ring (combat/damage_history.ts): a runtime-only
  // accumulator, never serialized or wired, rebuilt deterministically from dealDamage
  // on every host. Its EFFECT (Rewind's heal2 events) is pinned by the event digest,
  // so excluding the raw ring avoids per-combat-frame digest churn without losing
  // gameplay coverage (like wireRev above).
  'damageHistory',
  'weaponStowed', // Z-key sheathe pose; render-only, no gameplay path reads it
  'modularAppearance', // authored cosmetic look; the sim never reads it
  // Derived crit core (recalcPlayerStats): a pure function of sampled inputs
  // (gear ratings, talents, auras), like the derived meta fields below.
  'sharedCritBonus',
  // The castNth empower guard flag (combat/empower_next.ts sets it, the same
  // cast's onCastCompleted clears it): lives only inside one cast's resolution,
  // never serialized or wired. Its EFFECT (which procs fire) is pinned by the
  // event digest and procState counters.
  'castConsumedEmpower',
  // In-flight Dawn's Embrace reservation for Radiant Resonance. The observable
  // cast time, mana spend, aura removal, and heal remain in the parity digest.
  'castRadiantResonance',
]);

// Session-only / presentation / derived PlayerMeta fields. Derived fields
// (known, talentMods, fiestaMods, fiestaSpecial) are pure functions of sampled
// inputs (talents/equipment/level/augments), so excluding them avoids redundant
// drift and large nested blobs while their inputs stay pinned.
export const META_EXCLUDE: ReadonlySet<string> = new Set([
  'characterId', // DB id; not sim-deterministic offline
  'name', // identity
  'skin', // appearance
  'skinCatalog',
  'pendingSkinRank', // cosmetic skin-select (pending*)
  'pendingSkinCatalog',
  'pendingSkinItemId',
  'moveInput', // input, not state
  'joinedAt', // session-only clock
  'lastActiveTick', // session-only
  'craftThrottle', // inert since the Craft Cast System retired the shared throttle; session-only
  // Session-only sweep bookkeeping for the withered-then-ready correction
  // (farm_ready.ts): derived from sampled inputs (farmPlots' notified flags +
  // farming proficiency, both pinned) and reconstructed by every sweep, so
  // sampling it would only churn goldens; the correction's OBSERVABLE, the
  // farmReady event, rides the pinned event digest.
  'farmWitheredAnnounced',
  'away', // session-only presence
  'lastWhisperFrom', // session-only
  'marketQuery', // session-only browse query (search + filters + page)
  // Server-stamped display breakdown behind bank.bonusSlots; session-only, never
  // persisted, never sim-mutated. The bonus CAPACITY it explains IS pinned (the
  // sampled meta.bank.bonusSlots), so excluding the rows loses no gameplay net.
  'bankBonusSources',
  // Server-stamped guild membership (id + rank) behind the Guild Bank's officer
  // gate; session-only exactly like bankBonusSources (never persisted, never
  // sim-mutated, always null offline), so sampling it would churn goldens for
  // no gameplay reason. The book state it authorizes IS sim-owned and testable
  // directly (Sim.guildBanks).
  // Re-audited for Phase 2 (the officer gate now READS the stamp): the
  // exclusion stays correct because the field remains a host-injected
  // AUTHORIZATION INPUT, not sim-evolved state. Offline it is always null, so
  // every guild bank op refuses and mutates nothing there (pinned in
  // tests/guild_bank.test.ts); online only the authoritative server's sim runs
  // the ops and the client mirrors results via the maybe('guildBank')
  // snapshot. No cross-host divergence can hide behind the exclusion: the
  // state the stamp gates (Sim.guildBanks, player copper/inventory) is fully
  // sampled, so a gate misfire would surface THERE.
  'guildMembership',
  'known', // derived from class/level/talents
  'talentMods', // derived from talents (recomputed)
  'fiestaMods', // derived from talentMods + augments
  'fiestaSpecial', // derived from augments
  'bankWireRev', // runtime-only bank snapshot dirty counter; never serialized/persisted
  'vaultWireRev', // runtime-only vault snapshot dirty counter; never serialized/persisted
  'wireRev', // runtime-only wire-dirty counter; never serialized/persisted
]);

function sampleExcluding(source: Record<string, unknown>, exclude: ReadonlySet<string>): unknown {
  const filtered: Record<string, unknown> = {};
  for (const k of Object.keys(source)) {
    if (exclude.has(k)) continue;
    filtered[k] = source[k];
  }
  return canonical(filtered, { omitDefaults: true });
}

// Deterministic per-Entity sample: every gameplay field (hp/pos/auras/cooldowns/
// threat/combat/AI/loot/...) as a value copy, presentation excluded.
export function sampleEntity(e: Entity): unknown {
  return sampleExcluding(e as unknown as Record<string, unknown>, ENTITY_EXCLUDE);
}

// Deterministic per-PlayerMeta sample: the character sheet a later extraction
// could change (xp/copper/inventory/equipment/quests/arena/delve/talents/...),
// as a value copy, with session/presentation/derived fields excluded.
export function samplePlayerMeta(meta: PlayerMeta): unknown {
  return sampleExcluding(meta as unknown as Record<string, unknown>, META_EXCLUDE);
}

// ----- trace schema -----------------------------------------------------------

// One sampled instant. `state` is the digest of the FULL player + tracked-entity
// sample and is pinned EVERY frame (this is what catches trajectory drift, with
// no size cost). The verbose `players`/`entities` full samples are attached only
// on checkpoint frames (init / final / explicit snapshots) so the golden stays
// small but the start and end states stay human-readable and directly diffable.
export interface Frame {
  tick: number;
  label?: string;
  time: JsonNum;
  nextId: number;
  state: string; // digest of { players, entities } full samples — pinned every frame
  events: string; // eventDigest of the window
  rng: { draws: number; digest: string }; // cumulative draw count + rolling digest
  players?: unknown[]; // full samplePlayerMeta per player (checkpoint frames only)
  entities?: unknown[]; // full sampleEntity per player + tracked entity (checkpoint frames only)
}

// A whole recorded scenario. The golden pins this object verbatim.
export interface Trace {
  scenario: string;
  seed: number;
  sampleEvery: number;
  ticks: number; // total ticks advanced during drive()
  coverage: string[]; // which systems / shared entry points this scenario exercises
  draws: number; // total rng draws observed during drive()
  drawDigest: string; // final rolling rng draw-order digest
  frames: Frame[];
}
