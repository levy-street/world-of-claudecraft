/** Build a valid current-format allocation while allowing the benchmark to
 * replace only the rows that matter to the measured specialization. */
export function benchmarkAllocation(defaultAllocation, spec, requestedRows = {}) {
  return {
    spec,
    rows: { ...defaultAllocation.rows, ...requestedRows },
  };
}

export const WARLOCK_BENCHMARK_ROWS = Object.freeze({
  8: 'wlk_r8_voidfeast',
  14: 'wlk_r14_shadow_mastery',
  17: 'wlk_r17_improved_fear',
  20: 'wlk_r20_chaos_bolt',
});

/** Seconds elapsed inside the encounter, excluding setup and pet preparation. */
export function combatElapsed(simTime, encounterStart) {
  return Math.max(0, simTime - encounterStart);
}

/** DPS while the actor was alive and able to contribute. Encounter DPS remains
 * useful for raid outcomes, but it includes a dead actor's surviving effects. */
export function activeDps(activeDamageDone, attemptSeconds, deathTime) {
  const activeSeconds =
    deathTime === undefined ? attemptSeconds : Math.min(deathTime, attemptSeconds);
  return activeSeconds > 0 ? activeDamageDone / activeSeconds : 0;
}

function combos(items, count) {
  if (count === 0) return [[]];
  if (items.length < count) return [];
  const [head, ...tail] = items;
  return [...combos(tail, count - 1).map((rest) => [head, ...rest]), ...combos(tail, count)];
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Select matched comparison groups before expanding the compared slot. This
 * prevents a hash sample from measuring each specialization beside different
 * tanks, healers, DPS partners, or seeds.
 */
export function comparisonPlans({ tanks, healerSets, dps, compared, dpsSlots, limit }) {
  const comparedSet = new Set(compared);
  const baselineSets = combos(
    dps.filter((key) => !comparedSet.has(key)),
    dpsSlots - 1,
  );
  const pairs = [];
  for (const tank of tanks) {
    for (const healerSet of healerSets) {
      for (const baselineDps of baselineSets) {
        const pairKey = `${tank}|${healerSet.join('+')}|${baselineDps.join('+')}`;
        pairs.push({ tank, healerSet, baselineDps, pairKey });
      }
    }
  }
  const selected = [...pairs]
    .sort(
      (a, b) => hashString(a.pairKey) - hashString(b.pairKey) || a.pairKey.localeCompare(b.pairKey),
    )
    .slice(0, Math.max(0, limit));
  return selected.flatMap((pair) => compared.map((comparedKey) => ({ ...pair, comparedKey })));
}

const NYTHRAXIS_ADD_IDS = new Set([
  'nythraxis_skeleton_warrior',
  'nythraxis_heroic_warrior_add',
  'nythraxis_heroic_priest_add',
  'nythraxis_heroic_rogue_add',
]);

export function nythraxisDamageBucket(targetId, templateId, bossId) {
  if (targetId === bossId) return 'boss';
  return NYTHRAXIS_ADD_IDS.has(templateId) ? 'add' : null;
}
