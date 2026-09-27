// Text-level ablations of harvested GLSL, for scripts/shader_ablation_corpus.mjs.
// Each transform removes or swaps ONE ingredient of a program so the link bench
// can price that ingredient alone, on the same program, with no game build.
// Pure; pinned by tests/shader_ablation_transforms.test.ts.
//
// A transform takes { vertex, fragment } and returns the new pair, or null when
// the program does not carry the ingredient (so the variant is skipped, never
// benched as a disguised copy of the baseline).

function dropDefines(text, names) {
  let out = text;
  for (const name of names) {
    out = out.replace(new RegExp(`^#define ${name}\\b.*\\n`, 'gm'), '');
  }
  return out;
}

function hasDefine(text, name) {
  return new RegExp(`^#define ${name}\\b`, 'm').test(text);
}

const ENVMAP_DEFINES = [
  'USE_ENVMAP',
  'ENVMAP_TYPE_CUBE_UV',
  'ENVMAP_MODE_REFLECTION',
  'ENVMAP_BLENDING_NONE',
  'CUBEUV_TEXEL_WIDTH',
  'CUBEUV_TEXEL_HEIGHT',
  'CUBEUV_MAX_MIP',
];

/** The span of `float wornTriR( ... ) { ... }`, by brace matching. */
export function wornTriRSpan(fragment) {
  const start = fragment.indexOf('float wornTriR(');
  if (start < 0) return null;
  const open = fragment.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < fragment.length; i++) {
    if (fragment[i] === '{') depth += 1;
    else if (fragment[i] === '}') {
      depth -= 1;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  return null;
}

function swapWornTriR(fragment, body) {
  const span = wornTriRSpan(fragment);
  if (!span) return null;
  const head =
    'float wornTriR( sampler2D tex, const in vec3 p, const in vec3 w, const in vec3 axis ) ';
  return `${fragment.slice(0, span.start)}${head}${body}${fragment.slice(span.end)}`;
}

// Three taps, no branch: what the early returns exist to avoid at RUN time.
const WORN_FLAT_BODY = `{
  return texture2D( tex, p.zy ).r * w.x + texture2D( tex, p.xz ).r * w.y
    + texture2D( tex, p.xy ).r * w.z;
}`;

// Same branches and the same tap counts, but every read takes explicit
// derivatives computed before any branch, so no gradient operation sits inside
// divergent flow control.
const WORN_GRAD_BODY = `{
  vec2 dxZY = dFdx( p.zy ); vec2 dyZY = dFdy( p.zy );
  vec2 dxXZ = dFdx( p.xz ); vec2 dyXZ = dFdy( p.xz );
  vec2 dxXY = dFdx( p.xy ); vec2 dyXY = dFdy( p.xy );
  if ( w.x >= 0.999 ) return textureGrad( tex, p.zy, dxZY, dyZY ).r;
  if ( w.y >= 0.999 ) return textureGrad( tex, p.xz, dxXZ, dyXZ ).r;
  if ( w.z >= 0.999 ) return textureGrad( tex, p.xy, dxXY, dyXY ).r;
  if ( axis.x <= 0.0 )
    return textureGrad( tex, p.xz, dxXZ, dyXZ ).r * w.y + textureGrad( tex, p.xy, dxXY, dyXY ).r * w.z;
  if ( axis.y <= 0.0 )
    return textureGrad( tex, p.zy, dxZY, dyZY ).r * w.x + textureGrad( tex, p.xy, dxXY, dyXY ).r * w.z;
  if ( axis.z <= 0.0 )
    return textureGrad( tex, p.zy, dxZY, dyZY ).r * w.x + textureGrad( tex, p.xz, dxXZ, dyXZ ).r * w.y;
  return textureGrad( tex, p.zy, dxZY, dyZY ).r * w.x + textureGrad( tex, p.xz, dxXZ, dyXZ ).r * w.y
    + textureGrad( tex, p.xy, dxXY, dyXY ).r * w.z;
}`;

// Same branches and the same tap counts, but ONE exit: tells the early returns
// (which ANGLE rewrites for HLSL, and which draw the X4000 "potentially
// uninitialized" warning) apart from the branches themselves.
const WORN_SINGLE_EXIT_BODY = `{
  float r;
  if ( w.x >= 0.999 ) r = texture2D( tex, p.zy ).r;
  else if ( w.y >= 0.999 ) r = texture2D( tex, p.xz ).r;
  else if ( w.z >= 0.999 ) r = texture2D( tex, p.xy ).r;
  else if ( axis.x <= 0.0 ) r = texture2D( tex, p.xz ).r * w.y + texture2D( tex, p.xy ).r * w.z;
  else if ( axis.y <= 0.0 ) r = texture2D( tex, p.zy ).r * w.x + texture2D( tex, p.xy ).r * w.z;
  else if ( axis.z <= 0.0 ) r = texture2D( tex, p.zy ).r * w.x + texture2D( tex, p.xz ).r * w.y;
  else r = texture2D( tex, p.zy ).r * w.x + texture2D( tex, p.xz ).r * w.y
    + texture2D( tex, p.xy ).r * w.z;
  return r;
}`;

const PARALLAX_GUARD = 'if ( uWornTaps > 0.0 && wornCamD < uWornParEnd ) {';

export const ABLATIONS = {
  'no-shadowmap': ({ vertex, fragment }) =>
    hasDefine(fragment, 'USE_SHADOWMAP')
      ? {
          vertex: dropDefines(vertex, ['USE_SHADOWMAP']),
          fragment: dropDefines(fragment, ['USE_SHADOWMAP']),
        }
      : null,
  'no-envmap': ({ vertex, fragment }) =>
    hasDefine(fragment, 'USE_ENVMAP')
      ? {
          vertex: dropDefines(vertex, ENVMAP_DEFINES),
          fragment: dropDefines(fragment, ENVMAP_DEFINES),
        }
      : null,
  'no-shadowmap-no-envmap': ({ vertex, fragment }) =>
    hasDefine(fragment, 'USE_SHADOWMAP') && hasDefine(fragment, 'USE_ENVMAP')
      ? {
          vertex: dropDefines(vertex, ['USE_SHADOWMAP', ...ENVMAP_DEFINES]),
          fragment: dropDefines(fragment, ['USE_SHADOWMAP', ...ENVMAP_DEFINES]),
        }
      : null,
  'worn-flat': ({ vertex, fragment }) => {
    const swapped = swapWornTriR(fragment, WORN_FLAT_BODY);
    return swapped ? { vertex, fragment: swapped } : null;
  },
  'worn-grad': ({ vertex, fragment }) => {
    const swapped = swapWornTriR(fragment, WORN_GRAD_BODY);
    return swapped ? { vertex, fragment: swapped } : null;
  },
  'worn-single-exit': ({ vertex, fragment }) => {
    const swapped = swapWornTriR(fragment, WORN_SINGLE_EXIT_BODY);
    return swapped ? { vertex, fragment: swapped } : null;
  },
  // Additivity check: do the two worn savings stack?
  'worn-flat-no-parallax': ({ vertex, fragment }) => {
    const swapped = swapWornTriR(fragment, WORN_FLAT_BODY);
    return swapped?.includes(PARALLAX_GUARD)
      ? { vertex, fragment: swapped.replace(PARALLAX_GUARD, 'if ( false ) {') }
      : null;
  },
  'worn-no-parallax': ({ vertex, fragment }) =>
    fragment.includes(PARALLAX_GUARD)
      ? { vertex, fragment: fragment.replace(PARALLAX_GUARD, 'if ( false ) {') }
      : null,
};

/**
 * A deterministic sample: programs sorted by hash, the first `count` that
 * satisfy `accept`. Sorting by a content hash is as good as a shuffle and
 * needs no seed.
 */
export function pickPrograms(programs, accept, count) {
  return [...programs]
    .sort((a, b) => a.hash.localeCompare(b.hash))
    .filter(accept)
    .slice(0, count);
}
