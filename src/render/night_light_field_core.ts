// night_light_field_core: which of the world's small night lights shine on the
// ground this frame, and how they pack into the terrain shader's uniform slots.
//
// The problem this solves: the forward renderer pins the live THREE.PointLight
// count at a handful (renderer.ts budgetFireLights), so "every lamp, fire, and
// body lights the ground around it" cannot be real Three lights. Painting baked
// additive pools instead read as stickers: they ignored the terrain's shape and
// sliced into slopes. The field is the middle path the repo already uses for
// cross-surface atmosphere (biome_haze_field): the nearest few dozen lights go
// into a shared uniform block, and the terrain fragment shader evaluates REAL
// diffuse lighting (direction, distance falloff, surface normal) for each one.
// The ground then reacts like ground: a bank facing a lamp catches its light, a
// ridge shadows its far side, and nothing is a decal.
//
// A src/render pure core: no Three, no DOM. The Three half (uniforms, GLSL,
// registry) is night_light_field.ts; renderer.ts drives it per frame.
//
// THE PACKED LAYOUT, and why it is shaped for the fragment loop rather than for
// the reader. Every terrain fragment on screen runs this loop after dark, so a
// per-slot term the shader can test and STOP on is worth far more than a tidy
// array. Per slot i:
//
//   posRadius[i] = (x, y, z, cutoffRadius SQUARED)
//   color[i]     = (r, g, b, reachKey)
//
// `reachKey` is `|light.xz - anchor.xz| - radius`: the closest the fragment can
// be to the anchor and still be inside this light. Slots are written in
// ASCENDING reachKey, so once a fragment's own anchor distance falls below
// slot i's key, no slot from i on can reach it and the loop breaks. Paired with
// the anchor bound below (the farthest any packed light reaches), the two
// bounds cut the loop at both ends: a fragment out past every light skips it
// entirely, and a fragment standing among the lights only walks the ones whose
// windows can still be open. Both are exact, not approximations, so the picture
// is identical to evaluating all forty every time.
//
// Everything is measured in the XZ plane, which is what lets the bound use the
// anchor renderer.ts already passes (the player's ground position, no height).
// A 3D hit implies a 2D hit, so a 2D reject can never drop a light that would
// have contributed.

import { MOB_GLOW_RANGE, mobGlowStrength } from './night_lighting_core';

/** Total uniform slots the terrain shader loops over. */
export const NIGHT_LIGHT_SLOTS = 40;
/** Slots reserved for moving bodies (the player and nearby characters). The
 *  disc layer this replaces pooled MOB_GLOW_POOL discs; a field slot only
 *  matters within a body light's short reach, so a camera-local camp is
 *  covered well below the disc pool's crowd cap, but the count still has to
 *  hold a busy pull: raid-sized crowds beyond it go without ground light,
 *  which is the same crowd-safe failure mode the disc pool chose. */
export const NIGHT_LIGHT_DYNAMIC_SLOTS = 14;
/**
 * Slots for the world's fixed lights (lamps, braziers, camp fires).
 *
 * This is the range the lit world reaches, not a memory budget: a static light
 * outside the window casts NOTHING, so the count decides how far down a road a
 * player sees lamplight on the ground. At ten the window closed inside 60 yards
 * in the busy places (a town's lamps plus a camp's braziers filled it), so the
 * next lamp up the road stood over dark ground while the one overhead lit a
 * pool. The wide window is what makes a road read as lit ahead of the player
 * rather than only underfoot; the shader still loops only over the live count,
 * so an empty wilderness costs exactly what it did before.
 */
export const NIGHT_LIGHT_STATIC_SLOTS = NIGHT_LIGHT_SLOTS - NIGHT_LIGHT_DYNAMIC_SLOTS;

/** One light the field can carry. Colour is linear 0..1; radius in yards.
 *  `flicker` is the fractional amplitude of the light's live waver: 0 for a
 *  steady lantern glass, higher for an open fire. */
export interface NightLightSite {
  x: number;
  y: number;
  z: number;
  radius: number;
  r: number;
  g: number;
  b: number;
  intensity: number;
  flicker?: number;
}

/**
 * The last slots of each selection window carry reduced weight, stepping down
 * toward the boundary. A nearest-K window has a hard edge by construction (the
 * K+1th light is simply absent), and the moment a new light enters, everything
 * behind it shifts one rank; the taper turns what would be a full-brightness
 * pop at the boundary into a chain of small steps at the FARTHEST lights,
 * which distance has already made faint.
 */
export const NIGHT_LIGHT_TAIL_TAPER = [0.75, 0.5, 0.25] as const;

/**
 * The reference falloff, mirrored term for term by the GLSL in
 * night_light_field.ts: three's own physical punctual-light attenuation
 * (decay 2 with the pow4 cutoff window, the exact curve THREE.PointLight
 * shades with), so the field's ground light and the budget's real point
 * lights agree about how a lamp's reach dies off. Zero at and past the
 * cutoff radius, so a light's edge never pops. Height matters: 3D distance.
 */
export function nightLightFalloff(dx: number, dy: number, dz: number, radius: number): number {
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d >= radius) return 0;
  const cutoffWindow = 1 - (d / radius) ** 4;
  const clamped = cutoffWindow < 0 ? 0 : cutoffWindow > 1 ? 1 : cutoffWindow;
  return (clamped * clamped) / Math.max(d * d, 0.01);
}

/**
 * A light's deterministic waver at a moment, around 1: a primary sine at the
 * shared fire-flicker frequency (point_light_budget.ts flickers the real fire
 * lights at time * 11, so a lamp's ground light and its point light waver in
 * near step) plus a slower secondary, the phase seeded by the light's own
 * position so a camp of fires never pulses in unison. Amplitude is `flicker`.
 */
export function nightLightFlicker(time: number, x: number, z: number, amplitude: number): number {
  if (amplitude <= 0) return 1;
  const phase = (x * 12.9898 + z * 78.233) % 6.2832;
  return (
    1 + amplitude * (Math.sin(time * 11 + phase) * 0.6 + Math.sin(time * 5.7 + phase * 1.9) * 0.4)
  );
}

/** Floats a caller must hand `packNightLights` for the anchor bound uniform. */
export const NIGHT_LIGHT_BOUND_FLOATS = 3;

/**
 * Pack this frame's lights into the two flat uniform arrays. Returns the live
 * count; slots past it are stale and the shader must not read them (the count
 * uniform gates the loop).
 *
 * Statics take the nearest NIGHT_LIGHT_STATIC_SLOTS to the anchor, dynamics
 * the nearest NIGHT_LIGHT_DYNAMIC_SLOTS, each scaled by its own glow driver
 * (lamps ride the dusk lamplighter window, bodies ride the later true-dark
 * window; night_lighting_core.ts owns both curves). A zero glow contributes
 * zero entries, so by day the loop runs over nothing at all.
 *
 * `anchorX`/`anchorZ` is the PLAYER, not the camera: the same anchor the
 * point-light budget and the disc layer rank by, so every night-light system
 * agrees about whose surroundings are lit.
 *
 * `outBound` receives (anchorX, anchorZ, boundRadius SQUARED): the sphere
 * around the anchor that contains every packed light's reach. A fragment
 * outside it is provably unlit by all of them, which is what lets the shader
 * skip the loop over the whole distant half of the ground. It is 0 when
 * nothing packed, so the same one compare also carries the daylight case.
 *
 * Selection is a bounded insertion into the slot window rather than a sort;
 * the staged winners are then ordered once by reach key (at most forty entries,
 * arriving as two already-ascending runs, so the insertion sort barely moves
 * anything). It runs every frame (dynamics move every frame); over the world's
 * few hundred static sites the whole pack measures ~0.01 ms, and by day the
 * glow gate makes it free.
 */
export function packNightLights(
  statics: readonly NightLightSite[],
  dynamics: readonly NightLightSite[],
  dynamicsCount: number,
  anchorX: number,
  anchorZ: number,
  staticGlow: number,
  dynamicGlow: number,
  time: number,
  outPosRadius: Float32Array,
  outColor: Float32Array,
  outBound: Float32Array,
): number {
  let count = 0;
  count = stageNearest(
    statics,
    statics.length,
    anchorX,
    anchorZ,
    staticGlow,
    time,
    NIGHT_LIGHT_STATIC_SLOTS,
    count,
  );
  count = stageNearest(
    dynamics,
    Math.min(dynamicsCount, dynamics.length),
    anchorX,
    anchorZ,
    dynamicGlow,
    time,
    NIGHT_LIGHT_DYNAMIC_SLOTS,
    count,
  );
  sortStagedByReach(count);
  let bound = 0;
  for (let i = 0; i < count; i++) {
    if (stageFar[i] > bound) bound = stageFar[i];
    const site = stageSite[i];
    outPosRadius[i * 4] = site.x;
    outPosRadius[i * 4 + 1] = site.y;
    outPosRadius[i * 4 + 2] = site.z;
    // squared here, once per frame, rather than per fragment in the loop
    outPosRadius[i * 4 + 3] = site.radius * site.radius;
    const level = stageLevel[i];
    outColor[i * 4] = site.r * level;
    outColor[i * 4 + 1] = site.g * level;
    outColor[i * 4 + 2] = site.b * level;
    outColor[i * 4 + 3] = stageNear[i];
  }
  outBound[0] = anchorX;
  outBound[1] = anchorZ;
  outBound[2] = bound * bound;
  return count;
}

/** scratch windows for the bounded nearest-K insertion (module-owned, no allocs) */
const pickIndex = new Int32Array(NIGHT_LIGHT_SLOTS);
const pickDist = new Float64Array(NIGHT_LIGHT_SLOTS);
/** the staged winners, in selection order, before the reach ordering */
const stageSite: NightLightSite[] = new Array(NIGHT_LIGHT_SLOTS);
const stageLevel = new Float64Array(NIGHT_LIGHT_SLOTS);
/** nearest anchor distance this light can still reach: |light.xz - anchor| - r */
const stageNear = new Float64Array(NIGHT_LIGHT_SLOTS);
/** farthest anchor distance it can reach: |light.xz - anchor| + r */
const stageFar = new Float64Array(NIGHT_LIGHT_SLOTS);

function stageNearest(
  sites: readonly NightLightSite[],
  siteCount: number,
  anchorX: number,
  anchorZ: number,
  glow: number,
  time: number,
  slots: number,
  stagedFrom: number,
): number {
  if (glow <= 0.001 || siteCount === 0 || slots <= 0) return stagedFrom;
  let picked = 0;
  for (let i = 0; i < siteCount; i++) {
    const site = sites[i];
    const dx = site.x - anchorX;
    const dz = site.z - anchorZ;
    const d2 = dx * dx + dz * dz;
    if (picked === slots && d2 >= pickDist[picked - 1]) continue;
    // insertion into the sorted window, dropping the current farthest
    let at = picked < slots ? picked : slots - 1;
    while (at > 0 && pickDist[at - 1] > d2) {
      pickDist[at] = pickDist[at - 1];
      pickIndex[at] = pickIndex[at - 1];
      at--;
    }
    pickDist[at] = d2;
    pickIndex[at] = i;
    if (picked < slots) picked++;
  }
  const taperFrom = slots - NIGHT_LIGHT_TAIL_TAPER.length;
  let staged = stagedFrom;
  for (let k = 0; k < picked; k++) {
    const site = sites[pickIndex[k]];
    const taper = k >= taperFrom ? NIGHT_LIGHT_TAIL_TAPER[k - taperFrom] : 1;
    // the ONE root the pack takes, at most forty per frame, and it buys the
    // shader both of its early exits
    const distance = Math.sqrt(pickDist[k]);
    stageSite[staged] = site;
    stageLevel[staged] =
      site.intensity * glow * taper * nightLightFlicker(time, site.x, site.z, site.flicker ?? 0);
    stageNear[staged] = distance - site.radius;
    stageFar[staged] = distance + site.radius;
    staged++;
  }
  return staged;
}

/**
 * Order the staged winners by their nearest reach, ascending, which is the
 * whole reason the shader may `break` instead of walking every slot. Insertion
 * sort on purpose: the input is two runs that are each already ascending in
 * DISTANCE, so it is near-linear in practice, it is stable (equal keys keep
 * their selection order, so the pack stays deterministic), and it moves the
 * parallel arrays with no allocation.
 */
function sortStagedByReach(count: number): void {
  for (let i = 1; i < count; i++) {
    const site = stageSite[i];
    const level = stageLevel[i];
    const near = stageNear[i];
    const far = stageFar[i];
    let at = i - 1;
    while (at >= 0 && stageNear[at] > near) {
      stageSite[at + 1] = stageSite[at];
      stageLevel[at + 1] = stageLevel[at];
      stageNear[at + 1] = stageNear[at];
      stageFar[at + 1] = stageFar[at];
      at--;
    }
    stageSite[at + 1] = site;
    stageLevel[at + 1] = level;
    stageNear[at + 1] = near;
    stageFar[at + 1] = far;
  }
}

/**
 * The read-only slice of a renderer entity view the dynamic collector reads
 * (structurally satisfied by the renderer's own view map, the mob_night_glow
 * contract).
 */
export interface NightBodyView {
  group: { visible: boolean; position: { x: number; y: number; z: number } };
}

export interface NightBodyEntity {
  kind: string;
  scale: number;
}

/** How far a body's warm ground light reaches for a scale-1 body (the
 *  punctual cutoff; the decay-2 falloff dies out well inside it). */
export const BODY_LIGHT_RADIUS = 10;
/** Body light colour: a pale warm candle-glow, as linear channels. */
export const BODY_LIGHT_COLOR = [1.0, 0.7, 0.45] as const;
/** Candela-style, like the fixed lights: enough for a clear pool underfoot. */
export const BODY_LIGHT_INTENSITY = 8;
/** The light hangs a torso above the feet, so the pool centres on the body. */
export const BODY_LIGHT_LIFT = 1.1;
/** Bodies past this go without ground light: the disc layer's own range. */
export const BODY_LIGHT_RANGE = MOB_GLOW_RANGE;

/**
 * Fill `out` with a light for every nearby visible character, the player's own
 * body included. Caller-owned `out`, returned count (the packNightLights
 * dynamics input): per frame, so no allocation. Objects (chests, nodes) carry
 * no body light; they have their own quest glows when they matter.
 *
 * Each body's intensity carries the SAME smoothstep range ease the disc layer
 * used (night_lighting_core.mobGlowStrength), so a body walking out of range
 * fades over the last ten yards instead of its light popping off, and the
 * farthest bodies (the ones the slot window evicts first) are already faint.
 */
export function collectBodyNightLights(
  views: Iterable<[number, NightBodyView]>,
  entities: { get(id: number): NightBodyEntity | undefined },
  px: number,
  pz: number,
  out: NightLightSite[],
): number {
  let count = 0;
  for (const [id, view] of views) {
    if (!view.group.visible) continue;
    const entity = entities.get(id);
    if (!entity || entity.kind === 'object') continue;
    const x = view.group.position.x;
    const z = view.group.position.z;
    const dx = x - px;
    const dz = z - pz;
    const fade = mobGlowStrength(dx * dx + dz * dz, 1);
    if (fade <= 0.001) continue;
    const bodyScale = Math.max(0.5, entity.scale);
    const slot = out[count];
    if (slot === undefined) {
      out.push({
        x,
        y: view.group.position.y + BODY_LIGHT_LIFT,
        z,
        radius: BODY_LIGHT_RADIUS * bodyScale,
        r: BODY_LIGHT_COLOR[0],
        g: BODY_LIGHT_COLOR[1],
        b: BODY_LIGHT_COLOR[2],
        intensity: BODY_LIGHT_INTENSITY * fade,
      });
    } else {
      slot.x = x;
      slot.y = view.group.position.y + BODY_LIGHT_LIFT;
      slot.z = z;
      slot.radius = BODY_LIGHT_RADIUS * bodyScale;
      slot.r = BODY_LIGHT_COLOR[0];
      slot.g = BODY_LIGHT_COLOR[1];
      slot.b = BODY_LIGHT_COLOR[2];
      slot.intensity = BODY_LIGHT_INTENSITY * fade;
      slot.flicker = 0;
    }
    count++;
  }
  return count;
}
