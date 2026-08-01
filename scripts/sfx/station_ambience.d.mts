// Type sidecar for station_ambience.mjs (same convention as
// sfx_prompts.d.mts): lets the Vitest pins import the synthesis module
// without an any-typed escape hatch.

export interface StationAmbienceSpec {
  key: string;
  duration: number;
  prompt: string;
  compose: (rng: () => number, samples: number) => Float32Array;
}

export declare const SAMPLE_RATE: number;
export declare const STATION_AMBIENCE_SPECS: StationAmbienceSpec[];
export declare function renderStationAmbience(key: string): Float32Array;
