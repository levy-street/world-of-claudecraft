// Pure legacy helpers plus the authoritative public projection for Varkhul's
// permanent forge pillars. The encounter owns mutation; render and wire consume
// the stable projection types below.

import { hash2 } from './rng';
import {
  type VarkhulForgeBeamIndex,
  varkhulForgeBeamColumns,
  varkhulForgeBeamImpactPosition,
} from './varkhul_forge_beams';
import {
  type ActiveVarkhulInterceptBeam,
  activeVarkhulInterceptBeam,
} from './varkhul_intercept_beam';

export type VarkhulAssemblyPhase =
  | 'idle'
  | 'adds'
  | 'cores'
  | 'convergence'
  | 'links'
  | 'stunned'
  | 'done';
export type VarkhulAssemblyDifficulty = 'normal' | 'heroic';
export type VarkhulAssemblyRuneControl = 'off' | 'counterclockwise' | 'clockwise';
export type VarkhulAssemblyRuneOutcome = 'full' | 'partial' | 'failed';

const VARKHUL_ASSEMBLY_PHASES = new Set<VarkhulAssemblyPhase>([
  'idle',
  'adds',
  'cores',
  'convergence',
  'links',
  'stunned',
  'done',
]);

export interface VarkhulAssemblyRuneAssignment {
  playerId: number;
  symbol: number;
}

export interface ActiveVarkhulMoltenCore {
  id: string;
  x: number;
  z: number;
  carrierId: number | null;
  delivered: boolean;
}

export interface ActiveVarkhulRuneAssignment extends VarkhulAssemblyRuneAssignment {
  locked: boolean;
}

export interface ActiveVarkhulRune {
  symbol: number;
  x: number;
  z: number;
  radius: number;
  trackIndex: number;
  trackRadius: number;
  ownerAngle: number;
  assignedPlayerId: number | null;
  orphaned: boolean;
  locked: boolean;
  targetAngle: number;
  glyphAngle: number;
  control: VarkhulAssemblyRuneControl;
  controlProgress: number;
  alignmentProgress: number;
  aligned: boolean;
}

export interface ActiveVarkhulAssembly {
  bossId: number;
  difficulty: VarkhulAssemblyDifficulty;
  phase: VarkhulAssemblyPhase;
  forgeX: number;
  forgeZ: number;
  forgeHp: number;
  forgeMaxHp: number;
  forgeOverheat: number;
  forgeBeamActiveMask: number;
  forgeBeamWarmupRemaining: number;
  forgeMeltdownRemaining: number;
  addWave: number;
  addWaves: number;
  addsRemaining: number;
  forgeBeams: Array<{
    index: VarkhulForgeBeamIndex;
    columnX: number;
    columnZ: number;
    impactX: number;
    impactZ: number;
    active: boolean;
    warning: boolean;
    blocked: boolean;
    blockerId: number | null;
  }>;
  interceptBeam: ActiveVarkhulInterceptBeam | null;
  cores: ActiveVarkhulMoltenCore[];
  deliveryWindowRemaining: number;
  assignments: ActiveVarkhulRuneAssignment[];
  runes: ActiveVarkhulRune[];
  round: number;
  rounds: number;
  remaining: number;
}

export interface VarkhulAssemblyProjectionState {
  assemblyTriggered: boolean;
  assemblyRemaining: number;
  assemblyRuneDifficulty: VarkhulAssemblyDifficulty;
  assemblyPhase: VarkhulAssemblyPhase;
  assemblyForgeHp: number;
  assemblyForgeOverheat: number;
  assemblyForgeBeamActiveMask: number;
  assemblyForgeBeamWarningMask: number;
  assemblyForgeBeamWarmupRemaining: number;
  assemblyForgeBeamBlockerIds: readonly (number | null)[];
  assemblyForgeMeltdownRemaining: number;
  assemblyIntermissionWaves: number;
  assemblyNextWaveIndex: number;
  assemblyAddIds: readonly number[];
  assemblyPortalSpawns: readonly { wave: number; spawnIndex: number; remaining: number }[];
  assemblyArtificerPortalSpawns: readonly { portalIndex: number; remaining: number }[];
  assemblyOrdinaryAddWaves: readonly { addId: number; wave: number }[];
  interceptBeamTargetId: number | null;
  interceptBeamBlockerId: number | null;
  interceptBeamCastRemaining: number;
  assemblyCores: readonly {
    id: string;
    pos: { x: number; z: number };
    carrierId: number | null;
    delivered: boolean;
  }[];
  assemblyDeliveryWindowRemaining: number;
  assemblyRuneCenter: { x: number; z: number } | null;
  assemblyRuneAssignments: readonly ActiveVarkhulRuneAssignment[];
  assemblyRuneAngles: readonly number[];
  assemblyRuneControls: readonly VarkhulAssemblyRuneControl[];
  assemblyRuneControlHoldSeconds: readonly number[];
  assemblyRuneAlignmentHoldSeconds: readonly number[];
  assemblyRuneRescuerIds: readonly (number | null)[];
  assemblyRuneUnavailablePlayerIds: readonly number[];
  assemblyRuneSlots: readonly number[];
  assemblyRuneLayoutKey: number;
  assemblyRuneRound: number;
  assemblyRuneRounds: number;
  assemblyRuneRemaining: number;
}

export const VARKHUL_ASSEMBLY_FORGE_MAX_HP = 100;
export const VARKHUL_ASSEMBLY_FORGE_LOCAL_POS = { x: 0, z: 22 } as const;
export const VARKHUL_ASSEMBLY_CORE_BASE_DAMAGE = 20;
export const VARKHUL_ASSEMBLY_UNSTABLE_REACTION_DAMAGE = 40;
export const VARKHUL_ASSEMBLY_CORE_WINDOW_SECONDS = 6;
export const VARKHUL_ASSEMBLY_CORE_PICKUP_RADIUS = 1.8;
export const VARKHUL_ASSEMBLY_FORGE_DELIVERY_RADIUS = 3;
export const VARKHUL_ASSEMBLY_BURDEN_TICK_SECONDS = 2;
export const VARKHUL_ASSEMBLY_CONVERGENCE_SECONDS = 4;
export const VARKHUL_ASSEMBLY_RUNE_COUNT = 10;
export const VARKHUL_ASSEMBLY_RUNE_TRACK_COUNT = VARKHUL_ASSEMBLY_RUNE_COUNT;
export const VARKHUL_ASSEMBLY_RUNE_STATION_RING_RADIUS = 15.5;
export const VARKHUL_ASSEMBLY_RUNE_TRACK_RADIUS = 3;
export const VARKHUL_ASSEMBLY_RUNE_RING_FORWARD_OFFSET = 2;
/** Visual impact radius for the full clock resolving; not an interaction radius. */
export const VARKHUL_ASSEMBLY_RUNE_OWNER_RADIUS = 18;
export const VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET = 0.82;
export const VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS = 0.72;
export const VARKHUL_ASSEMBLY_RUNE_COMPLETION_RADIUS = 2.6;
export const VARKHUL_ASSEMBLY_RUNE_ALIGNMENT_RADIANS = Math.PI / 36;
export const VARKHUL_ASSEMBLY_RUNE_CONTROL_ARM_SECONDS = 0.6;
export const VARKHUL_ASSEMBLY_RUNE_LOCK_HOLD_SECONDS = 0.8;
export const VARKHUL_ASSEMBLY_RUNE_SPEED_NORMAL = Math.PI / 10;
export const VARKHUL_ASSEMBLY_RUNE_SPEED_HEROIC = Math.PI / 20;
export const VARKHUL_ASSEMBLY_LINK_FIREBALLS_NORMAL = 3;
export const VARKHUL_ASSEMBLY_LINK_FIREBALLS_HEROIC = 5;
export const VARKHUL_ASSEMBLY_LINK_FIREBALL_SECONDS_NORMAL = 3.2;
export const VARKHUL_ASSEMBLY_LINK_FIREBALL_SECONDS_HEROIC = 2.3;
export const VARKHUL_ASSEMBLY_LINK_FIREBALL_SPAWN_DISTANCE = 31;
export const VARKHUL_ASSEMBLY_LINK_FIREBALL_RADIUS = 1.45;
export const VARKHUL_ASSEMBLY_LINK_FIREBALL_DURATION = 7;
export const VARKHUL_ASSEMBLY_LINK_FIREBALL_DAMAGE_NORMAL = 0.16;
export const VARKHUL_ASSEMBLY_LINK_FIREBALL_DAMAGE_HEROIC = 0.2;
export const VARKHUL_ASSEMBLY_RUNE_SECONDS_NORMAL = 25;
export const VARKHUL_ASSEMBLY_RUNE_SECONDS_HEROIC = 30;
export const VARKHUL_ASSEMBLY_RUNE_SECOND_WAVE_MIN_SECONDS_HEROIC = 20;
export const VARKHUL_ASSEMBLY_STUN_SECONDS = 15;
export const VARKHUL_ASSEMBLY_DAMAGED_STUN_SECONDS = 10;
export const VARKHUL_ASSEMBLY_PARTIAL_STUN_SECONDS = 8;
export const VARKHUL_ASSEMBLY_STUN_DAMAGE_TAKEN_BONUS = 0.5;
export const VARKHUL_ASSEMBLY_DAMAGED_DAMAGE_TAKEN_BONUS = 0.3;
export const VARKHUL_ASSEMBLY_PARTIAL_DAMAGE_TAKEN_BONUS = 0.25;
export const VARKHUL_ASSEMBLY_LINK_FAILURE_DAMAGE_NORMAL = 0.2;
export const VARKHUL_ASSEMBLY_LINK_FAILURE_DAMAGE_HEROIC = 0.25;

export function varkhulAssemblyBurdenDamageMaxHp(stacks: number): number {
  return Math.min(0.1, Math.max(1, Math.floor(stacks)) * 0.02);
}

export function varkhulAssemblyRounds(difficulty: VarkhulAssemblyDifficulty): number {
  void difficulty;
  return 2;
}

export function varkhulAssemblyRuneSeconds(difficulty: VarkhulAssemblyDifficulty): number {
  return difficulty === 'heroic'
    ? VARKHUL_ASSEMBLY_RUNE_SECONDS_HEROIC
    : VARKHUL_ASSEMBLY_RUNE_SECONDS_NORMAL;
}

export function varkhulAssemblyRuneRemainingAfterWaveAdvance(
  difficulty: VarkhulAssemblyDifficulty,
  remaining: number,
): number {
  return difficulty === 'heroic'
    ? Math.max(remaining, VARKHUL_ASSEMBLY_RUNE_SECOND_WAVE_MIN_SECONDS_HEROIC)
    : remaining;
}

export function varkhulAssemblyRuneAssignments(
  playerIds: readonly number[],
  bossId: number,
  round: number,
): VarkhulAssemblyRuneAssignment[] {
  const ordered = [...new Set(playerIds)]
    .sort((first, second) => {
      const firstScore = hash2(bossId + round * 131, first, 0x1a55e);
      const secondScore = hash2(bossId + round * 131, second, 0x1a55e);
      return firstScore - secondScore || first - second;
    })
    .slice(0, VARKHUL_ASSEMBLY_RUNE_COUNT);
  return ordered.map((playerId, symbol) => ({ playerId, symbol }));
}

/** Maps each symbol onto a physical clock slot without consuming shared combat RNG. */
export function varkhulAssemblyRuneSlots(
  difficulty: VarkhulAssemblyDifficulty,
  layoutKey: number,
): number[] {
  const symbols = Array.from({ length: VARKHUL_ASSEMBLY_RUNE_COUNT }, (_, symbol) => symbol);
  if (difficulty === 'normal') {
    return symbols.map((symbol) => {
      const wave = varkhulAssemblyRuneWave(symbol, 2);
      const indexInWave = symbol % (VARKHUL_ASSEMBLY_RUNE_COUNT / 2);
      return indexInWave * 2 + wave;
    });
  }
  const safeKey = Math.max(0, Math.floor(layoutKey));
  const slots = Array.from({ length: VARKHUL_ASSEMBLY_RUNE_COUNT }, () => 0);
  for (let wave = 0; wave < 2; wave++) {
    const shuffled = symbols
      .filter((symbol) => varkhulAssemblyRuneWave(symbol, 2) === wave)
      .sort((first, second) => {
        const firstScore = hash2(safeKey * 2 + wave + 1, first + 1, 0x51075);
        const secondScore = hash2(safeKey * 2 + wave + 1, second + 1, 0x51075);
        return firstScore - secondScore || first - second;
      });
    const anchorIndex = shuffled.indexOf(wave * (VARKHUL_ASSEMBLY_RUNE_COUNT / 2));
    shuffled.forEach((symbol, index) => {
      const rotatedIndex = (index - anchorIndex + safeKey + shuffled.length) % shuffled.length;
      slots[symbol] = rotatedIndex * 2 + wave;
    });
  }
  return slots;
}

export function varkhulAssemblyAdjacentRuneSymbols(
  symbol: number,
  slots: readonly number[],
): readonly [number, number] {
  const safeSymbol = Math.max(0, Math.floor(symbol)) % VARKHUL_ASSEMBLY_RUNE_COUNT;
  const slot =
    Math.max(0, Math.floor(slots[safeSymbol] ?? safeSymbol)) % VARKHUL_ASSEMBLY_RUNE_COUNT;
  const symbolAt = (targetSlot: number): number => {
    const found = slots.findIndex(
      (candidate) =>
        Math.max(0, Math.floor(candidate)) % VARKHUL_ASSEMBLY_RUNE_COUNT === targetSlot,
    );
    return found >= 0 ? found : targetSlot;
  };
  return [
    symbolAt((slot + VARKHUL_ASSEMBLY_RUNE_COUNT - 1) % VARKHUL_ASSEMBLY_RUNE_COUNT),
    symbolAt((slot + 1) % VARKHUL_ASSEMBLY_RUNE_COUNT),
  ];
}

export function varkhulAssemblyRuneRescuePlayerIds(
  symbol: number,
  assignments: readonly VarkhulAssemblyRuneAssignment[],
  slots: readonly number[],
): number[] {
  return varkhulAssemblyAdjacentRuneSymbols(symbol, slots).flatMap((adjacentSymbol) => {
    const assignment = assignments.find((entry) => entry.symbol === adjacentSymbol);
    return assignment ? [assignment.playerId] : [];
  });
}

export function varkhulAssemblyRuneWave(symbol: number, rounds: number): number {
  if (Math.max(1, Math.floor(rounds)) <= 1) return 0;
  const safeSymbol = Math.max(0, Math.floor(symbol)) % VARKHUL_ASSEMBLY_RUNE_COUNT;
  return safeSymbol < VARKHUL_ASSEMBLY_RUNE_COUNT / 2 ? 0 : 1;
}

function normalizedAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function positiveAngle(angle: number): number {
  const normalized = normalizedAngle(angle);
  return normalized < 0 ? normalized + Math.PI * 2 : normalized;
}

function angleDelta(from: number, to: number): number {
  return normalizedAngle(to - from);
}

export function varkhulAssemblyRuneTargetAngle(
  bossId: number,
  symbol: number,
  round: number,
): number {
  const safeSymbol = Math.max(0, Math.floor(symbol)) % VARKHUL_ASSEMBLY_RUNE_COUNT;
  const safeRound = Math.max(0, Math.floor(round));
  return normalizedAngle(
    hash2(bossId + safeRound * 977, safeSymbol + 1, 0x70a41) * Math.PI * 2 - Math.PI,
  );
}

export function varkhulAssemblyRuneStartAngle(
  bossId: number,
  symbol: number,
  round: number,
): number {
  const safeSymbol = Math.max(0, Math.floor(symbol)) % VARKHUL_ASSEMBLY_RUNE_COUNT;
  const safeRound = Math.max(0, Math.floor(round));
  const target = varkhulAssemblyRuneTargetAngle(bossId, safeSymbol, safeRound);
  const separation =
    Math.PI * (1 / 3 + hash2(bossId + safeRound * 313, safeSymbol + 1, 0x51a47) * (1 / 6));
  const direction = hash2(bossId + safeRound * 719, safeSymbol + 1, 0x51a48) < 0.5 ? -1 : 1;
  return normalizedAngle(target + separation * direction);
}

export function varkhulAssemblyRuneControlAt(
  center: { x: number; z: number },
  trackRadius: number,
  glyphAngle: number,
  player: { x: number; z: number },
): VarkhulAssemblyRuneControl {
  if (![center.x, center.z, trackRadius, glyphAngle, player.x, player.z].every(Number.isFinite)) {
    return 'off';
  }
  const boundaryEpsilon = 1e-9;
  const counterclockwise = varkhulAssemblyRuneControlPosition(
    center,
    trackRadius,
    glyphAngle,
    'counterclockwise',
  );
  if (
    Math.hypot(player.x - counterclockwise.x, player.z - counterclockwise.z) <=
    VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS + boundaryEpsilon
  ) {
    return 'counterclockwise';
  }
  const clockwise = varkhulAssemblyRuneControlPosition(
    center,
    trackRadius,
    glyphAngle,
    'clockwise',
  );
  if (
    Math.hypot(player.x - clockwise.x, player.z - clockwise.z) <=
    VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS + boundaryEpsilon
  ) {
    return 'clockwise';
  }
  return 'off';
}

export function varkhulAssemblyRuneControlPosition(
  center: { x: number; z: number },
  trackRadius: number,
  glyphAngle: number,
  control: Exclude<VarkhulAssemblyRuneControl, 'off'>,
): { x: number; z: number } {
  const radius =
    Math.max(0, trackRadius) +
    (control === 'clockwise'
      ? VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET
      : -VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET);
  return {
    x: center.x + Math.sin(glyphAngle) * radius,
    z: center.z + Math.cos(glyphAngle) * radius,
  };
}

export interface VarkhulAssemblyControlHold {
  control: VarkhulAssemblyRuneControl;
  seconds: number;
  progress: number;
  engaged: boolean;
}

export function varkhulAssemblyAdvanceControlHold(
  previousControl: VarkhulAssemblyRuneControl,
  previousSeconds: number,
  requestedControl: VarkhulAssemblyRuneControl,
  seconds: number,
): VarkhulAssemblyControlHold {
  if (requestedControl === 'off' || seconds <= 0) {
    return { control: 'off', seconds: 0, progress: 0, engaged: false };
  }
  const held = Math.min(
    VARKHUL_ASSEMBLY_RUNE_CONTROL_ARM_SECONDS,
    Math.max(0, previousControl === requestedControl ? previousSeconds : 0) + Math.max(0, seconds),
  );
  const progress = Math.min(1, held / VARKHUL_ASSEMBLY_RUNE_CONTROL_ARM_SECONDS);
  return {
    control: requestedControl,
    seconds: held,
    progress,
    engaged: progress >= 1,
  };
}

export function varkhulAssemblyAdvanceRuneAlignment(
  previousSeconds: number,
  aligned: boolean,
  engaged: boolean,
  seconds: number,
): number {
  if (!aligned || !engaged || seconds <= 0) return 0;
  return Math.min(
    VARKHUL_ASSEMBLY_RUNE_LOCK_HOLD_SECONDS,
    Math.max(0, previousSeconds) + Math.max(0, seconds),
  );
}

export function varkhulAssemblyRuneAligned(glyphAngle: number, targetAngle: number): boolean {
  return (
    Number.isFinite(glyphAngle) &&
    Number.isFinite(targetAngle) &&
    Math.abs(angleDelta(glyphAngle, targetAngle)) <= VARKHUL_ASSEMBLY_RUNE_ALIGNMENT_RADIANS
  );
}

export function varkhulAssemblyBestRuneControl(
  glyphAngle: number,
  targetAngle: number,
): Exclude<VarkhulAssemblyRuneControl, 'off'> {
  return angleDelta(glyphAngle, targetAngle) >= 0 ? 'clockwise' : 'counterclockwise';
}

export function varkhulAssemblyStepRune(
  glyphAngle: number,
  control: VarkhulAssemblyRuneControl,
  difficulty: VarkhulAssemblyDifficulty,
  seconds: number,
  targetAngle: number,
): number {
  if (control === 'off' || seconds <= 0 || varkhulAssemblyRuneAligned(glyphAngle, targetAngle)) {
    return varkhulAssemblyRuneAligned(glyphAngle, targetAngle) ? targetAngle : glyphAngle;
  }
  const direction = control === 'clockwise' ? 1 : -1;
  const speed =
    difficulty === 'heroic'
      ? VARKHUL_ASSEMBLY_RUNE_SPEED_HEROIC
      : VARKHUL_ASSEMBLY_RUNE_SPEED_NORMAL;
  const travel = speed * Math.max(0, seconds);
  const distanceToTarget =
    direction > 0
      ? positiveAngle(targetAngle - glyphAngle)
      : positiveAngle(glyphAngle - targetAngle);
  if (distanceToTarget <= travel + VARKHUL_ASSEMBLY_RUNE_ALIGNMENT_RADIANS) return targetAngle;
  return normalizedAngle(glyphAngle + direction * travel);
}

export function varkhulAssemblyRuneOutcome(lockedRunes: number): VarkhulAssemblyRuneOutcome {
  const locked = Math.max(0, Math.floor(lockedRunes));
  if (locked >= VARKHUL_ASSEMBLY_RUNE_COUNT) return 'full';
  if (locked >= Math.ceil(VARKHUL_ASSEMBLY_RUNE_COUNT * 0.6)) return 'partial';
  return 'failed';
}

export function varkhulAssemblyRuneStation(
  roomCenter: { x: number; z: number },
  slot: number,
): { x: number; z: number; trackIndex: number; trackRadius: number; ownerAngle: number } {
  const safeSlot = Math.max(0, Math.floor(slot)) % VARKHUL_ASSEMBLY_RUNE_COUNT;
  const ownerAngle =
    Math.PI / VARKHUL_ASSEMBLY_RUNE_COUNT +
    safeSlot * ((Math.PI * 2) / VARKHUL_ASSEMBLY_RUNE_COUNT);
  return {
    x: roomCenter.x + Math.sin(ownerAngle) * VARKHUL_ASSEMBLY_RUNE_STATION_RING_RADIUS,
    z:
      roomCenter.z +
      VARKHUL_ASSEMBLY_RUNE_RING_FORWARD_OFFSET +
      Math.cos(ownerAngle) * VARKHUL_ASSEMBLY_RUNE_STATION_RING_RADIUS,
    trackIndex: safeSlot,
    trackRadius: VARKHUL_ASSEMBLY_RUNE_TRACK_RADIUS,
    ownerAngle,
  };
}

export function varkhulAssemblyFireballCadence(difficulty: VarkhulAssemblyDifficulty): number {
  return difficulty === 'heroic'
    ? VARKHUL_ASSEMBLY_LINK_FIREBALL_SECONDS_HEROIC
    : VARKHUL_ASSEMBLY_LINK_FIREBALL_SECONDS_NORMAL;
}

export function varkhulAssemblyFireballPattern(
  forge: { x: number; z: number },
  difficulty: VarkhulAssemblyDifficulty,
  round: number,
  wave: number,
): Array<{ x: number; z: number; dirX: number; dirZ: number }> {
  const count =
    difficulty === 'heroic'
      ? VARKHUL_ASSEMBLY_LINK_FIREBALLS_HEROIC
      : VARKHUL_ASSEMBLY_LINK_FIREBALLS_NORMAL;
  const rotation = round * 0.73 + wave * 0.91;
  return Array.from({ length: count }, (_, index) => {
    const angle = rotation + (index * Math.PI * 2) / count;
    const outwardX = Math.sin(angle);
    const outwardZ = Math.cos(angle);
    return {
      x: forge.x + outwardX * VARKHUL_ASSEMBLY_LINK_FIREBALL_SPAWN_DISTANCE,
      z: forge.z + outwardZ * VARKHUL_ASSEMBLY_LINK_FIREBALL_SPAWN_DISTANCE,
      dirX: -outwardX,
      dirZ: -outwardZ,
    };
  });
}

export function activeVarkhulAssembly(
  bossId: number,
  state: VarkhulAssemblyProjectionState,
  forge: { x: number; z: number },
  boss: { x: number; z: number },
  entityOf: (entityId: number) => { pos: { x: number; z: number }; dead: boolean } | undefined,
): ActiveVarkhulAssembly | null {
  if (
    (state.assemblyRuneDifficulty !== 'normal' && state.assemblyRuneDifficulty !== 'heroic') ||
    !VARKHUL_ASSEMBLY_PHASES.has(state.assemblyPhase)
  ) {
    return null;
  }
  const forgeAnchor = forge;
  const addWaves =
    state.assemblyPhase === 'adds' ? Math.max(0, Math.floor(state.assemblyIntermissionWaves)) : 0;
  const addWave =
    addWaves > 0 ? Math.min(addWaves, Math.max(1, Math.floor(state.assemblyNextWaveIndex))) : 0;
  const addsRemaining =
    state.assemblyPhase === 'adds'
      ? state.assemblyPortalSpawns.length +
        state.assemblyArtificerPortalSpawns.length +
        state.assemblyAddIds.reduce((count, addId) => {
          const add = entityOf(addId);
          return count + (add && !add.dead ? 1 : 0);
        }, 0)
      : 0;
  const forgeBeams = varkhulForgeBeamColumns(forgeAnchor).map((column) => {
    const active = (state.assemblyForgeBeamActiveMask & (1 << column.index)) !== 0;
    const warning = (state.assemblyForgeBeamWarningMask & (1 << column.index)) !== 0;
    const blockerId = state.assemblyForgeBeamBlockerIds?.[column.index] ?? null;
    const blocker = !active || blockerId === null ? undefined : entityOf(blockerId);
    const impact = varkhulForgeBeamImpactPosition(
      forgeAnchor,
      column.index,
      blocker && blockerId !== null
        ? { id: blockerId, x: blocker.pos.x, z: blocker.pos.z, dead: blocker.dead }
        : null,
    );
    return {
      index: column.index,
      columnX: column.x,
      columnZ: column.z,
      impactX: impact.x,
      impactZ: impact.z,
      active,
      warning,
      blocked: blocker !== undefined && !blocker.dead,
      blockerId: blocker !== undefined && !blocker.dead ? blockerId : null,
    };
  });
  return {
    bossId,
    difficulty: state.assemblyRuneDifficulty,
    phase: state.assemblyPhase,
    forgeX: forgeAnchor.x,
    forgeZ: forgeAnchor.z,
    forgeHp: state.assemblyForgeHp,
    forgeMaxHp: VARKHUL_ASSEMBLY_FORGE_MAX_HP,
    forgeOverheat: state.assemblyForgeOverheat,
    forgeBeamActiveMask: state.assemblyForgeBeamActiveMask,
    forgeBeamWarmupRemaining: state.assemblyForgeBeamWarmupRemaining,
    forgeMeltdownRemaining: state.assemblyForgeMeltdownRemaining,
    addWave,
    addWaves,
    addsRemaining,
    forgeBeams,
    interceptBeam: activeVarkhulInterceptBeam(bossId, boss, state, entityOf),
    cores: [],
    deliveryWindowRemaining: state.assemblyDeliveryWindowRemaining,
    assignments: [],
    runes: [],
    round: state.assemblyRuneRound,
    rounds: state.assemblyRuneRounds,
    remaining: state.assemblyRemaining,
  };
}

/** Projects the permanent dark pillar hardware before Varkhul enters combat. */
export function inactiveVarkhulAssembly(
  bossId: number,
  difficulty: VarkhulAssemblyDifficulty,
  forge: { x: number; z: number },
): ActiveVarkhulAssembly {
  return {
    bossId,
    difficulty,
    phase: 'idle',
    forgeX: forge.x,
    forgeZ: forge.z,
    forgeHp: VARKHUL_ASSEMBLY_FORGE_MAX_HP,
    forgeMaxHp: VARKHUL_ASSEMBLY_FORGE_MAX_HP,
    forgeOverheat: 0,
    forgeBeamActiveMask: 0,
    forgeBeamWarmupRemaining: 0,
    forgeMeltdownRemaining: 0,
    addWave: 0,
    addWaves: 0,
    addsRemaining: 0,
    forgeBeams: varkhulForgeBeamColumns(forge).map((column) => ({
      index: column.index,
      columnX: column.x,
      columnZ: column.z,
      impactX: forge.x,
      impactZ: forge.z,
      active: false,
      warning: false,
      blocked: false,
      blockerId: null,
    })),
    interceptBeam: null,
    cores: [],
    deliveryWindowRemaining: 0,
    assignments: [],
    runes: [],
    round: 0,
    rounds: 1,
    remaining: 0,
  };
}
