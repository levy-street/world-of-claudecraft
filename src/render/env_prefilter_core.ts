import type { BiomeId } from '../sim/types';

export type EnvironmentBiome = Extract<BiomeId, 'vale' | 'marsh' | 'peaks'>;

const ENVIRONMENT_BIOMES: readonly EnvironmentBiome[] = ['vale', 'marsh', 'peaks'];

export interface EnvironmentPrefilterPlan {
  /** PMREMs built while the renderer is constructed. */
  immediate: EnvironmentBiome[];
  /** PMREMs allowed to allocate after entry. Empty by design on constrained WebKit. */
  deferred: EnvironmentBiome[];
}

function dedicatedEnvironmentFor(biome: BiomeId): EnvironmentBiome {
  return ENVIRONMENT_BIOMES.includes(biome as EnvironmentBiome)
    ? (biome as EnvironmentBiome)
    : 'vale';
}

/**
 * Choose the HDR environment maps the renderer may prefilter.
 *
 * A constrained WebKit process keeps only the spawn biome PMREM for the session. Building a
 * second mip-chained cubemap after entry creates a transient GPU allocation spike large enough
 * to terminate WKWebView even on recent iPhones. The sky dome still cross-fades every biome, so
 * retaining the initial IBL is a cosmetic ambient-light compromise, not lost world information.
 */
export function resolveEnvironmentPrefilterPlan(
  constrainedMemory: boolean,
  initialBiome: BiomeId,
): EnvironmentPrefilterPlan {
  if (constrainedMemory) {
    return {
      immediate: [dedicatedEnvironmentFor(initialBiome)],
      deferred: [],
    };
  }
  return {
    immediate: [...ENVIRONMENT_BIOMES],
    deferred: [],
  };
}
