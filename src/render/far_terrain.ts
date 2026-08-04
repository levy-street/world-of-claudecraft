// The far-vista terrain painter: a whole-world coarse mesh (one standard
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
  createFarTileBuilder,
  type FarTile,
  type FarVistaPlan,
  farGridIndices,
  farGridSide,
  farTileBuildOrder,
  farTileVisible,
  planFarTiles,
} from './far_terrain_core';
import { idleSlot } from './idle_queue';

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

// An idle-paced build slice: about the same per-slice budget the near
// terrain's streamed chunk builds use (IDLE_GEOMETRY_SLICE_MS scale). A
// 960u tile row is ~100 terrainHeight samples, roughly half a millisecond.
const FAR_BUILD_ROWS_PER_SLICE = 12;
const FAR_BUILD_TIMEOUT_MS = 200;

// Fragments closer than (detailFar - margin) are discarded: inside the
// detail envelope the real terrain owns every pixel, and on steep ridges
// the coarse mesh's chord error is far larger than any fixed vertical drop
// could hide (the sealed walls rise 60 units inside one far-mesh cell). The
// margin keeps a covered overlap band so the handoff never opens a seam:
// near chunks stay visible out to detailFar itself.
const FAR_DISCARD_MARGIN = 60;

interface BuiltFarTile {
  tile: FarTile;
  index: number;
  mesh: THREE.Mesh;
}

export interface FarTerrainView {
  group: THREE.Group;
  /** Per-frame visibility: the layer shows only outdoors; tiles beyond the
   *  view envelope hide; near-field fragments discard against detailFar. */
  update(camX: number, camZ: number, detailFar: number, viewFar: number, outdoor: boolean): void;
  /** Re-sample the tiles intersecting an edited region (editor sculpt /
   *  biome paint), idle-paced and coalesced: repeated calls for one tile
   *  queue it once. Call at stroke END, never per drag sample. */
  rebuildRegion(minX: number, minZ: number, maxX: number, maxZ: number): void;
  /** Stops the in-flight background build (call before discarding). */
  cancelStreaming(): void;
  /** Dispose every built tile geometry and the one shared material. */
  dispose(): void;
  /** Build progress for the renderer's readiness gate and diagnostics:
   *  built tiles / planned tiles. A queued region rebuild does NOT drop a
   *  tile from the built count (the stale mesh stands until its
   *  replacement geometry is ready, never a hole). */
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
      rebuildRegion: () => {},
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
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFarCut = farCut;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFarXZ;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvFarXZ = (modelMatrix * vec4(position, 1.0)).xz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vFarXZ;\nuniform vec3 uFarCut;',
      )
      .replace(
        'void main() {',
        'void main() {\n\tif (distance(vFarXZ, uFarCut.xy) < uFarCut.z) discard;',
      );
  };

  const sharedIndex = sharedIndexFor(tiles[0].size, plan.spacing);

  // A tile's geometry data, built in idle-paced slices.
  const buildTileData = async (
    tile: FarTile,
  ): Promise<{
    geo: THREE.BufferGeometry;
    minY: number;
    maxY: number;
  } | null> => {
    const builder = createFarTileBuilder(tile, plan.spacing, seed);
    for (;;) {
      await idleSlot(FAR_BUILD_TIMEOUT_MS);
      if (cancelled) return null;
      if (builder.step(FAR_BUILD_ROWS_PER_SLICE)) break;
    }
    const data = builder.result();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geo.setIndex(sharedIndex);
    return { geo, minY: data.minY, maxY: data.maxY };
  };

  const frameTileGeo = (tile: FarTile, minY: number, maxY: number, geo: THREE.BufferGeometry) => {
    geo.boundingBox = new THREE.Box3(
      new THREE.Vector3(tile.x0, minY, tile.z0),
      new THREE.Vector3(tile.x0 + tile.size, maxY, tile.z0 + tile.size),
    );
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
  };

  const attachTile = (
    tile: FarTile,
    index: number,
    minY: number,
    maxY: number,
    geo: THREE.BufferGeometry,
  ): void => {
    frameTileGeo(tile, minY, maxY, geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.updateMatrixWorld(true);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    built.push({ tile, index, mesh });
  };

  // Editor invalidation: tiles queued for a re-sample after a region edit.
  // A Set coalesces repeat edits of one tile; the drain loop runs one tile
  // at a time on the same idle pacing as the initial build. The stale mesh
  // stays attached until its replacement geometry is complete, so the far
  // field never opens a hole (and the renderer's readiness gate never
  // drops for a region rebuild).
  const pendingRebuild = new Set<number>();
  let draining = false;
  const drainRebuilds = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        if (cancelled) return;
        // Only tiles the built list can see are drainable NOW. A queued
        // tile still mid-initial-build must stay queued (deleting it here
        // would race the attach and strand a torn tile); the attach check
        // in buildAll re-kicks the drain once it lands.
        const next = [...pendingRebuild].find((i) => built.some((b) => b.index === i));
        if (next === undefined) return;
        pendingRebuild.delete(next);
        const entry = built.find((b) => b.index === next);
        if (!entry) continue;
        const data = await buildTileData(entry.tile);
        if (!data) return;
        entry.mesh.geometry.dispose();
        entry.mesh.geometry = data.geo;
        frameTileGeo(entry.tile, data.minY, data.maxY, data.geo);
      }
    } finally {
      draining = false;
    }
  };

  let buildingIndex = -1;
  const buildAll = async (): Promise<void> => {
    const order = farTileBuildOrder(tiles, priorityPoint?.x ?? 0, priorityPoint?.z ?? 0);
    for (const idx of order) {
      if (cancelled) return;
      buildingIndex = idx;
      const data = await buildTileData(tiles[idx]);
      if (!data) return;
      attachTile(tiles[idx], idx, data.minY, data.maxY, data.geo);
      // An edit that landed while this tile was mid-slice sampled a torn
      // mix of old and new heights; its queued entry re-samples it now
      // that the built list can see it.
      if (pendingRebuild.has(idx)) void drainRebuilds();
    }
    buildingIndex = -1;
    if (pendingRebuild.size > 0) void drainRebuilds();
  };
  void buildAll();

  const tileIntersects = (tile: FarTile, minX: number, minZ: number, maxX: number, maxZ: number) =>
    tile.x0 <= maxX &&
    tile.x0 + tile.size >= minX &&
    tile.z0 <= maxZ &&
    tile.z0 + tile.size >= minZ;

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
    rebuildRegion(minX, minZ, maxX, maxZ): void {
      // The crest-preserving sampler reaches half a cell around a vertex
      // and the normals one more cell, so pad the edit by two spacings to
      // catch every tile whose surface the edit can influence.
      const pad = plan.spacing * 2;
      for (let i = 0; i < tiles.length; i++) {
        if (!tileIntersects(tiles[i], minX - pad, minZ - pad, maxX + pad, maxZ + pad)) continue;
        const isBuilt = built.some((b) => b.index === i);
        // Queue built tiles, and the one currently mid-build (its slices
        // may have sampled a torn mix; buildAll re-drains it on attach).
        // Skip tiles the initial build has not reached: they will sample
        // the edited heightfield when their turn comes.
        if (isBuilt || i === buildingIndex) pendingRebuild.add(i);
      }
      if (pendingRebuild.size > 0) void drainRebuilds();
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
