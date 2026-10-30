// The painted star layer of the sky dome (src/render/sky.ts), as GLSL the dome splices
// into its one program: stars that read hand painted (small soft round points, a few
// four-point twinkles with soft tapered arms and a gentle glow halo, a warm or cool
// tint each, sizes varied) but are drawn analytically, so they stay crisp at any screen
// resolution, where the painting's own stars were a few texels magnified into blobs.
//
// Stable as the camera turns: every star sits at a fixed sky direction (cells of the
// world-space view direction's longitude and latitude, never the screen), and every
// shape is a smooth profile whose width is held at least about a pixel by the
// screen-space derivative of the view direction, its energy conserved, so a star
// smaller than a pixel neither shimmers nor vanishes. The only motion is the slow
// twinkle. Shapes are measured in true angles round each star (the longitude offset
// scaled by the cosine of its latitude), so a cross high in the sky stays a cross.
//
// Drawn only on the painted night's share of the dome (uPaintStarAmt, set by sky.ts
// from sky_painted_core.ts paintedStarLayerScale); every other sky skips the block on a
// uniform branch and keeps its classic stars untouched. Where they show is the painting's
// own star density, the night texture's ALPHA (compress_sky_ldr.mjs starDensityAlpha),
// read across the bound arms the way the painted night itself is mixed. The knobs are
// PAINTED_STARS in sky_painted_core.ts; they are baked in as constants, so the dome stays
// one program for the whole session.

import { PAINTED_STARS } from './sky_painted_core';

function glslFloat(value: number): string {
  const text = String(Number(value.toFixed(6)));
  return text.includes('.') || text.includes('e') ? text : `${text}.0`;
}

const RAD = Math.PI / 180;
const f = glslFloat;
const vec3 = (rgb: readonly number[]): string => `vec3(${rgb.map(f).join(', ')})`;
const S = PAINTED_STARS;

/** The uniform the layer adds to the dome: its strength (0 skips it). */
export const PAINTED_STARS_DECLARATIONS = /* glsl */ `
  uniform float uPaintStarAmt; // painted star layer: the cycle's star amount x the painted night's share
`;

/**
 * Functions the layer needs, placed after the dome's uniforms (they read uMix and the
 * night arms) and before main(). Self-contained: its own hash, no dome helper used.
 */
export const PAINTED_STARS_FUNCTIONS = /* glsl */ `
  // A sine-free hash: stable for the large cell indices of the fine point grid, where
  // a sin() hash loses precision and starts drawing patterns on some GPUs.
  float wocPaintHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  // The painting's star density under a sky position: the night texture's alpha, mixed
  // over the bound arms by their painted-night weight exactly as the night colour is.
  float wocPaintStarDensity(vec2 uv) {
    float wa = (1.0 - uMix) * uNightW.x;
    float wb = uMix * uNightW.y;
    float d = 0.0;
    if (uNightW.x > 0.0) d += wa * texture2D(uNightA, vec2(uv.x + uNightOffA, uv.y)).a;
    if (uNightW.y > 0.0) d += wb * texture2D(uNightB, vec2(uv.x + uNightOffB, uv.y)).a;
    return d / max(wa + wb, 1e-4);
  }

  // A soft round blob: squared distance d2 against radius r (radians), never drawn
  // under about a pixel wide (px radians), with its energy kept, so it is stable.
  float wocPaintBlob(float d2, float r, float px) {
    float re2 = r * r + 0.36 * px * px;
    return exp2(-1.442695 * d2 / re2) * (r * r / re2);
  }

  // One tapered arm along its own axis: brightness and width fall away toward the tip.
  float wocPaintArm(float along, float across, float len, float width, float px) {
    float t = clamp(1.0 - abs(along) / len, 0.0, 1.0);
    float w = width * (0.3 + 0.7 * t);
    float we2 = w * w + 0.36 * px * px;
    return exp2(-1.442695 * across * across / we2) * sqrt(w * w / we2) * t * t;
  }

  vec3 wocPaintStars(vec2 uv, float px, float density, float time) {
    vec3 sum = vec3(0.0);
    // Small soft points: one candidate per fine cell, kept off the cell's edges so it
    // is never cut, lit where the density reaches its rank.
    {
      vec2 g = uv * vec2(${f(S.pointCells[0])}, ${f(S.pointCells[1])});
      vec2 cell = floor(g);
      float rank = wocPaintHash(cell + 0.37);
      float vis = smoothstep(rank, rank + 0.06, density * ${f(S.pointFill)});
      if (vis > 0.0) {
        vec2 h = vec2(wocPaintHash(cell + 7.1), wocPaintHash(cell + 13.3));
        vec2 dg = g - (cell + 0.25 + 0.5 * h);
        float cosLat = cos((uv.y - 0.5) * 3.14159265);
        float dx = dg.x * ${f((2 * Math.PI) / S.pointCells[0])} * cosLat;
        float dy = dg.y * ${f(Math.PI / S.pointCells[1])};
        float s = wocPaintHash(cell + 19.7);
        float r = mix(${f(S.pointRadiusDeg[0] * RAD)}, ${f(S.pointRadiusDeg[1] * RAD)}, s * s * s);
        float b = mix(0.3, 1.0, s) * mix(0.6, 1.0, wocPaintHash(cell + 23.9)) * vis;
        vec3 tint = mix(${vec3(S.cool)}, ${vec3(S.warm)}, wocPaintHash(cell + 29.3));
        sum += tint * (b * ${f(S.pointGain)} * wocPaintBlob(dx * dx + dy * dy, r, px));
      }
    }
    // Bright stars: coarse cells, the four nearest searched (every shape is held under
    // half a cell, so none is ever clipped), the u index wrapped round the seam. A
    // share of them are four-point twinkles; the rest are round, with a glow halo.
    {
      vec2 g = uv * vec2(${f(S.sparkleCells[0])}, ${f(S.sparkleCells[1])});
      vec2 base = floor(g - 0.5);
      for (int j = 0; j < 2; j++) {
        for (int i = 0; i < 2; i++) {
          vec2 cell = base + vec2(float(i), float(j));
          vec2 key = vec2(mod(cell.x, ${f(S.sparkleCells[0])}), cell.y);
          float rank = wocPaintHash(key + 41.3);
          float vis = smoothstep(rank, rank + 0.04, density * ${f(S.sparkleFill)});
          if (vis <= 0.0) continue;
          float isCross = step(wocPaintHash(key + 79.3), ${f(S.crossShare)});
          vec2 c0 = cell + vec2(wocPaintHash(key + 43.7), wocPaintHash(key + 47.1));
          float cosC = cos((c0.y / ${f(S.sparkleCells[1])} - 0.5) * 3.14159265);
          vec2 dg = g - c0;
          float dx = dg.x * ${f((2 * Math.PI) / S.sparkleCells[0])} * cosC;
          float dy = dg.y * ${f(Math.PI / S.sparkleCells[1])};
          float tilt = (wocPaintHash(key + 53.3) - 0.5) * ${f(2 * S.sparkleTiltRad)};
          float ct = cos(tilt);
          float st = sin(tilt);
          float ax = ct * dx - st * dy;
          float ay = st * dx + ct * dy;
          float sz = wocPaintHash(key + 59.9);
          float halfCell = 0.45 * min(${f((2 * Math.PI) / S.sparkleCells[0])} * cosC, ${f(Math.PI / S.sparkleCells[1])});
          float len = min(mix(${f(S.sparkleArmDeg[0] * RAD)}, ${f(S.sparkleArmDeg[1] * RAD)}, sz), halfCell / ${f(S.sparkleArmAspect)});
          float d2 = ax * ax + ay * ay;
          float core = wocPaintBlob(d2, ${f(S.sparkleCoreDeg * RAD)} * (0.7 + 0.6 * sz), px);
          float arms = isCross * (wocPaintArm(ax, ay, len, ${f(S.sparkleArmWidthDeg * RAD)}, px)
            + wocPaintArm(ay, ax, len * ${f(S.sparkleArmAspect)}, ${f(S.sparkleArmWidthDeg * RAD)}, px));
          float haloR = min(${f(S.haloDeg * RAD)} * (0.6 + 0.8 * sz), 0.45 * halfCell);
          float halo = mix(0.5 + 0.5 * sz, smoothstep(0.35, 1.0, sz), isCross)
            * exp2(-1.442695 * d2 / (haloR * haloR));
          float twinkle = 1.0 - ${f(S.twinkle)} * (0.5 + 0.5 * sin(time * (0.7 + 1.3 * wocPaintHash(key + 61.1)) + 6.2831853 * wocPaintHash(key + 67.3)));
          vec3 tint = mix(${vec3(S.cool)}, ${vec3(S.warm)}, wocPaintHash(key + 71.9));
          float lit = vis * twinkle * mix(0.55, 1.0, sz);
          sum += tint * (lit * ${f(S.sparkleGain)} * (core + ${f(S.armGain)} * arms))
            + ${vec3(S.cool)} * (vis * ${f(S.haloGain)} * halo);
        }
      }
    }
    return sum;
  }
`;

/**
 * The statement block over the dome's `vec3 c` and view `dir`, after the classic stars
 * and before the horizon fog band. The derivative and the density fetch run in uniform
 * control flow (inside the uniform gate, before any branch on the view direction).
 */
export const PAINTED_STARS_GLSL = /* glsl */ `
    if (uPaintStarAmt > 0.001) {
      vec2 paintUv = vec2(
        atan(dir.z, dir.x) * 0.15915494 + 0.5,
        asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989 + 0.5);
      float paintPx = max(length(fwidth(dir)), 1e-6);
      float paintDensity = max(
        wocPaintStarDensity(paintUv),
        ${f(S.zenithFloor)} * smoothstep(0.6, 0.85, dir.y));
      float paintUpper = smoothstep(-0.02, 0.2, dir.y);
      if (paintUpper > 0.0 && paintDensity > 0.0) {
        c += wocPaintStars(paintUv, paintPx, paintDensity, uTime) * (paintUpper * uPaintStarAmt);
      }
    }
`;
