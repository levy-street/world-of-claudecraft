// Shared server-test fixtures: a bare ClientWorld plus the fake-socket family
// that drives a GameServer without a live transport. See "Server tests" in
// tests/CLAUDE.md for the idiom this module centralizes (issue #2088): before
// this module existed, each suite hand-rolled its own copy of both, so a new
// ClientWorld field needed a manual sweep across every copy (or silently
// diverged between them). New suites should import from here rather than
// hand-rolling either fixture again.

import type { ClientSession, GameServer } from '../../server/game';
import { ClientWorld } from '../../src/net/online';
import { emptyAllocation } from '../../src/sim/content/talents';
import { ALL_RECIPES } from '../../src/sim/data';
import { freshDeedStats } from '../../src/sim/deeds';
import { emptyCraftSkills } from '../../src/sim/professions/wheel';
import { emptyMoveInput, type PlayerClass } from '../../src/sim/types';

export interface BareClientOverrides {
  // Convenience key: sets BOTH cfg.playerClass and the private ownPlayerClass
  // consistently. Ignored if overrides.cfg already supplies a playerClass.
  playerClass?: PlayerClass;
  // Any other ClientWorld field (including a full replacement `cfg`), stamped
  // over the defaults below via Object.assign.
  [field: string]: unknown;
}

/**
 * A ClientWorld without the WebSocket plumbing, to drive applySnapshot/
 * onMessage directly (Object.create(ClientWorld.prototype) skips the
 * constructor, so no real socket ever opens). Mirrors every field the class
 * declares a static default for, including the crafting mirrors
 * (emptyCraftSkills() and a pre-sync craftingIdentity), which is strictly
 * more faithful to a freshly constructed online client than omitting them.
 * Constructor-only fields with no static default (characterId, the socket,
 * token, base, clientSeed) are left unset, matching what `new ClientWorld(...)`
 * itself leaves before openSocket() completes.
 *
 * `connected` defaults to true, NOT the class's own `false`: this fixture
 * exists to feed an already-open session's snapshots/events, which is what
 * every caller needs. Pass `overrides` to stamp any field (or a fresh nested
 * object like `cfg`) to a suite-specific value.
 */
export function bareClient(pid: number, overrides: BareClientOverrides = {}): ClientWorld {
  const { playerClass: playerClassOverride, ...rest } = overrides;
  const cfgOverride = rest.cfg as { playerClass?: PlayerClass } | undefined;
  const playerClass: PlayerClass =
    cfgOverride?.playerClass ?? (playerClassOverride as PlayerClass | undefined) ?? 'warrior';

  // biome-ignore lint/suspicious/noExplicitAny: the sanctioned bareClient idiom (tests/CLAUDE.md)
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass };
  c.entities = new Map();
  c.playerId = pid;
  c.ownPlayerId = pid;
  c.ownPlayerClass = playerClass;
  c.spectating = null;
  c.moveInput = emptyMoveInput();
  c.known = [];
  c.realm = '';
  c.inventory = [];
  c.bags = [null, null, null, null];
  c.vendorBuyback = [];
  c.equipment = {};
  c.equipmentInstances = {};
  c.copper = 0;
  c.accountCosmetics = {
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  };
  c.xp = 0;
  c.lifetimeXp = 0;
  c.prestigeRank = 0;
  c.restedXp = 0;
  c.unlockedMilestones = [];
  c.talents = emptyAllocation();
  c.talentSpec = null;
  c.talentRole = null;
  c.loadouts = [];
  c.activeLoadout = -1;
  c.questLog = new Map();
  c.questsDone = new Set();
  c.pendingQuestCommands = new Map();
  c.partyInfo = null;
  c.selectedDungeonDifficulty = 'normal';
  c.tradeInfo = null;
  c.duelInfo = null;
  c.bgInfo = null;
  c.arenaInfo = null;
  c.dungeonFinderInfo = null;
  c.dungeonFinderBoard = null;
  c.honor = 0;
  c.lifetimeHonor = 0;
  c.cardMinigameInfo = { queued: false, available: true, match: null };
  c.lastVcupRemainder = null;
  c.lastVcupShared = null;
  c.cupInfo = null;
  c.sportRole = null;
  c.socialInfo = null;
  c.marketInfo = null;
  c.marketCollectPending = false;
  c.mailInfo = null;
  c.mailUnread = 0;
  c.bankInfo = null;
  c.deedsEarned = new Map();
  c.deedStats = freshDeedStats();
  c.renown = 0;
  c.activeTitle = null;
  c.delveRun = null;
  c.companionState = null;
  c.riftFloor = null;
  c.riftCollisionToken = 0;
  c.lockpickState = null;
  c.delveMarks = 0;
  c.companionUpgrades = {};
  c.craftSkills = emptyCraftSkills();
  c.craftingIdentity = {
    version: 1,
    synced: false,
    craftSkills: c.craftSkills,
    activeArchetype: null,
    pairedMajor: null,
    hobbyCraft: null,
    attunedPairs: [],
    switchCount: 0,
    amendsProgress: 0,
    amendsRequired: 0,
    knownRecipes: [],
    cadenceBlockedQuests: [],
  };
  c.gatheringProficiency = {};
  c.delveClears = {};
  c.delveDaily = { date: '', firstClearXp: [], markClears: 0 };
  c.professionsState = { skills: [] };
  c.townFocus = {};
  c.nodeCooldowns = new Map();
  c.recipeList = ALL_RECIPES;
  // stationPlacements is a getter on ClientWorld (it resolves the active
  // content bundle, which wraps the builtin STATIONS on shipped hosts), so
  // the bare client already reads STATIONS without an assignment here.
  c.lastCraftResult = null;
  c.lastMasterwork = null;
  c.lastDisenchantResult = null;
  c.lastEnchantResult = null;
  c.lastSalvageResult = null;
  c.activeMobileStationCraft = null;
  c.markers = {};
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.serverTickHz = null;
  c.stableCooldownSchedules = new Map();
  c.stableNodeDeadlines = new Map();
  c.stableChargeRecharges = new Map();
  c.missingSince = new Map();
  c.pendingFacingDelta = 0;
  c.connected = true;
  c.eventQueue = [];
  c.activeFrostRings = [];
  c.activeTemporalHourglasses = [];
  c.profanityWords = [];
  c.mouselookFacing = null;
  c.lastInputSentAt = 0;
  c.lastInputSig = '';
  c.inputSeq = 0;
  c.pendingInputSeqSentAt = new Map();
  c.ackedInputSeq = 0;
  c.inputEchoSamples = [];
  c.spectateFacingPending = false;
  c.pendingSpectateFacing = null;
  c.lootRollPrompts = [];
  c.lootRollGroup = [];
  c.masterLootPrompts = [];
  c.playerFlair = new Map();
  c.mountRaceMirror = null;
  c.mountLessonActiveMirror = false;
  c.activeBossDeathZones = [];
  c.riftEventExpiresAtMs = null;

  Object.assign(c, rest);
  return c;
}

export interface FakeClient {
  // biome-ignore lint/suspicious/noExplicitAny: sent frames are untyped wire JSON, read all
  // over the calling suites (msg.t, msg.list, ...); matches the idiom's prior local type.
  sent: any[];
  // biome-ignore lint/suspicious/noExplicitAny: mirrors the `ws` field GameServer.join expects
  ws: any;
}

/** A fake WebSocket that just records every JSON.parse'd payload sent to it. */
export function fakeWs(): FakeClient {
  // biome-ignore lint/suspicious/noExplicitAny: see FakeClient.sent
  const sent: any[] = [];
  return {
    sent,
    ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) },
  };
}

/** The most recent `t: 'snap'` frame among everything sent to a fakeWs(). */
// biome-ignore lint/suspicious/noExplicitAny: sent frames are untyped wire JSON
export function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) {
    if (sent[i].t === 'snap') return sent[i];
  }
  return null;
}

/** Joins a fakeWs() to a GameServer, throwing on a join-time rejection. */
export function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
  meta: Parameters<GameServer['join']>[7] = {},
): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, cls, null, false, meta);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

/** Forces one broadcastSnapshots() pass on a GameServer under test. */
export function broadcast(server: GameServer): void {
  // biome-ignore lint/suspicious/noExplicitAny: broadcastSnapshots is a private server-loop method
  (server as any).broadcastSnapshots();
}
