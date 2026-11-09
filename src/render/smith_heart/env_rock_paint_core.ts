// The painted rock's shader, shared by the veins that lay a cliff painting over the rock
// they keep (the Breath's, breath_env_plan_core.ts, and the Quench's,
// quench_env_plan_core.ts): the painting read triplanar at two scales turned off the axes
// and off each other, its far scale's own value steering which shows (no repeat lines up),
// laid over a surface's own colour as the vein's `EnvRockPaint` says. The surface keeps
// its value (its sculpted forms, beds and creases stay where they were: a painting laid
// triplanar over a sculpt put its painted light on faces turned every way); the painting
// gives it its hue and a share of its strokes.
//
// Three-free, DOM-free, deterministic: it only writes GLSL text.

/** Yards one repeat of each scale of a painted rock covers. */
export interface EnvRockTile {
  readonly a: number;
  readonly b: number;
  readonly steer: number;
}

/** How a vein's painted rock takes the painting over a surface's own paint: its hue (a
 *  share of the painting's colour taken back toward grey), a share of the painting's
 *  value strokes, the surface's own value, the faces turned up (`scour`) and down
 *  (`down`) tinted, and optionally a colour laid on the faces turned up (`ledge`: the
 *  snow on the Quench's ledges). `mean` is the painting's mean luminance (linear), the
 *  value its strokes vary round. */
export interface EnvRockPaint {
  readonly hue: number;
  readonly strokes: number;
  readonly value: number;
  readonly mean: number;
  readonly scour: readonly [number, number, number];
  readonly down: readonly [number, number, number];
  readonly ledge?: { readonly color: readonly [number, number, number]; readonly share: number };
}

const v3 = (c: readonly number[]) => `vec3( ${c.map((v) => v.toFixed(2)).join(', ')} )`;

/** The painted rock's GLSL, `vec3 <fn>( sampler2D paint, vec3 p, vec3 n, vec3 dx, vec3 dy,
 *  vec3 base )`: the painting triplanar at `p` (instance-local yards) on the planes `n`
 *  faces, laid over `base`. Every read takes its gradients from `dx` and `dy` (the caller's
 *  dFdx and dFdy of `p`, taken in uniform control flow), so it may sit behind a
 *  per-fragment weight. */
export function envRockPaintGlsl(fn: string, T: EnvRockTile, P: EnvRockPaint): string {
  const tri = (turn: string, k: string) =>
    `( textureGrad( paint, ${turn} * ( p.zy * ${k} ), ${turn} * ( dx.zy * ${k} ), ${turn} * ( dy.zy * ${k} ) ).rgb * b.x
      + textureGrad( paint, ${turn} * ( p.xz * ${k} ), ${turn} * ( dx.xz * ${k} ), ${turn} * ( dy.xz * ${k} ) ).rgb * b.y
      + textureGrad( paint, ${turn} * ( p.xy * ${k} ), ${turn} * ( dx.xy * ${k} ), ${turn} * ( dy.xy * ${k} ) ).rgb * b.z )`;
  const ledge = P.ledge
    ? `
    c = mix( c, ${v3(P.ledge.color)} * mix( 1.0, rl / ${P.mean.toFixed(3)}, 0.25 ), smoothstep( 0.55, 0.85, n.y ) * ${P.ledge.share.toFixed(2)} );`
    : '';
  return `vec3 ${fn}( sampler2D paint, vec3 p, vec3 n, vec3 dx, vec3 dy, vec3 base ) {
    vec3 b = pow( abs( n ), vec3( 4.0 ) );
    b /= b.x + b.y + b.z;
    const mat2 tA = mat2( 0.8, 0.6, -0.6, 0.8 );
    const mat2 tB = mat2( 0.38, -0.92, 0.92, 0.38 );
    const float kA = ${(1 / T.a).toFixed(5)};
    const float kB = ${(1 / T.b).toFixed(5)};
    const float kS = ${(1 / T.steer).toFixed(5)};
    const vec3 lumaW = vec3( 0.299, 0.587, 0.114 );
    vec3 rockA = ${tri('tA', 'kA')};
    vec3 rockB = ${tri('tB', 'kB')};
    float steer = dot( textureGrad( paint, p.xz * kS, dx.xz * kS, dy.xz * kS ).rgb, vec3( 0.33 ) );
    vec3 rock = mix( rockA, rockB, smoothstep( 0.18, 0.32, steer ) );
    float rl = max( dot( rock, lumaW ), 1e-3 );
    vec3 hue = mix( vec3( 1.0 ), rock / rl, ${P.hue.toFixed(2)} );
    float v = dot( base, lumaW ) * ${P.value.toFixed(2)} * mix( 1.0, rl / ${P.mean.toFixed(3)}, ${P.strokes.toFixed(2)} );
    vec3 c = hue * v;
    c *= mix( vec3( 1.0 ), ${v3(P.scour)}, smoothstep( 0.62, 0.9, n.y ) * 0.5 );
    c *= mix( vec3( 1.0 ), ${v3(P.down)}, smoothstep( -0.15, -0.7, n.y ) * 0.6 );${ledge}
    return c;
  }`;
}
