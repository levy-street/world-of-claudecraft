// The HUD coordinator's own colour vocabulary, named once (the woc_log_tones.ts
// and profession_log_tones.ts precedent, applied to hud.ts by the Masterwrought
// Phase 18 sweep).
//
// hud.ts used to spell these as inline hex literals: about a hundred chat-log
// colour arguments, the map painter's canvas fills, and a handful of inline
// style colours. A chat line is written as an inline colour on a span the log
// owns, a canvas fill is a string the 2D context takes, and an inline style is
// text: none of them can read a stylesheet token, so the values have to live in
// TypeScript. Naming them here by ROLE is what makes a retune a one-file change
// instead of a sweep with misses that read as deliberate differences, and it is
// what lets tests/hud_tones.test.ts keep hud.ts itself hex-free.
//
// Three records rather than forty loose constants: the coordinator imports
// three names (its line count is ratcheted), the BG_END_LOG_COLORS record it
// already carried is the same shape, and `as const` keeps every member a
// literal type. Two families deliberately stay elsewhere: the professions
// event arms consume PROF_LOG_* from
// src/ui/hud/professions/profession_log_tones.ts (their own family seam), and
// the $WOC money surfaces consume WOC_LOG_* from woc_log_tones.ts. A value
// repeated across seams (the loot-family green, the house gold) is the SAME
// register spelled once per family on purpose: each family retunes on its own.
//
// DOM-free and deterministic (registered in tests/architecture.test.ts
// UI_PURE_CORES): constants only, no behavior.

import type { BgEndLogTone } from './hud/battleground/bg_end_banner_view';

/** The chat and combat log tones, keyed by the register a line speaks in. */
export const HUD_LOG = {
  /** The plain register: the log's default colour, avoidance lines (miss,
   *  dodge, parry), and a flavor line that carries no colour of its own. */
  PLAIN: '#ccc',
  /** A system notice in the house gold: zone welcomes, level-ups, honor, the
   *  deed and relic toasts, skill-ups, gear restored. */
  NOTICE: '#ffd100',
  /** Something went the player's way: a loot grant, a race finished, a win, a
   *  respawn, a heal landed. */
  GOOD: '#7fdc4f',
  /** Something went against the player: a loss, a timeout, sudden death. */
  BAD: '#ff7a6a',
  /** A duel or arena call (countdowns, the duel result, a draw). */
  CONTEST: '#fa6',
  /** News about the player's own things with nothing granted: mail arrived or
   *  sent, a calendar entry, the guild message of the day. */
  NEWS: '#c8f7c5',
  /** A match-critical call the player must react to now: a flag captured, the
   *  remaining-time warning, a Fiesta wave or powerup. */
  CALL: '#ffd24a',
  /** The arena queue state (queued with a position, left the queue). */
  QUEUE: '#ffa040',
  /** A gear-restore shortfall: a piece not held, a copy gone, a slot taken. */
  SHORTFALL: '#ff8a5c',
  /** Quest progress and guild notices on the parchment register. */
  PROGRESS: '#dcd29f',
  /** A muted match note: the finish cause line, a dropped flag, a neutral kill. */
  MUTED: '#cfc6a8',
  /** Another player's broadcast unlock (a deed, a relic, an Illumination). */
  BROADCAST: '#40d264',
  /** An aura gained or faded. */
  AURA: '#d8a0d8',
  /** A local chat-filter notice (ignoring, no longer ignoring). */
  FILTER: '#aaf',
  /** Experience gained. */
  XP: '#a980d8',
  /** A tip or a big dodge word: the join-channels hint, the Fiesta dodge pop. */
  TIP: '#7fd4ff',
  /** Damage the player dealt with an ability. */
  ABILITY_HIT: '#ffe97a',
  /** Damage the player dealt with an auto-attack. */
  MELEE_HIT: '#eee',
  /** Damage the player took. */
  DAMAGE_TAKEN: '#ff8877',
  /** A hit the player landed that the target blocked. */
  BLOCK_DEALT: '#b8c4d9',
  /** A hit the player blocked. */
  BLOCK_TAKEN: '#7ec8e3',
  /** Another entity died. */
  DEATH: '#aaa',
  /** The player's own death recap line. */
  DEATH_RECAP: '#ff4444',
  /** A picked lock's yield tier. */
  LOCK_YIELD: '#ffdd88',
  /** The battleground flag was taken. */
  FLAG_TAKEN: '#ff9a3c',
  /** The battleground flag was returned. */
  FLAG_RETURNED: '#9fdc7f',
  /** A kill-feed line credited to battleground team 0. */
  KILL_FEED_TEAM_A: '#ff8a7a',
  /** A kill-feed line credited to battleground team 1. */
  KILL_FEED_TEAM_B: '#7fb2ff',
  /** A Fiesta augment the player gained. */
  AUGMENT: '#ff3df0',
  /** A Fiesta augment an ally gained. */
  ALLY_AUGMENT: '#c98bff',
  /** The Fiesta powerup word pop. */
  POWERUP_POP: '#32e0ff',
  /** A relocation notice (the Yumi teleport). */
  TELEPORT: '#7fd7ff',
  /** A moment cue the player acts on now (the fishing bite). */
  CUE: '#9adcff',
  /** A delve companion's line. */
  DELVE_COMPANION: '#c9a6e0',
  /** A delve lore unlock. */
  DELVE_LORE: '#cba6f0',
  /** A soft hint the player may ignore (the crafting trend nudge). */
  HINT: '#c8b888',
} as const;

/** The combat-log register for each Thornhollow Fields finish-line tone. WHICH
 *  lines exist and what they say is the pure core's decision
 *  (hud/battleground/bg_end_banner_view.ts); only the colour lives here. Total
 *  over BgEndLogTone, so a new tone red-fails tsc rather than logging an
 *  undefined colour. */
export const BG_END_LOG_COLORS: Record<BgEndLogTone, string> = {
  resultWin: HUD_LOG.GOOD,
  resultNotWin: HUD_LOG.BAD,
  cause: HUD_LOG.MUTED,
  bonus: HUD_LOG.NOTICE,
};

/** The world map's canvas fills: the paper, the strip placeholder, the clock. */
export const MAP_TONE = {
  /** The world-strip placeholder's deep-sea tone until the plate lands. */
  STRIP_SEA: '#163058',
  /** The blank map-paper underlay a cache-miss open blits while the zone fills. */
  PAPER: '#3c3a30',
  /** The day/night clock's sun disc and its halo ring. */
  CLOCK_SUN: '#ffd45a',
  /** The day/night clock's moon disc. */
  CLOCK_MOON: '#e2e8f6',
  /** The day/night clock's phase marker and its glow. */
  CLOCK_HAND: '#fff',
  /** The dark ring that keeps the phase marker legible over the sky. */
  CLOCK_HAND_RING: '#000',
} as const;

/** The few inline style colours HUD chrome writes as text. */
export const CHROME_TONE = {
  /** The music note while music is off: a plain tan, not gold (the slash, not
   *  dimming, signals muted). */
  MUSIC_OFF: '#cdbd8e',
  /** The Heroic tag beside an item's quality and kind line. */
  HEROIC_TAG: '#e5cc80',
  /** The muted meta text beside the arena "versus" line. */
  ARENA_META: '#b6ad8c',
  /** The role chip's colour when a Discord role has no colour of its own. */
  ROLE_FALLBACK: '#888',
} as const;
