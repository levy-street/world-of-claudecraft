// The character-select roster row as the server lists it (GET /api/characters).
// Its own module so the online mirror (online.ts) stays a consumer of the wire
// shape rather than its home, and DOM-free helpers (char_sort.ts,
// charselect_hints.ts) can import the type without the whole client.
import type { PlayerClass } from '../sim/types';

export interface CharacterSummary {
  id: number;
  name: string;
  class: PlayerClass;
  level: number;
  skin: number;
  online: boolean;
  forceRename: boolean;
  lastPlayed?: string | null;
  playtimeSeconds?: number;
  // Real, in-world appearance so the char-select preview matches the game. Both
  // optional for back-compat with an older server that omits them: absent
  // skinCatalog defaults to the class rig, absent hand fields show no item.
  skinCatalog?: 'class' | 'mech';
  mainhandItemId?: string | null;
  offhandItemId?: string | null;
  /** The account's active Armory weapon skin for this character (server-resolved
   *  per class + mainhand). Optional for back-compat like the fields above. */
  weaponSkinId?: string | null;
  /** THIS character's authored modular look (characters.appearance). Untrusted
   *  wire JSON: consumers normalize (normalizeAppearance) before composing.
   *  Null/absent = pre-creator character; the legacy class rig renders. */
  appearance?: Record<string, unknown> | null;
  /** Mirror of the character's saved helm-visibility preference, so the roster
   *  preview wears (or bares) the kit helm exactly as the world last saw them. */
  helmHidden?: boolean;
  /** ISO creation timestamp (server clock), for display; eligibility for the
   *  redesign token is decided server-side (appearanceRerollAvailable). */
  createdAt?: string | null;
  /** Server-decided: this character still holds its one-shot appearance
   *  redesign (created before the modular creator shipped, token unspent).
   *  Drives the roster's reroll button; flips false after a successful spend. */
  appearanceRerollAvailable?: boolean;
  /** The id of the zone this character stands in on login (server-resolved
   *  through the rejoin rule, so an instance save reads as its door's zone).
   *  Null when the save resumes at the world start; absent on an older server.
   *  Character select renders it, localized, under the level line. */
  zoneId?: string | null;
}
