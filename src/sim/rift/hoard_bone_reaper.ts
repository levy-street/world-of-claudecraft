// Bonelord Xarreth's arena mechanics (the Buried Hoard bone boss): the Wandering
// Scythe and the Soul Harvest. The choreography is pure and shared with the
// renderer (hoard_bone_reaper_core.ts); this module is the authoritative half:
// when each is cast, who the blade hits, who releases a soul, what the boss
// gains from one that arrives, and that nothing outlives the fight.
//
// State rides HoardBossState.boneReaper; the telegraphs ride the ordinary hoard
// cue list, so views, the online mirror and cleanup (clearState drops the whole
// list and tells every client to clear) need nothing new. Draws no rng: a cast's
// route and its souls' places are seeded from the cue id.

import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import {
  BONE_SCYTHE,
  BONE_SCYTHE_TOTAL_SEC,
  type BoneScytheFrame,
  decodeScytheFrame,
  encodeScytheFrame,
  HOARD_HARVESTED_SOUL_AURA_ID,
  HOARD_SOUL_BURDEN_AURA_ID,
  isBoneReaperVariant,
  pointInScytheBlade,
  SOUL_HARVEST,
  scytheAngle,
  scytheFrameFor,
  scythePatternOf,
  scythePhase,
  scythePivot,
  soulCountFor,
  soulLifeSec,
  soulPhase,
  soulPosition,
  soulSpawnOffsets,
} from './hoard_bone_reaper_core';
import { hoardBossKit } from './hoard_boss_kits';
import { measureHoardRoom } from './hoard_room';
import { hoardMechanicDamage, hoardPressure } from './hoard_scaling';
import type { HoardBossCue, HoardBossState, RiftInstance } from './types';

export { HOARD_HARVESTED_SOUL_AURA_ID };
export const HOARD_SCYTHE_ABILITY = 'Wandering Scythe';
export const HOARD_SOUL_HARVEST_ABILITY = 'Soul Harvest';

/** Cadence. The two take turns; past half health they come faster, so a harvest
 *  can begin while the last scythe is still abroad in the room. Both carriers are
 *  sweeps, so while one lives the boss engine's busy gate holds his generic
 *  buried marks back: deliberate, the scythe and the souls ARE his floor pressure
 *  (his bone legion waves run in tickSpecialKit and are never gated). */
export const BONE_REAPER_FIRST_SEC = 7;
export const BONE_REAPER_EVERY_SEC = 17;
export const BONE_REAPER_PRESSED_EVERY_SEC = 11;
export const BONE_REAPER_PRESSED_HP = 0.5;

export interface HoardBoneReaperState {
  timer: number;
  /** 0 casts the scythe next, 1 the harvest. */
  step: 0 | 1;
  /** Sim-time seconds until each player may be hit by the blade again. */
  scytheCooldowns: Map<number, number>;
  /** Harvested Soul stacks on the boss, and what is left of their life. */
  stacks: number;
  stackRemaining: number;
}

type Emit = (ctx: SimContext, inst: RiftInstance, cue: HoardBossCue) => void;
type SweepCue = Extract<HoardBossCue, { kind: 'sweep' }>;
type MarkCue = Extract<HoardBossCue, { kind: 'mark' }>;

export function isBoneReaperCue(cue: HoardBossCue): boolean {
  return isBoneReaperVariant(cue.variant);
}

function reaperState(state: HoardBossState): HoardBoneReaperState {
  state.boneReaper ??= {
    timer: BONE_REAPER_FIRST_SEC,
    step: 0,
    scytheCooldowns: new Map(),
    stacks: 0,
    stackRemaining: 0,
  };
  return state.boneReaper;
}

/** The room in front of the boss, measured off the floor's own shell so the
 *  route fits whatever hoard this is. Falls back to a modest room. */
export function boneReaperFrame(
  inst: RiftInstance,
  boss: Entity,
): BoneScytheFrame & { halfWidth: number; clearDepth: number } {
  // Measured from where he STANDS: he is pinned there for the cast, so the
  // route's clearance round him holds wherever he was being fought. The room is
  // "clear" while it stays wide enough to leave a way round the blade.
  const room = measureHoardRoom(
    inst,
    boss,
    BONE_SCYTHE.reach + BONE_SCYTHE.wallMargin + BONE_SCYTHE.minLateral,
    BONE_SCYTHE.maxDepth + BONE_SCYTHE.reach,
  );
  return {
    ...scytheFrameFor(room.halfWidth, room.clearDepth - BONE_SCYTHE.reach, room.forwardSign),
    halfWidth: room.halfWidth,
    clearDepth: room.clearDepth,
  };
}

function castFx(ctx: SimContext, boss: Entity, ability: string, duration: number): void {
  ctx.emit({
    type: 'spellfxAt',
    x: boss.pos.x,
    z: boss.pos.z,
    school: 'shadow',
    fx: 'burst',
    ability,
    duration,
    sourceId: boss.id,
  });
}

function startScythe(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  living: number,
  emit: Emit,
): void {
  const frame = encodeScytheFrame(boneReaperFrame(inst, boss));
  // Enough players in a rare enough hoard, and a SECOND scythe comes with it: its
  // route mirrored left for right, its blade begun on the far side of the turn,
  // and (its cue id being the next one) a different route pattern. Two readable
  // hazards to thread between, never a lone player's problem. The two share the
  // per-player hit cooldown on purpose: caught between them is one hit, never two.
  // Only where the room is wide enough for the mirrored routes to stay apart: cornered
  // against a wall the two would ride the same line, so he calls just the one.
  // Three players or more, whatever the map's rarity (playtest).
  const pair = living >= BONE_SCYTHE.pairMinPlayers && frame.radius >= BONE_SCYTHE.pairMinLateral;
  for (let blade = 0; blade < (pair ? 2 : 1); blade++) {
    const carrier: HoardBossCue = {
      id: state.nextCueId++,
      kind: 'sweep',
      variant: 'bone-scythe',
      x: boss.pos.x,
      z: boss.pos.z,
      facing: boss.facing + blade * Math.PI,
      radius: blade === 0 ? frame.radius : -frame.radius,
      halfAngle: frame.halfAngle,
      remaining: BONE_SCYTHE_TOTAL_SEC,
      total: BONE_SCYTHE_TOTAL_SEC,
    };
    state.cues.push(carrier);
    emit(ctx, inst, carrier);
  }
  castFx(ctx, boss, HOARD_SCYTHE_ABILITY, BONE_SCYTHE.castSec);
  ctx.emit({
    type: 'log',
    text: `${boss.name} calls a great scythe into the room. Keep clear of its blade!`,
    color: '#9dffd0',
    entityId: boss.id,
  });
}

function startHarvest(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  players: readonly Entity[],
  emit: Emit,
): void {
  const frame = boneReaperFrame(inst, boss);
  const pressure = hoardPressure(inst.vault);
  const seed = state.nextCueId;
  const offsets = soulSpawnOffsets(
    soulCountFor(players.length, pressure.extra),
    seed,
    frame,
    frame.halfWidth,
    frame.clearDepth,
  );
  const souls: MarkCue[] = [];
  let longest = 0;
  for (const offset of offsets) {
    let x = boss.pos.x + offset.x;
    let z = boss.pos.z + frame.forwardSign * offset.f;
    // Never on top of a player: slide it along the ring's tangent until clear.
    for (let nudge = 0; nudge < 4; nudge++) {
      const crowded = players.some(
        (p) => Math.hypot(p.pos.x - x, p.pos.z - z) < SOUL_HARVEST.playerClearance,
      );
      if (!crowded) break;
      x += SOUL_HARVEST.playerClearance * (nudge % 2 === 0 ? 1 : -1.6);
      z += frame.forwardSign * 1.5;
    }
    const life = soulLifeSec(Math.hypot(boss.pos.x - x, boss.pos.z - z), pressure.speed);
    longest = Math.max(longest, life);
    souls.push({
      id: 0,
      kind: 'mark',
      variant: 'bone-soul',
      phase: 'warning',
      x,
      z,
      radius: SOUL_HARVEST.interactionRadius,
      remaining: life,
      total: life,
      // No targetId: a targeted mark is re-anchored ON its target by the
      // presentation pass (a static charge follows its player), and a soul must
      // stay where it is drawn.
    });
  }
  const carrier: HoardBossCue = {
    id: state.nextCueId++,
    kind: 'sweep',
    variant: 'bone-harvest',
    x: boss.pos.x,
    z: boss.pos.z,
    facing: boss.facing,
    radius: SOUL_HARVEST.absorbRadius,
    halfAngle: Math.PI,
    remaining: longest + 0.4,
    total: longest + 0.4,
  };
  state.cues.push(carrier);
  emit(ctx, inst, carrier);
  for (const soul of souls) {
    soul.id = state.nextCueId++;
    state.cues.push(soul);
    emit(ctx, inst, soul);
  }
  castFx(ctx, boss, HOARD_SOUL_HARVEST_ABILITY, SOUL_HARVEST.castSec);
  ctx.emit({
    type: 'log',
    text: `${boss.name} draws trapped souls toward him. Reach them before he does!`,
    color: '#9dffd0',
    entityId: boss.id,
  });
}

/** One tick of the bone kit's own clock. Called only while Xarreth is engaged. */
export function tickHoardBoneReaper(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  players: readonly Entity[],
  emit: Emit,
): void {
  const reaper = reaperState(state);
  if (reaper.stacks > 0) {
    reaper.stackRemaining -= DT;
    if (reaper.stackRemaining <= 0) {
      reaper.stacks = 0;
      applyStacks(ctx, boss, reaper);
    }
  }
  for (const [pid, left] of reaper.scytheCooldowns) {
    if (left - DT <= 0) reaper.scytheCooldowns.delete(pid);
    else reaper.scytheCooldowns.set(pid, left - DT);
  }
  reaper.timer -= DT;
  if (reaper.timer > 0) return;
  const living = players.filter((p) => !p.dead);
  if (living.length === 0) return;
  // Never two of the same at once, and never a harvest with no room to run it.
  const busy = (variant: string) => state.cues.some((cue) => cue.variant === variant);
  if (reaper.step === 0 ? busy('bone-scythe') : busy('bone-harvest')) return;
  if (reaper.step === 0) startScythe(ctx, inst, boss, state, living.length, emit);
  else startHarvest(ctx, inst, boss, state, living, emit);
  reaper.step = reaper.step === 0 ? 1 : 0;
  const pressed = boss.hp / Math.max(1, boss.maxHp) <= BONE_REAPER_PRESSED_HP;
  // The hoard's rarity presses the cadence, as it does every other boss's.
  reaper.timer =
    (pressed ? BONE_REAPER_PRESSED_EVERY_SEC : BONE_REAPER_EVERY_SEC) *
    hoardPressure(inst.vault).cadence;
}

function tickScythe(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  cue: SweepCue,
  reaper: HoardBoneReaperState,
  players: readonly Entity[],
): void {
  const elapsed = cue.total - cue.remaining;
  if (scythePhase(elapsed) !== 'active') return;
  const frame = decodeScytheFrame(cue.radius, cue.halfAngle);
  const pivot = scythePivot(cue.x, cue.z, scythePatternOf(cue.id), frame, elapsed);
  const angle = scytheAngle(cue.facing, elapsed);
  for (const player of players) {
    if (player.dead || reaper.scytheCooldowns.has(player.id)) continue;
    if (!pointInScytheBlade(pivot, angle, player.pos)) continue;
    reaper.scytheCooldowns.set(player.id, BONE_SCYTHE.hitCooldownSec);
    ctx.dealDamage(
      boss,
      player,
      hoardMechanicDamage(inst, BONE_SCYTHE.damageFraction),
      false,
      'shadow',
      HOARD_SCYTHE_ABILITY,
      'hit',
      true,
    );
    // Thrown OUT from the pivot: the hit also carries the player clear of the ring.
    // applyKnockback reads only its source's `pos`, so a boss standing at the
    // pivot is all this stand-in needs to be.
    ctx.applyKnockback(
      { ...boss, pos: { ...boss.pos, x: pivot.x, z: pivot.z } },
      player,
      BONE_SCYTHE.knockback,
    );
    ctx.emit({
      type: 'spellfxAt',
      x: player.pos.x,
      z: player.pos.z,
      school: 'shadow',
      fx: 'burst',
      ability: HOARD_SCYTHE_ABILITY,
      radius: 1.6,
      sourceId: boss.id,
    });
  }
}

/** Releasing a soul costs the player who did it: a stack of Soul Burden, more
 *  damage taken for a while. It is what stops one player sweeping the room, makes
 *  a party share the souls out, and gives a lone player a real choice between
 *  carrying the burden and feeding the boss. */
function burden(ctx: SimContext, boss: Entity, player: Entity, alone: boolean): void {
  const held = player.auras.find((aura) => aura.id === HOARD_SOUL_BURDEN_AURA_ID);
  const stacks = Math.min(SOUL_HARVEST.burdenMaxStacks, (held?.stacks ?? 0) + 1);
  player.auras = player.auras.filter((aura) => aura.id !== HOARD_SOUL_BURDEN_AURA_ID);
  ctx.applyAura(player, {
    id: HOARD_SOUL_BURDEN_AURA_ID,
    name: 'Soul Burden',
    kind: 'vulnerability',
    remaining: SOUL_HARVEST.burdenDurationSec,
    duration: SOUL_HARVEST.burdenDurationSec,
    value: stacks * (alone ? SOUL_HARVEST.soloBurdenPerStack : SOUL_HARVEST.burdenPerStack),
    stacks,
    sourceId: boss.id,
    school: 'shadow',
    encounterOwned: true,
  });
}

function applyStacks(ctx: SimContext, boss: Entity, reaper: HoardBoneReaperState): void {
  boss.auras = boss.auras.filter((aura) => aura.id !== HOARD_HARVESTED_SOUL_AURA_ID);
  if (reaper.stacks <= 0) return;
  ctx.applyAura(boss, {
    id: HOARD_HARVESTED_SOUL_AURA_ID,
    name: 'Harvested Soul',
    kind: 'buff_dmg_done',
    remaining: reaper.stackRemaining,
    duration: SOUL_HARVEST.stackDurationSec,
    value: reaper.stacks * SOUL_HARVEST.damagePerStack,
    stacks: reaper.stacks,
    sourceId: boss.id,
    school: 'shadow',
    encounterOwned: true,
  });
}

/** Resolve one soul for this tick. Returns false once it is spent: released by a
 *  player, or absorbed. Whichever comes first is final, because the cue leaves
 *  the list in the same call and nothing else reads it. */
function tickSoul(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  cue: MarkCue,
  reaper: HoardBoneReaperState,
  players: readonly Entity[],
  drawnTo: { x: number; z: number },
  emit: Emit,
): boolean {
  const elapsed = cue.total - cue.remaining;
  const phase = soulPhase(elapsed);
  const at = soulPosition(cue, drawnTo, elapsed, undefined, cue.total);
  if (phase !== 'forming') {
    // Lowest id first, so two players on one soul resolve the same way everywhere.
    const catcher = players.find(
      (p) =>
        !p.dead && Math.hypot(p.pos.x - at.x, p.pos.z - at.z) <= SOUL_HARVEST.interactionRadius,
    );
    if (catcher) {
      ctx.emit({
        type: 'spellfxAt',
        x: at.x,
        z: at.z,
        school: 'holy',
        fx: 'burst',
        ability: HOARD_SOUL_HARVEST_ABILITY,
        radius: 1.8,
        sourceId: catcher.id,
      });
      burden(ctx, boss, catcher, players.filter((p) => !p.dead).length <= 1);
      if (SOUL_HARVEST.playerRewardEnabled) {
        catcher.hp = Math.min(
          catcher.maxHp,
          catcher.hp + Math.round(catcher.maxHp * SOUL_HARVEST.playerRewardHealFraction),
        );
      }
      // Withdraw it from every client now: a zero-length cue clears its mirror.
      cue.remaining = 0;
      cue.total = 0;
      emit(ctx, inst, cue);
      return false;
    }
  }
  if (cue.remaining > 1e-8) return true;
  // The aura is the truth: if it lapsed on its own clock, the count starts over.
  if (!boss.auras.some((aura) => aura.id === HOARD_HARVESTED_SOUL_AURA_ID)) reaper.stacks = 0;
  reaper.stacks = Math.min(SOUL_HARVEST.maxStacks, reaper.stacks + 1);
  reaper.stackRemaining = SOUL_HARVEST.stackDurationSec;
  applyStacks(ctx, boss, reaper);
  ctx.emit({ type: 'spellfx', sourceId: boss.id, targetId: boss.id, school: 'shadow', fx: 'nova' });
  if (reaper.stacks === 1)
    ctx.emit({
      type: 'log',
      text: `${boss.name} devours a soul and grows stronger.`,
      color: '#ff9933',
      entityId: boss.id,
    });
  return false;
}

/** Advance one bone cue (its `remaining` is already stepped). Returns whether it
 *  stays in the list. */
export function tickHoardBoneCue(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  cue: HoardBossCue,
  players: readonly Entity[],
  emit: Emit,
): boolean {
  const reaper = reaperState(state);
  if (cue.variant === 'bone-scythe' && cue.kind === 'sweep') {
    tickScythe(ctx, inst, boss, cue, reaper, players);
    return cue.remaining > 1e-8;
  }
  if (cue.variant === 'bone-soul' && cue.kind === 'mark') {
    // Drawn to where the harvest was cast (the boss is pinned there), which is
    // also the point the renderer reads, so both walk the same line. The carrier
    // outlives every soul by construction (its life is the longest soul's plus a
    // margin), so the boss.pos fallback is a guard, never a path.
    const carrier = state.cues.find((entry) => entry.variant === 'bone-harvest');
    return tickSoul(ctx, inst, boss, cue, reaper, players, carrier ?? boss.pos, emit);
  }
  // The harvest carrier: it only holds the boss and times out; it also ends
  // early once every soul is spent, so the boss is never pinned for nothing.
  // It is first in the list, so it reads souls spent LATER this tick as still
  // present and ends one tick after the last of them: harmless, and simpler
  // than reaching into tickCues' half-built list.
  const soulsLeft = state.cues.some((entry) => entry.variant === 'bone-soul' && entry !== cue);
  const forming = cue.total - cue.remaining < SOUL_HARVEST.castSec;
  if (!soulsLeft && !forming) {
    cue.remaining = 0;
    cue.total = 0;
    emit(ctx, inst, cue);
    return false;
  }
  return cue.remaining > 1e-8;
}

/** Xarreth is a giant who stands his ground: he is pinned where he cast for as
 *  long as his scythe is abroad or a harvest has souls walking to him, which is
 *  also what keeps the blade's route clear of the melee on him. He still swings
 *  at whoever is in reach. Scoped to the hoard boss, after normal target and
 *  leash checks. */
export function holdHoardBoneReaper(ctx: SimContext, mob: Entity): boolean {
  // The same predicate the casts use (hoard_boss.ts tickSpecialKit): whoever gets
  // the scythe and the harvest is pinned for them, whatever his template is.
  if (hoardBossKit(mob.templateId) !== 'bone-legion') return false;
  const inst = ctx.riftInstances.find(
    (entry) => entry.vault && entry.partyKey !== null && entry.bossId === mob.id,
  );
  const cues = inst?.hoardBoss?.cues;
  if (!cues) return false;
  for (const cue of cues) {
    if (cue.remaining <= 0) continue;
    if (cue.variant !== 'bone-harvest' && cue.variant !== 'bone-scythe') continue;
    mob.pos.x = cue.x;
    mob.pos.z = cue.z;
    return true;
  }
  return false;
}

/** The fight reset or ended: the stacks go with it. */
export function clearHoardBoneReaper(boss: Entity | undefined, state: HoardBossState): void {
  if (boss) boss.auras = boss.auras.filter((aura) => aura.id !== HOARD_HARVESTED_SOUL_AURA_ID);
  delete state.boneReaper;
}
