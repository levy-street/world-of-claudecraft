export const ENGINE_DURATION: number;
export const CHIME_DURATION: number;
export const SAMPLE_RATE: number;
export const CHIME_NOTES: readonly (readonly [number, number, number, number])[];

export function renderEngineChug(): Float32Array;
export function renderChime(): Float32Array;
export function encodeWav(samples: Float32Array, sampleRate?: number): Buffer;
