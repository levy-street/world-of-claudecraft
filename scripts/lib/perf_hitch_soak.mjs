// Pure fixed-seed schedule for the hitch referee's retained-memory soak.
// Runtime WebSocket commands and browser checks stay in perf_hitch_scenarios.mjs.

export const HITCH_SOAK_SEED = 0x5eed0b;
export const HITCH_SOAK_COHORTS = 3;
export const HITCH_SOAK_INTERVAL_MS = 10_000;
export const HITCH_SOAK_INSIDE_RADIUS = 10;
export const HITCH_SOAK_OUTSIDE_RADIUS = 240;

function round(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Fit retained-heap growth across every GC-floor valley. Centering the time
 * axis keeps the least-squares calculation numerically stable for page clocks.
 */
export function estimateHeapFloorGrowthMb(series) {
  if (!Array.isArray(series) || series.length < 2) return null;
  let previousAtMs = -Infinity;
  let totalAtMs = 0;
  let totalFloorMb = 0;
  for (const valley of series) {
    if (
      !Number.isFinite(valley?.atMs) ||
      !Number.isFinite(valley?.floorMb) ||
      valley.atMs <= previousAtMs ||
      valley.floorMb < 0
    ) {
      return null;
    }
    previousAtMs = valley.atMs;
    totalAtMs += valley.atMs;
    totalFloorMb += valley.floorMb;
  }

  const meanAtMs = totalAtMs / series.length;
  const meanFloorMb = totalFloorMb / series.length;
  let timeVariance = 0;
  let timeFloorCovariance = 0;
  for (const valley of series) {
    const centeredAtMs = valley.atMs - meanAtMs;
    timeVariance += centeredAtMs * centeredAtMs;
    timeFloorCovariance += centeredAtMs * (valley.floorMb - meanFloorMb);
  }
  if (timeVariance <= 0) return null;

  const durationMs = series.at(-1).atMs - series[0].atMs;
  return round((timeFloorCovariance / timeVariance) * durationMs);
}

export async function executeSoakChurnPlan(plan, { now, wait, moveOutside, applyIncoming }) {
  const startedAt = now();
  for (const step of plan.steps) {
    const delayMs = startedAt + step.atMs - now();
    if (delayMs > 0) await wait(delayMs);
    for (const botIndex of step.outgoingBotIndexes) moveOutside(botIndex);
    for (const entry of step.incoming) applyIncoming(entry);
  }
}

export function resolveSoakAppearance(entry, weaponType, weaponSkins, mounts) {
  if (entry.weaponType !== weaponType) {
    throw new Error(
      `soak rotation planned ${entry.weaponType} cosmetics for bot ${entry.botIndex} holding ${weaponType}`,
    );
  }
  const weaponSkin = weaponSkins[weaponType]?.[entry.weaponVariant];
  const mountItem = mounts[entry.mountVariant];
  if (!weaponSkin || !mountItem) {
    throw new Error(`soak cosmetic rotation is incomplete for bot ${entry.botIndex}`);
  }
  return { skin: entry.skin, weaponSkin, mountItem };
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive integer`);
  return value;
}

function seededOrder(size, seed) {
  const order = Array.from({ length: size }, (_, index) => index);
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  for (let index = order.length - 1; index > 0; index -= 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const swapIndex = state % (index + 1);
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }
  return order;
}

function decodeCombination(index, weaponVariantCount, mountVariantCount) {
  const variantsPerSkin = weaponVariantCount * mountVariantCount;
  const skin = Math.floor(index / variantsPerSkin);
  const withinSkin = index % variantsPerSkin;
  return {
    skin,
    weaponVariant: Math.floor(withinSkin / mountVariantCount),
    mountVariant: withinSkin % mountVariantCount,
  };
}

/** Deterministic FNV-1a over a weapon-type label, to give each type its own seed lane. */
function labelHash(label) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * One rotation per weapon type: a seeded shuffle of that type's REAL
 * (skin, weaponVariant, mountVariant) space, sized by the type's actual
 * fixture list (the lists are ragged: bow carries fewer server-valid skins
 * than the other types). Bots of the same type walk the shuffle at
 * appearanceRoundCount strides, so together they visit
 * min(botsOfType * appearanceRoundCount, space) distinct combinations and a
 * scheduled weaponVariant can never exceed the type's list.
 */
function buildWeaponTypeRotations({
  botCount,
  botWeaponTypes,
  weaponVariantCounts,
  skinCount,
  mountVariantCount,
  seed,
}) {
  if (!Array.isArray(botWeaponTypes) || botWeaponTypes.length !== botCount) {
    throw new Error('botWeaponTypes must name a weapon type for every soak bot');
  }
  if (!weaponVariantCounts || typeof weaponVariantCounts !== 'object') {
    throw new Error('weaponVariantCounts must map each weapon type to its fixture list length');
  }
  const rotations = new Map();
  const typeRanks = new Array(botCount);
  botWeaponTypes.forEach((weaponType, botIndex) => {
    if (typeof weaponType !== 'string' || weaponType.length === 0) {
      throw new Error(`soak bot ${botIndex} is missing a weapon type`);
    }
    let rotation = rotations.get(weaponType);
    if (!rotation) {
      const variantCount = weaponVariantCounts[weaponType];
      if (!Number.isInteger(variantCount) || variantCount <= 0) {
        throw new Error(`weaponVariantCounts.${weaponType} must be a positive integer`);
      }
      const space = skinCount * variantCount * mountVariantCount;
      rotation = {
        variantCount,
        space,
        order: seededOrder(space, (seed ^ 0x9e3779b9 ^ labelHash(weaponType)) >>> 0),
        botCount: 0,
      };
      rotations.set(weaponType, rotation);
    }
    typeRanks[botIndex] = rotation.botCount;
    rotation.botCount += 1;
  });
  return { rotations, typeRanks };
}

export function buildSoakChurnPlan({
  botCount,
  measureMs,
  seed = HITCH_SOAK_SEED,
  cohortCount = HITCH_SOAK_COHORTS,
  intervalMs = HITCH_SOAK_INTERVAL_MS,
  skinCount = 8,
  botWeaponTypes,
  weaponVariantCounts,
  mountVariantCount = 5,
}) {
  positiveInteger(botCount, 'botCount');
  positiveInteger(measureMs, 'measureMs');
  positiveInteger(cohortCount, 'cohortCount');
  positiveInteger(intervalMs, 'intervalMs');
  positiveInteger(skinCount, 'skinCount');
  positiveInteger(mountVariantCount, 'mountVariantCount');
  if (botCount % cohortCount !== 0) {
    throw new Error('botCount must divide evenly into soak cohorts');
  }

  const cohortSize = botCount / cohortCount;
  const order = seededOrder(botCount, seed);
  const cohorts = Array.from({ length: cohortCount }, (_, index) =>
    order.slice(index * cohortSize, (index + 1) * cohortSize),
  );
  const visible = new Set(cohorts.slice(1).flat());
  const initialVisibleBotIndexes = [...visible].sort((a, b) => a - b);
  const stepCount = Math.ceil(measureMs / intervalMs);
  const appearanceRoundCount = Math.ceil(stepCount / cohortCount);
  const { rotations, typeRanks } = buildWeaponTypeRotations({
    botCount,
    botWeaponTypes,
    weaponVariantCounts,
    skinCount,
    mountVariantCount,
    seed,
  });
  const visitedCombinations = new Set();
  const steps = [];

  for (let cycle = 0; cycle < stepCount; cycle += 1) {
    const appearanceRound = Math.floor(cycle / cohortCount);
    const incomingBotIndexes = cohorts[cycle % cohortCount];
    const outgoingBotIndexes = cohorts[(cycle + 1) % cohortCount];
    for (const botIndex of outgoingBotIndexes) visible.delete(botIndex);
    const incoming = incomingBotIndexes.map((botIndex) => {
      visible.add(botIndex);
      const weaponType = botWeaponTypes[botIndex];
      const rotation = rotations.get(weaponType);
      const combinationIndex =
        rotation.order[
          (typeRanks[botIndex] * appearanceRoundCount + appearanceRound) % rotation.space
        ];
      const appearance = decodeCombination(
        combinationIndex,
        rotation.variantCount,
        mountVariantCount,
      );
      visitedCombinations.add(
        `${weaponType}:${appearance.skin}:${appearance.weaponVariant}:${appearance.mountVariant}`,
      );
      return {
        botIndex,
        weaponType,
        ...appearance,
      };
    });
    steps.push({
      atMs: cycle * intervalMs,
      cycle,
      outgoingBotIndexes: [...outgoingBotIndexes],
      incoming,
      visibleBotIndexes: [...visible].sort((a, b) => a - b),
    });
  }

  return {
    seed,
    cohortCount,
    cohortSize,
    intervalMs,
    appearanceRoundCount,
    uniqueCombinationCount: visitedCombinations.size,
    initialVisibleBotIndexes,
    steps,
  };
}
