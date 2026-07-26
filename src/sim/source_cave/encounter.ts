// Deterministic Source Cave wave encounter. Every contributor becomes visibly
// hostile at reboot; overflow guardians retire as their assigned waves fall.
// Crossing the centre seal collapses all pacing; striking a dormant combatant
// wakes its wave, while striking an overflow guardian adds that guardian to the
// pull permanently. State lives on InstanceSlot, never in module globals.

import { devTierForMergedPrs } from '../dev_tier';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { addThreat, clearThreat } from '../threat';
import type { Entity } from '../types';
import {
  playersInSourceCaveInstance,
  SOURCE_CAVE_SEAL_RADIUS,
  sourceCaveSealCenter,
  sourceCaveSealPopulation,
} from './occupancy';
import { dropSourceCaveMob, replaceSourceCaveMobs } from './population';
import { isSourceCaveMobEntity, SOURCE_CAVE_DUNGEON_ID } from './runtime';
import type { SourceCaveEncounterState, SourceCaveMobSpec } from './types';

export const SOURCE_CAVE_INITIAL_DELAY = 3;
// Short breathers tuned for a 10-player raid: enough to re-drink nothing, just
// re-position, so healer mana is a resource across waves rather than per wave.
export const SOURCE_CAVE_INTERMISSION_DELAY = 2;
export const SOURCE_CAVE_BOSS_DELAY = 5;
export const SOURCE_CAVE_CONFIRM_SECONDS = 10;
export const SOURCE_CAVE_WIPE_RESET_DELAY = 5;

export const SOURCE_CAVE_CONFIRM_TEXT =
  'Are you sure you want to proceed? Ensure you gather your resources before you push.';

const TINKERER_WAVE_SIZE = 10;
const ARTIFICER_WAVE_SIZE = 8;
const RUNESMITH_WAVE_SIZE = 6;
// Small on purpose: architects carry Sweeping Refactor (templates.ts) and the
// the original probe measured six simultaneous cleavers zone-killing even a
// spread raid; capping the cohort at three keeps the mechanic lethal-if-stacked
// instead of lethal-always. Growing the encounter therefore adds architect
// WAVES (the combat budget's architect cap is a multiple of this), never a
// wider architect wave: three is the measured ceiling, not a starting point.
const ARCHITECT_WAVE_SIZE = 3;

// Encirclement: once the reboot fires, every living dormant contributor leaves
// its home ring and holds a tight circle just outside the seal, facing the
// mustered group (the do-not-cross boundary drawn in bodies). The small gap
// keeps them readably off the seal edge; the march runs at a deliberate pace,
// slower than a chase but far from the idle amble.
const SOURCE_CAVE_ENCIRCLE_GAP = 3;
export const SOURCE_CAVE_ENCIRCLE_RADIUS = SOURCE_CAVE_SEAL_RADIUS + SOURCE_CAVE_ENCIRCLE_GAP;
const SOURCE_CAVE_ENCIRCLE_SPEED_MULT = 0.6;

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/** Stable weak-to-strong cohorts over the fixed-budget combatant subset. */
export function buildSourceCaveWaveLogins(mobs: readonly SourceCaveMobSpec[]): string[][] {
  const tinkerer: SourceCaveMobSpec[] = [];
  const artificer: SourceCaveMobSpec[] = [];
  const runesmith: SourceCaveMobSpec[] = [];
  const architect: SourceCaveMobSpec[] = [];
  const bosses: SourceCaveMobSpec[] = [];
  for (const mob of mobs) {
    if (!mob.combatant) continue;
    if (mob.boss) {
      bosses.push(mob);
      continue;
    }
    const tier = mob.combatTier ?? devTierForMergedPrs(mob.mergedPrs)?.key ?? 'tinkerer';
    if (tier === 'unranked' || tier === 'tinkerer') tinkerer.push(mob);
    else if (tier === 'artificer') artificer.push(mob);
    else if (tier === 'runesmith') runesmith.push(mob);
    else architect.push(mob); // Architect and non-boss Worldwright combat roles share this wave.
  }
  const weakestFirst = (a: SourceCaveMobSpec, b: SourceCaveMobSpec) =>
    b.rank - a.rank || (a.login < b.login ? -1 : a.login > b.login ? 1 : 0);
  for (const group of [tinkerer, artificer, runesmith, architect, bosses]) {
    group.sort(weakestFirst);
  }
  return [
    ...chunks(tinkerer, TINKERER_WAVE_SIZE),
    ...chunks(artificer, ARTIFICER_WAVE_SIZE),
    ...chunks(runesmith, RUNESMITH_WAVE_SIZE),
    ...chunks(architect, ARCHITECT_WAVE_SIZE),
    ...bosses.map((boss) => [boss]),
  ].map((wave) => wave.map((mob) => mob.login));
}

export function createSourceCaveEncounterState(
  specMobs: readonly SourceCaveMobSpec[],
  mobIdsByLogin: ReadonlyMap<string, number>,
): SourceCaveEncounterState {
  const waves = buildSourceCaveWaveLogins(specMobs).map((wave) =>
    wave.map((login) => {
      const id = mobIdsByLogin.get(login);
      if (id === undefined) throw new Error(`Source cave wave mob missing: ${login}`);
      return id;
    }),
  );
  const spectators = specMobs
    .filter((mob) => !mob.combatant)
    .sort((a, b) => b.rank - a.rank || (a.login < b.login ? -1 : a.login > b.login ? 1 : 0))
    .map((mob) => {
      const id = mobIdsByLogin.get(mob.login);
      if (id === undefined) throw new Error(`Source cave spectator missing: ${mob.login}`);
      return id;
    });
  const spectatorMobIdsByWave = waves.map(() => [] as number[]);
  if (waves.length > 0) {
    for (let i = 0; i < spectators.length; i++) {
      const waveIndex = Math.min(
        waves.length - 1,
        Math.floor((i * waves.length) / spectators.length),
      );
      spectatorMobIdsByWave[waveIndex].push(spectators[i]);
    }
  }
  return {
    phase: 'idle',
    started: false,
    breached: false,
    cleared: false,
    waves,
    combatMobIds: waves.flat(),
    spectatorMobIdsByWave,
    awakenedGuardianMobIds: new Set(),
    retiredSpectatorWaves: new Set(),
    activatedWaves: new Set(),
    activeMobIds: new Set(),
    initialTargetId: null,
    nextWaveAt: null,
    confirmationPid: null,
    confirmationUntil: 0,
    wipeResetAt: null,
  };
}

function livingPlayers(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const out: Entity[] = [];
  for (const meta of playersInSourceCaveInstance(ctx, inst)) {
    const entity = ctx.entities.get(meta.entityId);
    if (entity && !entity.dead) out.push(entity);
  }
  return out;
}

function nearestPlayer(mob: Entity, players: readonly Entity[]): Entity | null {
  let nearest: Entity | null = null;
  let nearestD2 = Infinity;
  for (const player of players) {
    const dx = player.pos.x - mob.pos.x;
    const dz = player.pos.z - mob.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < nearestD2) {
      nearest = player;
      nearestD2 = d2;
    }
  }
  return nearest;
}

function engageMob(mob: Entity, target: Entity): void {
  mob.aiState = 'chase';
  mob.aggroTargetId = target.id;
  mob.inCombat = true;
  mob.leashAnchor = { ...mob.pos };
  addThreat(mob, target.id, 1);
}

function activateWave(
  ctx: SimContext,
  inst: InstanceSlot,
  waveIndex: number,
  initialTargetId: number | null = null,
): void {
  const state = inst.sourceCaveEncounter;
  if (!state || state.activatedWaves.has(waveIndex)) return;
  state.activatedWaves.add(waveIndex);
  state.nextWaveAt = null;
  state.phase = state.breached ? 'breached' : 'active';
  const players = livingPlayers(ctx, inst);
  const initialTarget = players.find((player) => player.id === initialTargetId) ?? null;
  for (const id of state.waves[waveIndex] ?? []) {
    const mob = ctx.entities.get(id);
    if (!mob || mob.dead) continue;
    state.activeMobIds.add(id);
    const target = initialTarget ?? nearestPlayer(mob, players);
    if (target) engageMob(mob, target);
  }
}

function setExitSealed(ctx: SimContext, inst: InstanceSlot, sealed: boolean): void {
  if (inst.exitId === null) return;
  const exit = ctx.entities.get(inst.exitId);
  if (!exit) return;
  exit.lootable = !sealed;
  exit.respawnTimer = Infinity;
}

export function beginSourceCaveEncounter(
  ctx: SimContext,
  inst: InstanceSlot,
  initialTargetId: number,
): void {
  const state = inst.sourceCaveEncounter;
  if (!state || state.started) return;
  state.started = true;
  state.phase = 'countdown';
  state.breached = false;
  state.cleared = false;
  state.activatedWaves.clear();
  state.activeMobIds.clear();
  state.initialTargetId = initialTargetId;
  state.nextWaveAt = ctx.time + SOURCE_CAVE_INITIAL_DELAY;
  state.confirmationPid = null;
  state.confirmationUntil = 0;
  state.wipeResetAt = null;
  setExitSealed(ctx, inst, true);
  for (const id of inst.mobIds) {
    const mob = ctx.entities.get(id);
    if (!mob || mob.dead) continue;
    mob.hostile = true;
    mob.aggroTargetId = null;
    mob.aiState = 'idle';
    mob.inCombat = false;
    clearThreat(mob);
  }
}

export function sourceCaveRebootNeedsConfirmation(ctx: SimContext, inst: InstanceSlot): boolean {
  const population = sourceCaveSealPopulation(ctx, inst);
  return population.eligible > 0 && population.inside < population.eligible;
}

export function confirmSourceCaveReboot(ctx: SimContext, inst: InstanceSlot, pid: number): boolean {
  const state = inst.sourceCaveEncounter;
  if (!state || state.started) return true;
  if (!sourceCaveRebootNeedsConfirmation(ctx, inst)) return true;
  if (state.confirmationPid === pid && ctx.time <= state.confirmationUntil) {
    state.confirmationPid = null;
    state.confirmationUntil = 0;
    return true;
  }
  state.confirmationPid = pid;
  state.confirmationUntil = ctx.time + SOURCE_CAVE_CONFIRM_SECONDS;
  ctx.error(pid, SOURCE_CAVE_CONFIRM_TEXT);
  return false;
}

function encounterForMob(ctx: SimContext, mob: Entity): InstanceSlot | null {
  if (!isSourceCaveMobEntity(mob)) return null;
  return (
    ctx.instances.find(
      (inst) =>
        inst.dungeonId === SOURCE_CAVE_DUNGEON_ID &&
        inst.partyKey !== null &&
        inst.mobIds.includes(mob.id),
    ) ?? null
  );
}

/** Directly pulling a dormant combatant wakes its entire deterministic cohort. */
export function tryWakeSourceCaveWave(ctx: SimContext, mob: Entity): boolean {
  const inst = encounterForMob(ctx, mob);
  const state = inst?.sourceCaveEncounter;
  if (!inst || !state?.started || state.breached || state.activeMobIds.has(mob.id)) return false;
  if (wakeSourceCaveGuardian(ctx, mob)) return true;
  const waveIndex = state.waves.findIndex((wave) => wave.includes(mob.id));
  if (waveIndex < 0 || state.activatedWaves.has(waveIndex)) return false;
  activateWave(ctx, inst, waveIndex);
  return true;
}

/** Wake one overflow guardian as a permanent extra combatant without breaching the seal. */
export function wakeSourceCaveGuardian(
  ctx: SimContext,
  mob: Entity,
  source: Entity | null = null,
): boolean {
  const inst = encounterForMob(ctx, mob);
  const state = inst?.sourceCaveEncounter;
  if (
    !inst ||
    !state?.started ||
    state.breached ||
    mob.dead ||
    state.awakenedGuardianMobIds.has(mob.id) ||
    !state.spectatorMobIdsByWave.some((group) => group.includes(mob.id))
  ) {
    return false;
  }
  state.awakenedGuardianMobIds.add(mob.id);
  state.activeMobIds.add(mob.id);
  const players = livingPlayers(ctx, inst);
  const controller =
    source?.kind === 'player'
      ? source
      : source?.ownerId !== null && source?.ownerId !== undefined
        ? (ctx.entities.get(source.ownerId) ?? null)
        : null;
  const target = controller ?? nearestPlayer(mob, players);
  if (target) engageMob(mob, target);
  return true;
}

/** Dormant contributors ignore only players still standing on the intact seal. */
export function isDormantSourceCaveTargetSafe(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
): boolean {
  const inst = encounterForMob(ctx, mob);
  const state = inst?.sourceCaveEncounter;
  if (!inst || !state?.started || state.breached || state.activeMobIds.has(mob.id)) return false;
  const populationPlayers = livingPlayers(ctx, inst);
  if (
    !populationPlayers.some((player) => player.id === target.id || player.id === target.ownerId)
  ) {
    return false;
  }
  const centre = sourceCaveSealCenter(ctx, inst);
  if (!centre) return false;
  const controller =
    target.ownerId === null ? target : (ctx.entities.get(target.ownerId) ?? target);
  const dx = controller.pos.x - centre.x;
  const dz = controller.pos.z - centre.z;
  return dx * dx + dz * dz <= SOURCE_CAVE_SEAL_RADIUS * SOURCE_CAVE_SEAL_RADIUS;
}

/**
 * March every living dormant contributor onto the encirclement ring. Slots are
 * evenly spaced in spawn-bearing order, anchored at the first mob's own bearing,
 * so the assignment is deterministic (id tiebreak), paths never cross, and the
 * ring re-closes ranks as cohorts activate. Draws no rng; called from the
 * per-tick driver before mob AI (locomotion skips the generic idle wander and
 * proximity-aggro scan for these mobs, acquisition stays with the seal, breach,
 * and cohort-wake rules).
 */
function encircleDormantContributors(ctx: SimContext, inst: InstanceSlot): void {
  const state = inst.sourceCaveEncounter;
  const centre = sourceCaveSealCenter(ctx, inst);
  if (!state || !centre) return;
  const bearing = (mob: Entity) => Math.atan2(mob.spawnPos.x - centre.x, mob.spawnPos.z - centre.z);
  const dormant: Entity[] = [];
  for (const group of [...state.waves, ...state.spectatorMobIdsByWave]) {
    for (const id of group) {
      if (state.activeMobIds.has(id)) continue;
      const mob = ctx.entities.get(id);
      if (mob && !mob.dead) dormant.push(mob);
    }
  }
  if (dormant.length === 0) return;
  dormant.sort((a, b) => bearing(a) - bearing(b) || a.id - b.id);
  const anchor = bearing(dormant[0]);
  for (let i = 0; i < dormant.length; i++) {
    const mob = dormant[i];
    const angle = anchor + (Math.PI * 2 * i) / dormant.length;
    const slot = ctx.groundPos(
      centre.x + Math.sin(angle) * SOURCE_CAVE_ENCIRCLE_RADIUS,
      centre.z + Math.cos(angle) * SOURCE_CAVE_ENCIRCLE_RADIUS,
    );
    mob.wanderTarget = null;
    if (ctx.moveToward(mob, slot, mob.moveSpeed * SOURCE_CAVE_ENCIRCLE_SPEED_MULT)) {
      mob.facing = Math.atan2(centre.x - mob.pos.x, centre.z - mob.pos.z);
    }
  }
}

function breachEncounter(ctx: SimContext, inst: InstanceSlot): void {
  const state = inst.sourceCaveEncounter;
  if (!state || state.breached || state.cleared) return;
  state.breached = true;
  state.phase = 'breached';
  state.nextWaveAt = null;
  for (let i = 0; i < state.waves.length; i++) activateWave(ctx, inst, i);
  const players = livingPlayers(ctx, inst);
  for (const group of state.spectatorMobIdsByWave) {
    for (const id of group) {
      const mob = ctx.entities.get(id);
      if (!mob || mob.dead) continue;
      mob.hostile = true;
      state.activeMobIds.add(id);
      const target = nearestPlayer(mob, players);
      if (target) engageMob(mob, target);
    }
  }
}

function resetEncounter(ctx: SimContext, inst: InstanceSlot): void {
  const cave = ctx.sourceCave;
  if (!inst.sourceCaveEncounter || !cave) return;
  const mobIdsByLogin = replaceSourceCaveMobs(ctx, inst);
  inst.sourceCaveEncounter = createSourceCaveEncounterState(cave.spec.mobs, mobIdsByLogin);
  setExitSealed(ctx, inst, false);
  for (const id of inst.objectIds) {
    const object = ctx.entities.get(id);
    if (object?.templateId === 'source_cave_reboot') object.lootable = true;
  }
}

function allMobsDead(ctx: SimContext, inst: InstanceSlot): boolean {
  if (!inst.sourceCaveEncounter) return false;
  for (const id of sourceCaveDefeatMobIds(inst)) {
    const mob = ctx.entities.get(id);
    if (mob && !mob.dead) return false;
  }
  return true;
}

function retireCompletedSpectators(ctx: SimContext, state: SourceCaveEncounterState): void {
  if (state.breached) return;
  for (const waveIndex of state.activatedWaves) {
    if (state.retiredSpectatorWaves.has(waveIndex)) continue;
    const defeated = state.waves[waveIndex].every((id) => {
      const mob = ctx.entities.get(id);
      return !mob || mob.dead;
    });
    if (!defeated) continue;
    state.retiredSpectatorWaves.add(waveIndex);
    for (const id of state.spectatorMobIdsByWave[waveIndex] ?? []) {
      if (!state.awakenedGuardianMobIds.has(id)) dropSourceCaveMob(ctx, id);
    }
  }
}

function retireAllSpectators(ctx: SimContext, state: SourceCaveEncounterState): void {
  for (const group of state.spectatorMobIdsByWave) {
    for (const id of group) {
      if (!state.awakenedGuardianMobIds.has(id)) dropSourceCaveMob(ctx, id);
    }
  }
}

/** Combat ids are the encounter waves; inst.mobIds remains the full visible roster. */
export function sourceCaveCombatMobIds(inst: InstanceSlot): number[] {
  return inst.sourceCaveEncounter?.combatMobIds ?? inst.mobIds;
}

/** Normal pacing requires the fixed budget; a breach requires every remaining guardian. */
export function sourceCaveDefeatMobIds(inst: InstanceSlot): number[] {
  const state = inst.sourceCaveEncounter;
  if (!state) return inst.mobIds;
  return state.breached ? inst.mobIds : [...state.combatMobIds, ...state.awakenedGuardianMobIds];
}

/** Per-tick encounter driver, called before mob AI so a breach reacts immediately. */
export function updateSourceCaveEncounters(ctx: SimContext): void {
  for (const inst of ctx.instances) {
    if (inst.dungeonId !== SOURCE_CAVE_DUNGEON_ID || inst.partyKey === null) continue;
    const state = inst.sourceCaveEncounter;
    if (!state?.started || state.cleared) continue;
    retireCompletedSpectators(ctx, state);
    if (allMobsDead(ctx, inst)) {
      if (!state.breached) retireAllSpectators(ctx, state);
      state.cleared = true;
      state.phase = 'cleared';
      state.activeMobIds.clear();
      state.nextWaveAt = null;
      setExitSealed(ctx, inst, false);
      continue;
    }

    const players = livingPlayers(ctx, inst);
    if (players.length === 0) {
      state.wipeResetAt ??= ctx.time + SOURCE_CAVE_WIPE_RESET_DELAY;
      if (ctx.time >= state.wipeResetAt) resetEncounter(ctx, inst);
      continue;
    }
    state.wipeResetAt = null;

    const population = sourceCaveSealPopulation(ctx, inst);
    if (!state.breached && population.inside < population.eligible) {
      breachEncounter(ctx, inst);
      continue;
    }

    if (!state.breached) encircleDormantContributors(ctx, inst);

    for (const id of [...state.activeMobIds]) {
      const mob = ctx.entities.get(id);
      if (!mob || mob.dead) {
        state.activeMobIds.delete(id);
        continue;
      }
      // An activated contributor cannot quietly evade home and stall its wave.
      if (mob.aiState === 'idle') {
        const target = nearestPlayer(mob, players);
        if (target) engageMob(mob, target);
      }
    }
    if (state.breached || state.activeMobIds.size > 0) continue;

    if (state.nextWaveAt !== null) {
      if (ctx.time >= state.nextWaveAt) {
        const next = state.waves.findIndex((_, index) => !state.activatedWaves.has(index));
        if (next >= 0) activateWave(ctx, inst, next, state.initialTargetId);
      }
      continue;
    }

    const next = state.waves.findIndex((_, index) => !state.activatedWaves.has(index));
    if (next < 0) continue;
    const bossWave = next === state.waves.length - 1;
    state.phase = 'intermission';
    state.nextWaveAt =
      ctx.time + (bossWave ? SOURCE_CAVE_BOSS_DELAY : SOURCE_CAVE_INTERMISSION_DELAY);
  }
}

export function sourceCaveExitSealed(inst: InstanceSlot): boolean {
  const state = inst.sourceCaveEncounter;
  return !!state?.started && !state.cleared;
}
