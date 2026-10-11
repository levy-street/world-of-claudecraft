import { PRIMARY_STATS, staminaBaseline } from '../item_budget';
import {
  RIFT_BAND_MAX_UPGRADE,
  type RiftBandShell,
  riftBandItemLevel,
  riftBandPrimaryStats,
  riftBandStatBudget,
} from '../rift/band_ladder';
import type { RiftTier } from '../types';
import type { LootQualityDescriptor } from './types';

type Line = Record<string, number>;

function candidates(shell: RiftBandShell, level: number, quality: LootQualityDescriptor): Line[] {
  const guaranteedLevel = level + 2 * (quality.tier - 1);
  const finalLevel = level + 2 * quality.tier;
  const floor: Line = { ...riftBandPrimaryStats(shell, guaranteedLevel) };
  const caster = shell.primary === 'int';
  if (caster) floor.sta = staminaBaseline(riftBandStatBudget(finalLevel));
  const points = riftBandStatBudget(finalLevel) - riftBandStatBudget(guaranteedLevel);
  const out: Line[] = [];
  for (let primary = 0; primary <= points; primary++) {
    const line = {
      ...floor,
      [shell.primary]: (floor[shell.primary] ?? 0) + primary,
      [shell.secondary]: (floor[shell.secondary] ?? 0) + points - primary,
    };
    if (!caster && line.sta < staminaBaseline(riftBandStatBudget(finalLevel))) continue;
    out.push(line);
  }
  const primaryWeight = quality.weights[PRIMARY_STATS.indexOf(shell.primary)];
  const secondaryWeight = quality.weights[PRIMARY_STATS.indexOf(shell.secondary)];
  // Closest weighted share first. Stable ties retain primary-stat order.
  const ideal = (points * primaryWeight) / (primaryWeight + secondaryWeight);
  return out.sort(
    (a, b) =>
      Math.abs(a[shell.primary] - floor[shell.primary] - ideal) -
      Math.abs(b[shell.primary] - floor[shell.primary] - ideal),
  );
}

/** Resolve all upgrade steps together so rounding cannot move a point off a stat.
 * Each candidate spends exactly its final budget and retains the uniformly scaled
 * preceding-tier floor. Lookahead chooses the closest permanent allocation that
 * can survive every later upgrade; no new roll or saved derived totals are needed. */
export function riftQualityPrimaryStats(
  shell: RiftBandShell,
  tier: RiftTier,
  upgrade: number,
  quality: LootQualityDescriptor,
): Line {
  // Resolved on every call, deliberately unmemoized: sim state stays on Sim
  // (src/sim/CLAUDE.md, Adding a mechanic step 1), and the walk is small (a
  // handful of candidates per step over six steps, first monotone path wins),
  // so recalcPlayerStats pays a bounded constant per worn quality band.
  // Priced at the same capped level the ordinary line uses (riftBandItemLevel),
  // so a cap change can never split the ladder from its baseline.
  const rows = Array.from({ length: RIFT_BAND_MAX_UPGRADE + 1 }, (_, i) =>
    candidates(shell, riftBandItemLevel(tier, i), quality),
  );
  function path(step: number, previous?: Line): Line[] | undefined {
    if (step === rows.length) return [];
    for (const candidate of rows[step]) {
      if (previous && PRIMARY_STATS.some((k) => (candidate[k] ?? 0) < (previous[k] ?? 0))) continue;
      const tail = path(step + 1, candidate);
      if (tail) return [candidate, ...tail];
    }
    return undefined;
  }
  const result = path(0);
  // Unreachable from persisted data: feasibility does not depend on the weights
  // (they only order the candidates and the search is exhaustive),
  // sanitizeRiftGearInstance constrains rift.tier to a real rank, and the
  // ladder suite pins every shell/rank/tier combination. Kept as a throw so a
  // future shell or budget change that breaks monotonicity fails loudly in
  // that suite rather than pricing a worn band silently.
  if (!result) throw new Error('Rift loot-quality ladder has no monotone allocation');
  return result[Math.max(0, Math.min(RIFT_BAND_MAX_UPGRADE, Math.floor(upgrade)))];
}
