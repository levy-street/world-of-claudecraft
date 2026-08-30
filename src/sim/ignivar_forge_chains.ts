import type { SimContext } from './sim_context';
import { DT, dist2d, type Entity, type IgnivarEncounterState, type Vec3 } from './types';

export const IGNIVAR_FORGE_CHAINS_AURA_ID = 'ignivar_forge_chains';
export const IGNIVAR_FORGE_CHAINS_NAME = 'Chains of the Forge';
export const IGNIVAR_FORGE_CHAINS_FIRST_SECONDS = 18;
export const IGNIVAR_FORGE_CHAINS_EVERY = 32;
export const IGNIVAR_FORGE_CHAINS_DURATION_SECONDS = 8;
export const IGNIVAR_FORGE_CHAINS_BREAK_DISTANCE = 10;
export const IGNIVAR_FORGE_CHAINS_PAIR_COUNT = 5;
export const IGNIVAR_FORGE_CHAINS_ATTACH_GRACE_SECONDS = 2.5;
export const IGNIVAR_FORGE_CHAINS_STRAIN_SECONDS = 0.75;
export const IGNIVAR_FORGE_CHAINS_WARNING_DISTANCE = 8;

export type IgnivarForgeChainsUpdate = 'idle' | 'active' | 'resolved';

const CHAIN_CROSSING_EPSILON = 1e-8;

function orientXZ(first: Vec3, second: Vec3, point: Vec3): number {
  return (second.x - first.x) * (point.z - first.z) - (second.z - first.z) * (point.x - first.x);
}

function pointStrictlyInsideSegmentXZ(point: Vec3, first: Vec3, second: Vec3): boolean {
  const dx = second.x - first.x;
  const dz = second.z - first.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= CHAIN_CROSSING_EPSILON) return false;
  const projection = (point.x - first.x) * dx + (point.z - first.z) * dz;
  return projection > CHAIN_CROSSING_EPSILON && projection < lengthSq - CHAIN_CROSSING_EPSILON;
}

/**
 * Whether one tick of player movement passes through the live chain segment.
 * Strict segment intersection deliberately ignores stationary overlap,
 * collinear movement, and endpoint grazes beside either linked player.
 */
export function movementCrossesIgnivarForgeChain(
  movementStart: Vec3,
  movementEnd: Vec3,
  chainFirst: Vec3,
  chainSecond: Vec3,
): boolean {
  if (movementStart.x === movementEnd.x && movementStart.z === movementEnd.z) return false;
  const movementFirstSide = orientXZ(movementStart, movementEnd, chainFirst);
  const movementSecondSide = orientXZ(movementStart, movementEnd, chainSecond);
  const chainStartSide = orientXZ(chainFirst, chainSecond, movementStart);
  const chainEndSide = orientXZ(chainFirst, chainSecond, movementEnd);
  const passedThrough =
    movementFirstSide * movementSecondSide < 0 && chainStartSide * chainEndSide < 0;
  const landedOnChain =
    Math.abs(chainStartSide) > CHAIN_CROSSING_EPSILON &&
    Math.abs(chainEndSide) <= CHAIN_CROSSING_EPSILON &&
    pointStrictlyInsideSegmentXZ(movementEnd, chainFirst, chainSecond);
  return passedThrough || landedOnChain;
}

function clearChainAura(player: Entity | undefined, bossId: number): void {
  if (!player) return;
  player.auras = player.auras.filter(
    (aura) => aura.id !== IGNIVAR_FORGE_CHAINS_AURA_ID || aura.sourceId !== bossId,
  );
}

export function clearIgnivarForgeChainAura(player: Entity, bossId?: number): void {
  player.auras = player.auras.filter(
    (aura) =>
      aura.id !== IGNIVAR_FORGE_CHAINS_AURA_ID ||
      (bossId !== undefined && aura.sourceId !== bossId),
  );
}

function closestChainPair(candidates: readonly Entity[]): [Entity, Entity] | null {
  let pair: [Entity, Entity] | null = null;
  let pairDistance = Number.POSITIVE_INFINITY;
  for (let first = 0; first < candidates.length; first++) {
    for (let second = first + 1; second < candidates.length; second++) {
      const distance = dist2d(candidates[first].pos, candidates[second].pos);
      if (distance >= pairDistance) continue;
      pair = [candidates[first], candidates[second]];
      pairDistance = distance;
    }
  }
  return pair;
}

function eligibleChainPairs(ctx: SimContext, players: readonly Entity[]): [Entity, Entity][] {
  const living = players.filter((player) => !player.dead).sort((a, b) => a.id - b.id);
  const pairs: [Entity, Entity][] = [];
  const linkedIds = new Set<number>();
  if (ctx.devCommands) {
    const devBotIds = new Set<number>();
    for (const meta of ctx.players.values()) {
      if (meta.isDevBot) devBotIds.add(meta.entityId);
    }
    const humans = living.filter((player) => !devBotIds.has(player.id));
    if (humans.length === 1) {
      let nearestBot: Entity | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const player of living) {
        if (!devBotIds.has(player.id)) continue;
        const distance = dist2d(humans[0].pos, player.pos);
        if (distance >= nearestDistance) continue;
        nearestBot = player;
        nearestDistance = distance;
      }
      if (nearestBot) {
        pairs.push([humans[0], nearestBot]);
        linkedIds.add(humans[0].id);
        linkedIds.add(nearestBot.id);
      }
    }
  }
  let candidates = living.filter((player) => !linkedIds.has(player.id));
  while (pairs.length < IGNIVAR_FORGE_CHAINS_PAIR_COUNT) {
    const pair = closestChainPair(candidates);
    if (!pair) break;
    pairs.push(pair);
    linkedIds.add(pair[0].id);
    linkedIds.add(pair[1].id);
    candidates = candidates.filter((player) => !linkedIds.has(player.id));
  }
  return pairs;
}

function applyChainAura(ctx: SimContext, boss: Entity, player: Entity, partner: Entity): void {
  ctx.applyAura(player, {
    id: IGNIVAR_FORGE_CHAINS_AURA_ID,
    name: IGNIVAR_FORGE_CHAINS_NAME,
    kind: 'vulnerability',
    remaining: IGNIVAR_FORGE_CHAINS_DURATION_SECONDS,
    duration: IGNIVAR_FORGE_CHAINS_DURATION_SECONDS,
    value: 0,
    value2: partner.id,
    sourceId: boss.id,
    school: 'fire',
    encounterOwned: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: player.id,
    school: 'fire',
    fx: 'nova',
  });
}

function finishChainPair(
  ctx: SimContext,
  boss: Entity,
  first: Entity | undefined,
  second: Entity | undefined,
  resolution: 'safe' | 'strain' | 'crossed',
): void {
  if (resolution === 'strain') {
    for (const player of [first, second]) {
      if (!player || player.dead) continue;
      executeChainFailure(ctx, boss, player);
    }
  }
  for (const player of [first, second]) {
    clearChainAura(player, boss.id);
    if (!player) continue;
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: player.id,
      school: 'fire',
      fx: resolution === 'safe' ? 'flourish' : 'detonate',
    });
  }
}

function executeChainFailure(ctx: SimContext, boss: Entity, player: Entity): void {
  ctx.dealDamage(
    boss,
    player,
    player.maxHp * 100,
    false,
    'fire',
    IGNIVAR_FORGE_CHAINS_NAME,
    'hit',
    true,
    undefined,
    false,
    false,
    true,
  );
  // Severing a tether is an encounter failure, not a survivable damage check.
  // Keep explicit GM/dev invulnerability useful while bypassing ordinary
  // immunities and cheat-death effects in a real encounter.
  if (
    !player.dead &&
    !player.gm &&
    !(ctx.devCommands && (player.devGod || player.profilerInvulnerable))
  ) {
    ctx.handleDeath(player, boss);
  }
}

function snapshotChainPlayerPositions(
  players: readonly Entity[],
): Array<{ playerId: number; x: number; z: number }> {
  return players
    .filter((player) => !player.dead)
    .sort((a, b) => a.id - b.id)
    .map((player) => ({ playerId: player.id, x: player.pos.x, z: player.pos.z }));
}

function findChainCrossings(
  ctx: SimContext,
  linked: readonly [number, number][],
  players: readonly Entity[],
  previousPositions: readonly { playerId: number; x: number; z: number }[],
): Array<{ pairIndex: number; intruder: Entity }> {
  const previousByPlayerId = new Map(
    previousPositions.map((position) => [position.playerId, position] as const),
  );
  const crossings: Array<{ pairIndex: number; intruder: Entity }> = [];
  for (let pairIndex = 0; pairIndex < linked.length; pairIndex++) {
    const [firstId, secondId] = linked[pairIndex];
    const first = ctx.entities.get(firstId);
    const second = ctx.entities.get(secondId);
    if (!first || !second || first.dead || second.dead) continue;
    for (const player of players) {
      if (player.dead || player.id === firstId || player.id === secondId) continue;
      const previous = previousByPlayerId.get(player.id);
      if (!previous) continue;
      if (
        movementCrossesIgnivarForgeChain(
          { x: previous.x, y: player.pos.y, z: previous.z },
          player.pos,
          first.pos,
          second.pos,
        )
      ) {
        crossings.push({ pairIndex, intruder: player });
      }
    }
  }
  return crossings;
}

function killChainIntruder(ctx: SimContext, boss: Entity, intruder: Entity): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: intruder.id,
    school: 'fire',
    fx: 'detonate',
  });
  executeChainFailure(ctx, boss, intruder);
}

function finishChainCycle(state: IgnivarEncounterState): void {
  state.forgeChainsPlayerIds = null;
  state.forgeChainsRemaining = 0;
  state.forgeChainsAttachGraceRemaining = 0;
  state.forgeChainsStrainSeconds = [];
  state.forgeChainsTimer = IGNIVAR_FORGE_CHAINS_EVERY;
  state.forgeChainsLastPositions = [];
}

/** Updates Ignivar's Heroic-only stay-together pair mechanic. */
export function updateIgnivarForgeChains(
  ctx: SimContext,
  boss: Entity,
  state: IgnivarEncounterState,
  players: readonly Entity[],
  canStart: boolean,
): IgnivarForgeChainsUpdate {
  const linked = state.forgeChainsPlayerIds;
  if (linked) {
    const crossings = findChainCrossings(ctx, linked, players, state.forgeChainsLastPositions);
    const crossedPairIndices = new Set(crossings.map((crossing) => crossing.pairIndex));
    const intruders = [
      ...new Map(crossings.map(({ intruder }) => [intruder.id, intruder])).values(),
    ].sort((a, b) => a.id - b.id);
    for (const intruder of intruders) killChainIntruder(ctx, boss, intruder);
    state.forgeChainsRemaining = Math.max(0, state.forgeChainsRemaining - DT);
    state.forgeChainsAttachGraceRemaining = Math.max(0, state.forgeChainsAttachGraceRemaining - DT);
    const encounterPlayerIds = new Set(players.map((player) => player.id));
    const activePairs: [number, number][] = [];
    const activeStrains: number[] = [];
    for (let pairIndex = 0; pairIndex < linked.length; pairIndex++) {
      const [firstId, secondId] = linked[pairIndex];
      const first = ctx.entities.get(firstId);
      const second = ctx.entities.get(secondId);
      const invalid =
        !first ||
        !second ||
        first.dead ||
        second.dead ||
        !encounterPlayerIds.has(firstId) ||
        !encounterPlayerIds.has(secondId);
      if (crossedPairIndices.has(pairIndex)) {
        finishChainPair(ctx, boss, first, second, 'crossed');
        continue;
      }
      if (invalid) {
        finishChainPair(ctx, boss, first, second, 'safe');
        continue;
      }
      const firstAura = first.auras.find(
        (entry) => entry.id === IGNIVAR_FORGE_CHAINS_AURA_ID && entry.sourceId === boss.id,
      );
      const secondAura = second.auras.find(
        (entry) => entry.id === IGNIVAR_FORGE_CHAINS_AURA_ID && entry.sourceId === boss.id,
      );
      const straining =
        state.forgeChainsAttachGraceRemaining <= 0 &&
        dist2d(first.pos, second.pos) >= IGNIVAR_FORGE_CHAINS_BREAK_DISTANCE;
      const strain = straining
        ? Math.min(
            IGNIVAR_FORGE_CHAINS_STRAIN_SECONDS,
            (state.forgeChainsStrainSeconds[pairIndex] ?? 0) + DT,
          )
        : 0;
      for (const aura of [firstAura, secondAura]) {
        if (!aura) continue;
        aura.remaining = state.forgeChainsRemaining;
      }
      if (strain >= IGNIVAR_FORGE_CHAINS_STRAIN_SECONDS) {
        finishChainPair(ctx, boss, first, second, 'strain');
        continue;
      }
      if (state.forgeChainsRemaining <= 0) {
        finishChainPair(ctx, boss, first, second, 'safe');
        continue;
      }
      activePairs.push([firstId, secondId]);
      activeStrains.push(strain);
    }
    if (activePairs.length === 0) {
      finishChainCycle(state);
      return 'resolved';
    }
    state.forgeChainsPlayerIds = activePairs;
    state.forgeChainsStrainSeconds = activeStrains;
    state.forgeChainsLastPositions = snapshotChainPlayerPositions(players);
    return 'active';
  }

  state.forgeChainsTimer = Math.max(0, state.forgeChainsTimer - DT);
  if (!canStart || state.forgeChainsTimer > 0) return 'idle';
  const pairs = eligibleChainPairs(ctx, players);
  if (pairs.length === 0) return 'idle';
  state.forgeChainsPlayerIds = pairs.map(([first, second]) => [first.id, second.id]);
  state.forgeChainsRemaining = IGNIVAR_FORGE_CHAINS_DURATION_SECONDS;
  state.forgeChainsAttachGraceRemaining = IGNIVAR_FORGE_CHAINS_ATTACH_GRACE_SECONDS;
  state.forgeChainsStrainSeconds = pairs.map(() => 0);
  state.forgeChainsLastPositions = snapshotChainPlayerPositions(players);
  for (const [first, second] of pairs) {
    applyChainAura(ctx, boss, first, second);
    applyChainAura(ctx, boss, second, first);
  }
  return 'active';
}
