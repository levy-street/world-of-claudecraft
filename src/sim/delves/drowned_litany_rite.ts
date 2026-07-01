// Drowned Reliquary Rite finale for The Drowned Litany (Phase 7). Replaces the
// lockpick chest with a seeded shrine-sequence puzzle after Sister Nhalia dies.

import { drownedLitanyChestItemsForTier } from '../content/delves/drowned_litany_loot';
import { LOCKPICK_TIER_REWARD } from '../content/delves/lockpick_tiers';
import { DELVES } from '../data';
import { DELVE_MODULE_LAYOUTS } from '../delve_layout';
import type { LootTier } from '../lockpick';
import { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import {
  type DelveRun,
  DT,
  type Entity,
  RITE_SHRINE_KINDS,
  type RiteIntensity,
  type RiteShrineKind,
} from '../types';
import { grantDelveRewards, openDelveSurfaceExit } from './runs';

const RITE_PLAYBACK_STEP = 0.6; // seconds between sequence lights
const RITE_REPEAT_GAP = 1.2; // longer dark beat between repeat playbacks
const RITE_WRONG_DMG_PCT = 0.03;

// Player-chosen difficulty. Easy shows the sequence more times and grants more
// tries but caps loot low; Hard shows it once, allows a single try, and is the only
// path to premium. `ceiling` caps the mistake-derived tier, so difficulty is strictly
// monotonic by reward. `tries` is the number of full attempts at repeating the
// sequence; a wrong touch fails the current try, and the tolerated mistake count is
// tries - 1 (the last try has no slack).
const RITE_INTENSITY: Record<
  RiteIntensity,
  { length: number; tries: number; playbacks: number; ceiling: LootTier }
> = {
  easy: { length: 4, tries: 3, playbacks: 3, ceiling: 'low' },
  medium: { length: 5, tries: 2, playbacks: 2, ceiling: 'medium' },
  hard: { length: 6, tries: 1, playbacks: 1, ceiling: 'premium' },
};

const TIER_ORDER: Record<LootTier, number> = { low: 0, medium: 1, premium: 2 };

function capTier(tier: LootTier, ceiling: LootTier): LootTier {
  return TIER_ORDER[tier] <= TIER_ORDER[ceiling] ? tier : ceiling;
}

function riteCeiling(intensity: RiteIntensity | null): LootTier {
  return RITE_INTENSITY[intensity ?? 'medium'].ceiling;
}

export type CreateDelveObjectFn = (
  ctx: SimContext,
  run: DelveRun,
  kind: string,
  pos: { x: number; y: number; z: number },
) => Entity;

export function clearDrownedLitanyRiteState(run: DelveRun): void {
  run.drownedLitanyRite = undefined;
}

export function generateRiteSequence(seed: number, length: number): RiteShrineKind[] {
  const rng = new Rng((seed ^ 0xd20ed71a) >>> 0);
  const out: RiteShrineKind[] = [];
  for (let i = 0; i < length; i++) {
    const pick = RITE_SHRINE_KINDS[rng.int(0, RITE_SHRINE_KINDS.length - 1)];
    if (pick) out.push(pick);
  }
  return out;
}

function lootTierForMistakes(mistakes: number, mistakesAllowed: number): LootTier {
  if (mistakes === 0) return 'premium';
  if (mistakes <= mistakesAllowed) return 'medium';
  return 'low';
}

function emitPartyLog(ctx: SimContext, run: DelveRun, text: string, color: string): void {
  if (!run.partyKey) return;
  for (const pid of ctx.partyMembersForKey(run.partyKey)) {
    ctx.emit({ type: 'log', text, color, pid });
  }
}

function grantRiteBonus(ctx: SimContext, run: DelveRun, tier: LootTier): void {
  const reward = LOCKPICK_TIER_REWARD[tier];
  const delve = DELVES[run.delveId];
  const members = run.partyKey ? ctx.partyMembersForKey(run.partyKey) : [];
  const tierDef = delve.tiers.find((t) => t.id === run.tierId);
  const baseCopper = Math.round(
    ((tierDef?.copperMin ?? delve.baseRewards.copperMin) +
      (tierDef?.copperMax ?? delve.baseRewards.copperMax)) /
      2,
  );
  const bonusCopper = Math.round(baseCopper * (reward.copperMult - 1));
  for (const pid of members) {
    const meta = ctx.players.get(pid);
    if (!meta) continue;
    meta.delveMarks += reward.bonusMarks;
    meta.copper += bonusCopper;
    ctx.emit({ type: 'lockpickBonus', tier, marks: reward.bonusMarks, copper: bonusCopper, pid });
  }
}

export function spawnDrownedLitanyRite(
  ctx: SimContext,
  run: DelveRun,
  zBase: number,
  createObject: CreateDelveObjectFn,
): void {
  const moduleId = run.modules[run.moduleIndex] ?? 'litany_apse';
  const layout = DELVE_MODULE_LAYOUTS[moduleId as keyof typeof DELVE_MODULE_LAYOUTS];
  const dais = layout?.dais ?? { x: 0, z: 52 };
  const reliquaryLocalZ = dais.z - 12;
  const reliquaryPos = ctx.groundPos(run.origin.x + dais.x, run.origin.z + zBase + reliquaryLocalZ);

  const reliquary = createObject(ctx, run, 'drowned_reliquary', reliquaryPos);
  reliquary.facing = Math.PI;
  reliquary.prevFacing = Math.PI;
  run.rewardChestId = reliquary.id;

  const shrineOffsets: Record<RiteShrineKind, { x: number; z: number }> = {
    rite_shrine_bell: { x: 0, z: reliquaryLocalZ - 8 },
    rite_shrine_candle: { x: 0, z: reliquaryLocalZ + 8 },
    rite_shrine_reed: { x: -8, z: reliquaryLocalZ },
    rite_shrine_skull: { x: 8, z: reliquaryLocalZ },
  };
  const shrineEntityIds = {} as Record<RiteShrineKind, number>;
  for (const kind of RITE_SHRINE_KINDS) {
    const off = shrineOffsets[kind];
    const pos = ctx.groundPos(run.origin.x + dais.x + off.x, run.origin.z + zBase + off.z);
    const shrine = createObject(ctx, run, kind, pos);
    shrineEntityIds[kind] = shrine.id;
  }

  // The rite waits for the player to choose a difficulty at the reliquary before
  // the sequence is generated and playback begins (chooseDrownedLitanyRiteIntensity).
  run.drownedLitanyRite = {
    awaitingChoice: true,
    intensity: null,
    sequence: [],
    currentIndex: 0,
    mistakes: 0,
    mistakesAllowed: 0,
    tries: 0,
    playbacks: 0,
    playbackLoop: 0,
    puzzleActive: false,
    sequencePlaying: false,
    playbackIndex: 0,
    playbackTimer: RITE_PLAYBACK_STEP,
    shrineEntityIds,
    reliquaryId: reliquary.id,
    opened: false,
  };

  emitPartyLog(
    ctx,
    run,
    'Sister Nhalia falls silent. The Drowned Reliquary rises from the blackwater. Approach it to begin the rite.',
    '#8f8',
  );
}

/** Lock in the chosen difficulty: generate the seeded sequence and start playback.
 * Shared per run (the first chooser commits it); returns false if not awaiting. */
export function chooseDrownedLitanyRiteIntensity(
  ctx: SimContext,
  run: DelveRun,
  intensity: RiteIntensity,
): boolean {
  const st = run.drownedLitanyRite;
  if (!st || !st.awaitingChoice) return false;
  const cfg = RITE_INTENSITY[intensity] ?? RITE_INTENSITY.medium;
  st.awaitingChoice = false;
  st.intensity = intensity;
  st.sequence = generateRiteSequence(run.seed, cfg.length);
  st.currentIndex = 0;
  st.mistakes = 0;
  st.tries = cfg.tries;
  st.mistakesAllowed = cfg.tries - 1;
  st.playbacks = cfg.playbacks;
  st.playbackLoop = 0;
  st.puzzleActive = true;
  st.sequencePlaying = true;
  st.playbackIndex = 0;
  st.playbackTimer = RITE_PLAYBACK_STEP;
  // No log here: the popup closes and the shrine pulses are the cue that playback
  // has begun (and the "shrines fall dark" line follows when it is the player's turn).
  return true;
}

function openDrownedReliquary(
  ctx: SimContext,
  run: DelveRun,
  tier: LootTier,
  openerId: number,
): void {
  const st = run.drownedLitanyRite;
  if (!st || st.opened) return;
  st.opened = true;
  st.puzzleActive = false;
  st.sequencePlaying = false;

  const state = run.objectState[st.reliquaryId];
  const obj = ctx.entities.get(st.reliquaryId);
  const ownerCls = ctx.players.get(openerId)?.cls ?? 'warrior';
  const isCoffer = run.bountiful && st.reliquaryId === run.rewardChestId;
  const items = drownedLitanyChestItemsForTier(tier, ownerCls, ctx.rng, isCoffer);
  if (state) {
    state.looted = true;
    state.open = true;
    state.triggered = true;
    state.lootedTier = tier;
    state.pendingLoot = items.map((s) => ({ ...s }));
  }
  if (obj) {
    obj.name = 'Opened Drowned Reliquary';
    obj.templateId = 'delve_drowned_reliquary_open';
  }
  grantDelveRewards(ctx, run);
  grantRiteBonus(ctx, run, tier);
  openDelveSurfaceExit(ctx, run);
  ctx.emit({ type: 'delveChestLoot', chestId: st.reliquaryId, items, pid: openerId });
  emitPartyLog(ctx, run, 'The Drowned Reliquary opens.', '#8cf');
}

export function tickDrownedLitanyRite(ctx: SimContext, run: DelveRun): void {
  const st = run.drownedLitanyRite;
  if (!st?.puzzleActive || !st.sequencePlaying) return;

  st.playbackTimer -= DT;
  if (st.playbackTimer > 0) return;

  const kind = st.sequence[st.playbackIndex];
  if (kind) {
    const shrineId = st.shrineEntityIds[kind];
    ctx.emit({ type: 'delveRitePulse', shrineId, shrineKind: kind });
  }
  st.playbackIndex += 1;
  st.playbackTimer = RITE_PLAYBACK_STEP;

  if (st.playbackIndex >= st.sequence.length) {
    st.playbackLoop += 1;
    if (st.playbackLoop < st.playbacks) {
      // Replay the sequence again (Easy shows it 3x, Medium 2x, Hard 1x), with a
      // longer dark beat so the repeat reads as a fresh pass.
      st.playbackIndex = 0;
      st.playbackTimer = RITE_REPEAT_GAP;
    } else {
      st.sequencePlaying = false;
      st.playbackIndex = 0;
      emitPartyLog(ctx, run, 'The shrines fall dark. Repeat the sequence.', '#8cf');
    }
  }
}

export function interactDrownedLitanyRite(
  ctx: SimContext,
  run: DelveRun,
  objectId: number,
  pid: number,
): boolean {
  const st = run.drownedLitanyRite;
  if (!st) return false;

  const state = run.objectState[objectId];
  if (!state) return false;

  if (state.kind === 'drowned_reliquary') {
    if (state.looted && state.pendingLoot?.length) {
      return false; // let collectDelveChestLoot handle
    }
    if (state.open) {
      ctx.emit({ type: 'log', text: 'The reliquary is empty.', color: '#aaa', pid });
      return true;
    }
    if (st.awaitingChoice) {
      // Open the difficulty popup client-side (personal cue).
      ctx.emit({ type: 'delveRiteChoosePrompt', reliquaryId: objectId, pid });
      return true;
    }
    ctx.error(pid, 'Complete the shrine rite to open the reliquary.');
    return true;
  }

  const shrineKind = state.kind as RiteShrineKind;
  if (!RITE_SHRINE_KINDS.includes(shrineKind)) return false;

  // Ignore shrine clicks before a difficulty is chosen at the reliquary.
  if (st.awaitingChoice) return true;
  if (!st.puzzleActive || st.opened) return true;
  if (st.sequencePlaying) {
    ctx.error(pid, 'The shrines replay the rite. Wait.');
    return true;
  }

  const expected = st.sequence[st.currentIndex];
  if (shrineKind === expected) {
    st.currentIndex += 1;
    ctx.emit({ type: 'delveRiteFeedback', shrineId: objectId, shrineKind, correct: true, pid });
    emitPartyLog(ctx, run, 'A soft chime answers your touch.', '#8f8');
    if (st.currentIndex >= st.sequence.length) {
      const tier = capTier(
        lootTierForMistakes(st.mistakes, st.mistakesAllowed),
        riteCeiling(st.intensity),
      );
      openDrownedReliquary(ctx, run, tier, pid);
    }
    return true;
  }

  st.mistakes += 1;
  ctx.emit({ type: 'delveRiteFeedback', shrineId: objectId, shrineKind, correct: false, pid });
  emitPartyLog(ctx, run, 'A harsh bell crack. Black water splashes at your feet.', '#f88');
  const player = ctx.entities.get(pid);
  if (player && !player.dead) {
    const dmg = Math.max(1, Math.round(player.maxHp * RITE_WRONG_DMG_PCT));
    ctx.dealDamage(player, player, dmg, false, 'physical', null, 'hit', false);
  }

  if (st.mistakes > st.mistakesAllowed) {
    // Out of tries: the reliquary opens on its meanest spoils.
    openDrownedReliquary(ctx, run, 'low', pid);
    return true;
  }

  // Tries remain: the wrong touch failed this attempt, so replay the sequence one
  // more time and restart input from the top. Setting playbackLoop to the final pass
  // reuses tickDrownedLitanyRite to show a single reminder pass before "the shrines
  // fall dark" cues the player's turn again.
  st.currentIndex = 0;
  st.sequencePlaying = true;
  st.playbackIndex = 0;
  st.playbackLoop = Math.max(0, st.playbacks - 1);
  st.playbackTimer = RITE_REPEAT_GAP;
  return true;
}
