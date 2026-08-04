// The far-vista terrain painter: a whole-world coarse mesh (one Lambert
// material, about a dozen frustum-culled tiles) drawn beyond the classic
// detail envelope so the horizon shows the real world. With the outdoor
// fog removed this layer IS the draw distance: every ridge to the world
// rim renders from anywhere. All decisions live in far_terrain_core.ts
// (pure, Node-tested); this file only owns the Three objects and the
// idle-paced build loop.
//
// Cost model: the tiles are static world-space geometry built once per
// session (about 100-200ms of terrainHeight sampling, spread across idle
// slots, nearest tiles first). Per frame the layer costs one visibility
// loop over ~12 tiles plus the draw of whatever survives the frustum and
// the view envelope. Fragments inside the detail envelope are discarded
// in the shader; that overlap band is where the real terrain owns every
// pixel.

import * as THREE from 'three';
import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X, WORLD_MIN_Z } from '../sim/data';
import {
  BIOME_HAZE_DECLARATIONS,
  biomeHazeFragmentGlsl,
  biomeHazeUniforms,
  hasBiomeHazeField,
} from './biome_haze_field';
import {
  createFarTileBuilder,
  type FarTile,
  type FarVistaPlan,
  farGridIndices,
  farGridSide,
  farTileBuildOrder,
  farTileVisible,
  planFarTiles,
} from './far_terrain_core';
import { getGrassGroundBake } from './grass_ground_bake';
import { idleSlot } from './idle_queue';
import { GRASS_BAKE_PATCH_YARDS, GRASS_PAINT_GAIN } from './meadow_tuning';
import { renderLayerDisabled } from './render_dev_flags';

// One Uint16 index buffer per (tileSize, spacing): every tile of one
// spacing has identical topology, so a dozen tiles share one buffer.
const indexCache = new Map<string, THREE.BufferAttribute>();
function sharedIndexFor(tileSize: number, spacing: number): THREE.BufferAttribute {
  const key = `${tileSize}:${spacing}`;
  let index = indexCache.get(key);
  if (!index) {
    index = new THREE.BufferAttribute(farGridIndices(farGridSide(tileSize, spacing)), 1);
    indexCache.set(key, index);
  }
  return index;
}

// An idle-paced build slice. A 960u tile row is ~100 terrainHeight samples,
// roughly half a millisecond, so 40 rows stays around 3ms per slice. The
// budget matters less than the SLOT COUNT: this build takes an idle slot per
// slice for its whole run and competes with near-terrain zone prepares for
// the same idle time, so fewer, chunkier, more deferential slices (see the
// timeout deferrals below) keep the vista from starving the detail horizon.
const FAR_BUILD_ROWS_PER_SLICE = 40;
const FAR_BUILD_TIMEOUT_MS = 200;
/** Timed-out slots deferred before forcing progress: the far vista is the
 *  politest consumer of idle time, the near detail always outranks it. */
const FAR_BUILD_TIMEOUT_DEFERRALS = 2;

// Fragments closer than (detailFar - margin) are discarded: inside the
// detail envelope the real terrain owns every pixel, and on steep ridges
// the coarse mesh's chord error is far larger than any fixed vertical drop
// could hide (the sealed walls rise 60 units inside one far-mesh cell). The
// margin keeps a covered overlap band so the handoff never opens a seam:
// near chunks stay visible out to detailFar itself.
const FAR_DISCARD_MARGIN = 60;

interface BuiltFarTile {
  tile: FarTile;
  mesh: THREE.Mesh;
}

/**
 * Albedo-shaped ambient floor for deep night, shared by every far tile
 * (one uniform object, the farCut pattern). The vista is the first layer
 * this renderer draws with large arbitrarily oriented rock faces at scale;
 * under the night rig (light scale 0.36, ~88 percent of what remains in one
 * hard directional) a face angled off the moon crushes to black while the
 * horizontal near meadow stays readable. Emissive lands after all light
 * attenuation, so this floor survives the night scale exactly like the real
 * canopies' emissive floor does. Zero by day: the day frame is byte-identical.
 */
const FAR_NIGHT_FLOOR: [number, number, number] = [0.026, 0.03, 0.044];
const farNightFloor = { value: new THREE.Color(0, 0, 0) };

/** Per-frame, from the renderer's day/night update: scales the moonlit
 *  ambient floor with how deep into night the cycle sits (0 by day). */
export function setFarTerrainNightFloor(nightAmt: number): void {
  farNightFloor.value.setRGB(
    FAR_NIGHT_FLOOR[0] * nightAmt,
    FAR_NIGHT_FLOOR[1] * nightAmt,
    FAR_NIGHT_FLOOR[2] * nightAmt,
  );
}

export interface FarTerrainView {
  group: THREE.Group;
  /** Per-frame visibility: the layer shows only outdoors; tiles beyond the
   *  view envelope hide; near-field fragments discard against detailFar. */
  update(camX: number, camZ: number, detailFar: number, viewFar: number, outdoor: boolean): void;
  /** Stops the in-flight background build (call before discarding). */
  cancelStreaming(): void;
  /** Dispose every built tile geometry and the one shared material. */
  dispose(): void;
  /** Build progress for diagnostics: built tiles / planned tiles. */
  builtTileCount(): number;
  plannedTileCount(): number;
}

export function buildFarTerrain(
  seed: number,
  plan: FarVistaPlan,
  priorityPoint?: { x: number; z: number },
): FarTerrainView {
  const group = new THREE.Group();
  group.name = 'farTerrain';
  const built: BuiltFarTile[] = [];
  let cancelled = false;

  if (!plan.enabled) {
    return {
      group,
      update: () => {},
      cancelStreaming: () => {
        cancelled = true;
      },
      dispose: () => {},
      builtTileCount: () => 0,
      plannedTileCount: () => 0,
    };
  }

  const tiles = planFarTiles(WORLD_MIN_X, WORLD_MAX_X, WORLD_MIN_Z, WORLD_MAX_Z);
  // Standard, not Lambert: the detail terrain lights with the realm's IBL
  // irradiance (scene.environment), and without the same term the far
  // tiles' shaded faces crush toward black where the near terrain stays
  // readable. Rough, metalness 0: the diffuse IBL response only.
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });
  material.name = 'farTerrain';
  // The near-field discard (see FAR_DISCARD_MARGIN). uTime-style shared
  // uniforms are overkill here: one vec3 (camera xz + cutoff) per frame.
  const farCut = { value: new THREE.Vector3(0, 0, 0) };
  // Meadow-continuum ground paint: the far tiles multiply the SAME baked
  // blade texture the near splat terrain paints with, at the same true
  // world scale and the same constructed gain, gated by the per-vertex
  // grass weight (aGrassW). No distance term anywhere: the mip chain does
  // the averaging, so the tiles' meadow converges on the identical colour
  // the near ground shows, and the handoff at the detail horizon is
  // invisible by construction. ?grassbake=off keeps the legacy flat tint.
  const grassBake = renderLayerDisabled('grassbake') ? null : getGrassGroundBake();
  // Distant-zone atmosphere: whether the biome haze field exists is decided
  // once, before the material compiles, so a tier without one is byte-identical.
  const zoneHaze = hasBiomeHazeField();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFarCut = farCut;
    shader.uniforms.uFarNightFloor = farNightFloor;
    if (grassBake) shader.uniforms.uGrassBake = { value: grassBake.texture };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec2 vFarXZ;${
          grassBake ? '\nattribute float aGrassW;\nvarying float vGrassW;' : ''
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvFarXZ = (modelMatrix * vec4(position, 1.0)).xz;${
          grassBake ? '\nvGrassW = aGrassW;' : ''
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec2 vFarXZ;\nuniform vec3 uFarCut;\nuniform vec3 uFarNightFloor;${
          grassBake ? '\nvarying float vGrassW;\nuniform sampler2D uGrassBake;' : ''
        }`,
      )
      .replace(
        'void main() {',
        'void main() {\n\tif (distance(vFarXZ, uFarCut.xy) < uFarCut.z) discard;',
      )
      .replace(
        // The deep-night ambient floor (see FAR_NIGHT_FLOOR): albedo-shaped,
        // added where emissive lands so it survives the night light scale.
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += uFarNightFloor * diffuseColor.rgb;',
      );
    if (grassBake) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= mix(vec3(1.0),
          texture2D(uGrassBake, vFarXZ * ${(1 / GRASS_BAKE_PATCH_YARDS).toFixed(6)}).rgb
            * ${GRASS_PAINT_GAIN.toFixed(4)},
          vGrassW);`,
      );
    }
    // Per-zone aerial perspective (biome_haze_field.ts). Self-contained and
    // additive on purpose: its own uniforms, its own two replaces, and it
    // lands immediately before <fog_fragment> so the horizon haze band still
    // owns the rim. The near splat terrain splices the identical snippet on
    // the identical uniforms, which is what keeps the detail-horizon handoff
    // seamless.
    if (zoneHaze) {
      Object.assign(shader.uniforms, biomeHazeUniforms());
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>${BIOME_HAZE_DECLARATIONS}`)
        .replace(
          '#include <fog_fragment>',
          `${biomeHazeFragmentGlsl('vFarXZ')}\n\t#include <fog_fragment>`,
        );
    }
  };

  const sharedIndex = sharedIndexFor(tiles[0].size, plan.spacing);

  const attachTile = (
    tile: FarTile,
    minY: number,
    maxY: number,
    geo: THREE.BufferGeometry,
  ): void => {
    geo.boundingBox = new THREE.Box3(
      new THREE.Vector3(tile.x0, minY, tile.z0),
      new THREE.Vector3(tile.x0 + tile.size, maxY, tile.z0 + tile.size),
    );
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.updateMatrixWorld(true);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    built.push({ tile, mesh });
  };

  const buildAll = async (): Promise<void> => {
    const order = farTileBuildOrder(tiles, priorityPoint?.x ?? 0, priorityPoint?.z ?? 0);
    for (const idx of order) {
      if (cancelled) return;
      const tile = tiles[idx];
      const builder = createFarTileBuilder(tile, plan.spacing, seed);
      for (;;) {
        await idleSlot(FAR_BUILD_TIMEOUT_MS, {
          maxTimeoutDeferrals: FAR_BUILD_TIMEOUT_DEFERRALS,
        });
        if (cancelled) return;
        if (builder.step(FAR_BUILD_ROWS_PER_SLICE)) break;
      }
      const data = builder.result();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
      geo.setAttribute('aGrassW', new THREE.BufferAttribute(data.grassW, 1));
      geo.setIndex(sharedIndex);
      attachTile(tile, data.minY, data.maxY, geo);
    }
  };
  void buildAll();

  return {
    group,
    update(camX, camZ, detailFar, viewFar, outdoor): void {
      group.visible = outdoor;
      if (!outdoor) return;
      farCut.value.set(camX, camZ, Math.max(0, detailFar - FAR_DISCARD_MARGIN));
      for (const b of built) {
        b.mesh.visible = farTileVisible(b.tile, camX, camZ, viewFar);
      }
    },
    cancelStreaming(): void {
      cancelled = true;
    },
    dispose(): void {
      cancelled = true;
      for (const b of built) b.mesh.geometry.dispose();
      built.length = 0;
      material.dispose();
    },
    builtTileCount: () => built.length,
    plannedTileCount: () => tiles.length,
  };
}
