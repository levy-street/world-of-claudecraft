// Recording policy for every SimEvent type the drain can carry.
//
// The recorder used to route a hand-picked handful of event types and let a
// bare `default: break` swallow the rest, which is how respawns and
// resurrection offers stayed invisible to the parse: nothing forced a
// decision when those events were added. This map is keyed by the FULL
// SimEvent type union, so adding a type to the sim fails typecheck here until
// someone classifies it. The classification is the decision record.
//
// - routed: the recorder has a bespoke handler (attribution, rollups, fight
//   opening) in recorder.ts.
// - record: shipped verbatim to the fight of the event's actor; no rollup.
//   Combat-meaningful state changes with no bespoke handling live here.
// - skip: cosmetic, UI-only, or non-combat (chat, loot, quests, cues, ...).
//   Volume or privacy, never "nobody asked yet".
//
// Regenerate the key list with scripts/parse/gen_event_policy.mjs when the
// union changes (existing decisions are kept, new types land as 'skip' with
// a TODO), or add the new key by hand; typecheck enforces completeness.
import type { SimEvent } from '../../src/sim/types';

export type EventRecordPolicy = 'routed' | 'record' | 'skip';

export const EVENT_RECORD_POLICY: Readonly<Record<SimEvent['type'], EventRecordPolicy>> = {
  arenaCountdown: 'skip',
  arenaEnd: 'skip',
  arenaFound: 'skip',
  arenaQueued: 'skip',
  arenaStart: 'skip',
  arenaUnqueued: 'skip',
  attuned: 'skip',
  attunedZone: 'skip',
  augmentChosen: 'skip',
  augmentOffer: 'skip',
  aura: 'routed',
  bank: 'skip',
  bgCountdown: 'skip',
  bgEnd: 'skip',
  bgFlag: 'skip',
  bgFound: 'skip',
  bgKill: 'skip',
  bgProposalUpdate: 'skip',
  bgProposed: 'skip',
  bgQueued: 'skip',
  bgStart: 'skip',
  bgTimeWarning: 'skip',
  bgUnqueued: 'skip',
  calendarResult: 'skip',
  cardDuelMatchEnd: 'skip',
  cardDuelMatchStart: 'skip',
  cardPlayed: 'skip',
  cardRoundResolved: 'skip',
  castStart: 'routed',
  castStop: 'routed',
  chat: 'skip',
  comboPoint: 'skip',
  commissionOrderResult: 'skip',
  companionBark: 'skip',
  craftResult: 'skip',
  damage: 'routed',
  death: 'routed',
  deedBroadcast: 'skip',
  deedUnlocked: 'skip',
  delveChestLoot: 'skip',
  delveComplete: 'skip',
  delveEntered: 'skip',
  delveFailed: 'skip',
  delveLoreUnlock: 'skip',
  delveObjectiveComplete: 'skip',
  delveRiteChoosePrompt: 'skip',
  delveRiteFeedback: 'skip',
  delveRitePulse: 'skip',
  dfProposal: 'skip',
  disenchantResult: 'skip',
  duelCountdown: 'skip',
  duelEnd: 'skip',
  duelRequest: 'skip',
  duelStart: 'skip',
  enchantResult: 'skip',
  error: 'skip',
  ferryBellHome: 'skip',
  ferryIslandArrival: 'skip',
  fiestaDown: 'skip',
  fiestaPowerup: 'skip',
  fiestaScore: 'skip',
  fiestaWave: 'skip',
  fiestaWord: 'skip',
  fishingBite: 'skip',
  fishingEarlyReel: 'skip',
  fishingEmptyHook: 'skip',
  fishingGotAway: 'skip',
  fishingResult: 'skip',
  gatherDenied: 'skip',
  gatherDowngrade: 'skip',
  gatherRareEvent: 'skip',
  gatherResult: 'skip',
  gatherToolNoNode: 'skip',
  guildInvite: 'skip',
  guildInviteCancelled: 'skip',
  guildRenamed: 'skip',
  harvestResult: 'skip',
  heal: 'routed',
  heal2: 'routed',
  honor: 'skip',
  learnAbility: 'skip',
  levelup: 'skip',
  loadoutGearResult: 'skip',
  lockpickBonus: 'skip',
  lockpickEnd: 'skip',
  lockpickOffer: 'skip',
  lockpickSession: 'skip',
  lockpickStep: 'skip',
  log: 'skip',
  loot: 'skip',
  lootRoll: 'skip',
  mailArrived: 'skip',
  mailResult: 'skip',
  mailbox: 'skip',
  masterLoot: 'skip',
  masterwork: 'skip',
  masterworkZone: 'skip',
  motdResult: 'skip',
  mountRaceCountdown: 'skip',
  mountRaceEnd: 'skip',
  mountRaceJump: 'skip',
  mountRaceStart: 'skip',
  mountTrainEnd: 'skip',
  mountTrainSession: 'skip',
  noticeboard: 'skip',
  partyInvite: 'skip',
  playerDeath: 'skip',
  prestige: 'skip',
  profTierTutorial: 'skip',
  profTrendNudge: 'skip',
  questAccepted: 'skip',
  questDone: 'skip',
  questProgress: 'skip',
  questReady: 'skip',
  readyCheckStart: 'skip',
  reliquaryIlluminationBroadcast: 'skip',
  reliquaryUnlock: 'skip',
  respawn: 'record',
  resurrectionOffer: 'record',
  riftDeathZoneClear: 'skip',
  riftDeathZoneSpawn: 'skip',
  riftForgeResult: 'skip',
  riftRaceResult: 'skip',
  riftRaceWorld: 'skip',
  riftState: 'skip',
  salvageResult: 'skip',
  skinEvent: 'skip',
  spellfx: 'skip',
  spellfxAt: 'skip',
  toolEffectResult: 'skip',
  tradeDone: 'skip',
  tradeRequest: 'skip',
  trainResult: 'skip',
  tutorialGreeting: 'skip',
  unbindResult: 'skip',
  unstuck: 'skip',
  varkhulCallout: 'skip',
  vaultCraftConsume: 'skip',
  vendor: 'skip',
  virtualLevelUp: 'skip',
  worldObjectBurning: 'skip',
  xp: 'skip',
  yumiDown: 'skip',
  yumiStatus: 'skip',
  yumiSuddenDeath: 'skip',
  yumiTeleport: 'skip',
};

/** Event types the generic `record` path ships; exported for tests. */
export const GENERIC_RECORDED_EVENT_TYPES: ReadonlySet<SimEvent['type']> = new Set(
  (Object.keys(EVENT_RECORD_POLICY) as SimEvent['type'][]).filter(
    (type) => EVENT_RECORD_POLICY[type] === 'record',
  ),
);

/**
 * The entity a generically recorded event belongs to, in the sim's own
 * precedence: a personal event's pid, else the acting entity, else the
 * target, else the source. Null when the event names nobody.
 */
export function eventActorId(ev: SimEvent): number | null {
  const fields = ev as Record<string, unknown>;
  for (const key of ['pid', 'entityId', 'targetId', 'sourceId']) {
    const value = fields[key];
    if (typeof value === 'number') return value;
  }
  return null;
}
