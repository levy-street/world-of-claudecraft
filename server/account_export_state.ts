// Subject-access projection only. Persistence must retain the pre-rolled farm
// outcomes so saving or exporting cannot change a crop's eventual harvest.
import type { PersistedFarmPlot } from '../src/sim/professions/farm_persist';

// Explicit public field picks also keep a future private plot field out of an
// export until it is deliberately reviewed here. Other character-state fields
// remain untouched: this is not a save normalizer or a general data allowlist.
const PUBLIC_PLOT_FIELDS = [
  'cropId',
  'plantedAtMs',
  'readyAtMs',
  'compost',
  'watch',
  'tonic',
  'notified',
] as const satisfies readonly (keyof PersistedFarmPlot)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function publicPlot(row: unknown): unknown {
  // Tolerate legacy malformed JSON shapes without letting an array of plot
  // records bypass the projection. Scalars contain no hidden named fields.
  if (Array.isArray(row)) return row.map(publicPlot);
  if (!isRecord(row)) return row;
  const out: Record<string, unknown> = {};
  for (const field of PUBLIC_PLOT_FIELDS) {
    if (!Object.hasOwn(row, field)) continue;
    const value = row[field];
    // All public plot fields are scalar. Do not pass nested secret-bearing
    // objects through a malformed public field; preserve scalar bytes as saved.
    if (value === null || typeof value !== 'object') out[field] = value;
  }
  return out;
}

/** Copy only the farming branch that needs redaction, without mutating or
 *  normalizing the stored character. Missing flags stay missing, timestamps
 *  stay as saved, and the account export does not compute a live plot status. */
export function projectAccountExportState(state: unknown): unknown {
  if (!isRecord(state)) return state;
  const plots = state.farmPlots;
  if (Array.isArray(plots)) return { ...state, farmPlots: plots.map(publicPlot) };
  if (!isRecord(plots)) return state;
  return {
    ...state,
    farmPlots: Object.fromEntries(
      Object.entries(plots).map(([bed, row]) => [bed, publicPlot(row)]),
    ),
  };
}
