// Refresh signature for the character sheet: the cheap data digest the open
// sheet's 2 Hz slow-band poll (CharWindow.refreshIfChanged) latches on to
// rebuild when anything the open sheet shows has moved.
//
// Why this exists at all: the character sheet is a COLD window. It repaints on
// open and on the handful of edges that call renderIfOpen, so without a latch an
// already-open sheet kept showing the state from the moment it was opened. The
// first cut signed only the progression block's worn Book of Deeds cosmetics,
// the earned border badges, and the Reliquary pair plus Curator rank, and its
// header called widening it "a separate decision". That decision has been made:
// the player report was "open the sheet, cast a buff or proc something, and the
// stats do not move until I reopen it", and the same staleness hit a level up,
// a talent spec change, reputation, the non-honor currencies, Total XP and the
// Virtual Level, and the Time Played minute. The signature now covers every
// board the sheet paints, in three layers:
//
// 1. ALWAYS signed (the parts every tab shows, plus the original latch): the
//    header (name, level, archetype title, hobby craft, the honor balance, the
//    portrait skin), the worn equipment ids behind the paperdoll, and the
//    original deeds / Reliquary six-plus-one.
// 2. The Stats tab's boards and attribute tiles, signed by the RAW inputs the
//    stat model (char_stat_model_core.ts) reads, never by calling it: the stat
//    block, the attack / spell / heal power, the crit / dodge chances and
//    ratings, the shared crit bonus, the spell-only crit auras' summed bonus
//    (the Spell Crit cell adds it on top of Intellect), and the talent spec
//    (the Specialization panel). Numbers are rounded to 1e-3, which is at or finer than every
//    display precision the cells use (whole numbers, and one-decimal percents of
//    0..1 fractions), so a sub-display float wobble cannot repaint.
// 3. Per-tab terms: Reputation (faction standings, the world quest board's done
//    and total counts, and the reset countdown's displayed minute), Currencies
//    (heroic marks, honor and lifetime honor, delve marks, the faction
//    currencies), Progression (Total XP, which also drives Virtual Level and the
//    prestige readiness, prestige rank, milestone count, the Time Played
//    minute). The Skills tab is not signed here: its craft and gathering rows
//    are already latched by professionSurfaceRefreshSig on the same band, which
//    repaints this sheet too.
//
// AURAS ARE NOT SIGNED. The sheet never draws an aura (the only aura reader is
// the stat tooltip, built at hover time), and every number a buff or proc moves
// is signed above in its own right; the one stat the sheet derives from auras
// at paint time, Spell Crit, signs its aura bonus as a single number, which a
// timer, a stack or an unrelated aura never moves. Signing aura ids, stacks or timers would
// rebuild the whole open sheet up to twice a second in combat (a mob DoT, each
// stack of a debuff) for a picture that did not change.
//
// TAB AWARENESS. charSheetRefreshSigFor(world) with no tab signs the union of
// every tab's terms, so it is correct whichever tab is showing, at the price of
// a rebuild when a HIDDEN tab's data moves (the Time Played minute, for one,
// would repaint the Stats tab once a minute). Passing the CharWindow's
// active tab narrows layers 2 and 3 to the board actually on screen, and
// passing a clock adds the Reputation reset countdown's minute (the core never
// reads a clock itself). Only layer 1 stays signed on every tab.
//
// Cost: one fixed array through JSON.stringify per slow tick, the worn
// equipment record (a fixed slot count), the player's auras for the spell crit
// bonus, and, on the Reputation tab, the world quest board (a few entries). No
// stat model, no t(), no formatting. The one allocating read is
// Sim.ownedMounts(), which spreads bags AND bank into a fresh array per call,
// read only while the sheet is open (every paint re-latches, so a
// reopen is never followed by a redundant repaint).
//
// Blind spots, all accepted: a mount add plus a mount remove inside ONE 500 ms
// band cancel out (the Reliquary tracker carries the same one); a discovery that
// is not a catalogued relic moves the signature without moving the pair, costing
// one repaint of identical HTML (both pinned in tests/char_sheet_sig_core.test.ts);
// the $WOC wallet row on the
// Currencies tab reads host wallet state, not the world, and refreshes on its own
// wallet path; per-copy worn instance edits (an enchant, a rename) move the
// paperdoll through the inventory repaint edge, not this signature. Weapon skins
// are deliberately NOT signed: they are account cosmetics the character-scoped
// pair excludes by design.
//
// It converges in BOTH hosts without an optimistic write: offline the sim setters
// are synchronous, so the next slow tick already reads the new values; online the
// mirror updates from the snapshot fields, which land well inside the 500 ms band.
//
// Deliberately IDS and NUMBERS, not resolved display text: comparing data means a
// language change (which repaints every window through its own path) does not
// masquerade as a data change.
//
// Pure and host-agnostic: no DOM, no i18n, no clock, no live world import, so a
// Vitest drives it directly with a plain object.

import { spellCritBonusFromAuras } from '../sim/combat/spell_combat';
import type { Entity, EquipSlot, WorldQuestProgress } from '../sim/types';
import { worldQuestCompletedForBoard } from '../sim/world_quest_practice';
import type { CharacterSidebarTab } from './char_view';

/** The slice of the live world the sheet signature reads (IWorld satisfies it
 *  structurally, as do test fakes). */
export interface CharSheetSigWorld {
  activeTitle: string | null;
  activeBorder: string | null;
  deedsEarned: { size: number };
  deedStats: { itemsDiscovered: { size: number } };
  reliquaryMarks: { size: number };
  ownedMounts(): readonly string[];
  reliquaryAccountFinds: { size: number };
  accountDeeds: { size: number };
  player: Pick<
    Entity,
    | 'name'
    | 'level'
    | 'skin'
    | 'stats'
    | 'attackPower'
    | 'spellPower'
    | 'healPower'
    | 'critChance'
    | 'dodgeChance'
    | 'critRating'
    | 'hasteRating'
    | 'hitRating'
    | 'sharedCritBonus'
    | 'auras'
  >;
  equipment: Readonly<Partial<Record<EquipSlot, string>>>;
  talentSpec: string | null;
  archetypeTitle: string | null;
  hobbyCraft: string | null;
  honor: number;
  lifetimeHonor: number;
  heroicMarks: number;
  delveMarks: number;
  factions: Readonly<Record<string, number>>;
  factionCurrencies: Readonly<Record<string, number>>;
  worldQuestLog: ReadonlyMap<string, WorldQuestProgress>;
  worldQuestExpiresAtMs: number;
  lifetimeXp: number;
  prestigeRank: number;
  unlockedMilestones: readonly string[];
  playtimeSeconds: number;
}

/** 1e-3 rounding: at or finer than every display precision on the sheet, so a
 *  sub-display float wobble never moves the signature. Non-finite reads sign 0. */
const r3 = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;

/** Worn item ids in slot-key order (a fixed slot set, so the order is stable). */
function equipmentDigest(equipment: Readonly<Partial<Record<EquipSlot, string>>>): string {
  let out = '';
  for (const slot in equipment) out += `${slot}=${equipment[slot as EquipSlot] ?? ''},`;
  return out;
}

/** A numeric record's values in key order (faction standings, faction currencies). */
function recordDigest(record: Readonly<Record<string, number>>): string {
  let out = '';
  for (const key in record) out += `${key}=${r3(record[key])},`;
  return out;
}

function statsTerms(world: CharSheetSigWorld): unknown[] {
  const p = world.player;
  const s = p.stats;
  return [
    r3(s.str),
    r3(s.agi),
    r3(s.sta),
    r3(s.int),
    r3(s.spi),
    r3(s.armor),
    r3(s.pvpOffense),
    r3(s.pvpDefense),
    r3(s.pvpVitality),
    r3(p.attackPower),
    r3(p.spellPower),
    r3(p.healPower),
    r3(p.critChance),
    r3(p.dodgeChance),
    r3(p.critRating),
    r3(p.hasteRating),
    r3(p.hitRating),
    r3(p.sharedCritBonus),
    r3(spellCritBonusFromAuras(p)),
    world.talentSpec,
  ];
}

function reputationTerms(world: CharSheetSigWorld, nowMs: number | undefined): unknown[] {
  let done = 0;
  for (const progress of world.worldQuestLog.values()) {
    if (worldQuestCompletedForBoard(progress)) done++;
  }
  // The countdown prints whole minutes rounded UP (worldQuestDurationText), so
  // its displayed minute is the bucket to sign; no clock, no countdown term.
  const expires = world.worldQuestExpiresAtMs;
  let minute: number | null = null;
  if (nowMs !== undefined && Number.isFinite(nowMs)) {
    minute =
      Number.isFinite(expires) && expires > nowMs ? Math.ceil((expires - nowMs) / 60_000) : 0;
  }
  return [recordDigest(world.factions), done, world.worldQuestLog.size, minute];
}

function currencyTerms(world: CharSheetSigWorld): unknown[] {
  return [
    r3(world.heroicMarks),
    r3(world.lifetimeHonor),
    r3(world.delveMarks),
    recordDigest(world.factionCurrencies),
  ];
}

function progressionTerms(world: CharSheetSigWorld): unknown[] {
  return [
    Math.floor(world.lifetimeXp),
    world.prestigeRank,
    world.unlockedMilestones.length,
    // Time Played prints whole minutes at most (playtime_view.ts playtimeParts).
    Number.isFinite(world.playtimeSeconds) ? Math.floor(world.playtimeSeconds / 60) : 0,
  ];
}

/**
 * The whole sheet's refresh signature off a live world (see the header for the
 * three layers). `tab` narrows the per-tab layer to the board on screen; absent,
 * every tab's terms are signed. `nowMs` adds the Reputation reset countdown's
 * displayed minute; absent, the countdown is not signed. Byte-stable for equal
 * input, so a repeated identical poll compares equal and repaints nothing.
 */
export function charSheetRefreshSigFor(
  world: CharSheetSigWorld,
  tab?: CharacterSidebarTab,
  nowMs?: number,
): string {
  const p = world.player;
  const all = tab === undefined;
  return JSON.stringify([
    charSheetRefreshSig({
      activeTitle: world.activeTitle,
      activeBorder: world.activeBorder,
      deedsEarned: world.deedsEarned.size,
      itemsDiscovered: world.deedStats.itemsDiscovered.size,
      marks: world.reliquaryMarks.size,
      mounts: world.ownedMounts().length,
      accountEntries: world.reliquaryAccountFinds.size + world.accountDeeds.size,
    }),
    // Layer 1: the header and the paperdoll, on every tab.
    p.name,
    p.level,
    p.skin ?? 0,
    world.archetypeTitle,
    world.hobbyCraft,
    r3(world.honor),
    equipmentDigest(world.equipment),
    // Layer 2: the Stats tab's boards and attribute tiles, only where they show.
    all || tab === 'stats' ? statsTerms(world) : null,
    // Layer 3: the board on screen, or every board when no tab is given.
    all || tab === 'reputation' ? reputationTerms(world, nowMs) : null,
    all || tab === 'currencies' ? currencyTerms(world) : null,
    all || tab === 'progression' ? progressionTerms(world) : null,
  ]);
}

/**
 * Compact signature of the progression block's deeds and Reliquary rows: the
 * active title deed id and the active border deed id (both null for "nothing
 * worn"), the earned-deed count behind the border badge row, and the
 * character-scoped Reliquary ownership sizes behind the completion pair and
 * Curator rank. Byte-stable for equal input (a fixed array through
 * JSON.stringify), so a latch comparing two signatures moves exactly when one
 * of them moves. charSheetRefreshSigFor nests it as its first slot.
 */
export function charSheetRefreshSig(parts: {
  activeTitle: string | null;
  activeBorder: string | null;
  /** deedsEarned.size: the earned border-badge row is built from that set. */
  deedsEarned: number;
  /** deedStats.itemsDiscovered.size: item relics behind the completion pair. */
  itemsDiscovered: number;
  /** reliquaryMarks.size: authored non-item marks behind the pair. */
  marks: number;
  /** ownedMounts().length: Horizons mount relics behind the pair. */
  mounts: number;
  /** reliquaryAccountFinds.size + accountDeeds.size: the account ledger halves
   *  behind the account-wide pair and border row. Optional so a host with no
   *  ledger signs exactly as before. */
  accountEntries?: number;
}): string {
  return JSON.stringify([
    parts.activeTitle,
    parts.activeBorder,
    parts.deedsEarned,
    parts.itemsDiscovered,
    parts.marks,
    parts.mounts,
    parts.accountEntries ?? 0,
  ]);
}
