// Varkhul raid encounter. The boss owns only deterministic, sim-local state;
// clients derive every actionable warning from existing casts, auras, facing,
// and GroundAoE snapshots.

import { MOBS } from '../data';
import { createMob } from '../entity';
import {
  IGNIVAR_CINDER_ARTIFICER_ID,
  IGNIVAR_CRUCIBLE_WARDEN_ID,
  IGNIVAR_EMBER_SENTINEL_ID,
  VARKHUL_BOSS_ID as VARKHUL_BOSS_TEMPLATE_ID,
} from '../ignivar_raid_ids';
import { applyDungeonMobTuning, mobTemplateForDungeonDifficulty } from '../instances/difficulty';
import {
  mobCombatProfile,
  mobEffectiveMeleeRange,
  tryMobMeleeSwingInRange,
} from '../mob/combat_profile';
import { updateMobTarget } from '../mob/targeting';
import type { SimContext } from '../sim_context';
import {
  CAST_COMPLETE_EPS,
  DT,
  dist2d,
  type Entity,
  steadyAngleTo,
  type VarkhulEncounterState,
  type Vec3,
} from '../types';
import {
  VARKHUL_FORGESTORM_RADIUS,
  VARKHUL_FORGESTORM_WARNING_SECONDS,
} from '../varkhul_forgestorm';

export { VARKHUL_BOSS_ID } from '../ignivar_raid_ids';
export const VARKHUL_EMBER_SENTINEL_ID = IGNIVAR_EMBER_SENTINEL_ID;
export const VARKHUL_CRUCIBLE_WARDEN_ID = IGNIVAR_CRUCIBLE_WARDEN_ID;
export const VARKHUL_CINDER_ARTIFICER_ID = IGNIVAR_CINDER_ARTIFICER_ID;

export const VARKHUL_MAKERS_BRAND_AURA_ID = 'varkhul_makers_brand';
export const VARKHUL_MAKERS_BRAND_CAST_ID = "Maker's Brand";
export const VARKHUL_MAKERS_BRAND_EVERY = 14;
export const VARKHUL_MAKERS_BRAND_DAMAGE_MAX_HP = 0.3;
export const VARKHUL_MAKERS_BRAND_DURATION = 30;
export const VARKHUL_MAKERS_BRAND_MAX_STACKS = 3;
export const VARKHUL_MAKERS_BRAND_PER_STACK = 0.35;
export const VARKHUL_MAKERS_BRAND_TANK_SWAP_STACKS = 2;

export const VARKHUL_LIVING_BLUEPRINT_CAST_ID = 'Living Blueprint';
export const VARKHUL_LIVING_BLUEPRINT_AURA_ID = 'varkhul_living_blueprint';
export const VARKHUL_LIVING_BLUEPRINT_TARGETS = 3;
export const VARKHUL_LIVING_BLUEPRINT_SECONDS = 4;
export const VARKHUL_LIVING_BLUEPRINT_DAMAGE_MAX_HP = 0.4;
export const VARKHUL_BLUEPRINT_RANGE = 34;
export const VARKHUL_BLUEPRINT_HALF_WIDTH = 2.25;
export const VARKHUL_BLUEPRINT_INNER_RADIUS = 3;

export const VARKHUL_FORGESTORM_CAST_ID = 'Forgestorm';
export const VARKHUL_FORGESTORM_WAVES = 3;
export const VARKHUL_FORGESTORM_IMPACTS_PER_WAVE = 5;
export const VARKHUL_FORGESTORM_DAMAGE_MAX_HP = 0.3;
export {
  VARKHUL_FORGESTORM_RADIUS,
  VARKHUL_FORGESTORM_WARNING_SECONDS,
} from '../varkhul_forgestorm';

export const VARKHUL_ANVILS_DECREE_CAST_ID = "Anvil's Decree";
export const VARKHUL_ANVILS_DECREE_STRIKES = 3;
export const VARKHUL_ANVILS_DECREE_STRIKE_SECONDS = 2;
export const VARKHUL_ANVILS_DECREE_RAIDWIDE_MAX_HP = 0.1;
export const VARKHUL_ANVILS_DECREE_LANE_MAX_HP = 0.35;
export const VARKHUL_ANVIL_LANE_RANGE = 38;
export const VARKHUL_ANVIL_LANE_HALF_WIDTH = 2.5;
export const VARKHUL_ANVIL_LANE_INNER_RADIUS = 3;
export const VARKHUL_FORGE_LOCAL_POS = { x: 0, z: 22 } as const;

export const VARKHUL_MASTERS_ASSEMBLY_CAST_ID = "The Master's Assembly";
export const VARKHUL_MASTERS_ASSEMBLY_AURA_ID = 'varkhul_masters_assembly';
export const VARKHUL_MASTERS_ASSEMBLY_HP_THRESHOLD = 0.5;
export const VARKHUL_MASTERS_ASSEMBLY_SECONDS = 20;
export const VARKHUL_WARDEN_SHIELD_AURA_ID = 'varkhul_warden_shield';

export const VARKHUL_MASTERPIECE_UNBOUND_AURA_ID = 'varkhul_masterpiece_unbound';
export const VARKHUL_MASTERPIECE_UNBOUND_HP_THRESHOLD = 0.2;
export const VARKHUL_MASTERPIECE_UNBOUND_SECONDS = 45;
export const VARKHUL_MASTERPIECE_UNBOUND_SPEED_MULTIPLIER = 1.25;
export const VARKHUL_MASTERPIECE_UNBOUND_DAMAGE_BONUS = 0.25;
export const VARKHUL_MASTERPIECE_UNBOUND_PULSE_SECONDS = 3;
export const VARKHUL_MASTERPIECE_UNBOUND_PULSE_MAX_HP = 0.05;

const VARKHUL_FIRST_BLUEPRINT_SECONDS = 8;
const VARKHUL_FIRST_FORGESTORM_SECONDS = 20;
const VARKHUL_FIRST_ANVIL_SECONDS = 32;
const VARKHUL_BLUEPRINT_EVERY = 34;
const VARKHUL_FORGESTORM_EVERY = 38;
const VARKHUL_ANVIL_EVERY = 42;
const VARKHUL_WIPE_DAMAGE_MULTIPLIER = 100;
const VARKHUL_ASSEMBLY_ADD_OFFSETS = [
  { id: VARKHUL_EMBER_SENTINEL_ID, x: -10, z: 11 },
  { id: VARKHUL_CRUCIBLE_WARDEN_ID, x: 10, z: 11 },
  { id: VARKHUL_CINDER_ARTIFICER_ID, x: 0, z: 18 },
] as const;

function encounterInstance(ctx: SimContext, boss: Entity) {
  return ctx.instances.find((instance) => instance.mobIds.includes(boss.id)) ?? null;
}

function playersInEncounter(ctx: SimContext, boss: Entity, includeDead = false): Entity[] {
  const instance = encounterInstance(ctx, boss);
  if (!instance || instance.exitId === null) return [];
  const players: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const player = ctx.entities.get(meta.entityId);
    if (player?.kind !== 'player' || (!includeDead && player.dead)) continue;
    if (ctx.instanceClaimIdAt(player.pos) !== instance.exitId) continue;
    players.push(player);
  }
  players.sort((a, b) => a.id - b.id);
  return players;
}

function tankIds(ctx: SimContext, boss: Entity): Set<number> {
  const result = new Set<number>();
  if (boss.aggroTargetId !== null) result.add(boss.aggroTargetId);
  for (const meta of ctx.players.values()) {
    if (meta.talentMods.role === 'tank') result.add(meta.entityId);
  }
  return result;
}

export function selectVarkhulBlueprintTargets(
  players: readonly Entity[],
  tanks: ReadonlySet<number>,
  castKey: number,
): Entity[] {
  const candidates = players.filter((player) => !player.dead && !tanks.has(player.id));
  if (candidates.length <= VARKHUL_LIVING_BLUEPRINT_TARGETS) return candidates;
  const start = castKey % candidates.length;
  return Array.from(
    { length: VARKHUL_LIVING_BLUEPRINT_TARGETS },
    (_, index) => candidates[(start + index) % candidates.length],
  );
}

function pointInRadialLanes(
  origin: Pick<Vec3, 'x' | 'z'>,
  facing: number,
  point: Pick<Vec3, 'x' | 'z'>,
  range: number,
  halfWidth: number,
  innerRadius: number,
): boolean {
  const dx = point.x - origin.x;
  const dz = point.z - origin.z;
  for (let lane = 0; lane < 4; lane++) {
    const angle = facing + (lane * Math.PI) / 2;
    const forward = dx * Math.sin(angle) + dz * Math.cos(angle);
    const lateral = dx * Math.cos(angle) - dz * Math.sin(angle);
    if (forward >= innerRadius && forward <= range && Math.abs(lateral) <= halfWidth) return true;
  }
  return false;
}

export function pointInVarkhulBlueprintLane(
  origin: Pick<Vec3, 'x' | 'z'>,
  point: Pick<Vec3, 'x' | 'z'>,
): boolean {
  return pointInRadialLanes(
    origin,
    Math.PI / 4,
    point,
    VARKHUL_BLUEPRINT_RANGE,
    VARKHUL_BLUEPRINT_HALF_WIDTH,
    VARKHUL_BLUEPRINT_INNER_RADIUS,
  );
}

export function pointInVarkhulAnvilLane(
  origin: Pick<Vec3, 'x' | 'z'>,
  facing: number,
  point: Pick<Vec3, 'x' | 'z'>,
): boolean {
  return pointInRadialLanes(
    origin,
    facing,
    point,
    VARKHUL_ANVIL_LANE_RANGE,
    VARKHUL_ANVIL_LANE_HALF_WIDTH,
    VARKHUL_ANVIL_LANE_INNER_RADIUS,
  );
}

export function varkhulForgestormPattern(
  castKey: number,
  waveIndex: number,
  origin: Pick<Vec3, 'x' | 'z'>,
): Array<{ x: number; z: number }> {
  const rotation = castKey * 0.47 + waveIndex * 0.83;
  const radii = [8, 15, 22, 15, 8] as const;
  return radii.map((radius, index) => {
    const angle = rotation + (index * Math.PI * 2) / VARKHUL_FORGESTORM_IMPACTS_PER_WAVE;
    return {
      x: origin.x + Math.sin(angle) * radius,
      z: origin.z + Math.cos(angle) * radius,
    };
  });
}

function initVarkhulEncounter(boss: Entity): VarkhulEncounterState {
  if (!boss.varkhul) {
    boss.varkhul = {
      makersBrandTimer: VARKHUL_MAKERS_BRAND_EVERY,
      blueprintTimer: VARKHUL_FIRST_BLUEPRINT_SECONDS,
      blueprintCastKey: 0,
      blueprintRemaining: 0,
      blueprintTargetIds: [],
      forgestormTimer: VARKHUL_FIRST_FORGESTORM_SECONDS,
      forgestormCastKey: 0,
      forgestormWaveIndex: 0,
      forgestormWarningRemaining: 0,
      forgestormPoints: [],
      anvilTimer: VARKHUL_FIRST_ANVIL_SECONDS,
      anvilStrikeIndex: 0,
      anvilStrikeRemaining: 0,
      anvilFacing: boss.facing,
      majorAbility: 'none',
      assemblyTriggered: false,
      assemblyAddIds: [],
      assemblyRemaining: 0,
      assemblyWipeResolved: false,
      masterpieceTriggered: false,
      masterpieceRemaining: 0,
      masterpiecePulseTimer: VARKHUL_MASTERPIECE_UNBOUND_PULSE_SECONDS,
      masterpieceWipeResolved: false,
    };
  }
  return boss.varkhul;
}

function resolveLivingTarget(boss: Entity, players: readonly Entity[]): Entity | null {
  const current =
    boss.aggroTargetId === null
      ? null
      : (players.find((player) => player.id === boss.aggroTargetId && !player.dead) ?? null);
  const target = current ?? players.find((player) => !player.dead) ?? null;
  boss.aggroTargetId = target?.id ?? null;
  return target;
}

function clearBossCast(boss: Entity): void {
  boss.castingAbility = null;
  boss.castTotal = 0;
  boss.castRemaining = 0;
  boss.castTargetId = null;
  boss.castAim = null;
  boss.channeling = false;
}

function clearEncounterWarnings(ctx: SimContext, boss: Entity): void {
  for (let index = ctx.groundAoEs.length - 1; index >= 0; index--) {
    const effect = ctx.groundAoEs[index];
    if (effect.sourceId === boss.id && effect.abilityId === VARKHUL_FORGESTORM_CAST_ID) {
      ctx.groundAoEs.splice(index, 1);
    }
  }
}

export function clearVarkhulEncounterAuras(player: Entity, sourceId?: number): void {
  player.auras = player.auras.filter(
    (aura) =>
      (aura.id !== VARKHUL_MAKERS_BRAND_AURA_ID && aura.id !== VARKHUL_LIVING_BLUEPRINT_AURA_ID) ||
      (sourceId !== undefined && aura.sourceId !== sourceId),
  );
}

function cancelMajorAbility(ctx: SimContext, boss: Entity, st: VarkhulEncounterState): void {
  for (const player of playersInEncounter(ctx, boss, true)) {
    player.auras = player.auras.filter(
      (aura) => aura.id !== VARKHUL_LIVING_BLUEPRINT_AURA_ID || aura.sourceId !== boss.id,
    );
  }
  clearEncounterWarnings(ctx, boss);
  st.majorAbility = 'none';
  st.blueprintRemaining = 0;
  st.blueprintTargetIds = [];
  st.forgestormWarningRemaining = 0;
  st.forgestormPoints = [];
  st.anvilStrikeIndex = 0;
  st.anvilStrikeRemaining = 0;
  clearBossCast(boss);
}

function dealFractionalDamage(
  ctx: SimContext,
  boss: Entity,
  target: Entity,
  fraction: number,
  ability: string,
): void {
  ctx.dealDamage(
    boss,
    target,
    Math.ceil(target.maxHp * fraction),
    false,
    'fire',
    ability,
    'hit',
    true,
    undefined,
    false,
    false,
    true,
  );
}

function wipeEncounter(
  ctx: SimContext,
  boss: Entity,
  players: readonly Entity[],
  ability: string,
): void {
  for (const player of players) {
    if (player.dead) continue;
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: player.id,
      school: 'fire',
      fx: 'nova',
    });
    ctx.dealDamage(
      boss,
      player,
      player.maxHp * VARKHUL_WIPE_DAMAGE_MULTIPLIER,
      false,
      'fire',
      ability,
      'hit',
      true,
      undefined,
      false,
      false,
      true,
    );
  }
}

function castMakersBrand(ctx: SimContext, boss: Entity, target: Entity): boolean {
  if (dist2d(boss.pos, target.pos) > mobEffectiveMeleeRange(boss)) return false;
  const existing = target.auras.find(
    (aura) => aura.id === VARKHUL_MAKERS_BRAND_AURA_ID && aura.sourceId === boss.id,
  );
  dealFractionalDamage(
    ctx,
    boss,
    target,
    VARKHUL_MAKERS_BRAND_DAMAGE_MAX_HP,
    VARKHUL_MAKERS_BRAND_CAST_ID,
  );
  if (!target.dead) {
    if (existing) {
      existing.stacks = Math.min(
        VARKHUL_MAKERS_BRAND_MAX_STACKS,
        Math.max(1, existing.stacks ?? 1) + 1,
      );
      existing.value = existing.stacks * VARKHUL_MAKERS_BRAND_PER_STACK;
      existing.remaining = VARKHUL_MAKERS_BRAND_DURATION;
      ctx.emit({ type: 'aura', targetId: target.id, name: existing.name, gained: true });
    } else {
      ctx.applyAura(target, {
        id: VARKHUL_MAKERS_BRAND_AURA_ID,
        name: VARKHUL_MAKERS_BRAND_CAST_ID,
        kind: 'vuln_source',
        remaining: VARKHUL_MAKERS_BRAND_DURATION,
        duration: VARKHUL_MAKERS_BRAND_DURATION,
        value: VARKHUL_MAKERS_BRAND_PER_STACK,
        stacks: 1,
        sourceId: boss.id,
        school: 'fire',
        encounterOwned: true,
      });
    }
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: target.id,
    school: 'fire',
    fx: 'projectile',
  });
  return true;
}

function startLivingBlueprint(
  ctx: SimContext,
  boss: Entity,
  st: VarkhulEncounterState,
  players: readonly Entity[],
): void {
  st.blueprintCastKey++;
  const targets = selectVarkhulBlueprintTargets(players, tankIds(ctx, boss), st.blueprintCastKey);
  st.majorAbility = 'blueprint';
  st.blueprintRemaining = VARKHUL_LIVING_BLUEPRINT_SECONDS;
  st.blueprintTargetIds = targets.map((target) => target.id);
  st.blueprintTimer = VARKHUL_BLUEPRINT_EVERY;
  boss.castingAbility = VARKHUL_LIVING_BLUEPRINT_CAST_ID;
  boss.castTotal = VARKHUL_LIVING_BLUEPRINT_SECONDS;
  boss.castRemaining = VARKHUL_LIVING_BLUEPRINT_SECONDS;
  boss.castTargetId = null;
  boss.castAim = null;
  boss.channeling = true;
  for (const target of targets) {
    ctx.applyAura(target, {
      id: VARKHUL_LIVING_BLUEPRINT_AURA_ID,
      name: VARKHUL_LIVING_BLUEPRINT_CAST_ID,
      kind: 'vulnerability',
      remaining: VARKHUL_LIVING_BLUEPRINT_SECONDS,
      duration: VARKHUL_LIVING_BLUEPRINT_SECONDS,
      value: 0,
      sourceId: boss.id,
      school: 'fire',
      encounterOwned: true,
    });
  }
}

function resolveLivingBlueprint(
  ctx: SimContext,
  boss: Entity,
  st: VarkhulEncounterState,
  players: readonly Entity[],
): void {
  const origins = st.blueprintTargetIds
    .map((id) => ctx.entities.get(id))
    .filter((entity): entity is Entity => entity?.kind === 'player');
  for (const origin of origins) {
    ctx.emit({
      type: 'spellfxAt',
      x: origin.pos.x,
      z: origin.pos.z,
      school: 'fire',
      fx: 'nova',
      sourceId: boss.id,
      radius: VARKHUL_BLUEPRINT_RANGE,
      ability: VARKHUL_LIVING_BLUEPRINT_CAST_ID,
    });
  }
  for (const player of players) {
    if (!origins.some((origin) => pointInVarkhulBlueprintLane(origin.pos, player.pos))) continue;
    dealFractionalDamage(
      ctx,
      boss,
      player,
      VARKHUL_LIVING_BLUEPRINT_DAMAGE_MAX_HP,
      VARKHUL_LIVING_BLUEPRINT_CAST_ID,
    );
  }
  for (const player of playersInEncounter(ctx, boss, true)) {
    player.auras = player.auras.filter(
      (aura) => aura.id !== VARKHUL_LIVING_BLUEPRINT_AURA_ID || aura.sourceId !== boss.id,
    );
  }
  st.blueprintRemaining = 0;
  st.blueprintTargetIds = [];
  st.majorAbility = 'none';
  clearBossCast(boss);
}

function updateLivingBlueprint(
  ctx: SimContext,
  boss: Entity,
  st: VarkhulEncounterState,
  players: readonly Entity[],
  speed: number,
): void {
  st.blueprintRemaining = Math.max(0, st.blueprintRemaining - DT * speed);
  boss.castingAbility = VARKHUL_LIVING_BLUEPRINT_CAST_ID;
  boss.castRemaining = st.blueprintRemaining;
  if (st.blueprintRemaining <= CAST_COMPLETE_EPS) resolveLivingBlueprint(ctx, boss, st, players);
}

function addForgestormWarnings(ctx: SimContext, boss: Entity, points: readonly Vec3[]): void {
  for (const point of points) {
    ctx.groundAoEs.push({
      sourceId: boss.id,
      abilityId: VARKHUL_FORGESTORM_CAST_ID,
      ability: VARKHUL_FORGESTORM_CAST_ID,
      pos: { ...point },
      radius: VARKHUL_FORGESTORM_RADIUS,
      min: 0,
      max: 0,
      remaining: VARKHUL_FORGESTORM_WARNING_SECONDS + DT * 2,
      interval: 999,
      tickTimer: 999,
      school: 'fire',
    });
  }
}

function startForgestormWave(
  ctx: SimContext,
  boss: Entity,
  st: VarkhulEncounterState,
  waveIndex: number,
): void {
  const instance = encounterInstance(ctx, boss);
  if (!instance) return;
  const origin = ctx.instanceOriginOf(instance);
  st.forgestormWaveIndex = waveIndex;
  st.forgestormWarningRemaining = VARKHUL_FORGESTORM_WARNING_SECONDS;
  st.forgestormPoints = varkhulForgestormPattern(st.forgestormCastKey, waveIndex, origin).map(
    (point) => ctx.groundPos(point.x, point.z),
  );
  addForgestormWarnings(ctx, boss, st.forgestormPoints);
}

function startForgestorm(ctx: SimContext, boss: Entity, st: VarkhulEncounterState): void {
  st.majorAbility = 'forgestorm';
  st.forgestormTimer = VARKHUL_FORGESTORM_EVERY;
  st.forgestormCastKey++;
  boss.castingAbility = VARKHUL_FORGESTORM_CAST_ID;
  boss.castTotal = VARKHUL_FORGESTORM_WAVES * VARKHUL_FORGESTORM_WARNING_SECONDS;
  boss.castRemaining = boss.castTotal;
  boss.castTargetId = null;
  boss.castAim = null;
  boss.channeling = true;
  startForgestormWave(ctx, boss, st, 0);
}

function resolveForgestormWave(
  ctx: SimContext,
  boss: Entity,
  st: VarkhulEncounterState,
  players: readonly Entity[],
): void {
  for (const point of st.forgestormPoints) {
    ctx.emit({
      type: 'spellfxAt',
      x: point.x,
      z: point.z,
      school: 'fire',
      fx: 'meteorImpact',
      sourceId: boss.id,
      radius: VARKHUL_FORGESTORM_RADIUS,
      ability: VARKHUL_FORGESTORM_CAST_ID,
    });
  }
  for (const player of players) {
    if (
      !st.forgestormPoints.some(
        (point) =>
          Math.hypot(player.pos.x - point.x, player.pos.z - point.z) <= VARKHUL_FORGESTORM_RADIUS,
      )
    )
      continue;
    dealFractionalDamage(
      ctx,
      boss,
      player,
      VARKHUL_FORGESTORM_DAMAGE_MAX_HP,
      VARKHUL_FORGESTORM_CAST_ID,
    );
  }
  clearEncounterWarnings(ctx, boss);
  st.forgestormPoints = [];
  const nextWave = st.forgestormWaveIndex + 1;
  if (nextWave < VARKHUL_FORGESTORM_WAVES) {
    startForgestormWave(ctx, boss, st, nextWave);
    return;
  }
  st.forgestormWarningRemaining = 0;
  st.majorAbility = 'none';
  clearBossCast(boss);
}

function updateForgestorm(
  ctx: SimContext,
  boss: Entity,
  st: VarkhulEncounterState,
  players: readonly Entity[],
  speed: number,
): void {
  st.forgestormWarningRemaining = Math.max(0, st.forgestormWarningRemaining - DT * speed);
  boss.castingAbility = VARKHUL_FORGESTORM_CAST_ID;
  boss.castRemaining =
    (VARKHUL_FORGESTORM_WAVES - 1 - st.forgestormWaveIndex) * VARKHUL_FORGESTORM_WARNING_SECONDS +
    st.forgestormWarningRemaining;
  if (st.forgestormWarningRemaining <= CAST_COMPLETE_EPS) {
    resolveForgestormWave(ctx, boss, st, players);
  }
}

function anvilWorldPosition(ctx: SimContext, boss: Entity): Vec3 {
  const instance = encounterInstance(ctx, boss);
  if (!instance) return { ...boss.spawnPos };
  const origin = ctx.instanceOriginOf(instance);
  return ctx.groundPos(origin.x + VARKHUL_FORGE_LOCAL_POS.x, origin.z + VARKHUL_FORGE_LOCAL_POS.z);
}

function setAnvilStrikeFacing(st: VarkhulEncounterState): void {
  st.anvilFacing = ((st.anvilStrikeIndex + st.forgestormCastKey) * Math.PI) / 8;
}

function startAnvilsDecree(ctx: SimContext, boss: Entity, st: VarkhulEncounterState): void {
  st.majorAbility = 'anvil';
  st.anvilTimer = VARKHUL_ANVIL_EVERY;
  st.anvilStrikeIndex = 0;
  st.anvilStrikeRemaining = VARKHUL_ANVILS_DECREE_STRIKE_SECONDS;
  setAnvilStrikeFacing(st);
  const forge = anvilWorldPosition(ctx, boss);
  boss.pos = { ...forge };
  boss.prevPos = { ...forge };
  boss.facing = st.anvilFacing;
  boss.prevFacing = st.anvilFacing;
  boss.castingAbility = VARKHUL_ANVILS_DECREE_CAST_ID;
  boss.castTotal = VARKHUL_ANVILS_DECREE_STRIKES * VARKHUL_ANVILS_DECREE_STRIKE_SECONDS;
  boss.castRemaining = boss.castTotal;
  boss.castTargetId = null;
  boss.castAim = { ...forge };
  boss.channeling = true;
}

function resolveAnvilStrike(
  ctx: SimContext,
  boss: Entity,
  st: VarkhulEncounterState,
  players: readonly Entity[],
): void {
  const forge = anvilWorldPosition(ctx, boss);
  ctx.emit({
    type: 'spellfxAt',
    x: forge.x,
    z: forge.z,
    school: 'fire',
    fx: 'nova',
    sourceId: boss.id,
    radius: VARKHUL_ANVIL_LANE_RANGE,
    ability: VARKHUL_ANVILS_DECREE_CAST_ID,
  });
  for (const player of players) {
    dealFractionalDamage(
      ctx,
      boss,
      player,
      VARKHUL_ANVILS_DECREE_RAIDWIDE_MAX_HP,
      VARKHUL_ANVILS_DECREE_CAST_ID,
    );
    if (player.dead || !pointInVarkhulAnvilLane(forge, st.anvilFacing, player.pos)) continue;
    dealFractionalDamage(
      ctx,
      boss,
      player,
      VARKHUL_ANVILS_DECREE_LANE_MAX_HP,
      VARKHUL_ANVILS_DECREE_CAST_ID,
    );
  }
  st.anvilStrikeIndex++;
  if (st.anvilStrikeIndex >= VARKHUL_ANVILS_DECREE_STRIKES) {
    st.anvilStrikeRemaining = 0;
    st.majorAbility = 'none';
    clearBossCast(boss);
    return;
  }
  st.anvilStrikeRemaining = VARKHUL_ANVILS_DECREE_STRIKE_SECONDS;
  setAnvilStrikeFacing(st);
  boss.facing = st.anvilFacing;
  boss.prevFacing = st.anvilFacing;
}

function updateAnvilsDecree(
  ctx: SimContext,
  boss: Entity,
  st: VarkhulEncounterState,
  players: readonly Entity[],
  speed: number,
): void {
  st.anvilStrikeRemaining = Math.max(0, st.anvilStrikeRemaining - DT * speed);
  boss.castingAbility = VARKHUL_ANVILS_DECREE_CAST_ID;
  boss.castRemaining =
    (VARKHUL_ANVILS_DECREE_STRIKES - 1 - st.anvilStrikeIndex) *
      VARKHUL_ANVILS_DECREE_STRIKE_SECONDS +
    st.anvilStrikeRemaining;
  boss.facing = st.anvilFacing;
  if (st.anvilStrikeRemaining <= CAST_COMPLETE_EPS) {
    resolveAnvilStrike(ctx, boss, st, players);
  }
}

function spawnAssemblyAdd(
  ctx: SimContext,
  boss: Entity,
  templateId: string,
  localX: number,
  localZ: number,
): Entity | null {
  const instance = encounterInstance(ctx, boss);
  const template = MOBS[templateId];
  if (!instance || !template) return null;
  const origin = ctx.instanceOriginOf(instance);
  const difficulty = instance.difficulty ?? 'normal';
  const spawnTemplate = mobTemplateForDungeonDifficulty(template, instance.dungeonId, difficulty);
  const add = createMob(
    ctx.nextId++,
    spawnTemplate,
    spawnTemplate.maxLevel,
    ctx.groundPos(origin.x + localX, origin.z + localZ),
  );
  applyDungeonMobTuning(add, instance.dungeonId, difficulty);
  add.spawnPos = { ...add.pos };
  add.tappedById = boss.tappedById;
  add.inCombat = true;
  add.aiState = 'attack';
  add.aggroTargetId = boss.aggroTargetId;
  ctx.addEntity(add);
  boss.summonedIds.push(add.id);
  instance.mobIds.push(add.id);
  return add;
}

function startMastersAssembly(ctx: SimContext, boss: Entity, st: VarkhulEncounterState): void {
  cancelMajorAbility(ctx, boss, st);
  st.assemblyTriggered = true;
  st.assemblyRemaining = VARKHUL_MASTERS_ASSEMBLY_SECONDS;
  st.assemblyWipeResolved = false;
  const adds = VARKHUL_ASSEMBLY_ADD_OFFSETS.map((spawn) =>
    spawnAssemblyAdd(ctx, boss, spawn.id, spawn.x, spawn.z),
  ).filter((add): add is Entity => add !== null);
  st.assemblyAddIds = adds.map((add) => add.id);
  ctx.applyAura(boss, {
    id: VARKHUL_MASTERS_ASSEMBLY_AURA_ID,
    name: VARKHUL_MASTERS_ASSEMBLY_CAST_ID,
    kind: 'absorb',
    remaining: VARKHUL_MASTERS_ASSEMBLY_SECONDS,
    duration: VARKHUL_MASTERS_ASSEMBLY_SECONDS,
    value: boss.maxHp * VARKHUL_WIPE_DAMAGE_MULTIPLIER,
    sourceId: boss.id,
    school: 'fire',
    encounterOwned: true,
  });
  const warden = adds.find((add) => add.templateId === VARKHUL_CRUCIBLE_WARDEN_ID);
  const artificer = adds.find((add) => add.templateId === VARKHUL_CINDER_ARTIFICER_ID);
  if (warden && artificer) {
    ctx.applyAura(artificer, {
      id: VARKHUL_WARDEN_SHIELD_AURA_ID,
      name: 'Crucible Guard',
      kind: 'absorb',
      remaining: VARKHUL_MASTERS_ASSEMBLY_SECONDS,
      duration: VARKHUL_MASTERS_ASSEMBLY_SECONDS,
      value: artificer.maxHp * VARKHUL_WIPE_DAMAGE_MULTIPLIER,
      sourceId: warden.id,
      school: 'fire',
      encounterOwned: true,
    });
  }
  if (artificer) {
    artificer.castingAbility = VARKHUL_MASTERS_ASSEMBLY_CAST_ID;
    artificer.castTotal = VARKHUL_MASTERS_ASSEMBLY_SECONDS;
    artificer.castRemaining = VARKHUL_MASTERS_ASSEMBLY_SECONDS;
    artificer.castTargetId = null;
    artificer.castAim = null;
    artificer.channeling = true;
  }
}

function finishAssembly(ctx: SimContext, boss: Entity, st: VarkhulEncounterState): void {
  boss.auras = boss.auras.filter(
    (aura) => aura.id !== VARKHUL_MASTERS_ASSEMBLY_AURA_ID || aura.sourceId !== boss.id,
  );
  st.assemblyRemaining = 0;
  for (const id of st.assemblyAddIds) {
    const add = ctx.entities.get(id);
    if (add) clearBossCast(add);
  }
  st.assemblyAddIds = [];
}

function updateMastersAssembly(
  ctx: SimContext,
  boss: Entity,
  st: VarkhulEncounterState,
  players: readonly Entity[],
): boolean {
  if (!st.assemblyTriggered || st.assemblyAddIds.length === 0) return false;
  const adds = st.assemblyAddIds.map((id) => ctx.entities.get(id)).filter(Boolean) as Entity[];
  const liveAdds = adds.filter((add) => !add.dead);
  const warden = liveAdds.find((add) => add.templateId === VARKHUL_CRUCIBLE_WARDEN_ID);
  const artificer = liveAdds.find((add) => add.templateId === VARKHUL_CINDER_ARTIFICER_ID);
  if (!warden && artificer) {
    artificer.auras = artificer.auras.filter((aura) => aura.id !== VARKHUL_WARDEN_SHIELD_AURA_ID);
  }
  if (liveAdds.length === 0) {
    finishAssembly(ctx, boss, st);
    return false;
  }
  if (artificer) {
    st.assemblyRemaining = Math.max(0, st.assemblyRemaining - DT);
    artificer.castingAbility = VARKHUL_MASTERS_ASSEMBLY_CAST_ID;
    artificer.castTotal = VARKHUL_MASTERS_ASSEMBLY_SECONDS;
    artificer.castRemaining = st.assemblyRemaining;
    artificer.channeling = true;
    if (st.assemblyRemaining <= CAST_COMPLETE_EPS && !st.assemblyWipeResolved) {
      st.assemblyWipeResolved = true;
      wipeEncounter(ctx, boss, players, VARKHUL_MASTERS_ASSEMBLY_CAST_ID);
    }
  } else {
    st.assemblyRemaining = 0;
  }
  boss.aiState = 'attack';
  return true;
}

export function updateVarkhulAssemblyArtificer(add: Entity): void {
  if (
    add.templateId !== VARKHUL_CINDER_ARTIFICER_ID ||
    add.castingAbility !== VARKHUL_MASTERS_ASSEMBLY_CAST_ID
  )
    return;
  add.inCombat = true;
  add.aiState = 'attack';
  add.aggroTargetId = null;
  add.channeling = true;
}

function startMasterpieceUnbound(boss: Entity, st: VarkhulEncounterState): void {
  st.masterpieceTriggered = true;
  st.masterpieceRemaining = VARKHUL_MASTERPIECE_UNBOUND_SECONDS;
  st.masterpiecePulseTimer = VARKHUL_MASTERPIECE_UNBOUND_PULSE_SECONDS;
  st.masterpieceWipeResolved = false;
  boss.enraged = true;
  boss.auras.push({
    id: VARKHUL_MASTERPIECE_UNBOUND_AURA_ID,
    name: 'Masterpiece Unbound',
    kind: 'enrage',
    remaining: VARKHUL_MASTERPIECE_UNBOUND_SECONDS,
    duration: VARKHUL_MASTERPIECE_UNBOUND_SECONDS,
    value: VARKHUL_MASTERPIECE_UNBOUND_DAMAGE_BONUS,
    sourceId: boss.id,
    school: 'fire',
    encounterOwned: true,
  });
}

function updateMasterpieceUnbound(
  ctx: SimContext,
  boss: Entity,
  st: VarkhulEncounterState,
  players: readonly Entity[],
): void {
  if (!st.masterpieceTriggered || st.masterpieceWipeResolved) return;
  st.masterpieceRemaining = Math.max(0, st.masterpieceRemaining - DT);
  st.masterpiecePulseTimer -= DT;
  if (st.masterpiecePulseTimer <= CAST_COMPLETE_EPS) {
    st.masterpiecePulseTimer += VARKHUL_MASTERPIECE_UNBOUND_PULSE_SECONDS;
    for (const player of players) {
      dealFractionalDamage(
        ctx,
        boss,
        player,
        VARKHUL_MASTERPIECE_UNBOUND_PULSE_MAX_HP,
        'Living Forge',
      );
    }
  }
  if (st.masterpieceRemaining <= CAST_COMPLETE_EPS) {
    st.masterpieceWipeResolved = true;
    wipeEncounter(ctx, boss, players, 'Masterpiece Unbound');
  }
}

export function resetVarkhulEncounter(ctx: SimContext, boss: Entity): void {
  for (const meta of ctx.players.values()) {
    const player = ctx.entities.get(meta.entityId);
    if (player?.kind !== 'player') continue;
    clearVarkhulEncounterAuras(player, boss.id);
  }
  clearEncounterWarnings(ctx, boss);
  ctx.despawnSummonedAdds(boss);
  boss.varkhul = undefined;
  boss.enraged = false;
  boss.auras = boss.auras.filter(
    (aura) =>
      aura.id !== VARKHUL_MASTERS_ASSEMBLY_AURA_ID &&
      aura.id !== VARKHUL_MASTERPIECE_UNBOUND_AURA_ID,
  );
  clearBossCast(boss);
}

function updateMajorAbility(
  ctx: SimContext,
  boss: Entity,
  st: VarkhulEncounterState,
  players: readonly Entity[],
  speed: number,
): boolean {
  if (st.majorAbility === 'blueprint') {
    updateLivingBlueprint(ctx, boss, st, players, speed);
    return true;
  }
  if (st.majorAbility === 'forgestorm') {
    updateForgestorm(ctx, boss, st, players, speed);
    return true;
  }
  if (st.majorAbility === 'anvil') {
    updateAnvilsDecree(ctx, boss, st, players, speed);
    return true;
  }
  return false;
}

export function updateVarkhulEncounter(ctx: SimContext, boss: Entity, pursueTarget = false): void {
  if (boss.templateId !== VARKHUL_BOSS_TEMPLATE_ID || boss.dead) return;
  let players = playersInEncounter(ctx, boss);
  if (players.length === 0) {
    boss.aiState = 'evade';
    if (boss.combatExitHoldUntil > ctx.time) return;
    resetVarkhulEncounter(ctx, boss);
    ctx.resetEvadingMob(boss);
    return;
  }
  const st = initVarkhulEncounter(boss);
  updateMobTarget(ctx, boss);
  let target = resolveLivingTarget(boss, players);
  if (!target) return;
  boss.aggroTargetId = target.id;
  boss.inCombat = true;
  boss.aiState = 'attack';

  if (!st.assemblyTriggered && boss.hp / boss.maxHp <= VARKHUL_MASTERS_ASSEMBLY_HP_THRESHOLD) {
    startMastersAssembly(ctx, boss, st);
  }
  if (updateMastersAssembly(ctx, boss, st, players)) return;

  if (
    !st.masterpieceTriggered &&
    boss.hp / boss.maxHp <= VARKHUL_MASTERPIECE_UNBOUND_HP_THRESHOLD
  ) {
    startMasterpieceUnbound(boss, st);
  }
  updateMasterpieceUnbound(ctx, boss, st, players);
  players = playersInEncounter(ctx, boss);
  target = resolveLivingTarget(boss, players);
  if (!target) return;

  const speed = st.masterpieceTriggered ? VARKHUL_MASTERPIECE_UNBOUND_SPEED_MULTIPLIER : 1;
  st.makersBrandTimer -= DT;
  if (st.makersBrandTimer <= CAST_COMPLETE_EPS && castMakersBrand(ctx, boss, target)) {
    st.makersBrandTimer = VARKHUL_MAKERS_BRAND_EVERY;
    players = playersInEncounter(ctx, boss);
    target = resolveLivingTarget(boss, players);
    if (!target) return;
  }

  if (updateMajorAbility(ctx, boss, st, players, speed)) return;

  st.blueprintTimer -= DT * speed;
  st.forgestormTimer -= DT * speed;
  st.anvilTimer -= DT * speed;
  if (st.blueprintTimer <= CAST_COMPLETE_EPS) {
    startLivingBlueprint(ctx, boss, st, players);
    return;
  }
  if (st.forgestormTimer <= CAST_COMPLETE_EPS) {
    startForgestorm(ctx, boss, st);
    return;
  }
  if (st.anvilTimer <= CAST_COMPLETE_EPS) {
    startAnvilsDecree(ctx, boss, st);
    return;
  }

  boss.swingTimer = Math.max(0, boss.swingTimer - DT);
  tryMobMeleeSwingInRange(ctx, boss, target);
  if (!pursueTarget) return;
  const profile = mobCombatProfile(boss);
  if (dist2d(boss.pos, target.pos) > profile.desiredRange) {
    if (!ctx.isRooted(boss)) {
      ctx.moveToward(
        boss,
        target.pos,
        boss.moveSpeed * profile.chaseSpeedMult * ctx.moveSpeedMult(boss),
      );
    } else {
      boss.facing = steadyAngleTo(boss.pos, target.pos, boss.facing);
    }
  } else {
    boss.facing = steadyAngleTo(boss.pos, target.pos, boss.facing);
  }
  tryMobMeleeSwingInRange(ctx, boss, target);
  boss.aiState = dist2d(boss.pos, target.pos) <= profile.meleeRange ? 'attack' : 'chase';
}
