import type { MaterialRarity } from '../sim/professions/gathering';
import type { PlayerProfessionSkill, ProfessionRecipeRecord } from '../sim/professions/types';

// Render-safe projection of a player's professions standing. Stub as of
// #1164, now real for the gathering professions (#1119): `skills` carries one
// entry per gathering profession (Mining/Logging/Herbalism), independent
// additive counters. Crafting/secondary professions still contribute nothing
// until #1120/#1125/#1126/#1140 land.
export interface PlayerProfessionsView {
  skills: readonly PlayerProfessionSkill[];
}

// Static content read: the common-tier recipe list (issue #1127). A plain
// data read (no per-player state), so it needs no wire round-trip: both
// worlds serve the same content table directly (Sim from src/sim/data.ts,
// ClientWorld from the same import, since recipe content ships with the
// client bundle like every other content table).
export type RecipeDef = ProfessionRecipeRecord;

// Craft-result surface (#1127): the outcome of one craftItem command, mirrored
// from the server's `craftResult` event so the client can render a toast/log
// line without deciding the outcome itself. `null` until the first craft
// attempt of the session.
export interface CraftResultView {
  ok: boolean;
  recipeId: string;
  itemId?: string;
  count?: number;
  quality?: MaterialRarity;
  reason?: 'unknown_recipe' | 'insufficient_materials' | 'combo_requirement_unmet';
}

// The professions read-surface facet (#1164, extended by #1121/#1127/#1129). `Sim`
// (src/sim/sim.ts `professionsState`/`professionsStateFor`) and `ClientWorld`
// (src/net/online.ts, mirrored from the `prof` wire delta) both implement
// this; see src/sim/professions/CLAUDE.md for the settled wire/persistence
// key names. `nodeHarvestableByMe` (#1121) is per-VIEWER, never global:
// whether the given gather node (see src/sim/content/gather_nodes.ts, #1120)
// is harvestable right now BY THE LOCAL VIEWER specifically. Two players
// asking about the same node id can get different answers, because each
// player's respawn timer for a node is independent (see
// src/sim/professions/gathering.ts). `recipeList`/`craftItem`/`lastCraftResult`
// (#1127) are the first crafting-action members: recipes exist as content, and
// a player can craft a common-tier recipe if they have required materials.
//
// `activeArchetype`/`archetypeSwitchCount`/`archetypeAmendsProgress`/
// `archetypeAmendsRequired` plus `acceptArchetypeQuest`/`advanceAmendsProgress`/
// `switchArchetype` (#1129, superseded scope) are the active-archetype identity
// surface: per the #107 decision, all ten craft skills (above) stay purely
// additive, and archetype identity is a single active craft the player swaps via
// quest, not a conserved-mass drain. See src/sim/professions/archetype.ts for the
// full state machine and what is stubbed (quest content, not the gating logic).
export interface IWorldProfessions {
  professionsState: PlayerProfessionsView;
  nodeHarvestableByMe(nodeId: string): boolean;
  harvestNode(nodeId: string): void;
  recipeList: readonly RecipeDef[];
  lastCraftResult: CraftResultView | null;
  craftItem(recipeId: string): void;
  // Active archetype identity (#1129). null before the acceptance quest.
  activeArchetype: string | null;
  // Total successful switches this character has ever made.
  archetypeSwitchCount: number;
  // Progress accrued toward the CURRENT switch's amends requirement, and that
  // requirement itself (scales with archetypeSwitchCount; see archetype.ts).
  archetypeAmendsProgress: number;
  archetypeAmendsRequired: number;
  // The title granted by the CURRENTLY-ACTIVE archetype (#1130, re-scoped per the
  // comment on the live issue): the craft id whose named title the player has
  // earned, or null before the acceptance quest has ever been completed (no
  // "Jack of All Trades" fallback under the #1129 active-archetype model, since a
  // character has at most one active archetype at a time). An identifier, not
  // localized text, per the string-free IWorld seam: the ten title names live in
  // src/ui/i18n.catalog/hud_chrome.ts (`archetypeTitle.<craftId>`).
  archetypeTitle: string | null;
  // Stub entry point for the zone-1 acceptance quest's completion: sets the
  // chosen craft as the active archetype (first time only). See archetype.ts.
  acceptArchetypeQuest(craftId: string): void;
  // Stub entry point for one completion of the repeatable "make amends" quest.
  advanceAmendsProgress(): void;
  // Attempt to switch the active archetype; blocked unless enough amends
  // progress has accrued for the current switchCount.
  switchArchetype(craftId: string): void;
}
