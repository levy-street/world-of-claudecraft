import type { Ante, LootTier, PickAction, VisibleCell } from '../sim/lockpick';
import type { DelveObjectiveState, RiteIntensity } from '../sim/types';
import type { WorldInteractionOutcome } from './interaction';

/** Drowned Reliquary Rite progress, surfaced so the HUD can guide the player:
 * choose = the reliquary is up and waits for a difficulty pick, playback = the
 * shrine sequence is being shown, input = the player must repeat it (current/
 * total track progress through the sequence), open = the reliquary has opened. */
export type DelveRitePhase = 'choose' | 'playback' | 'input' | 'open';

export interface DelveRiteInfo {
  phase: DelveRitePhase;
  current: number;
  total: number;
}

export interface DelveRunInfo {
  delveId: string;
  tierId: string;
  slot: number;
  origin: { x: number; z: number };
  moduleIndex: number;
  moduleCount: number;
  modules: string[];
  objective: DelveObjectiveState;
  affixes: string[];
  completed: boolean;
  exitPortalOpen: boolean;
  /** §7.6: this run rolled Bountiful: the reward chest is a purple Coffer that
   * only yields to a Hard + Premium-ante solve and guarantees a signature rare. */
  bountiful: boolean;
  /** The Drowned Reliquary Rite finale state, or null while no rite is up. */
  rite: DelveRiteInfo | null;
}

// Render-safe projection of an active lockpicking attempt. Only ever holds cells
// inside the fog window, the full lock layout never reaches the client.
export interface LockpickView {
  sessionId: string;
  objectId: number;
  w: number;
  h: number;
  col: number;
  row: number;
  page: number;
  pageCount: number;
  tries: number;
  triesTotal: number;
  lootTier: LootTier;
  allowed: Exclude<PickAction, 'abort'>[];
  visible: VisibleCell[];
  // Per-step budget (ms) for the server-authoritative clock, or null for no
  // clock. The HUD renders a countdown from this; it never enforces it.
  stepTimeoutMs: number | null;
}

export interface DelveCompanionInfo {
  companionId: string;
  entityId: number;
  rank: number;
  hp: number;
  maxHp: number;
}

export interface DelveDailyInfo {
  date: string;
  firstClearXp: string[];
  markClears: number;
}

// A Marks-vendor (Brother Halven) shop entry resolved against the player's clears:
// the static price/item plus its unlock state and a presentation breakdown of the
// gate, so the shop tab can show why a locked offer is locked. Structurally matches
// the sim's `DelveShopOffer`; both Sim and ClientWorld return that here.
export interface DelveShopOfferView {
  itemId: string;
  marks: number;
  unlocked: boolean;
  requiresHeroicClear: boolean;
  requiresClears: number; // >0 for a `clears:N` gate; 0 otherwise
}

export interface IWorldDelves {
  enterDelve(delveId: string, tierId: string): void;
  leaveDelve(): void;
  delveInteract(objectId: number): WorldInteractionOutcome;
  companionUpgrade(companionId: string): void;
  delveBuyShopItem(delveId: string, itemId: string): void;
  // Brother Halven's Marks-vendor stock for a delve, resolved against the viewer's
  // clears (unlock state per entry). The buy itself is server-authoritative.
  delveShopOffers(delveId: string): DelveShopOfferView[];
  lockpickState: LockpickView | null;
  lockpickEngage(objectId: number, ante: Ante): void;
  lockpickAction(action: PickAction): void;
  lockpickAbort(): void;
  collectDelveChestLoot(chestId: number): void;
  /** The Drowned Litany finale: pick the rite difficulty (Easy/Medium/Hard) at
   * the risen reliquary, which starts the shrine-sequence playback. */
  delveRiteChoose(intensity: RiteIntensity): void;
  delveRun: DelveRunInfo | null;
  companionState: DelveCompanionInfo | null;
  delveMarks: number;
  companionUpgrades: Record<string, number>;
  delveDaily: DelveDailyInfo;
}
