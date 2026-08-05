// The three bespoke Thornhollow Fields rune-pad effect kits (Slipstream / Forge /
// Aegis). Built by battleground_props.ts alongside the pad body and ticked by
// battleground_fx.ts; the design rationale and every tunable live in the pure
// core, battleground_rune_vfx_core.ts.
//
// PERFORMANCE CONTRACT. A pad is a world object that can sit on screen for a
// whole match, so nothing here animates on the CPU. Each mote cloud is one
// draw of GPU-animated points whose vertex shader derives the full trajectory
// from a baked seed and the renderer's single `sharedUniforms.uTime` clock; the
// shells and rings are shader materials on that same clock. `update()` writes
// exactly two things per pad per frame: the point light's pulsed intensity and
// (Ward only) the shard ring's yaw. Both come from the core.
//
// Every geometry and material is a module-level cache marked shared
// (shared_resource.ts), matching battleground_props.ts: pad views are stateful
// and unpooled, so per-view disposal must never free resources the next pad
// build will reuse. Sharing a material across two pads of the same type is
// deliberate and correct, same-type pads animate in lockstep off one clock.
//
// The kit sits UNDER the pad's own glow disc and spinner, and never touches
// them: the body (procedural shape today, a custom GLB once one is registered
// in battleground_rune_model.ts) stays independently swappable.
import * as THREE from 'three';
import type { BgRuneType } from '../sim/social/battleground';
import {
  AEGIS_SHARD_COUNT,
  AEGIS_SHARD_RADIUS,
  AEGIS_SHARD_Y,
  FORGE_PLUME_HEIGHT,
  FORGE_PLUME_WIDTH,
  RUNE_MOTE_SEED_STRIDE,
  RUNE_RING_INNER,
  RUNE_RING_OUTER,
  RUNE_VFX_TUNING,
  runeLightPulse,
  runeMoteSeeds,
  runeShardYaw,
} from './battleground_rune_vfx_core';
import { sharedUniforms } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

// The pad's light has to compete with FULL DAYLIGHT (renderer.ts runs the field
// at sun 2.8 + hemi 0.45), so the old 1.6/8 spent itself entirely on the body
// and put nothing on the ground, the pad glowed but lit nothing. These values
// lay a clear pool of rune color on the cobble around the pad without reading
// as a spotlight. Light COUNT is unchanged: one per pad, high tier only, on top
// of the map's own budgeted lights (BG_LIGHT_BUDGET_BY_TIER).
const RUNE_LIGHT_INTENSITY = 15;
const RUNE_LIGHT_DISTANCE = 15;
const RUNE_LIGHT_Y = 1.15;

/** Per-frame handles the fx pass drives. Held on the kit, not on the group. */
export interface RuneVfxKit {
  readonly group: THREE.Group;
  update(time: number): void;
}

// ---------------------------------------------------------------------------
// Shared shader chunks
// ---------------------------------------------------------------------------

// A soft round sprite computed from gl_PointCoord, no texture, no canvas, so
// this module stays DOM-free and the cloud costs one program and zero uploads.
const MOTE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float core = smoothstep(0.5, 0.06, d);
    float a = core * vAlpha;
    if (a < 0.01) discard;
    // A hot near-white center falling off to the rune color. Without it the
    // darker runes (Battle's red especially) read as dull specks against the
    // field rather than as something burning.
    vec3 rgb = mix(uColor, vec3(1.0), pow(max(core, 0.0), 3.0) * 0.55);
    gl_FragColor = vec4(rgb * (0.75 + 0.55 * a), a);
  }
`;

// Point size follows props.ts's fixed-pixel convention (a viewport-independent
// constant over view depth) rather than plumbing a uScale uniform through the
// renderer for three pads.
const MOTE_SIZE_EXPR = 'uSize / max(-mv.z, 1.0)';

const TAU = 'const float TAU = 6.28318530718;';

// Slipstream: a tight rising helix that CONTRACTS as it climbs and whips
// several turns per cycle, the silhouette of something being pulled upward.
const SLIPSTREAM_VERTEX = /* glsl */ `
  ${TAU}
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uRise;
  uniform float uRadius;
  uniform float uSize;
  uniform float uCycle;
  varying float vAlpha;
  void main() {
    float rate = 0.7 + 0.6 * aSeed.w;
    float life = fract(aSeed.z + uTime * rate / uCycle);
    // 3.4 turns per cycle, contracting toward the spinner as it rises.
    float ang = aSeed.x * TAU + life * TAU * 3.4;
    float r = uRadius * (0.4 + 0.6 * aSeed.y) * (1.0 - 0.6 * life);
    vec3 p = vec3(cos(ang) * r, life * uRise, sin(ang) * r);
    // Fade in off the pad, fade out at the top; never a hard pop either end.
    vAlpha = smoothstep(0.0, 0.14, life) * (1.0 - smoothstep(0.55, 1.0, life));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = ${MOTE_SIZE_EXPR} * (0.55 + 0.45 * (1.0 - life));
    gl_Position = projectionMatrix * mv;
  }
`;

// Forge: embers drift up and OUTWARD, decelerating, with a fast per-ember
// flicker. The lateral sway is what separates it from a fountain.
const FORGE_VERTEX = /* glsl */ `
  ${TAU}
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uRise;
  uniform float uRadius;
  uniform float uSize;
  uniform float uCycle;
  varying float vAlpha;
  void main() {
    float rate = 0.6 + 0.8 * aSeed.w;
    float life = fract(aSeed.z + uTime * rate / uCycle);
    float climb = sqrt(life); // fast off the coals, then it loses its heat
    float ang = aSeed.x * TAU + sin(uTime * 0.6 + aSeed.z * TAU) * 0.5;
    float r = uRadius * (0.25 + 0.75 * aSeed.y) * (0.6 + 0.9 * climb);
    vec3 p = vec3(cos(ang) * r, climb * uRise, sin(ang) * r);
    float flicker = 0.55 + 0.45 * sin(uTime * (11.0 + 9.0 * aSeed.w) + aSeed.z * TAU);
    vAlpha = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.35, 1.0, life)) * flicker;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = ${MOTE_SIZE_EXPR} * (0.4 + 0.6 * (1.0 - climb));
    gl_Position = projectionMatrix * mv;
  }
`;

// Aegis: sparks ORBIT the dome shell on their own inclined rings and never
// leave it. Nothing rises, which is exactly the shelter read.
const AEGIS_VERTEX = /* glsl */ `
  ${TAU}
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uRise;
  uniform float uRadius;
  uniform float uSize;
  uniform float uCycle;
  varying float vAlpha;
  void main() {
    float rate = 0.5 + 0.8 * aSeed.w;
    float ang = aSeed.x * TAU + uTime * rate * TAU / uCycle;
    // Each spark keeps its own band on the shell; the band tilts with radius.
    float band = 0.15 + 0.85 * aSeed.y;
    float y = uRise * band;
    float r = uRadius * sqrt(max(0.0, 1.0 - band * band * 0.55));
    vec3 p = vec3(cos(ang) * r, y, sin(ang) * r);
    vAlpha = 0.45 + 0.55 * pow(max(0.5 + 0.5 * sin(ang * 2.0 + uTime * 1.3), 0.0), 2.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = ${MOTE_SIZE_EXPR};
    gl_Position = projectionMatrix * mv;
  }
`;

const MOTE_VERTEX: Record<BgRuneType, string> = {
  sprint: SLIPSTREAM_VERTEX,
  damage: FORGE_VERTEX,
  defense: AEGIS_VERTEX,
};

// ---------------------------------------------------------------------------
// Shared resource caches (module lifetime, marked shared, never disposed)
// ---------------------------------------------------------------------------

const moteGeos = new Map<BgRuneType, THREE.BufferGeometry>();
const moteMats = new Map<string, THREE.ShaderMaterial>();
let runeRingGeo: THREE.RingGeometry | null = null;
const runeRingMats = new Map<number, THREE.ShaderMaterial>();
let forgePlumeGeo: THREE.PlaneGeometry | null = null;
const forgePlumeMats = new Map<number, THREE.ShaderMaterial>();
let aegisShardGeo: THREE.BufferGeometry | null = null;
const aegisShardMats = new Map<number, THREE.MeshBasicMaterial>();

/** A shader material on the renderer's shared clock, additive and depth-safe. */
function fxMaterial(
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uTime: sharedUniforms.uTime, ...uniforms },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return markSharedMaterial(mat);
}

function moteGeometry(kind: BgRuneType): THREE.BufferGeometry {
  let geo = moteGeos.get(kind);
  if (!geo) {
    const count = RUNE_VFX_TUNING[kind].motes;
    geo = new THREE.BufferGeometry();
    // Positions are unused (the vertex shader derives them), but Three needs a
    // `position` attribute to size the draw. One shared zero buffer per kind.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute(
      'aSeed',
      new THREE.BufferAttribute(runeMoteSeeds(count), RUNE_MOTE_SEED_STRIDE),
    );
    // The shader flings motes well outside the origin-sized bounds Three would
    // infer, so give it a sphere that covers the whole cloud instead.
    const t = RUNE_VFX_TUNING[kind];
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, t.rise * 0.5, 0),
      Math.max(t.radius, t.rise) * 1.5,
    );
    markSharedGeometry(geo);
    moteGeos.set(kind, geo);
  }
  return geo;
}

function moteMaterial(kind: BgRuneType, color: number): THREE.ShaderMaterial {
  const key = `${kind}:${color}`;
  let mat = moteMats.get(key);
  if (!mat) {
    const t = RUNE_VFX_TUNING[kind];
    mat = fxMaterial(MOTE_VERTEX[kind], MOTE_FRAGMENT, {
      uColor: { value: new THREE.Color(color) },
      uRise: { value: t.rise },
      uRadius: { value: t.radius },
      uSize: { value: t.moteSize },
      uCycle: { value: t.cycleSec },
    });
    moteMats.set(key, mat);
  }
  return mat;
}

function moteCloud(kind: BgRuneType, color: number): THREE.Points {
  const points = new THREE.Points(moteGeometry(kind), moteMaterial(kind, color));
  // The cloud's bounds are shader-derived; culling it against the (tiny) pad
  // group transform would pop it out at grazing angles.
  points.frustumCulled = false;
  points.renderOrder = 4;
  return points;
}

// ---------------------------------------------------------------------------
// The shared ground ring: outward-scrolling streaks, recolored per rune
// ---------------------------------------------------------------------------

const RUNE_RING_FRAGMENT = /* glsl */ `
  ${TAU}
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    // vUv.y runs inner->outer across a RingGeometry; vUv.x runs around it.
    float streak = pow(max(0.5 + 0.5 * sin(vUv.x * TAU * 9.0 - uTime * 7.0), 0.0), 3.0);
    float band = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
    float a = streak * band * 0.85;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

const UV_PASSTHROUGH_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * The ring every pad wears, in its own color. One geometry, one material per
 * COLOR (not per kind), so three pads of the same rune still share the draw.
 */
function runeGroundRing(color: number): THREE.Mesh {
  runeRingGeo ??= markSharedGeometry(new THREE.RingGeometry(RUNE_RING_INNER, RUNE_RING_OUTER, 48));
  let mat = runeRingMats.get(color);
  if (!mat) {
    mat = fxMaterial(UV_PASSTHROUGH_VERTEX, RUNE_RING_FRAGMENT, {
      uColor: { value: new THREE.Color(color) },
    });
    mat.side = THREE.DoubleSide;
    runeRingMats.set(color, mat);
  }
  const mesh = new THREE.Mesh(runeRingGeo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.09; // just over the pad's own glow disc (RUNE_DISC_Y)
  mesh.renderOrder = 3;
  return mesh;
}

// ---------------------------------------------------------------------------
// Forge (damage): the heat plume the embers rise through
// ---------------------------------------------------------------------------

// Everything falls off to zero before it reaches a quad edge, so the plume has
// no outline of its own from any angle, the fix for the cylinder shell this
// replaced (see FORGE_PLUME_WIDTH in the core for what that looked like).
const FORGE_PLUME_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float h = vUv.y;
    // Wide over the coals, tapering as the heat climbs.
    float halfWidth = mix(0.38, 0.10, smoothstep(0.0, 1.0, h));
    float lateral = 1.0 - smoothstep(0.0, halfWidth, abs(vUv.x - 0.5));
    // Off the pad, gone well before the top of the quad.
    float rise = smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.2, 0.9, h));
    // One scrolling convection band; two read as a barber pole.
    float bands = 0.6 + 0.4 * sin(h * 8.0 - uTime * 2.3);
    float a = lateral * rise * bands * 0.55;
    if (a < 0.01) discard;
    // A hot core where the plume is densest, cooling to the rune color out at
    // the edges, a flat red wash reads as gel, not heat.
    gl_FragColor = vec4(mix(uColor, vec3(1.0), lateral * rise * 0.4), a);
  }
`;

function forgePlume(color: number): THREE.Group {
  forgePlumeGeo ??= markSharedGeometry(
    new THREE.PlaneGeometry(FORGE_PLUME_WIDTH, FORGE_PLUME_HEIGHT),
  );
  let mat = forgePlumeMats.get(color);
  if (!mat) {
    mat = fxMaterial(UV_PASSTHROUGH_VERTEX, FORGE_PLUME_FRAGMENT, {
      uColor: { value: new THREE.Color(color) },
    });
    mat.side = THREE.DoubleSide;
    forgePlumeMats.set(color, mat);
  }
  // Two quads crossed at right angles: the plume keeps its volume as the
  // camera orbits, and one of the pair always faces the player reasonably.
  const group = new THREE.Group();
  for (const yaw of [0, Math.PI / 2]) {
    const quad = new THREE.Mesh(forgePlumeGeo, mat);
    quad.rotation.y = yaw;
    quad.position.y = FORGE_PLUME_HEIGHT / 2;
    quad.renderOrder = 3;
    group.add(quad);
  }
  return group;
}

// ---------------------------------------------------------------------------
// Aegis (defense): the orbiting shard plates
// ---------------------------------------------------------------------------
//
// There was a translucent hex dome here. It is GONE, and deliberately so: a
// shell between the camera and the pad spends its alpha hiding the body the
// pad exists to advertise. Softening it and flattening it both helped and
// neither fixed it, the ward now reads from the shards and the orbiting
// sparks, which sit BESIDE the body instead of in front of it.

/** The orbiting plate: a small tapered shield chip, flat side facing outward. */
function aegisShardGeometry(): THREE.BufferGeometry {
  if (aegisShardGeo) return aegisShardGeo;
  const sh = new THREE.Shape();
  sh.moveTo(0, 0.22);
  sh.lineTo(0.15, 0.12);
  sh.lineTo(0.15, -0.08);
  sh.lineTo(0, -0.24);
  sh.lineTo(-0.15, -0.08);
  sh.lineTo(-0.15, 0.12);
  sh.closePath();
  aegisShardGeo = markSharedGeometry(
    new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: false }),
  );
  return aegisShardGeo;
}

function aegisShardRing(color: number): THREE.Group {
  let mat = aegisShardMats.get(color);
  if (!mat) {
    mat = markSharedMaterial(
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    aegisShardMats.set(color, mat);
  }
  const ring = new THREE.Group();
  ring.position.y = AEGIS_SHARD_Y;
  for (let i = 0; i < AEGIS_SHARD_COUNT; i++) {
    const ang = (i / AEGIS_SHARD_COUNT) * Math.PI * 2;
    const shard = new THREE.Mesh(aegisShardGeometry(), mat);
    shard.position.set(Math.cos(ang) * AEGIS_SHARD_RADIUS, 0, Math.sin(ang) * AEGIS_SHARD_RADIUS);
    // Face outward, leaning back into the dome shell.
    shard.rotation.y = -ang;
    shard.rotation.x = -0.35;
    ring.add(shard);
  }
  return ring;
}

// ---------------------------------------------------------------------------
// Kit assembly
// ---------------------------------------------------------------------------

/**
 * Build the effect kit for one rune pad. `lowGfx` keeps the identity-bearing
 * silhouette (the mote cloud, which is one draw) and drops the pieces that are
 * pure richness: the point light and the shell/ring shaders.
 *
 * Returns null for a rune type with no kit, so callers stay total.
 */
export function buildRuneVfxKit(
  kind: BgRuneType,
  color: number,
  lowGfx: boolean,
): RuneVfxKit | null {
  const tuning = RUNE_VFX_TUNING[kind];
  if (!tuning) return null;

  const group = new THREE.Group();
  group.name = `runeVfx_${kind}`;
  let light: THREE.PointLight | null = null;
  let shards: THREE.Group | null = null;

  if (tuning.motes > 0) group.add(moteCloud(kind, color));

  if (!lowGfx) {
    // Common footing first, then whatever that kit adds above it.
    group.add(runeGroundRing(color));
    if (kind === 'damage') group.add(forgePlume(color));
    else if (kind === 'defense') {
      shards = aegisShardRing(color);
      group.add(shards);
    }
    light = new THREE.PointLight(color, RUNE_LIGHT_INTENSITY, RUNE_LIGHT_DISTANCE, 2);
    light.position.y = RUNE_LIGHT_Y;
    group.add(light);
  }

  const shardRing = shards;
  const pointLight = light;
  return {
    group,
    update(time: number): void {
      if (pointLight) pointLight.intensity = RUNE_LIGHT_INTENSITY * runeLightPulse(kind, time);
      if (shardRing) shardRing.rotation.y = runeShardYaw(kind, time);
    },
  };
}

/** Test-only window into the shared caches (see tests/battleground_rune_vfx). */
export const runeVfxInternalsForTest = {
  moteVertexShaders: MOTE_VERTEX,
  lightIntensity: RUNE_LIGHT_INTENSITY,
};
