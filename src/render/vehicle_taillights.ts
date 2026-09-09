// Tail lamp lenses: a clean glowing form laid over paint that could not be
// cleaned up any other way.
//
// WHY THIS EXISTS. The tail lights on this model are PAINT, not geometry, and
// the paint is artifacted: the mesh comes from a neural field so it has no edge
// flow, and its unwrap is thousands of tiny UV islands, so the painted lamp
// boundary is a run of island seams. Four runtime overlay attempts and a long
// Blender fitting effort all failed on that, every one of them by trying to
// TRACE the ragged boundary. Tracing bad data cannot produce a good edge.
//
// SO THE SHAPE IS IMPOSED AND ONLY THE SURFACE IS MEASURED:
//
//   - The OUTLINE is a superellipse in (angle, height): a rounded rectangle,
//     which is what a tail lamp is. Nothing about it comes from the mesh, so
//     nothing about it can be ragged.
//   - The DEPTH is raycast against the bodywork and then SMOOTHED, so the lens
//     follows the real curvature, including the wrap, without copying the
//     facets and dents. An unsmoothed cast reads as the same mess it was meant
//     to cover, with body poking through wherever the surface dips.
//   - The SWEEP is about a vertical axis set inboard of each rear corner, which
//     is what makes the 81 degree wrap around onto the flank fall out for free.
//     A height field over (x, y) cannot express that and produced the earlier
//     "piece hanging off the side".
//
// TWO LAYERS, and the first is the point. An additive sheet cannot hide
// anything, because additive only ever adds light: the artifacted paint shows
// straight through it and red over blue paint reads as magenta. The body layer
// is OPAQUE and covers the mess outright. The glow layer then sits a hair proud
// and does the lit part, which is what additive is good at.
//
// Parented to the chassis like the headlights, so it inherits yaw, pitch, roll
// and the landing squat with no per-frame work. There is no update function.

import * as THREE from 'three';
import { GFX } from './gfx';

/** One lamp: a rounded rectangle swept about a vertical axis, in model space. */
export interface TaillightSite {
  /** The vertical sweep axis, inboard of the rear corner. */
  axisX: number;
  axisZ: number;
  /** Angular span about that axis. 0 points straight back (-z), positive swings
   *  toward +x. The span crosses the corner, which is the whole trick. */
  angle0: number;
  angle1: number;
  y0: number;
  y1: number;
}

/**
 * The Rallycart's two lamps, measured off an orthographic render of the car
 * rather than off the mesh or the texture.
 *
 * These come from a HAND TRACE. Jamie drew the lamp outline in green on a
 * clean orthographic render, and `read_traced_lamps.mjs` converted the stroke
 * back into model units. That is why the maths here can be trusted: it only
 * ever ran on a deliberate human stroke, never on the artifacted paint.
 *
 * Traced: y 0.2230..0.2854, and on the rear panel x runs |0.157| out to |0.270|
 * before the body turns the corner and the lamp continues onto the flank. Both
 * lamps came back within a fraction of a millimetre of each other, so they are
 * kept mirrored rather than carrying the trace's own hand jitter.
 */
export const RALLYCART_TAILLIGHTS: readonly TaillightSite[] = [
  { axisX: 0.16, axisZ: -0.34, angle0: -0.022, angle1: 1.0, y0: 0.223, y1: 0.2854 },
  { axisX: -0.16, axisZ: -0.34, angle0: 0.022, angle1: -1.0, y0: 0.223, y1: 0.2854 },
];

/** Superellipse exponent for the outline. 2 is an ellipse, large is a
 *  rectangle. FITTED to the traced stroke by least squares, which came back at
 *  5.55 on both lamps: the corners were never the problem, the height was. An
 *  earlier version stood 26% taller than the real lamp and read as a slab. */
const ROUND = 5.5;

/** Grid resolution. Deliberately modest: the depth is smoothed afterwards, so
 *  more samples buy nothing but raycasts, and this runs when a mount is
 *  summoned. */
const SEG_U = 24;
const SEG_V = 20;

/** Smoothing passes over the depth grid. This is the knob that decides whether
 *  the lens reads as a lens or as shrink-wrap over the artifacts. */
const SMOOTH_PASSES = 3;

/** How far the lens body stands off the measured surface, and how much further
 *  the glow sits above it, in model units. */
const BODY_GAP = 0.006;
const GLOW_GAP = 0.004;

/** Where the rays start, measured out from the sweep axis. Comfortably outside
 *  any bodywork so the first hit is always the outer surface. */
const CAST_FROM = 0.4;

const BODY_COLOR = 0x8e0b06;
const GLOW_COLOR = 0xff3a10;
const GLOW_OPACITY = 0.7;
/** Above the bloom threshold where a composer exists, like the headlights. */
const GLOW_HDR = 1.5;

let bodyMaterial: THREE.MeshBasicMaterial | null = null;
let glowMaterial: THREE.MeshBasicMaterial | null = null;

function materials(): { body: THREE.Material; glow: THREE.Material } {
  bodyMaterial ??= new THREE.MeshBasicMaterial({ color: BODY_COLOR, side: THREE.DoubleSide });
  glowMaterial ??= new THREE.MeshBasicMaterial({
    color: new THREE.Color(GLOW_COLOR).multiplyScalar(GFX.composer ? GLOW_HDR : 1),
    transparent: true,
    opacity: GLOW_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  return { body: bodyMaterial, glow: glowMaterial };
}

/** The lamp's half-width at height parameter `t` in -1..1. */
function halfWidthAt(t: number): number {
  const w = (1 - Math.abs(t) ** ROUND) ** (1 / ROUND);
  return Number.isFinite(w) && w > 0 ? w : 0;
}

/**
 * Height parameter for row `iv`, CLUSTERED toward the top and bottom caps.
 *
 * Evenly spaced rows get this shape badly wrong. A superellipse this square
 * holds full width to about t = 0.95 and then closes almost all at once, so
 * with even spacing the half-width ran 0.98, 0.92, then 0 in a single row: the
 * whole cap fell into one quad and rendered as a wide shallow SPIKE rather than
 * the flat top the outline actually describes. Worse, every vertex of that
 * collapsed row sits at the middle of the angular span, which is right on the
 * body corner, so the spike appeared exactly where the two halves of the wrap
 * meet and stuck out past the bodywork.
 *
 * A sine distribution puts rows where the curvature is, so the corner rounding
 * gets five rows instead of one and the final closure is squeezed into about
 * 1% of the lamp height, far below a pixel. Same outline, honestly sampled.
 */
function heightParam(iv: number): number {
  return Math.sin((Math.PI / 2) * ((iv / SEG_V) * 2 - 1));
}

/**
 * Measure the bodywork depth under one lamp, then smooth it.
 *
 * Returns distance from the sweep axis at each grid point. Depth is the ONLY
 * thing taken from the mesh; angle and height are the imposed shape.
 */
function measureDepth(
  chassis: THREE.Object3D,
  site: TaillightSite,
  angles: number[][],
  heights: number[],
): number[][] {
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const local = new THREE.Vector3();
  const depth: number[][] = [];
  for (let iv = 0; iv <= SEG_V; iv++) {
    const row: number[] = [];
    for (let iu = 0; iu <= SEG_U; iu++) {
      const angle = angles[iv][iu];
      dir.set(Math.sin(angle), 0, -Math.cos(angle));
      origin.set(site.axisX, heights[iv], site.axisZ).addScaledVector(dir, CAST_FROM);
      // Rays are built in the chassis's own space, so both ends go through its
      // world matrix before casting and the hit distance comes back comparable.
      origin.applyMatrix4(chassis.matrixWorld);
      dir.transformDirection(chassis.matrixWorld).negate();
      raycaster.set(origin, dir);
      const hit = raycaster.intersectObject(chassis, true)[0];
      if (!hit) {
        row.push(Number.NaN);
        continue;
      }
      // Bring the hit back into the CHASSIS's own space before measuring.
      //
      // TRAP: hit.distance is in WORLD units while everything else here is in
      // model units, and a summoned mount is scaled about 6x. Subtracting one
      // from the other gave a large NEGATIVE depth, and a negative radius puts
      // the lens on the far side of the sweep axis, which drew two huge sheets
      // floating in front of the car. Measuring the radius from the axis in
      // local space has no unit to get wrong, needs no CAST_FROM term, and
      // survives non-uniform scale and rotation.
      local.copy(hit.point);
      chassis.worldToLocal(local);
      row.push(Math.hypot(local.x - site.axisX, local.z - site.axisZ));
    }
    depth.push(row);
  }

  // A miss means the parameters reached past the bodywork. Fill from neighbours
  // rather than tearing the sheet.
  for (let iv = 0; iv <= SEG_V; iv++) {
    for (let iu = 0; iu <= SEG_U; iu++) {
      if (!Number.isNaN(depth[iv][iu])) continue;
      let sum = 0;
      let n = 0;
      for (const [dv, du] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const r = depth[iv + dv]?.[iu + du];
        if (typeof r === 'number' && !Number.isNaN(r)) {
          sum += r;
          n++;
        }
      }
      depth[iv][iu] = n > 0 ? sum / n : 0.12;
    }
  }

  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const src = depth.map((r) => r.slice());
    for (let iv = 0; iv <= SEG_V; iv++) {
      for (let iu = 0; iu <= SEG_U; iu++) {
        let sum = 0;
        let n = 0;
        for (let dv = -1; dv <= 1; dv++) {
          for (let du = -1; du <= 1; du++) {
            const r = src[iv + dv]?.[iu + du];
            if (typeof r === 'number') {
              sum += r;
              n++;
            }
          }
        }
        depth[iv][iu] = sum / n;
      }
    }
  }
  return depth;
}

/** Build the lens sheet at a given stand-off from the measured surface. */
function lensGeometry(
  site: TaillightSite,
  angles: number[][],
  heights: number[],
  depth: number[][],
  gap: number,
): THREE.BufferGeometry {
  const position: number[] = [];
  const index: number[] = [];
  for (let iv = 0; iv <= SEG_V; iv++) {
    for (let iu = 0; iu <= SEG_U; iu++) {
      const angle = angles[iv][iu];
      // Offset RADIALLY from the sweep axis rather than along a per-face
      // normal. The corner is roughly cylindrical about that axis, so radial IS
      // the normal there, and unlike a face normal it cannot jitter facet to
      // facet, which is what a lens sitting 6mm off a noisy surface needs.
      const r = depth[iv][iu] + gap;
      position.push(
        site.axisX + Math.sin(angle) * r,
        heights[iv],
        site.axisZ - Math.cos(angle) * r,
      );
    }
  }
  const stride = SEG_U + 1;
  for (let iv = 0; iv < SEG_V; iv++) {
    for (let iu = 0; iu < SEG_U; iu++) {
      const a = iv * stride + iu;
      const b = a + stride;
      index.push(a, a + 1, b + 1, a, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** Marks a chassis that already carries lamps, so the call is idempotent. */
const ATTACHED = 'vehicleTaillights';

/**
 * Build both lenses and parent them to `chassis`, once.
 *
 * Safe to call every frame: it marks the chassis and returns immediately after
 * the first time. Keyed off the CHASSIS rather than view state so it survives a
 * graphics-settings rebuild handing back a fresh mount visual.
 *
 * Costs about 1050 raycasts against the body at attach, which is under what
 * the steering lock measurement already pays at the same moment.
 */
export function attachVehicleTaillights(
  chassis: THREE.Object3D,
  sites: readonly TaillightSite[],
): void {
  if (chassis.userData[ATTACHED]) return;
  chassis.userData[ATTACHED] = true;
  chassis.updateWorldMatrix(true, false);
  const { body, glow } = materials();

  for (const site of sites) {
    const angles: number[][] = [];
    const heights: number[] = [];
    for (let iv = 0; iv <= SEG_V; iv++) {
      const t = heightParam(iv);
      const half = halfWidthAt(t);
      heights.push((site.y0 + site.y1) / 2 + t * ((site.y1 - site.y0) / 2));
      const row: number[] = [];
      for (let iu = 0; iu <= SEG_U; iu++) {
        const s = ((iu / SEG_U) * 2 - 1) * half;
        row.push((site.angle0 + site.angle1) / 2 + s * ((site.angle1 - site.angle0) / 2));
      }
      angles.push(row);
    }

    const depth = measureDepth(chassis, site, angles, heights);
    for (const [gap, material] of [
      [BODY_GAP, body],
      [BODY_GAP + GLOW_GAP, glow],
    ] as const) {
      const mesh = new THREE.Mesh(lensGeometry(site, angles, heights, depth, gap), material);
      mesh.frustumCulled = false;
      chassis.add(mesh);
    }
  }
}
