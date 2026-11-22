// Per-zone blade width for the meadow (the near carpet, blade_grass.ts, and the
// mid band, blade_grass_band.ts). One shared uniform object, read by reference
// by both materials: the vertex shader pulls each blade's edge vertices toward
// its spine by this factor, so a zone look can thin the wide shipped ribbons
// into a finer painterly carpet without rebuilding a single cluster. The
// palette runtime writes the look's `render.bladeWidth`, eased across zone
// borders. 1 is the shipped blade exactly. Three-free so a plain Vitest pins it.

/** The narrowest a look may thin a blade (a hair-thin blade reads as noise). */
export const BLADE_WIDTH_MIN = 0.3;

/** The shared uniform the blade materials bind (`uBladeWidth`). */
export const BLADE_WIDTH_UNIFORM: { value: number } = { value: 1 };

/** Set the zone blade width; clamps to BLADE_WIDTH_MIN..1, non-finite restores 1. */
export function setBladeWidthZoneScale(value: number): void {
  BLADE_WIDTH_UNIFORM.value = Number.isFinite(value)
    ? Math.min(1, Math.max(BLADE_WIDTH_MIN, value))
    : 1;
}

/** The GLSL statement that narrows a blade (spliced first in begin_vertex). */
export const BLADE_WIDTH_GLSL = 'transformed -= aBladeSide * (1.0 - uBladeWidth);';

// The blade ROOT shade, the same way: the carpet's vertex colours brighten base
// to tip, and a zone look can deepen the base so a dense near meadow, seen from
// above, shows its shaded body (darker toward the camera) while distant grass
// shows only its lit tips. 1 is the shipped shade exactly.

/** The darkest a look may take a blade root. */
export const BLADE_BASE_MIN = 0.4;

/** The shared uniform the blade materials bind (`uBladeBase`). */
export const BLADE_BASE_UNIFORM: { value: number } = { value: 1 };

/** Set the zone blade-root shade; clamps to BLADE_BASE_MIN..1, non-finite restores 1. */
export function setBladeBaseZoneShade(value: number): void {
  BLADE_BASE_UNIFORM.value = Number.isFinite(value)
    ? Math.min(1, Math.max(BLADE_BASE_MIN, value))
    : 1;
}

/** The GLSL statement that deepens a blade root (after color_vertex). The blade
 *  rises to about one yard in model space, so the shade recovers by mid-blade. */
export const BLADE_BASE_GLSL = `#ifdef USE_COLOR
          vColor.rgb *= mix(uBladeBase, 1.0, smoothstep(0.0, 0.6, position.y));
        #endif`;

// Near-field shade: a painter darkens the meadow toward the viewer so the eye
// travels into the scene. The carpet's blades within a few yards of the camera
// take this multiplier, easing back to 1 by mid-field. 1 is the shipped carpet.

/** The darkest a look may take the near meadow. */
export const BLADE_NEAR_MIN = 0.5;

/** The shared uniform the near carpet binds (`uBladeNear`). */
export const BLADE_NEAR_UNIFORM: { value: number } = { value: 1 };

/** Set the zone near-field meadow shade; clamps to BLADE_NEAR_MIN..1, non-finite restores 1. */
export function setBladeNearZoneShade(value: number): void {
  BLADE_NEAR_UNIFORM.value = Number.isFinite(value)
    ? Math.min(1, Math.max(BLADE_NEAR_MIN, value))
    : 1;
}

/** Near-field shade over the camera distance of the blade's instance origin
 *  (begin_vertex, where the carpet already has `bgOrigin`). Full at 4 yards,
 *  gone by 24. */
export const BLADE_NEAR_GLSL = `#ifdef USE_COLOR
          vColor.rgb *= mix(uBladeNear, 1.0, smoothstep(4.0, 24.0, distance(bgOrigin, cameraPosition)));
        #endif`;

// The ground UNDER the near carpet: terrain.ts paints a pale near-grey floor
// inside the carpet ring (GRASS_PAINT_RING_GLSL), which shows between thin
// blades as light ground. A zone look can swap that floor toward a darker
// meadow tone (the meadow paint times CARPET_GROUND_DARK, an RGB multiplier). 0 is the shipped
// pale floor exactly; 1 is the full darker meadow floor.

/** The meadow floor under the carpet at full strength, as an RGB multiplier
 *  on the grass paint: dark and cool, so a gap between tufts reads as shadow
 *  in the grass, never as olive ground. */
export const CARPET_GROUND_DARK: readonly [number, number, number] = [0.36, 0.52, 0.36];

/** The painted ground PAST the carpet ring at full strength, as an RGB
 *  multiplier on the grass paint: pulled down to the blade field's own average
 *  so a gap between distant tufts reads as more meadow, not pale flat ground. */
export const CARPET_GROUND_FAR: readonly [number, number, number] = [0.66, 0.76, 0.6];

/** The shared uniform the terrain binds (`uCarpetGround`). */
export const CARPET_GROUND_UNIFORM: { value: number } = { value: 0 };

/** Set the zone carpet-floor blend; clamps to 0..1, non-finite restores 0. */
export function setCarpetGroundZone(value: number): void {
  CARPET_GROUND_UNIFORM.value = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

// The windswept comb and the painted field (the art bible's meadow): every
// blade bends toward ONE world direction, so the field reads as combed grass
// lying over itself and closes over the ground; and the field takes large
// light and dark patches plus a warm yellow-green tip, the way a painter lays
// a meadow in broad strokes. Both run at zero at stock (the shipped blades).

/** x,z: world comb direction (normalised in the shader); y: lean strength
 *  (tip offset in cluster units per unit height squared); w: droop (how far
 *  the tip sinks as it leans). Zeros are the shipped upright blades. */
export const BLADE_COMB_VALUES = new Float32Array([0, 0, 0, 0]);
/** x: field patch strength (0..0.5); y: warm-tip strength (0..1); z: clumping
 *  (0..1, blades in a clump share a comb direction, lean, height and shade, the
 *  way Ghost of Tsushima-style fields break into tussocks); w: cloud-shadow
 *  strength (setBladeCloudZone). */
export const BLADE_PAINT_VALUES = new Float32Array([0, 0, 0, 0]);

/** Shared uniforms both blade materials bind (typed arrays reach every clone). */
export const BLADE_COMB_UNIFORM: { value: Float32Array } = { value: BLADE_COMB_VALUES };
export const BLADE_PAINT_UNIFORM: { value: Float32Array } = { value: BLADE_PAINT_VALUES };

/** Set the comb: world direction (x, z), lean strength and droop. Non-finite
 *  values restore the upright blade. */
export function setBladeCombZone(dirX: number, dirZ: number, lean: number, droop: number): void {
  const ok = [dirX, dirZ, lean, droop].every(Number.isFinite);
  BLADE_COMB_VALUES[0] = ok ? dirX : 0;
  BLADE_COMB_VALUES[1] = ok ? Math.min(2, Math.max(0, lean)) : 0;
  BLADE_COMB_VALUES[2] = ok ? dirZ : 0;
  BLADE_COMB_VALUES[3] = ok ? Math.min(1, Math.max(0, droop)) : 0;
}

/** Set the painted field: patch strength, warm-tip strength and clumping (clamped). */
export function setBladePaintZone(patch: number, tip: number, clump = 0): void {
  BLADE_PAINT_VALUES[0] = Number.isFinite(patch) ? Math.min(0.5, Math.max(0, patch)) : 0;
  BLADE_PAINT_VALUES[1] = Number.isFinite(tip) ? Math.min(1, Math.max(0, tip)) : 0;
  BLADE_PAINT_VALUES[2] = Number.isFinite(clump) ? Math.min(1, Math.max(0, clump)) : 0;
}

/** x: blade height scale, y: cluster spread scale (1, 1 is the shipped
 *  cluster); z: view-space widening (0 is off; a blade seen edge-on widens
 *  toward the camera instead of vanishing, after the Ghost of Tsushima grass
 *  talk); w reserved. The carpet's placement no longer reads the palette
 *  lab's meadowHeight/Width (meadow_fullness_core.ts is orphaned), so blade
 *  size is set here, in the shader, for both meadow layers. */
export const BLADE_SIZE_VALUES = new Float32Array([1, 1, 0, 0]);
export const BLADE_SIZE_UNIFORM: { value: Float32Array } = { value: BLADE_SIZE_VALUES };

/** Set the blade size: height and spread scales (0.3..1.6), view-space
 *  widening (0..2) and distance thickening (0..3: tufts far from the camera
 *  spread wider, so fewer of them still close the field, after the Ghost of
 *  Tsushima grass talk; their warm tips also fade so they stop speckling). */
/** Distance thickening: tufts widen from BLADE_FAR_START to BLADE_FAR_END yards
 *  from the camera, by up to BLADE_FAR_MAX (the shader below reads these). */
export const BLADE_FAR_START = 14;
export const BLADE_FAR_END = 70;
export const BLADE_FAR_MAX = 3;
/** The largest blade height or spread scale a zone look may set. */
export const BLADE_SIZE_MAX = 1.6;

/** The most a zone look can stretch a tuft (xz) at `distance` yards from the
 *  camera: the largest spread times the largest distance thickening there.
 *  The carpet and band pad their culling bounds by it. */
export function bladeLookReach(distance: number): number {
  const t = Math.min(
    1,
    Math.max(0, (distance - BLADE_FAR_START) / (BLADE_FAR_END - BLADE_FAR_START)),
  );
  return BLADE_SIZE_MAX * (1 + BLADE_FAR_MAX * t * t * (3 - 2 * t));
}

export function setBladeSizeZone(height: number, spread: number, widen = 0, far = 0): void {
  const clamp = (v: number): number =>
    Number.isFinite(v) ? Math.min(BLADE_SIZE_MAX, Math.max(0.3, v)) : 1;
  BLADE_SIZE_VALUES[0] = clamp(height);
  BLADE_SIZE_VALUES[1] = clamp(spread);
  BLADE_SIZE_VALUES[2] = Number.isFinite(widen) ? Math.min(2, Math.max(0, widen)) : 0;
  BLADE_SIZE_VALUES[3] = Number.isFinite(far) ? Math.min(BLADE_FAR_MAX, Math.max(0, far)) : 0;
}

/** begin_vertex block (after the width pull, before any fade): comb and paint.
 *  Reads instanceMatrix directly, so it needs no locals from either material. */
export const BLADE_COMB_GLSL = `transformed.y *= uBladeSize.x;
        transformed.xz *= uBladeSize.y;
        #ifdef USE_INSTANCING
        {
          vec2 wocCombXZ = instanceMatrix[3].xz;
          // distance thickening: 0 near, 1 by mid-field
          float wocFarT = smoothstep(${BLADE_FAR_START.toFixed(1)}, ${BLADE_FAR_END.toFixed(1)}, distance(instanceMatrix[3].xyz, cameraPosition));
          if (uBladeSize.w > 0.0) transformed.xz *= 1.0 + uBladeSize.w * wocFarT;
          float wocCombJit = fract(sin(dot(wocCombXZ, vec2(12.9898, 78.233))) * 43758.5453);
          float wocCombH = max(position.y, 0.0) * uBladeSize.x;
          // clumps: a smooth world field (tussocks a couple of yards across)
          // that every blade of a clump reads alike
          float wocClumpA = sin(wocCombXZ.x * 0.61 + sin(wocCombXZ.y * 0.47) * 1.9);
          float wocClumpB = sin(wocCombXZ.y * 0.57 + sin(wocCombXZ.x * 0.39) * 2.3);
          float wocClump = uBladePaint.z;
          if (wocClump > 0.0) {
            float wocClumpH = 1.0 + wocClump * 0.22 * wocClumpA * wocClumpB;
            transformed.y *= wocClumpH;
            wocCombH *= wocClumpH;
          }
          if (uBladeSize.z > 0.0) {
            // view-space widening: the view direction in this cluster's frame
            // against the blade's own width axis; edge-on blades widen
            vec3 wocViewL = (cameraPosition - (modelMatrix * vec4(wocCombXZ.x, instanceMatrix[3].y, wocCombXZ.y, 1.0)).xyz)
              * mat3(instanceMatrix);
            float wocEdge = abs(dot(normalize(wocViewL.xz + vec2(1e-4, 0.0)),
              normalize(aBladeSide.xz + vec2(1e-5, 0.0))));
            transformed += aBladeSide * (uBladeSize.z * wocEdge);
          }
          if (uBladeComb.y > 0.0) {
            // the world comb direction, turned per clump, in this cluster's frame
            float wocTurn = wocClump * 0.9 * wocClumpA;
            vec2 wocDir = vec2(uBladeComb.x * cos(wocTurn) - uBladeComb.z * sin(wocTurn),
              uBladeComb.x * sin(wocTurn) + uBladeComb.z * cos(wocTurn));
            vec3 wocCombD = normalize(vec3(wocDir.x, 0.0, wocDir.y) * mat3(instanceMatrix));
            float wocLeanClump = 1.0 + wocClump * 0.35 * wocClumpB;
            float wocCombK = wocCombH * wocCombH * (0.75 + 0.5 * wocCombJit) * wocLeanClump;
            transformed += wocCombD * (uBladeComb.y * wocCombK);
            transformed.y -= uBladeComb.w * wocCombK;
          }
          #ifdef USE_COLOR
          if (uBladePaint.x > 0.0 || uBladePaint.y > 0.0) {
            // broad painted patches: two crossed warped sines over the world
            float wocPatch = sin(wocCombXZ.x * 0.17 + sin(wocCombXZ.y * 0.11) * 2.1)
              * sin(wocCombXZ.y * 0.15 + sin(wocCombXZ.x * 0.09) * 1.8);
            vColor.rgb *= 1.0 + uBladePaint.x * wocPatch + wocClump * 0.1 * wocClumpA * wocClumpB;
            if (uBladePaint.y > 0.0) {
              // sunlit tips: warmer toward the tip, read back from the cluster's
              // grey base-to-tip ramp (blade_grass.ts clusterGeometry: 0.86 at
              // the root, 1.1 at the tip)
              float wocTipT = clamp((color.g - 0.86) / 0.24, 0.0, 1.0);
              float wocTw = wocTipT * wocTipT;
              vColor.rgb *= vec3(1.0 + 0.2 * wocTw, 1.0 + 0.08 * wocTw, 1.0 - 0.4 * wocTw);
            }
            if (uBladePaint.x > 0.0) {
              // broad sunlit (warm) and shaded (cool) drifts across the field,
              // plus a little light and dark variety from tuft to tuft
              float wocDrift = sin(wocCombXZ.x * 0.11 + sin(wocCombXZ.y * 0.07) * 2.1)
                * cos(wocCombXZ.y * 0.09 - wocCombXZ.x * 0.04);
              float wocTuft = fract(sin(dot(wocCombXZ, vec2(27.17, 61.73))) * 41231.77);
              vColor.rgb *= vec3(1.0 + 0.55 * wocDrift, 1.0 + 0.08 * wocDrift, 1.0 - 0.6 * wocDrift)
                * ((0.9 - 0.12 * wocDrift) * (0.8 + 0.4 * wocTuft));
            }
            // warm yellow-green tips over the cooler body
            vColor.rgb *= mix(vec3(1.0), vec3(1.3, 1.2, 0.7),
              uBladePaint.y * smoothstep(0.35, 1.0, wocCombH) * (1.0 - 0.75 * wocFarT * step(0.0001, uBladeSize.w)));
          }
          #endif
        }
        #endif`;

// Extra blades and flowers (blade_grass.ts clusterGeometry `extras`): the
// carpet and band tufts carry sixteen finer blades and one tiny daisy, tagged by
// `aBladeKind` (1 extra blade, 2 flower). They collapse to the root unless a
// zone look turns them on, so stock tufts render the shipped nine blades.

/** x: extra blades on (> 0.5); y: share of tufts that show their flower (0..1);
 *  z: rounded-blade lighting 0..1 (lit spine, shaded edges); w: the mid band's
 *  fade start as a fraction of its radius (0 keeps the shipped 0.5; higher keeps
 *  distant tufts at full size longer, at the same instance count). */
export const BLADE_EXTRA_VALUES = new Float32Array([0, 0, 0, 0]);
export const BLADE_EXTRA_UNIFORM: { value: Float32Array } = { value: BLADE_EXTRA_VALUES };

/** Set the extras: blades 0..1 (on above 0.5), the flower share 0..1 and the
 *  rounded-blade lighting 0..1. */
export function setBladeExtraZone(blades: number, flowers: number, round = 0, bandFade = 0): void {
  BLADE_EXTRA_VALUES[3] =
    Number.isFinite(bandFade) && bandFade > 0 ? Math.min(0.95, Math.max(0.3, bandFade)) : 0;
  BLADE_EXTRA_VALUES[2] = Number.isFinite(round) ? Math.min(1, Math.max(0, round)) : 0;
  BLADE_EXTRA_VALUES[0] = Number.isFinite(blades) ? Math.min(1, Math.max(0, blades)) : 0;
  BLADE_EXTRA_VALUES[1] = Number.isFinite(flowers) ? Math.min(1, Math.max(0, flowers)) : 0;
}

/** Last in the instancing block (after sway, so nothing re-inflates a
 *  collapsed vertex): hide disabled extras and give a shown flower its own
 *  colours instead of the ground tint. */
export const BLADE_EXTRA_GLSL = `if (aBladeKind > 0.5) {
            float wocExtraHash = fract(sin(dot(instanceMatrix[3].xz, vec2(41.31, 17.77))) * 23421.631);
            bool wocFlower = aBladeKind > 1.5;
            bool wocShow = wocFlower ? wocExtraHash < uBladeExtra.y : uBladeExtra.x > 0.5;
            if (!wocShow) transformed = vec3(0.0);
            #ifdef USE_COLOR
            if (wocFlower) vColor.rgb = color.rgb;
            #endif
          }`;

// The painted meadow's colour and light (the art bible's Eastbrook):
// - one hue family: each blade keeps its value but its hue is pulled onto a
//   ramp from a cool shadow green to a warm light yellow-green, so no lime and
//   emerald blades fight in the same field;
// - side light: the near edge of a blade toward the sun lifts and the far
//   edge drops, so a flat strip reads as a rounded blade;
// - cloud shadows: broad, slowly drifting soft shadows over the field, the
//   large light shapes a painter blocks in first.
// All three are off at stock (strength 0).

/** rgb: shadow end of the ramp (linear); w: ramp strength 0..1. */
export const BLADE_RAMP_LO_VALUES = new Float32Array([0, 0, 0, 0]);
/** rgb: light end of the ramp (linear); w: side-light strength 0..1. */
export const BLADE_RAMP_HI_VALUES = new Float32Array([1, 1, 1, 0]);
export const BLADE_RAMP_LO_UNIFORM: { value: Float32Array } = { value: BLADE_RAMP_LO_VALUES };
export const BLADE_RAMP_HI_UNIFORM: { value: Float32Array } = { value: BLADE_RAMP_HI_VALUES };

/** sRGB hex to linear rgb, the space vColor lives in. */
export function hexToLinear(hex: number): [number, number, number] {
  const c = (v: number): number => {
    const s01 = v / 255;
    return s01 <= 0.04045 ? s01 / 12.92 : ((s01 + 0.055) / 1.055) ** 2.4;
  };
  return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)];
}

/** Set the ramp ends (linear rgb), ramp strength and side-light strength. */
export function setBladeRampZone(
  shadow: readonly [number, number, number],
  light: readonly [number, number, number],
  strength: number,
  side: number,
): void {
  const ok = [...shadow, ...light, strength, side].every(Number.isFinite);
  BLADE_RAMP_LO_VALUES.set(ok ? [shadow[0], shadow[1], shadow[2]] : [0, 0, 0]);
  BLADE_RAMP_HI_VALUES.set(ok ? [light[0], light[1], light[2]] : [1, 1, 1]);
  BLADE_RAMP_LO_VALUES[3] = ok ? Math.min(1, Math.max(0, strength)) : 0;
  BLADE_RAMP_HI_VALUES[3] = ok ? Math.min(1, Math.max(0, side)) : 0;
}

/** Set the cloud-shadow strength (0..0.6; stored in uBladePaint.w). */
export function setBladeCloudZone(strength: number): void {
  BLADE_PAINT_VALUES[3] = Number.isFinite(strength) ? Math.min(0.6, Math.max(0, strength)) : 0;
}

/** After the comb (begin_vertex, instancing on): ramp, side light, clouds. */
export const BLADE_LIGHT_GLSL = `#if defined( USE_INSTANCING ) && defined( USE_COLOR )
        {
          vec2 wocLightXZ = instanceMatrix[3].xz;
          if (uBladeRampLo.w > 0.0) {
            float wocLum = dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            vec3 wocRamp = mix(uBladeRampLo.rgb, uBladeRampHi.rgb, smoothstep(0.03, 0.42, wocLum));
            float wocRampLum = max(dot(wocRamp, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
            vColor.rgb = mix(vColor.rgb, wocRamp * (wocLum / wocRampLum), uBladeRampLo.w);
          }
          if (uBladeRampHi.w > 0.0) {
            vec3 wocSideW = mat3(instanceMatrix) * aBladeSide;
            float wocSideLen = length(wocSideW.xz);
            if (wocSideLen > 1e-5) {
              float wocSun = dot(wocSideW.xz / wocSideLen, normalize(vec2(-0.55, -0.83)));
              vColor.rgb *= 1.0 + uBladeRampHi.w * 0.35 * wocSun;
            }
          }
          if (uBladePaint.w > 0.0) {
            vec2 wocCloudP = wocLightXZ * 0.05 + vec2(uTime * 0.03, uTime * 0.012);
            float wocCloudF = sin(wocCloudP.x * 2.3 + sin(wocCloudP.y * 1.7) * 1.6)
              * sin(wocCloudP.y * 2.1 + sin(wocCloudP.x * 1.3) * 2.0);
            vColor.rgb *= 1.0 - uBladePaint.w * smoothstep(0.05, 0.55, wocCloudF);
          }
        }
        #endif`;

/** Vertex: pass the across-blade position on (extras geometry only). */
export const BLADE_ROUND_VERTEX_GLSL = 'vBladeAcross = aBladeAcross;';
/** Fragment: a lit spine and shaded edges, so a flat strip reads as a rounded
 *  blade and its outline sits lower in contrast against the field behind. */
export const BLADE_ROUND_FRAGMENT_GLSL = `if (uBladeExtra.z > 0.0) {
          float wocEdge = abs(vBladeAcross);
          diffuseColor.rgb *= mix(1.0, mix(1.12, 0.78, wocEdge * wocEdge), uBladeExtra.z);
        }`;

/**
 * Painted grass strokes for the ground past the blades (the art bible's
 * distant meadow reads as fine combed brush strokes, not flat colour). GLSL
 * statements declaring `float <out>`: a brightness multiplier around 1 over
 * world `xz`, streaked along the zone comb direction (uBladeComb), strongest
 * where uCarpetGround is on, and faded out wherever the strokes would shimmer
 * below a pixel (fwidth). 1.0 exactly when uCarpetGround is 0.
 */
export function meadowStrokeGlsl(xz: string, out: string): string {
  return `float ${out} = 1.0;
          if (uCarpetGround > 0.0) {
            vec2 wocStD = normalize(vec2(uBladeComb.x, uBladeComb.z) + vec2(1e-4, 0.0));
            vec2 wocStN = vec2(-wocStD.y, wocStD.x);
            float wocStA = dot(${xz}, wocStD) * 0.55;
            float wocStB = dot(${xz}, wocStN) * 4.2 + sin(wocStA * 1.7) * 1.3;
            float wocStroke = sin(wocStB + sin(wocStA * 0.9 + wocStB * 0.31) * 2.2)
              * (0.6 + 0.4 * sin(wocStA * 2.3 + wocStB * 0.17));
            float wocStFade = 1.0 - smoothstep(0.35, 1.1, fwidth(wocStB));
            // a coarser stroke octave that survives into the distance
            float wocStB2 = wocStB * 0.28 + sin(wocStA * 0.6) * 0.8;
            float wocStroke2 = sin(wocStB2 + sin(wocStA * 0.35 + wocStB2 * 0.5) * 1.8);
            float wocStFade2 = 1.0 - smoothstep(0.35, 1.1, fwidth(wocStB2));
            float wocStBroad = sin(dot(${xz}, vec2(0.11, 0.07)) + sin(${xz}.y * 0.05) * 2.0);
            ${out} = 1.0 + uCarpetGround * (0.22 * wocStroke * wocStFade
              + 0.2 * wocStroke2 * wocStFade2 + 0.07 * wocStBroad);
          }`;
}

/** Distant blades blend into the painted field: past mid-field a tuft's
 *  colour eases toward the ramp's mid tone, so lone tufts stop popping out of
 *  the ground. Rides the ramp strength (0 at stock). */
export const BLADE_FAR_BLEND_GLSL = `#if defined( USE_INSTANCING ) && defined( USE_COLOR )
          if (uBladeRampLo.w > 0.0) {
            float wocBlendT = smoothstep(14.0, 48.0, distance(instanceMatrix[3].xyz, cameraPosition));
            vec3 wocMid = mix(uBladeRampLo.rgb, uBladeRampHi.rgb, 0.6);
            vColor.rgb = mix(vColor.rgb, wocMid, 0.85 * wocBlendT * uBladeRampLo.w);
          }
        #endif`;
