// Which graphics API the client's WebGL context is actually talking to, derived
// from the UNMASKED_RENDERER_WEBGL adapter name the perf report already carries.
//
// This is deliberately ORTHOGONAL to gl_renderer_bucket, which answers "whose
// hardware" (nvidia, amd, intel-uhd, apple-m2, software). bucketGpu recognises a
// vendor and returns a fixed word, which throws the rest of the adapter name
// away, so on Windows and macOS the API is unrecoverable from storage today. It
// survives only for mobile parts, and only by accident: an Adreno or Mali name
// matches no vendor branch, falls through to bucketGpu's catch-all, and the
// sliced raw string carries "opengl-es-3.2" along with it.
//
// The two fields answer different questions and neither replaces the other. A
// WARP device is software AND Direct3D 11: gl_renderer_bucket says software,
// this says d3d11. That is why there is no 'software' value here.
//
// Kept as coarse as the bucket it sits beside: a closed vocabulary, no adapter
// model, no driver version, so it adds no fingerprinting surface over what
// gl_renderer_bucket already stores.

export const GL_BACKEND_LABELS = [
  'd3d11',
  'd3d9',
  'vulkan',
  'metal',
  'opengl-es',
  'opengl',
  'unknown',
] as const;

export type GlBackend = (typeof GL_BACKEND_LABELS)[number];

// Ordered: the FIRST match wins, so the entries that are substrings of another
// name come first. "opengl es" must precede "opengl" or every GLES device reads
// as desktop GL. Metal comes first because ANGLE's Metal names ("ANGLE Metal
// Renderer: Apple M2") carry no other API token but sit beside OpenGL-era Apple
// strings.
const BACKEND_PATTERNS: ReadonlyArray<readonly [RegExp, GlBackend]> = [
  [/metal/, 'metal'],
  [/vulkan/, 'vulkan'],
  [/opengl\s*es|gles/, 'opengl-es'],
  [/opengl/, 'opengl'],
  [/direct3d\s*11|d3d11/, 'd3d11'],
  [/direct3d\s*9|d3d9/, 'd3d9'],
];

/**
 * Classify an adapter name into one closed-vocabulary backend label.
 * An empty, unreadable, or token-free name (a masked vendor, a bare native GL
 * string) is 'unknown' rather than a guess.
 */
export function glBackendFromRenderer(renderer: string | null | undefined): GlBackend {
  const name = (renderer ?? '').toLowerCase();
  if (!name) return 'unknown';
  for (const [pattern, backend] of BACKEND_PATTERNS) {
    if (pattern.test(name)) return backend;
  }
  return 'unknown';
}
