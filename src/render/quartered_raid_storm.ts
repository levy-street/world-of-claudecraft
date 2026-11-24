// The storm round the raid isle, render side: the dark cloud cards that churn
// round its spike, wall it in behind and hang over its towers as a
// thunderhead, and the lightning that strikes down out of them. The layout,
// the strike schedule and each strike's plan are the pure core
// quartered_raid_storm_core.ts; the isle itself is one of the floating isles
// (quartered_floating_debris_core.ts, the 'raid' model). Cosmetic only:
// nothing here feeds the sim, and nothing a player reacts to rides it (the
// graphics fairness rule).
//
// A strike is one cloud: the core picks a cloud as it hangs right now, the
// bolt comes down out of it (onto the isle's towers, or past a flank into the
// storm below), and only that cloud and its two nearest light up. Every flash
// is a bolt; no strike lights the whole storm.
//
// GPU contract: the landmark dressing builds this view next to the isle it
// frames (quartered_landmark_dressing.ts), inside the cull cluster the isle
// rides, so every material links behind attachZoneFeature's world compile gate
// with the rest of the dressing, the zone sweep culls it with the isle, and the
// dressing's teardown frees it. The dressing has no per-frame hook, so it
// attaches the view here and the props update ticks it (tickRaidStorm); it
// sleeps while its cluster is hidden or the isle lies beyond the scenery
// horizon the props update hands it, and clears any lit strike before it
// does. The bolt is one preallocated mesh
// rewritten once per strike (never per frame), and the cloud glow three
// instanced cards; both are built lit (at opacity 0) so a prewarm render links
// the programs they draw with, then idle at nothing drawn. Per frame only the
// cloud instances and two opacities change, nothing is built. Reduced
// motion freezes the clouds and draws no lightning (lightning is the
// photosensitive case).
import * as THREE from 'three';
import { attachBiomeHaze } from './biome_haze_field';
import { type FloatingIsle, ISLE_MODELS, isleWorldPoint } from './quartered_floating_debris_core';
import {
  BOLT_POINTS,
  FORK_POINTS,
  GLOW_WIDTH,
  makeBackToFront,
  planStrike,
  puffPosition,
  ribbonIndices,
  ribbonInto,
  STORM_TEXTURE_SIZE,
  StrikeClock,
  type StrikePlan,
  stormIsleOf,
  stormPuffs,
  stormPuffTexels,
  stormReach,
} from './quartered_raid_storm_core';

/** The storm cloud's colour (its texture shades it, lit top to dark belly; the
 *  scene's light shades it again, so it darkens with the night like the rest
 *  of the sky). */
const STORM_TINT = new THREE.Color(0x68707e);
/** The light a strike throws on its own cloud, and on its two nearest (the
 *  glow cards' tint and their share of it). */
// brighter than white (the glow is never tone mapped), so the struck cloud
// blooms against the storm by day as well as by night
const CLOUD_GLOW_TINT = new THREE.Color(0xc4d2f2).multiplyScalar(1.7);
const CLOUD_GLOW_PEAK = 1;
/** How much bigger than its cloud a glow card is, so the light spills past
 *  the cloud's edge. */
const CLOUD_GLOW_SPILL = 1.3;
const CLOUD_GLOW_SHARES = [1, 0.5, 0.4] as const;
/** The bolt's core and glow tints and alphas: a solid white core in a soft
 *  blue halo (normal blending, so it reads against a bright sky as well as
 *  against the storm). */
const BOLT_CORE: [number, number, number, number] = [0.94, 0.97, 1, 1];
const BOLT_GLOW: [number, number, number, number] = [0.66, 0.8, 1, 0.5];
/** The bolt's vertices: glow main, glow fork, core main, core fork. */
const BOLT_VERTS = (BOLT_POINTS + FORK_POINTS) * 2 * 2;

export interface RaidStormView {
  group: THREE.Group;
  update(dt: number, reducedMotion: boolean, camX: number, camZ: number, fogFar: number): void;
  dispose(): void;
}

function cloudMaterial(): { material: THREE.MeshLambertMaterial; texture: THREE.DataTexture } {
  const size = STORM_TEXTURE_SIZE;
  const texture = new THREE.DataTexture(stormPuffTexels(size), size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  // lit (Lambert), so the storm darkens at night instead of glowing grey
  // against the stars
  const material = new THREE.MeshLambertMaterial({
    map: texture,
    color: STORM_TINT.clone(),
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  material.name = 'quartered-raid-storm-cloud';
  attachBiomeHaze(material);
  return { material, texture };
}

/** The light inside a struck cloud: the cloud's own soft shape, added. */
function cloudGlowMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: CLOUD_GLOW_TINT.clone(),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  material.name = 'quartered-raid-storm-cloud-glow';
  return material;
}

function boltMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    // never fogged: lightning is light and reads through the haze; the view
    // sleeps past the scenery horizon, so no bolt flashes beyond it
    fog: false,
    toneMapped: false,
  });
  material.name = 'quartered-raid-storm-bolt';
  return material;
}

/** The one bolt's geometry: fixed-size buffers (every bolt has the same point
 *  counts), its colours and indices set once, its positions written per strike. */
function boltGeometry(): { geometry: THREE.BufferGeometry; positions: Float32Array } {
  const positions = new Float32Array(BOLT_VERTS * 3);
  const colors = new Float32Array(BOLT_VERTS * 4);
  const indices: number[] = [];
  let v = 0;
  for (const [points, tint] of [
    [BOLT_POINTS, BOLT_GLOW],
    [FORK_POINTS, BOLT_GLOW],
    [BOLT_POINTS, BOLT_CORE],
    [FORK_POINTS, BOLT_CORE],
  ] as const) {
    ribbonIndices(points, v, indices);
    for (let k = 0; k < points * 2; k++) colors.set(tint, (v + k) * 4);
    v += points * 2;
  }
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3);
  position.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  return { geometry, positions };
}

/** True when `object` and every parent up to the scene are shown (the zone
 *  sweep hides the cluster the storm rides with the isle). */
function shown(object: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** The storm round the raid isle (a planned 'raid' floating isle). */
export function createRaidStormView(raid: FloatingIsle): RaidStormView {
  const isle = stormIsleOf(raid, (i) => isleWorldPoint(i, [0, ISLE_MODELS[i.model].h, 0]));
  const group = new THREE.Group();
  group.name = 'quartered-raid-storm';

  // The clouds: one card per puff, every card facing south (where the storm
  // is seen from), one instanced mesh for all its layers. The card is turned
  // to face south and its normals point up: lit from the sky above whichever
  // way the storm is seen, never backlit black when the sun hangs beyond it.
  const puffs = stormPuffs(isle);
  const card = new THREE.PlaneGeometry(1, 1);
  card.rotateY(Math.PI);
  const normals = card.getAttribute('normal');
  for (let i = 0; i < normals.count; i++) normals.setXYZ(i, 0, 1, 0);
  normals.needsUpdate = true;
  const { material: cloud, texture } = cloudMaterial();
  const clouds = new THREE.InstancedMesh(card, cloud, puffs.length);
  clouds.name = 'quartered-raid-storm-clouds';
  clouds.castShadow = false;
  clouds.receiveShadow = false;
  // over the isle's own faces where a card hangs in front of its spike
  clouds.renderOrder = 2;
  // a static sphere round everything the storm can reach (stormReach)
  const sphere = stormReach(isle);
  const center = new THREE.Vector3(sphere.x, sphere.y, sphere.z);
  const reach = new THREE.Sphere(center, sphere.radius);
  const at = { x: 0, y: 0, z: 0 };
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const tone = new THREE.Color();
  const xs = new Float64Array(puffs.length);
  const ys = new Float64Array(puffs.length);
  const zs = new Float64Array(puffs.length);
  const order: number[] = [];
  const sortFarFirst = makeBackToFront(zs);
  // instances are written farthest first each frame (the cards never write
  // depth, so a nearer card must draw after the one behind it), and a card's
  // tone moves with it
  const placeClouds = (t: number) => {
    for (let i = 0; i < puffs.length; i++) {
      puffPosition(isle, puffs[i], t, at);
      xs[i] = at.x;
      ys[i] = at.y;
      zs[i] = at.z;
    }
    sortFarFirst(order);
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      position.set(xs[i], ys[i], zs[i]);
      scale.set(puffs[i].w, puffs[i].h, 1);
      clouds.setMatrixAt(k, matrix.compose(position, quaternion, scale));
      clouds.setColorAt(k, tone.setScalar(puffs[i].shade));
    }
    clouds.instanceMatrix.needsUpdate = true;
    if (clouds.instanceColor) clouds.instanceColor.needsUpdate = true;
  };
  placeClouds(0);
  clouds.boundingSphere = reach.clone();
  group.add(clouds);

  // The light inside the struck cloud and its two nearest: three of the
  // cloud's own cards, added over it.
  const glowMat = cloudGlowMaterial(texture);
  const glow = new THREE.InstancedMesh(card, glowMat, CLOUD_GLOW_SHARES.length);
  glow.name = 'quartered-raid-storm-cloud-glow';
  glow.castShadow = false;
  glow.receiveShadow = false;
  glow.renderOrder = 3;
  glow.boundingSphere = reach.clone();
  group.add(glow);

  // The bolt: one mesh, rewritten for each strike.
  const { geometry: boltGeo, positions: boltPos } = boltGeometry();
  boltGeo.boundingSphere = reach.clone();
  const boltMat = boltMaterial();
  const bolt = new THREE.Mesh(boltGeo, boltMat);
  bolt.name = 'quartered-raid-storm-bolts';
  bolt.castShadow = false;
  bolt.receiveShadow = false;
  bolt.renderOrder = 4;
  group.add(bolt);

  const lightStrike = (plan: StrikePlan) => {
    let v = ribbonInto(plan.main, plan.width * GLOW_WIDTH, boltPos, 0);
    v = ribbonInto(plan.fork, plan.width * GLOW_WIDTH * 0.6, boltPos, v);
    v = ribbonInto(plan.main, plan.width, boltPos, v);
    ribbonInto(plan.fork, plan.width * 0.6, boltPos, v);
    boltGeo.getAttribute('position').needsUpdate = true;
    boltGeo.setDrawRange(0, Number.POSITIVE_INFINITY);
    for (let k = 0; k < CLOUD_GLOW_SHARES.length; k++) {
      const i = plan.glow[k];
      // a hair toward the Gyre, so the light lies over its own cloud
      position.set(xs[i], ys[i], zs[i] - 1);
      scale.set(puffs[i].w * CLOUD_GLOW_SPILL, puffs[i].h * CLOUD_GLOW_SPILL, 1);
      glow.setMatrixAt(k, matrix.compose(position, quaternion, scale));
      glow.setColorAt(k, tone.setScalar(CLOUD_GLOW_SHARES[k]));
    }
    glow.instanceMatrix.needsUpdate = true;
    if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
    glow.count = CLOUD_GLOW_SHARES.length;
  };
  // built lit (strike 0 at opacity 0), so a prewarm render links the programs
  // the strikes draw with; the first update settles it idle
  lightStrike(planStrike(isle, puffs, xs, ys, zs, 0));

  const clock = new StrikeClock();
  let time = 0;
  let planned = -1;
  let idle = false;
  let disposed = false;
  const dark = () => {
    if (idle) return;
    boltGeo.setDrawRange(0, 0);
    glow.count = 0;
    boltMat.opacity = 0;
    glowMat.opacity = 0;
    idle = true;
  };
  return {
    group,
    update(dt, reducedMotion, camX, camZ, fogFar) {
      // asleep while hidden or while the isle lies beyond the scenery horizon
      // (`fogFar`, the far distance the props update hands it), and a strike
      // is never left lit
      if (!shown(group) || Math.hypot(camX - center.x, camZ - center.z) > fogFar) {
        dark();
        return;
      }
      if (reducedMotion) {
        // no lightning and no churn: the storm hangs still and dark
        dark();
        return;
      }
      time += dt;
      placeClouds(time);
      const strike = clock.at(time);
      if (!strike) {
        dark();
        return;
      }
      if (strike.n !== planned) {
        // a new strike: out of a cloud as it hangs now
        lightStrike(planStrike(isle, puffs, xs, ys, zs, strike.n));
        planned = strike.n;
      }
      idle = false;
      boltMat.opacity = strike.light;
      glowMat.opacity = strike.light * CLOUD_GLOW_PEAK;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      card.dispose();
      cloud.dispose();
      texture.dispose();
      clouds.dispose();
      glowMat.dispose();
      glow.dispose();
      boltGeo.dispose();
      boltMat.dispose();
    },
  };
}

// The storms the dressings attached, ticked from the props update: the
// dressing view itself has no per-frame hook. A list, not one slot, so a
// dressing torn down while another is alive never stops the other's storm.
const attached: RaidStormView[] = [];

/** The landmark dressing attaches the storm it built... */
export function attachRaidStorm(view: RaidStormView): void {
  if (!attached.includes(view)) attached.push(view);
}

/** ...and detaches it on teardown (a stale view is never ticked). */
export function detachRaidStorm(view: RaidStormView): void {
  const at = attached.indexOf(view);
  if (at >= 0) attached.splice(at, 1);
}

/** One frame of each attached storm (none on a world without the isle built). */
export function tickRaidStorm(
  dt: number,
  reducedMotion: boolean,
  camX: number,
  camZ: number,
  fogFar: number,
): void {
  for (let i = 0; i < attached.length; i++) {
    attached[i].update(dt, reducedMotion, camX, camZ, fogFar);
  }
}
