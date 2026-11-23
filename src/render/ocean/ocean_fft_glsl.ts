// GLSL for the ocean simulation passes (ocean_simulation.ts). Every pass is a
// RawShaderMaterial in GLSL ES 3.00 so it can write two targets at once and
// read texels exactly with texelFetch. The cascades share one atlas, stacked
// vertically (cascade c owns rows c*N to c*N+N-1), so ONE draw runs a stage of
// the transform for every cascade at once.
//
// Four complex spectra ride each texel, two per target, each the PACKED pair
// A + iB of two real fields (their inverse transforms come back as the real
// and imaginary parts):
//   target 0: (Dx + i Dy), (Dz + i dDx/dz)
//   target 1: (dDy/dx + i dDy/dz), (dDx/dx + i dDz/dz)
// D is the displacement (x, height, z) and the four derivatives give the
// slope and the Jacobian of the choppy surface.

export const OCEAN_PASS_VERT = /* glsl */ `
precision highp float;
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * The time step (ocean_spectrum_core.ts oceanEvolveTexel is its CPU mirror,
 * line for line): h(k, t) = h0(k) e^(i w t) + conj(h0(-k)) e^(-i w t), then the
 * four packed field spectra. `uLoopT` is the wrapped clock as a fraction of
 * the loop, and every w is a whole number of cycles per loop (`waves.z`), so
 * the phase is exact and the wrap is seamless.
 */
export const OCEAN_EVOLVE_FRAG = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uH0;
uniform sampler2D uWaves;
uniform float uLoopT;
uniform float uChop;
layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
// A + iB for two complex numbers A and B.
vec2 pack2(vec2 a, vec2 b) { return vec2(a.x - b.y, a.y + b.x); }

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 h0 = texelFetch(uH0, p, 0);
  vec4 w = texelFetch(uWaves, p, 0);
  float phase = 6.283185307 * fract(w.z * uLoopT);
  vec2 e = vec2(cos(phase), sin(phase));
  vec2 h = cmul(h0.xy, e) + cmul(h0.zw, vec2(e.x, -e.y));
  vec2 kx = vec2(w.x * w.w);          // kx / |k|
  vec2 kz = vec2(w.y * w.w);          // kz / |k|
  vec2 minusIH = vec2(h.y, -h.x);     // -i h
  vec2 iH = vec2(-h.y, h.x);          // i h
  // Points move TOWARD the crest above them (ocean_spectrum_core
  // OCEAN_CHOP_SIGN), so the choppy terms carry a negative scale.
  float chop = -uChop;
  vec2 dx = minusIH * kx * chop;
  vec2 dz = minusIH * kz * chop;
  vec2 dydx = iH * w.x;
  vec2 dydz = iH * w.y;
  vec2 dxdx = h * (w.x * w.x * w.w) * chop;
  vec2 dzdz = h * (w.y * w.y * w.w) * chop;
  vec2 dxdz = h * (w.x * w.y * w.w) * chop;
  outA = vec4(pack2(dx, h), pack2(dz, dxdz));
  outB = vec4(pack2(dydx, dydz), pack2(dxdx, dzdz));
}
`;

/**
 * One radix-2 Stockham stage of the inverse transform along one axis, for all
 * four packed spectra and every cascade. The index arithmetic is
 * ocean_spectrum_core.ts stockhamStage, line for line.
 */
export const OCEAN_FFT_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uInA;
uniform sampler2D uInB;
uniform int uStage;      // p: 1, 2, 4, ... N / 2
uniform int uN;
uniform int uHorizontal; // 1 along x, 0 along z (within one cascade's block)
layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

void main() {
  ivec2 pix = ivec2(gl_FragCoord.xy);
  int j = uHorizontal == 1 ? pix.x : pix.y % uN;
  int block = uHorizontal == 1 ? 0 : pix.y - j;
  int k = j % uStage;
  int inPair = j % (2 * uStage);
  int i = (j - inPair) / 2 + k;
  int half_ = uN / 2;
  ivec2 a = uHorizontal == 1 ? ivec2(i, pix.y) : ivec2(pix.x, block + i);
  ivec2 b = uHorizontal == 1 ? ivec2(i + half_, pix.y) : ivec2(pix.x, block + i + half_);
  float angle = 3.141592653589793 * float(k) / float(uStage);
  vec2 tw = vec2(cos(angle), sin(angle));
  vec4 a0 = texelFetch(uInA, a, 0);
  vec4 b0 = texelFetch(uInA, b, 0);
  vec4 a1 = texelFetch(uInB, a, 0);
  vec4 b1 = texelFetch(uInB, b, 0);
  vec4 t0 = vec4(cmul(tw, b0.xy), cmul(tw, b0.zw));
  vec4 t1 = vec4(cmul(tw, b1.xy), cmul(tw, b1.zw));
  float s = inPair >= uStage ? -1.0 : 1.0;
  outA = a0 + s * t0;
  outB = a1 + s * t1;
}
`;

/**
 * Unpack one cascade into the two textures the surface samples:
 *   displacement: (Dx, Dy, Dz, 0)
 *   shading:      (dDy/dx, dDy/dz, Jacobian, foam)
 * Foam is persistent: whitecaps are born where the surface folds (the
 * Jacobian drops toward zero) and decay over a few seconds, read back from
 * the previous frame's shading target.
 */
export const OCEAN_ASSEMBLE_FRAG = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uInA;
uniform sampler2D uInB;
uniform sampler2D uPrevShade;
uniform int uBlock;        // first atlas row of this cascade
uniform float uFoamDecay;  // multiplier per frame
uniform vec2 uFoamBirth;   // x: Jacobian where foam is full, y: where it starts (x < y)
layout(location = 0) out vec4 outDisp;
layout(location = 1) out vec4 outShade;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 q = ivec2(p.x, p.y + uBlock);
  vec4 a = texelFetch(uInA, q, 0);
  vec4 b = texelFetch(uInB, q, 0);
  // Real parts are the first field of each pair, imaginary parts the second.
  float dx = a.x;
  float dy = a.y;
  float dz = a.z;
  float dxdz = a.w;
  float dydx = b.x;
  float dydz = b.y;
  float dxdx = b.z;
  float dzdz = b.w;
  float jacobian = (1.0 + dxdx) * (1.0 + dzdz) - dxdz * dxdz;
  // smoothstep needs its edges in order, so the falling ramp is spelled 1 - rise.
  float born = 1.0 - smoothstep(uFoamBirth.x, uFoamBirth.y, jacobian);
  float prev = texelFetch(uPrevShade, p, 0).w;
  float foam = clamp(max(prev * uFoamDecay, born), 0.0, 1.0);
  outDisp = vec4(dx, dy, dz, 0.0);
  outShade = vec4(dydx, dydz, jacobian, foam);
}
`;
