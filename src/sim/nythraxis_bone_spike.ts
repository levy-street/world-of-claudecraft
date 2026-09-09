// Bone Spike: Nythraxis impales raiders on spikes the DPS must shatter.
//
// On each cast the boss picks NYTHRAXIS_BONE_SPIKE_VICTIMS distinct players
// (anyone but the aggro holder, minus raiders already carrying a personal
// mechanic), pins each under an unbreakable, encounter-owned stun (the client
// drapes the death pose over it), and raises a stationary Bone Spike mob at the
// victim's feet. The victim drains a fraction of max hp every second until the
// spike dies; killing it frees them at once. The pure pieces live here (tuning,
// eligibility, the aura shape, the spike template contract); the driver in
// encounters/nythraxis.ts owns the cadence, the rng picks, the spawns, and the
// drain ticks.
//
// `src/sim`-pure: no rng, no wall clock, no DOM.

import type { DungeonDifficulty, Entity } from './types';

export const NYTHRAXIS_BONE_SPIKE_ID = 'nythraxis_bone_spike';
export const NYTHRAXIS_BONE_SPIKE_CAST_ID = 'Bone Spike';
export const NYTHRAXIS_IMPALED_AURA_ID = 'nythraxis_impaled';
export const NYTHRAXIS_IMPALED_AURA_NAME = 'Impaled';
export const NYTHRAXIS_BONE_SPIKE_FIRST_SECONDS = 12;
export const NYTHRAXIS_BONE_SPIKE_EVERY_NORMAL = 24;
export const NYTHRAXIS_BONE_SPIKE_EVERY_HEROIC = 20;
/**
 * Spikes and fire never overlap (owner playtest, 2026-09-04: raiders pinned in
 * a circle they were about to leave). A spike cast holds while a Grave
 * Eruption is telegraphing and for this long after it lands; an eruption holds
 * this long after a spike wave; a held cast polls again every
 * NYTHRAXIS_BONE_SPIKE_RETRY_SECONDS instead of skipping a whole cycle.
 */
export const NYTHRAXIS_BONE_SPIKE_FIRE_SETTLE_SECONDS = 3;
export const NYTHRAXIS_BONE_SPIKE_RETRY_SECONDS = 1;
/**
 * No spike lands in the run-up to Deathless Rage, so the wardstone channelers
 * are free to reach their stones; anyone still impaled when the cast begins
 * is freed by it (the calm window frees everyone).
 */
export const NYTHRAXIS_BONE_SPIKE_RAGE_LEAD_SECONDS = 8;
export const NYTHRAXIS_BONE_SPIKE_VICTIMS_NORMAL = 2;
export const NYTHRAXIS_BONE_SPIKE_VICTIMS_HEROIC = 3;
export const NYTHRAXIS_IMPALED_TICK_SECONDS = 1;
export const NYTHRAXIS_IMPALED_TICK_MAX_HP_NORMAL = 0.08;
export const NYTHRAXIS_IMPALED_TICK_MAX_HP_HEROIC = 0.1;
// The impale aura outlives any realistic spike: it is removed by the spike's
// death, the transition, a wipe, or the kill, never by its own timer.
export const NYTHRAXIS_IMPALED_AURA_SECONDS = 600;

export function nythraxisBoneSpikeCadence(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_BONE_SPIKE_EVERY_HEROIC
    : NYTHRAXIS_BONE_SPIKE_EVERY_NORMAL;
}

export function nythraxisBoneSpikeVictims(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_BONE_SPIKE_VICTIMS_HEROIC
    : NYTHRAXIS_BONE_SPIKE_VICTIMS_NORMAL;
}

export function nythraxisImpaledTickMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_IMPALED_TICK_MAX_HP_HEROIC
    : NYTHRAXIS_IMPALED_TICK_MAX_HP_NORMAL;
}

/** The impale aura this boss holds on the player, if any. */
export function nythraxisImpaledAura(player: Entity, bossId: number) {
  return player.auras.find(
    (aura) => aura.id === NYTHRAXIS_IMPALED_AURA_ID && aura.sourceId === bossId,
  );
}

export function isNythraxisImpaled(player: Entity, bossId: number): boolean {
  return nythraxisImpaledAura(player, bossId) !== undefined;
}

/**
 * Who a Bone Spike cast may pick: living players in the room, never the aggro
 * holder, never someone already impaled, never a live Soul Rend carrier (one
 * personal mechanic per raider). The order is the caller's (entity-id sorted
 * room roster), so the driver's rng.int picks stay deterministic.
 */
export function nythraxisBoneSpikeCandidates(
  room: readonly Entity[],
  bossId: number,
  aggroTargetId: number | null,
  soulRendMarkedIds: ReadonlySet<number>,
  standingInFire: (player: Entity) => boolean = () => false,
): Entity[] {
  return room.filter(
    (player) =>
      !player.dead &&
      player.id !== aggroTargetId &&
      !soulRendMarkedIds.has(player.id) &&
      !isNythraxisImpaled(player, bossId) &&
      // never pinned in fire they cannot step out of
      !standingInFire(player),
  );
}

/**
 * The wardstone channel's control gate: every stun, stasis, incapacitate, or
 * polymorph locks it EXCEPT this boss's own Impale. A spiked raider already
 * within reach of a wardstone may channel it (owner decision, 2026-09-04): the
 * spike holds their body, not their will.
 */
export function isNythraxisWardChannelLocked(player: Entity, bossId: number): boolean {
  return player.auras.some(
    (aura) =>
      (aura.kind === 'stun' ||
        aura.kind === 'stasis' ||
        aura.kind === 'incapacitate' ||
        aura.kind === 'polymorph') &&
      !(aura.id === NYTHRAXIS_IMPALED_AURA_ID && aura.sourceId === bossId),
  );
}

/** The aura an impaled raider carries; value2 is the spike entity that holds them. */
export function nythraxisImpaledAuraFor(bossId: number, spikeId: number) {
  return {
    id: NYTHRAXIS_IMPALED_AURA_ID,
    name: NYTHRAXIS_IMPALED_AURA_NAME,
    kind: 'stun' as const,
    remaining: NYTHRAXIS_IMPALED_AURA_SECONDS,
    duration: NYTHRAXIS_IMPALED_AURA_SECONDS,
    value: 0,
    value2: spikeId,
    sourceId: bossId,
    school: 'shadow' as const,
    unbreakableControl: true as const,
    encounterOwned: true as const,
  };
}

/**
 * Hold a Bone Spike in place: it never walks, aggroes, or swings. Mirrors the
 * pin Ignivar's Heart of the End uses, called from the mob tick dispatcher
 * before any generic AI can move it.
 */
export function pinNythraxisBoneSpike(spike: Entity): void {
  if (spike.templateId !== NYTHRAXIS_BONE_SPIKE_ID || spike.dead) return;
  spike.pos = { ...spike.spawnPos };
  spike.prevPos = { ...spike.spawnPos };
  spike.vx = 0;
  spike.vz = 0;
  spike.aggroTargetId = null;
  spike.inCombat = true;
  spike.aiState = 'attack';
  spike.swingTimer = Number.POSITIVE_INFINITY;
}
