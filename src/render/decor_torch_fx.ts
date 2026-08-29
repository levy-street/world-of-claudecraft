// Live fire for authored torch decor: every decorProps entry whose key is a
// torch model (the Gauntlet's fence-line lantern posts on the Proving Shore)
// gets a small flame and a night-light-field entry, so the posts genuinely
// light the ground around them after dark instead of standing cold.
//
// The fixture itself is drawn by the ordinary decorProps pass (props.ts):
// this module adds only the FIRE. It follows the streetlamp/brazier split
// exactly: no per-torch PointLight (the pinned point-light budget holds
// GFX.maxPointLights slots and a torch line would crowd the campfires out;
// see streetlamps.ts's header), ground light through
// registerStaticNightLights where the terrain shader splices it, and a
// draped glow pool on the fallback tier, all driven by the same lampGlow
// the lamps use. Flames join the renderer's shared scenery-flame pass.

import * as THREE from 'three';
import { getActiveWorldContent, zoneAt } from '../sim/data';
import { terrainHeight } from '../sim/world';
import { EMISSIVE_LIGHT, GFX } from './gfx';
import { buildDrapedGlowGeometry, type GlowPatchSite } from './ground_glow_patch';
import { hasNightLightField, registerStaticNightLights } from './night_light_field';
import { radialGlowTexture } from './textures';

export interface DecorTorchFxView {
  group: THREE.Group;
  /** Empty on purpose: torches ride the night light field, never the pinned
   *  point-light budget (the streetlamps.ts contract). */
  glowLights: THREE.PointLight[];
  /** live flame meshes for the renderer's scenery-flame pass */
  flames: THREE.Mesh[];
  /** per-zone subtrees, so the zone-feature distance cull works per zone */
  cullGroups: THREE.Group[];
  /** Drive the fallback ground pools from the frame's lamp glow amount. */
  update(glow: number, time: number): void;
}

/** decorProps keys this pass treats as burning torch posts. */
export const LIT_DECOR_KEYS: ReadonlySet<string> = new Set(['kcasTorch', 'kcasTorchMounted']);

/** Where the torch head's flame sits above the seated base at decor scale 1
 *  (the castle's mounted torches put theirs at +2.4 for scale 1.5). */
export const TORCH_FLAME_HEIGHT = 1.6;

const FLAME_COLOR = 0xffaa33;
const FLAME_EMISSIVE = 0xff6600;
const POOL_COLOR = 0xff8830;
const POOL_RADIUS = 6;
const POOL_OPACITY = 0.3;
/** Night-light-field entries: brighter than a camp brazier (the Gauntlet has
 *  no ground fires at all, the posts ARE its light) but tighter, a lantern's
 *  pool rather than a bonfire's. */
const FIELD_RADIUS = 24;
const FIELD_INTENSITY = 60;
const FIELD_COLOR = [1.0, 0.5, 0.18] as const;
/** A wind-licked open flame, calmer than a bonfire. */
const FIELD_FLICKER = 0.16;

/** The campfire flame profile (props.ts), at lantern size. */
export function buildTorchFlameGeometry(): THREE.BufferGeometry {
  const points = [
    [0, 0],
    [0.16, 0.1],
    [0.27, 0.28],
    [0.3, 0.45],
    [0.22, 0.66],
    [0.1, 0.84],
    [0.001, 0.95],
  ].map(([r, y]) => new THREE.Vector2(r * 0.6, y * 0.6));
  return new THREE.LatheGeometry(points, 7);
}

interface TorchSite {
  x: number;
  y: number;
  z: number;
}

/** Every authored torch decor entry, seated on the terrain like the
 *  decorProps pass seats the model itself. */
export function planDecorTorches(seed = 0): TorchSite[] {
  const content = getActiveWorldContent();
  const sites: TorchSite[] = [];
  for (const d of content.props.decorProps ?? []) {
    if (!LIT_DECOR_KEYS.has(d.key)) continue;
    const s = d.scale ?? 1;
    sites.push({ x: d.x, y: terrainHeight(d.x, d.z, seed) + TORCH_FLAME_HEIGHT * s, z: d.z });
  }
  return sites;
}

export function buildDecorTorchFx(seed = 0): DecorTorchFxView {
  const group = new THREE.Group();
  group.name = 'decor-torch-fx';
  const glowLights: THREE.PointLight[] = [];
  const flames: THREE.Mesh[] = [];
  const cullGroups: THREE.Group[] = [];
  const poolMeshes: THREE.Mesh[] = [];

  const sites = planDecorTorches(seed);
  if (sites.length === 0) {
    return { group, glowLights, flames, cullGroups, update: () => undefined };
  }

  registerStaticNightLights(
    'decor-torches',
    sites.map((site) => ({
      x: site.x,
      y: site.y + 0.3,
      z: site.z,
      radius: FIELD_RADIUS,
      r: FIELD_COLOR[0],
      g: FIELD_COLOR[1],
      b: FIELD_COLOR[2],
      intensity: FIELD_INTENSITY,
      flicker: FIELD_FLICKER,
    })),
  );
  const usePools = !hasNightLightField();

  const content = getActiveWorldContent();
  const byZone = new Map<number, TorchSite[]>();
  for (const site of sites) {
    const index = content.zones.indexOf(zoneAt(site.x, site.z));
    const bucket = byZone.get(index);
    if (bucket) bucket.push(site);
    else byZone.set(index, [site]);
  }

  const flameGeo = buildTorchFlameGeometry();
  const poolMat = usePools
    ? new THREE.MeshBasicMaterial({
        map: radialGlowTexture(),
        color: POOL_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    : null;

  const patchSites: GlowPatchSite[] = [];
  for (const [zoneIndex, zoneSites] of byZone) {
    const zoneGroup = new THREE.Group();
    zoneGroup.name = `decor-torch-fx-zone-${zoneIndex}`;
    patchSites.length = 0;
    for (const site of zoneSites) {
      patchSites.push({ x: site.x, z: site.z, radius: POOL_RADIUS });
      const flame = new THREE.Mesh(
        flameGeo,
        new THREE.MeshLambertMaterial({
          color: FLAME_COLOR,
          emissive: FLAME_EMISSIVE,
          emissiveIntensity: GFX.standardMaterials ? EMISSIVE_LIGHT : 1.4,
          transparent: true,
          opacity: 0.92,
        }),
      );
      flame.position.set(site.x, site.y, site.z);
      flames.push(flame);
      zoneGroup.add(flame);
    }
    if (poolMat) {
      const pools = new THREE.Mesh(
        buildDrapedGlowGeometry(patchSites, (x, z) => terrainHeight(x, z, seed)),
        poolMat,
      );
      pools.geometry.computeBoundingSphere();
      pools.renderOrder = 1; // over the ground it drapes on
      pools.visible = false; // no pool until dark
      poolMeshes.push(pools);
      zoneGroup.add(pools);
    }
    group.add(zoneGroup);
    cullGroups.push(zoneGroup);
  }

  let poolsShown = false;
  return {
    group,
    glowLights,
    flames,
    cullGroups,
    update(glow: number, time: number): void {
      const lit = glow > 0.001;
      if (lit !== poolsShown) {
        poolsShown = lit;
        for (const pool of poolMeshes) pool.visible = lit;
      }
      if (poolMat) {
        poolMat.opacity = lit ? POOL_OPACITY * glow * (1 + Math.sin(time * 1.4) * 0.06) : 0;
      }
    },
  };
}
