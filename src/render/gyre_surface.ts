// The Gyre's surface, drawn as the painted stone of the concept: a flagstone road laid along the
// whole climb and a faceted cliff skin over the steep ground of the peak (render/gyre_rock_skin_
// core.ts cuts the cliff, render/gyre_wind_core.ts lays the road's strip). Both are the raid's
// painted textures (the Breath vein's slab and cliff paintings, made seamless, 1024 square, KTX2
// so they stay GPU-compressed) on plain lit materials, so the stone takes the scene's sun,
// shadows and fog like every prop does. The cliff tile is shared: the storm pillars (props.ts)
// wear the same one, projected into it, so the whole peak is one texture.
//
// Presentation only: the terrain under them keeps every height and collision, and they sit a
// hand above it. Built once with the props; static, so nothing here moves after the build. The
// group is never hidden (a hidden group would miss the world-entry compile, which only collects
// visible objects). Every material is named for the fleet's program ledger.
//
// The tiles are cosmetic, so a failed fetch never fails world entry: every material starts on a
// one-texel stand-in of the stone's colour (so the map slot, and with it the shader program, is
// there from the first compile) and the real tile is swapped in when it lands.

import * as THREE from 'three';
import { GYRE_PATH_YARDS } from '../sim/quartered_gyre_wind';
import { loadKtx2Texture } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { attachBiomeHaze } from './biome_haze_field';
import { GFX } from './gfx';
import { buildGyreRockSkin } from './gyre_rock_skin_core';
import { buildLaneRibbons, type RibbonGeometry, type RibbonOptions } from './gyre_wind_core';
import { applyTextureAnisotropy } from './texture_anisotropy';

export interface GyreSurfaceView {
  group: THREE.Group;
  /** Free what the view owns outright (geometry, materials, stand-in textures); never the shared
   *  KTX2 tiles. Idempotent. */
  dispose(): void;
}

const SLAB_URL = '/textures/terrain/gyre_slab.ktx2';
const CLIFF_URL = '/textures/terrain/gyre_cliff.ktx2';

/** The road: a hand narrower than the 7-yard way so the ground's own edge shows as a kerb, a
 *  square of paving to every 6.7 yards of road. It lies under the wind's chevrons (lift 0.14). */
const ROAD: RibbonOptions = { width: 6.7, step: 1, lift: 0.05, tile: 6.7 };

/** One tile, fetched compressed (the flip is baked into the file, so it samples as a raw image
 *  would: the painting's top is up the v axis), on the tier's anisotropy budget. */
function fetchTile(url: string): Promise<THREE.Texture> {
  return loadKtx2Texture(url, { repeat: true }).then((t) => applyTextureAnisotropy(t, 'colour'));
}

// The two paintings, fetched with the world-entry preload so they are in hand when the props are
// built; a late one is bound when it lands. A failed fetch is swallowed (the stand-ins stay).
let slabTexture: THREE.Texture | null = null;
let cliffTexture: THREE.Texture | null = null;
const cliffWaiters: ((t: THREE.Texture) => void)[] = [];
function landCliff(t: THREE.Texture): void {
  cliffTexture = t;
  for (const bind of cliffWaiters.splice(0)) bind(t);
}
if (typeof window !== 'undefined') {
  registerDeferredPreload(() =>
    fetchTile(SLAB_URL).then(
      (t) => {
        slabTexture = t;
      },
      () => undefined,
    ),
  );
  registerDeferredPreload(() => fetchTile(CLIFF_URL).then(landCliff, () => undefined));
}

/** The shared painted cliff tile, or null until the world-entry preload has landed it. */
export function gyreCliffTexture(): THREE.Texture | null {
  return cliffTexture;
}

/** Run `bind` with the cliff tile: now if it is in hand, else when it lands. */
export function onGyreCliffTexture(bind: (t: THREE.Texture) => void): void {
  if (cliffTexture) {
    bind(cliffTexture);
    return;
  }
  const first = cliffWaiters.length === 0;
  cliffWaiters.push(bind);
  if (first && typeof document !== 'undefined') void fetchTile(CLIFF_URL).then(landCliff, () => {});
}

/** A one-texel stand-in of the stone's own colour, until the painting is bound (and where there
 *  is no DOM to fetch it). */
function placeholder(r: number, g: number, b: number): THREE.Texture {
  const t = new THREE.DataTexture(
    new Uint8Array([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255]),
    1,
    1,
  );
  t.needsUpdate = true;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let cliffStandIn: THREE.Texture | null = null;
/** The cliff tile's stand-in, shared by everything that wears the tile (the skin and the storm
 *  pillars): a material starts on it when the tile is late, so the swap to the real tile changes
 *  the texture, never the shader program. */
export function gyreCliffPlaceholder(): THREE.Texture {
  cliffStandIn ??= placeholder(0.5, 0.52, 0.68);
  return cliffStandIn;
}

/** Bind a painting to a material that started on a stand-in: when it lands. */
function bindWhenLanded(
  material: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial,
  url: string,
): void {
  if (typeof document === 'undefined') return;
  void fetchTile(url).then(
    (t) => {
      material.map = t;
      material.needsUpdate = true;
    },
    () => {},
  );
}

/** A painted-stone material on the tier's material family, as the prop kits convert theirs
 *  (standard where the tier has PBR, else Lambert), hazed with the ground under it. */
function stoneMaterial(opt: {
  name: string;
  map: THREE.Texture;
  vertexColors?: boolean;
  flatShading?: boolean;
  polygonOffsetFactor: number;
}): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  const common = {
    name: opt.name,
    map: opt.map,
    vertexColors: opt.vertexColors ?? false,
    flatShading: opt.flatShading ?? false,
    polygonOffset: true,
    polygonOffsetFactor: opt.polygonOffsetFactor,
    polygonOffsetUnits: opt.polygonOffsetFactor,
  };
  const mat = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ ...common, roughness: 0.95, metalness: 0 })
    : new THREE.MeshLambertMaterial(common);
  attachBiomeHaze(mat);
  return mat;
}

function stripGeometry(geo: RibbonGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(geo.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(geo.indices, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Build the road and the cliff: `ground` reads the world's finished terrain height. */
export function createGyreSurfaceView(ground: (x: number, z: number) => number): GyreSurfaceView {
  const group = new THREE.Group();
  group.name = 'gyre-surface';

  // ---- the flagstone road ----------------------------------------------------------------------
  const slabStandIn = slabTexture ? null : placeholder(0.56, 0.58, 0.72);
  const roadMat = stoneMaterial({
    name: 'gyre-surface:road',
    map: slabTexture ?? (slabStandIn as THREE.Texture),
    polygonOffsetFactor: -2,
  });
  if (!slabTexture) bindWhenLanded(roadMat, SLAB_URL);
  const lane = { t0: 0, t1: 1, yd0: 0, yd1: GYRE_PATH_YARDS };
  const road = new THREE.Mesh(stripGeometry(buildLaneRibbons([lane], ground, ROAD)), roadMat);
  road.name = 'gyre-road';
  road.receiveShadow = true;
  group.add(road);

  // ---- the cliff skin ----------------------------------------------------------------------------
  const skin = buildGyreRockSkin(ground);
  const skinGeo = new THREE.BufferGeometry();
  skinGeo.setAttribute('position', new THREE.BufferAttribute(skin.positions, 3));
  skinGeo.setAttribute('uv', new THREE.BufferAttribute(skin.uvs, 2));
  skinGeo.setAttribute('color', new THREE.BufferAttribute(skin.colors, 3));
  skinGeo.computeVertexNormals();
  skinGeo.computeBoundingSphere();
  const rockMat = stoneMaterial({
    name: 'gyre-surface:rock',
    map: cliffTexture ?? gyreCliffPlaceholder(),
    vertexColors: true,
    flatShading: true,
    polygonOffsetFactor: -1,
  });
  if (!cliffTexture)
    onGyreCliffTexture((t) => {
      rockMat.map = t;
      rockMat.needsUpdate = true;
    });
  const rock = new THREE.Mesh(skinGeo, rockMat);
  rock.name = 'gyre-rock-skin';
  rock.receiveShadow = true;
  group.add(rock);

  let disposed = false;
  return {
    group,
    dispose() {
      if (disposed) return;
      disposed = true;
      road.geometry.dispose();
      rock.geometry.dispose();
      roadMat.dispose();
      rockMat.dispose();
      slabStandIn?.dispose();
    },
  };
}
