// Clue Scrolls (world quests, Stage 3): the engine behind the treasure hunts a
// Clue Scroll opens (docs/design/clue-scrolls.md). It owns FUNCTIONS only; the
// state (PlayerMeta.clueHunt / clueScrollCycle / clueCasketsOpened, declared in
// world_quest_state.ts) stays on the Sim as live ctx views, and every host runs
// this identical code behind the SimContext seam.
//
// The entitlement: a character at CLUE_SCROLL_MIN_LEVEL or above who turns in
// the last rotating zone slot of the day's board earns one scroll, paid once per
// cycle (clueScrollCycle remembers the cycle that paid). The hunt: using a
// scroll draws a hunt from the authored pool through the sim's Rng, and the
// hooks below advance it one step at a time when the step's condition is met
// (landmark: a tick sweep; npc / deliver: the NPC talk; emote: the chat emote
// arm; dig: using the scroll again on the spot). The last step hands the
// casket (clue_casket.ts opens it).
//
// Language-agnostic: every event carries ids and indices, never prose (the
// client resolves clues.<huntId>.<step>). The few ctx.error refusals are plain
// English re-localized client-side by the sim_i18n matchers, like every other
// sim refusal.

import { bagPools, canAddItem } from './bags';
import {
  CLUE_HUNTS,
  CLUE_SCROLL_ITEM_ID,
  CLUE_SCROLL_MIN_LEVEL,
  CLUE_SCROLL_STACK_MAX,
  CLUE_STEP_RADIUS,
  type ClueHuntDef,
  type ClueStepDef,
  TREASURE_CASKET_ITEM_ID,
} from './content/clue_hunts';
import { zoneAt } from './data';
import {
  awardFactionReputation,
  type FactionId,
  factionDisplayName,
  factionForZone,
} from './factions';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { dist2d, type Entity, INTERACT_RANGE } from './types';
import { playerActiveWorldQuests } from './world_quest_reroll';
import { ALWAYS_ACTIVE_WORLD_QUEST_IDS } from './world_quest_rotation';

/** The persisted hunt cursor: which authored hunt, and the index of the step
 *  the player is solving next (0-based; steps before it are done). */
export interface ClueHuntProgress {
  huntId: string;
  step: number;
}

/**
 * TEST-ONLY hook. The authored pool (content/clue_hunts.ts CLUE_HUNTS) is the
 * one shipped source of hunts; a suite that needs a hunt with a known shape
 * (a landmark at a known poi, a dig at known coordinates) pushes its fixture
 * here and clears it in afterEach. While this array is non-empty it REPLACES
 * the authored pool for every lookup and pick (the sanitizer, the scroll draw,
 * the wire decoder), so a test never depends on what content shipped. Never
 * written by production code; the sim reads it only through activeCluePool().
 */
export const CLUE_HUNT_TEST_POOL: ClueHuntDef[] = [];

/** The pool every lookup and pick reads: the test hook when armed, else the shipped hunts. */
export function activeCluePool(): readonly ClueHuntDef[] {
  return CLUE_HUNT_TEST_POOL.length > 0 ? CLUE_HUNT_TEST_POOL : CLUE_HUNTS;
}

export function clueHuntById(huntId: string): ClueHuntDef | undefined {
  return activeCluePool().find((hunt) => hunt.id === huntId);
}

/**
 * The one load/decode sanitizer for a hunt cursor (the character save and the
 * `cluh` self key both run through it). A cursor naming a hunt that is not in
 * the pool restores to null BY DESIGN: a retired hunt returns nothing, the
 * player simply has no hunt (a scroll was already spent on it; see the design
 * page). The step is clamped to [0, steps.length - 1].
 */
export function sanitizeClueHunt(value: unknown): ClueHuntProgress | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<ClueHuntProgress>;
  if (typeof raw.huntId !== 'string') return null;
  const def = clueHuntById(raw.huntId);
  if (!def || def.steps.length === 0) return null;
  const step = Number.isFinite(raw.step) ? Math.floor(raw.step as number) : 0;
  return { huntId: def.id, step: Math.max(0, Math.min(def.steps.length - 1, step)) };
}

/** Lifetime casket count: a whole non-negative number, 0 for anything else. */
export function sanitizeClueCasketsOpened(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

// ---------------------------------------------------------------------------
// The entitlement

/**
 * Every rotating zone slot of the character's current board is completed:
 * one slot per WORLD_QUEST_ZONES entry (activeWorldQuestsForCycle order),
 * after the character's own reroll replacements (a rerolled slot counts once,
 * through its replacement), with the ALWAYS_ACTIVE_WORLD_QUEST_IDS dailies
 * excluded. A slot whose quest the character cannot start yet (quest.minLevel
 * above the player's level: updateWorldQuests never auto-starts it) is not on
 * their board and is not required, so the 16 to 19 bracket can complete the
 * slate the same way level 20 does. Pure: no clock, no rng, no ctx.
 */
export function worldQuestSlateComplete(
  meta: Pick<PlayerMeta, 'worldQuestCycle' | 'worldQuestReplacements' | 'worldQuestLog'>,
  playerLevel: number,
): boolean {
  if (!meta.worldQuestCycle) return false;
  const slots = playerActiveWorldQuests(meta).filter(
    (quest) => !ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(quest.id) && playerLevel >= quest.minLevel,
  );
  if (slots.length === 0) return false;
  return slots.every((quest) => meta.worldQuestLog.get(quest.id)?.state === 'completed');
}

/** True when one more scroll fits: under the stack cap AND the bags have room. */
export function canHoldAnotherClueScroll(ctx: SimContext, meta: PlayerMeta): boolean {
  if (ctx.countItem(CLUE_SCROLL_ITEM_ID, meta.entityId) >= CLUE_SCROLL_STACK_MAX) return false;
  return canAddItem(meta.inventory, bagPools(meta.bags), CLUE_SCROLL_ITEM_ID, 1);
}

/**
 * The completion arm of creditWorldQuest calls this right after the turn-in
 * lands. Pays at most once per cycle: the cycle is marked paid BEFORE the bag
 * check, so a lost scroll (stack full, bags full) is lost for the day, as the
 * design page says, and never re-rolls on the next turn-in.
 */
export function maybeAwardClueScroll(ctx: SimContext, meta: PlayerMeta, player: Entity): void {
  if (player.level < CLUE_SCROLL_MIN_LEVEL) return;
  if (!meta.worldQuestCycle || meta.clueScrollCycle === meta.worldQuestCycle) return;
  if (!worldQuestSlateComplete(meta, player.level)) return;
  meta.clueScrollCycle = meta.worldQuestCycle;
  const pid = meta.entityId;
  if (canHoldAnotherClueScroll(ctx, meta)) {
    ctx.addItem(CLUE_SCROLL_ITEM_ID, 1, pid);
    ctx.emit({ type: 'clueScrollEarned', pid });
  } else {
    ctx.emit({ type: 'clueScrollLost', pid });
  }
}

// ---------------------------------------------------------------------------
// The hunt

function withinClueRadius(player: Entity, x: number, z: number): boolean {
  const dx = player.pos.x - x;
  const dz = player.pos.z - z;
  return dx * dx + dz * dz <= CLUE_STEP_RADIUS * CLUE_STEP_RADIUS;
}

/** Standing in `zoneId` within CLUE_STEP_RADIUS (flat 2D) of the zone's poi `poiId`. */
export function atCluePoi(player: Entity, zoneId: string, poiId: string): boolean {
  const zone = zoneAt(player.pos.x, player.pos.z);
  if (zone.id !== zoneId) return false;
  const poi = zone.pois.find((entry) => entry.id === poiId);
  return poi !== undefined && withinClueRadius(player, poi.x, poi.z);
}

/** Standing in `zoneId` within CLUE_STEP_RADIUS (flat 2D) of world point (x, z). */
export function atClueSpot(player: Entity, zoneId: string, x: number, z: number): boolean {
  return zoneAt(player.pos.x, player.pos.z).id === zoneId && withinClueRadius(player, x, z);
}

/** The def and current step of the active hunt, or null when none (or retired mid-session). */
export function activeClueStep(
  meta: PlayerMeta,
): { def: ClueHuntDef; step: ClueStepDef; index: number } | null {
  const hunt = meta.clueHunt;
  if (!hunt) return null;
  const def = clueHuntById(hunt.huntId);
  const step = def?.steps[hunt.step];
  if (!def || !step) return null;
  return { def, step, index: hunt.step };
}

/**
 * Completes the current step: emits clueHuntStep with the index of the step
 * that just completed, and when it was the last one clears the hunt, hands the
 * casket and emits clueHuntDone. The owner-only `cluh` key rides wireRev.
 */
export function advanceClueHunt(ctx: SimContext, meta: PlayerMeta): void {
  const active = activeClueStep(meta);
  const hunt = meta.clueHunt;
  if (!active || !hunt) return;
  const pid = meta.entityId;
  const total = active.def.steps.length;
  hunt.step = active.index + 1;
  ctx.emit({ type: 'clueHuntStep', huntId: active.def.id, step: active.index, total, pid });
  if (hunt.step >= total) {
    meta.clueHunt = null;
    ctx.addItem(TREASURE_CASKET_ITEM_ID, 1, pid);
    ctx.emit({ type: 'clueHuntDone', huntId: active.def.id, pid });
    awardClueHuntStanding(ctx, meta, active.def);
  }
  meta.wireRev++;
}

/** Standing a finished hunt pays the faction whose land hid the treasure. A
 *  WORKING RULE: under two higher-band world quests (80 to 100 each), so the
 *  hunt tops up a day's faction progress without becoming its main source. */
export const CLUE_HUNT_STANDING = 150;

/** The faction a hunt pays: the owner of the zone its last step sits in (every
 *  authored hunt ends with a dig). Null for a zone no faction owns. */
export function clueHuntFaction(def: ClueHuntDef): FactionId | null {
  const last = def.steps[def.steps.length - 1];
  return last && 'zoneId' in last ? factionForZone(last.zoneId) : null;
}

function awardClueHuntStanding(ctx: SimContext, meta: PlayerMeta, def: ClueHuntDef): void {
  const factionId = clueHuntFaction(def);
  const player = ctx.entities.get(meta.entityId);
  if (!factionId || !player) return;
  const result = awardFactionReputation(meta, factionId, CLUE_HUNT_STANDING, player.level);
  if (result.gained <= 0) return;
  // Standing feeds the prog_<faction>_* meter deeds (no narrow dirty key), and
  // the receipt reuses the world-quest standing line the client re-localizes.
  ctx.markDeedsDirty(meta.entityId);
  ctx.emit({
    type: 'loot',
    text: `+${result.gained} ${factionDisplayName(factionId)} Standing.`,
    pid: meta.entityId,
  });
}

/** Starts `def` at step 0 (the scroll draw and the /dev clue hunt arm share it). */
export function startClueHunt(ctx: SimContext, meta: PlayerMeta, def: ClueHuntDef): void {
  meta.clueHunt = { huntId: def.id, step: 0 };
  meta.wireRev++;
  ctx.emit({
    type: 'clueHuntStarted',
    huntId: def.id,
    total: def.steps.length,
    pid: meta.entityId,
  });
}

/**
 * The `clueScroll` item-use arm (items.ts useItem, after the busy/dead gates).
 * No hunt active: draw one from the pool through ctx.rng, spend the scroll
 * (the arm's own consumeOneUnit, so the clicked copy is the one spent), start.
 * Hunt active on a dig step: standing on the spot advances it (the scroll is
 * NOT spent by a dig); elsewhere the dig is refused. Hunt active on any other
 * step: refused, nothing spent.
 */
export function useClueScroll(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  consumeOneUnit: () => void,
): void {
  const pid = meta.entityId;
  if (!meta.clueHunt) {
    const pool = activeCluePool();
    if (pool.length === 0) {
      ctx.error(pid, 'This scroll has nothing to reveal.');
      return;
    }
    const def = pool[ctx.rng.int(0, pool.length - 1)];
    consumeOneUnit();
    startClueHunt(ctx, meta, def);
    return;
  }
  const active = activeClueStep(meta);
  if (!active || active.step.kind !== 'dig') {
    ctx.error(pid, 'You are already following a clue.');
    return;
  }
  if (!atClueSpot(player, active.step.zoneId, active.step.x, active.step.z)) {
    ctx.error(pid, 'There is nothing to dig here.');
    return;
  }
  advanceClueHunt(ctx, meta);
}

/**
 * The per-tick hook (called from updateWorldQuests, the existing per-player
 * world-quest tick site, after the cycle reconcile). Resolves ONLY landmark
 * steps: one null check per tick for the many players with no hunt, one flat
 * distance check for the few on a landmark step. Emote steps resolve only
 * through onEmoteForClueHunt, never here.
 */
export function updateClueHunt(ctx: SimContext, meta: PlayerMeta, player: Entity): void {
  if (!meta.clueHunt || player.dead) return;
  const active = activeClueStep(meta);
  if (!active || active.step.kind !== 'landmark') return;
  if (atCluePoi(player, active.step.zoneId, active.step.poiId)) advanceClueHunt(ctx, meta);
}

/**
 * The NPC-talk hook (Sim.talkToNpc, before the world-quest instructor
 * claimant). Resolves `npc` steps on a template match and `deliver` steps when
 * the player carries the asked count (the items are removed, then the step
 * advances); a short delivery is refused without advancing. Never consumes the
 * talk: the NPC's ordinary quest business still runs after it. Server-
 * authoritative like the quest talk itself: the player must stand within the
 * quest-giver talk range (quests/quest_commands.ts questNpcFor's
 * INTERACT_RANGE + 2), else the talk is not a clue talk at all (the ordinary
 * quest path emits its own "Too far away.").
 */
export function onNpcTalkedForClueHunt(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  npc: Entity,
): void {
  if (!meta.clueHunt || player.dead) return;
  if (dist2d(player.pos, npc.pos) > INTERACT_RANGE + 2) return;
  const active = activeClueStep(meta);
  if (!active) return;
  const step = active.step;
  if (step.kind === 'npc') {
    if (npc.templateId === step.npcId) advanceClueHunt(ctx, meta);
    return;
  }
  if (step.kind !== 'deliver' || npc.templateId !== step.npcId) return;
  if (ctx.countItem(step.itemId, meta.entityId) < step.count) {
    ctx.error(meta.entityId, 'You do not have what the clue asks for.');
    return;
  }
  ctx.removeItem(step.itemId, step.count, meta.entityId);
  advanceClueHunt(ctx, meta);
}

/**
 * The emote hook (social/chat.ts, the predefined-emote arm, beside
 * onCheerForDeeds). `emoteKey` is the CANONICAL EMOTES key (the caller has
 * already resolved aliases). Resolves an `emote` step when the key matches and
 * the player stands within CLUE_STEP_RADIUS of the step's poi.
 */
export function onEmoteForClueHunt(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  emoteKey: string,
): void {
  if (!meta.clueHunt || player.dead) return;
  const active = activeClueStep(meta);
  if (!active || active.step.kind !== 'emote' || active.step.emote !== emoteKey) return;
  if (atCluePoi(player, active.step.zoneId, active.step.poiId)) advanceClueHunt(ctx, meta);
}

/** `/abandon` from the tracker (the clue_hunt_abandon command): returns nothing. */
export function abandonClueHunt(ctx: SimContext, pid?: number): void {
  const resolved = ctx.resolve(pid);
  if (!resolved) return;
  const { meta } = resolved;
  const hunt = meta.clueHunt;
  if (!hunt) return;
  meta.clueHunt = null;
  meta.wireRev++;
  ctx.emit({ type: 'clueHuntAbandoned', huntId: hunt.huntId, pid: meta.entityId });
}
