import type { MaterialRarity } from '../sim/professions/gathering';
import type { PlayerProfessionSkill, ProfessionRecipeRecord } from '../sim/professions/types';
import type { WorldInteractionOutcome } from './interaction';

// Render-safe projection of a player's professions standing. Stub as of
// #1164, now real for the gathering professions (#1119): `skills` carries one
// entry per gathering profession (Mining/Logging/Herbalism), independent
// additive counters. Crafting/secondary professions still contribute nothing
// until #1120/#1125/#1126/#1140 land.
export interface PlayerProfessionsView {
  skills: readonly PlayerProfessionSkill[];
}

/** Atomic crafting progression and identity mirror. `synced` is false only on
 * an online client that has not received its first cprof value yet. */
export interface CraftingIdentityView {
  version: 1;
  synced: boolean;
  craftSkills: Readonly<Record<string, number>>;
  activeArchetype: string | null;
  pairedMajor: string | null;
  hobbyCraft: string | null;
  attunedPairs: readonly string[];
  switchCount: number;
  amendsProgress: number;
  amendsRequired: number;
  // Recipe training (Professions 2.0 Phase 9): the recipe ids this character
  // has LEARNED via an acquisition source (trainer/drop/quest), SORTED for
  // stable signatures (the server's cprof delta diffs the JSON form).
  // Grandfathered recipes (no acquisition list) are known to everyone WITHOUT
  // appearing here; full knownness is this set plus the empty-acquisition arm
  // of src/sim/professions/crafting.ts isRecipeKnown over static content.
  knownRecipes: readonly string[];
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
  reason?:
    | 'unknown_recipe'
    | 'insufficient_materials'
    | 'combo_requirement_unmet'
    | 'recipe_not_learned'
    | 'throttled'
    // Phase 8 (supersedes #1297's not_at_hub): denied because the recipe is
    // station-bound and the player is neither at a station of its type nor
    // holding an ACTIVE mobile station for that craft (the mobile arm checks
    // activity and type, never distance). The ui resolves
    // WHICH station from recipeById(recipeId)?.stationType (static content,
    // identical in both worlds): no station field rides the event.
    | 'station_required';
  // Professions 2.0 Phase 2: true only when the masterwork effect applied to
  // this craft's output. `quality` now reports the output def's static
  // quality (outputs are deterministic; the quality roll is retired).
  masterwork?: boolean;
}

// Masterwork proc surface (Professions 2.0 Phase 2): the local viewer's most
// recent masterwork proc, mirrored from the server's `masterwork` event the
// same way CraftResultView mirrors `craftResult`. Ids only, string-free per
// the IWorld seam rule; `crafter` is the crafting player's entity id. `null`
// until the first masterwork proc of the session.
export interface MasterworkView {
  recipeId: string;
  itemId: string;
  crafter: number;
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
// `craftingIdentity` is the atomic craft-skill and attunement read surface used
// by both offline Sim and online ClientWorld. The legacy scalar properties and
// transition methods remain for API compatibility, while live transitions are
// authoritative quest completion effects rather than client commands.
export interface IWorldProfessions {
  professionsState: PlayerProfessionsView;
  nodeHarvestableByMe(nodeId: string): boolean;
  harvestNode(nodeId: string): WorldInteractionOutcome;
  recipeList: readonly RecipeDef[];
  lastCraftResult: CraftResultView | null;
  lastMasterwork: MasterworkView | null;
  craftItem(recipeId: string): void;
  craftingIdentity: CraftingIdentityView;
  // Active archetype identity (#1129). null before the acceptance quest.
  activeArchetype: string | null;
  // Total successful switches this character has ever made.
  archetypeSwitchCount: number;
  // Progress accrued toward the CURRENT switch's amends requirement, and that
  // requirement itself (scales with archetypeSwitchCount; see archetype.ts).
  archetypeAmendsProgress: number;
  archetypeAmendsRequired: number;
  // The title granted by the CURRENTLY-ACTIVE pair attunement (#1130, pair-named
  // under Professions 2.0 Phase 1): the CANONICAL PAIR ID (see
  // src/sim/professions/archetype.ts archetypePairId / ARCHETYPE_PAIR_TARGETS)
  // whose named archetype title the player has earned, or null before the
  // acceptance quest has ever been completed (no "Jack of All Trades" fallback
  // under the #1129 active-archetype model, since a character has at most one
  // active pair at a time). An identifier, not localized text, per the
  // string-free IWorld seam: the ten title names live in
  // src/ui/i18n.catalog/hud_chrome.ts (`archetypePair.<pairId>`).
  archetypeTitle: string | null;
  // The explicit hobby craft (#1294), empowered up to rare rather than common.
  // For an active pair it is one of the two crafts opposite its majors, and a
  // repeatable quest can switch that choice. `null` before attunement. An
  // identifier, with the same string-free-seam rule as `archetypeTitle`: the
  // craft display name lives in src/ui/i18n.catalog/hud_chrome.ts
  // (`craftName.<craftId>`, the per-craft display-name table).
  hobbyCraft: string | null;
  // Legacy direct transition entry points kept for compatibility. Online
  // ClientWorld does not send these as commands; live changes use quests.
  acceptArchetypeQuest(craftId: string): void;
  advanceAmendsProgress(): void;
  // Attempt to switch the active archetype; blocked unless enough amends
  // progress has accrued for the current switchCount.
  switchArchetype(craftId: string): void;
  // Mobile crafting station (Professions 2.0 Phase 8, wiring the inert #1134
  // mechanic): place the viewer's own temporary station for `craftId`.
  // Specialization-gated server-side (mobile_station.ts
  // placeMobileCraftingStation); Sim validates and stores on PlayerMeta,
  // ClientWorld sends the place_mobile_station command.
  placeMobileStation(craftId: string): void;
  // Recipe training (Professions 2.0 Phase 9): learn `recipeId` from the
  // resident master at its craft's STATIC station (a mobile station never
  // satisfies training). Server-authoritative: Sim validates via
  // src/sim/professions/training.ts resolveTrain (already known, trainer
  // taught, station range, teach tier, fee), charges the tiered fee exactly
  // once on success, and emits the personal text-free `trainResult` event;
  // ClientWorld sends the train_recipe command and never decides the outcome.
  trainRecipe(recipeId: string): void;
  // The craft id of the viewer's own currently ACTIVE (placed, unexpired)
  // mobile station, or null. An identifier, string-free per the seam rule.
  // Offline this reads the live PlayerMeta slot (expiry checked against the
  // sim tick); online it mirrors the server's `mst` self-delta
  // (server/game.ts computes active-vs-expired against ITS tickCount, so the
  // client never predicts placement or reasons about tick domains). The slot
  // is transient either way: never serialized into the character save.
  activeMobileStationCraft: string | null;
}
