// The far-vista terrain painter: a whole-world coarse mesh (one standard
// material, about a dozen frustum-culled tiles) drawn beyond the classic
// detail envelope so the horizon shows the real world. With the outdoor
// fog removed this layer IS the draw distance: every ridge to the world
// rim renders from anywhere. All decisions live in far_terrain_core.ts
// (pure, Node-tested); this file only owns the Three objects and the
// cooperative build loop.
//
// Cost model: the tiles are static world-space geometry built once per
// session (well under a second of terrainHeight sampling, spread across
// bounded time-budgeted slices, nearest tiles first; the entry curtain
// accelerates the whole grid so the vista stands before the first visible
// frame, see accelerateInitialBuild). Per frame the layer costs one visibility
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
import { stoneDetailNormal } from './detail_normals';
import {
  advanceWithinBudget,
  createFarTileBuilder,
  FAR_DETAIL_GRAIN,
  FAR_DETAIL_NORMAL,
  FAR_DETAIL_YARDS,
  type FarTile,
  type FarVistaPlan,
  farGridIndices,
  farGridSide,
  farTileBuildOrder,
  farTileVisible,
  planFarTiles,
} from './far_terrain_core';
import { GFX } from './gfx';
import { getGrassGroundBake } from './grass_ground_bake';
import { type IdleSlotResult, idleSlot } from './idle_queue';
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

// Build pacing: every slice is a bounded TIME bite (advanceWithinBudget in
// the core holds the law), never a row count. A row costs microseconds on
// most ground but up to ~8ms where the color recipe stacks (measured), so a
// fixed 12-row slice could block a frame for tens of milliseconds; a clock
// budget cannot.
//
// Two modes:
// - Polite (default; editor rebuilds, any leftover after entry): waits for
//   real idle time but forces a small bite every FAR_BUILD_TIMEOUT_MS under
//   sustained load, so a busy client still finishes the whole grid in
//   seconds instead of parking behind an idle policy that never fires
//   (Safari has no requestIdleCallback at all, and a loaded production
//   boot grants Chrome none either).
// - Eager (accelerateInitialBuild, the opaque-curtain boot and graphics
//   rebuild paths): plain macrotask turns with a bigger bite. Nobody is
//   watching frames behind the curtain, and the whole grid is well under a
//   second of CPU, so it completes while the loading screen is still
//   waiting on the network.
const FAR_BUILD_SLICE_BUDGET_MS = 3;
const FAR_BUILD_EAGER_SLICE_BUDGET_MS = 12;
const FAR_BUILD_TIMEOUT_MS = 50;

/** How long an entry curtain may hold for the far grid before giving up and
 *  falling back to the classic eased fog flip (a pathological device must
 *  never hold the player at the loading screen for the horizon). */
export const FAR_VISTA_ENTRY_MAX_WAIT_MS = 4000;

/** One macrotask turn: the eager lane's yield. setTimeout, not a
 *  MessageChannel ping, on purpose: message tasks outrank timer tasks in
 *  Chrome's scheduler, so a message-paced pump could starve the loading
 *  pipeline's own timer chains; timer-paced turns interleave fairly. */
const nextMacrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Injectable timer pair so the gate's timeout arm is Node-testable. */
export interface FarVistaGateTimers {
  set(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clear(handle: ReturnType<typeof setTimeout>): void;
}

/**
 * The bounded entry gate over an initial-build promise: true when the build
 * settles first, false when `maxWaitMs` elapses first (the caller falls back
 * to the classic eased flip). The losing timer is always cleared, so a
 * resolved gate leaves no armed timeout behind. Both arms are pinned by
 * far_terrain_view.test.ts; Renderer.farVistaReady is a thin consumer.
 */
export function farVistaGate(
  build: Promise<void>,
  maxWaitMs: number,
  // Wrapped, not extracted: a bare setTimeout reference invoked as a method
  // carries the wrong receiver and throws Illegal invocation in browsers.
  timers: FarVistaGateTimers = {
    set: (callback, ms) => setTimeout(callback, ms),
    clear: (handle) => clearTimeout(handle),
  },
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const handle = timers.set(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, maxWaitMs);
    void build.then(() => {
      if (settled) return;
      settled = true;
      timers.clear(handle);
      resolve(true);
    });
  });
}

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

/**
 * What the vista's ALBEDO is multiplied by at deepest night, the other half of
 * the same problem the floor above solves and the opposite symptom.
 *
 * The grade's ambient half (hemisphere plus IBL) deliberately holds a high
 * night floor (day_night_core.ts NIGHT_AMBIENT_FLOOR) because that is what
 * keeps terrain shape and body silhouettes readable underfoot. Out on the
 * vista the same floor lands on large high-albedo faces (snow caps, pale rim
 * rock) which are almost entirely ambient-lit, so they held roughly two thirds
 * of their DAY brightness against a sky graded down to a deep navy: distant
 * peaks read as glowing cutouts pasted over the night, the single loudest
 * "the far terrain ignores the day/night cycle" tell.
 *
 * A flat albedo multiply is the right shape for the fix: every light term
 * except the emissive floor multiplies albedo, so sun, hemisphere and IBL all
 * come down together and the surface keeps its light-and-shade RATIO (dimming
 * the ambient alone would flatten the shading it exists to preserve). The
 * night floor is applied after this and is albedo-shaped, so it scales with it
 * and keeps its relative say against the lit terms.
 *
 * Cosmetic and gameplay-neutral by construction: this material only ever draws
 * past the detail envelope (see FAR_DISCARD_MARGIN), where no actionable
 * information lives; the near terrain a player reads is untouched.
 */
const FAR_NIGHT_ALBEDO_DIM = 0.5;
const farNightDim = { value: 1 };

/** Per-frame, from the renderer's day/night update: scales the moonlit ambient
 *  floor and the night albedo dim with how deep into night the cycle sits.
 *  Both are the identity by day, so the day frame is byte-identical. */
export function setFarTerrainNightGrade(nightAmt: number): void {
  farNightFloor.value.setRGB(
    FAR_NIGHT_FLOOR[0] * nightAmt,
    FAR_NIGHT_FLOOR[1] * nightAmt,
    FAR_NIGHT_FLOOR[2] * nightAmt,
  );
  farNightDim.value = 1 - (1 - FAR_NIGHT_ALBEDO_DIM) * nightAmt;
}

/** The night-grade uniforms and their endpoints, for tests/far_terrain_night.
 *  The uniform objects are the live ones every tile's material shares, so a
 *  test reads exactly what a fragment would. */
export const farTerrainNightInternalsForTest = {
  farNightFloor,
  farNightDim,
  FAR_NIGHT_FLOOR,
  FAR_NIGHT_ALBEDO_DIM,
};

export interface FarTerrainView {
  group: THREE.Group;
  /** Per-frame visibility: the layer shows only outdoors; tiles beyond the
   *  view envelope hide; near-field fragments discard against detailFar. */
  update(camX: number, camZ: number, detailFar: number, viewFar: number, outdoor: boolean): void;
  /** Re-sample the tiles intersecting an edited region (editor sculpt /
   *  biome paint), idle-paced and coalesced: repeated calls for one tile
   *  queue it once. Call at stroke END, never per drag sample. */
  rebuildRegion(minX: number, minZ: number, maxX: number, maxZ: number): void;
  /** Switch the in-flight initial build to eager macrotask pacing (the
   *  opaque-curtain entry paths call this; it never applies to later editor
   *  rebuilds) and resolve once every planned tile is attached. Resolves
   *  immediately when the plan is disabled, the build is already complete,
   *  or streaming was cancelled; idempotent. */
  accelerateInitialBuild(): Promise<void>;
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

  // ?farvista=off takes the WHOLE coarse layer out, which is the one A/B that
  // answers "is that smooth thing on the mountain this layer or the real
  // terrain" in a single look. Same arm as a tier that never enables the vista,
  // so the horizon past the detail envelope simply ends.
  if (!plan.enabled || renderLayerDisabled('farvista')) {
    return {
      group,
      update: () => {},
      rebuildRegion: () => {},
      accelerateInitialBuild: () => Promise.resolve(),
      cancelStreaming: () => {
        cancelled = true;
      },
      dispose: () => {},
      builtTileCount: () => 0,
      plannedTileCount: () => 0,
    };
  }

  // Eager-lane state: accelerateInitialBuild flips the mode AND wakes a
  // build loop parked on an idle slot (the race below), so acceleration
  // takes effect immediately rather than after whatever grant the idle
  // scheduler still owes. Waiters resolve when the initial build settles
  // (complete or cancelled), never per tile.
  let eagerInitialBuild = false;
  let signalEagerKick: () => void = () => {};
  const eagerKick = new Promise<void>((resolve) => {
    signalEagerKick = resolve;
  });
  let initialBuildSettled = false;
  const initialBuildWaiters: Array<() => void> = [];
  const settleInitialBuild = (): void => {
    if (initialBuildSettled) return;
    initialBuildSettled = true;
    // The eager lane is boot-only: once the grid stands, later editor
    // rebuilds pace politely whatever the entry path requested.
    eagerInitialBuild = false;
    for (const waiter of initialBuildWaiters.splice(0)) waiter();
  };

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
  // The near-field discard (see FAR_DISCARD_MARGIN). One vec3 per frame:
  // camera xz plus the cutoff radius. The mesh's own HEIGHT is what guarantees
  // it sits under the near terrain now (far_surface_core.ts bakes a per-vertex
  // clearance at build time), so the vertex stage reads nothing here and the
  // guarantee holds at every distance instead of across one tuned band.
  const farCut = { value: new THREE.Vector3(0, 0, 0) };
  // Meadow-continuum ground paint: the far tiles multiply the SAME baked
  // blade texture the near splat terrain paints with, at the same true
  // world scale and the same constructed gain, gated by the per-vertex
  // grass weight (aGrassW). No distance term anywhere: the mip chain does
  // the averaging, so the tiles' meadow converges on the identical colour
  // the near ground shows, and the handoff at the detail horizon is
  // invisible by construction. ?grassbake=off keeps the legacy flat tint.
  const grassBake = renderLayerDisabled('grassbake') ? null : getGrassGroundBake();
  // Rock surface detail (see FAR_DETAIL_*): the shared terrain rock normal, the
  // same file detail_normals.ts already preloads for the stone families, so this
  // costs one extra sampler and no extra fetch. That texture's own repeat and
  // offset are irrelevant here, because the sample is taken at WORLD scale from
  // vFarXZ rather than through three's uv transform.
  //
  // It arrives on a deferred preload, so it can still be null when this material
  // compiles. The arm is therefore decided at compile time (tier, plus the
  // ?fardetail=off A/B) while the TEXTURE fills in later through a shared
  // uniform, behind an amount that stays 0 until it lands: sampling a null
  // sampler binds three's white placeholder, which would read as one constant
  // tilt over the entire world instead of as nothing.
  const detailArm = GFX.standardMaterials && !renderLayerDisabled('fardetail');
  const farDetail: { value: THREE.Texture | null } = { value: null };
  const farDetailAmt = { value: 0 };
  // Distant-zone atmosphere: whether the biome haze field exists is decided
  // once, before the material compiles, so a tier without one is byte-identical.
  const zoneHaze = hasBiomeHazeField();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFarCut = farCut;
    shader.uniforms.uFarNightFloor = farNightFloor;
    shader.uniforms.uFarNightDim = farNightDim;
    if (detailArm) {
      shader.uniforms.uFarDetail = farDetail;
      shader.uniforms.uFarDetailAmt = farDetailAmt;
    }
    if (grassBake) shader.uniforms.uGrassBake = { value: grassBake.texture };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec2 vFarXZ;${
          grassBake ? '\nattribute float aGrassW;\nvarying float vGrassW;' : ''
        }`,
      )
      .replace(
        // The overlap-band sink (farOverlapSink, whose Node twin pins this
        // curve). Inside the band the real terrain draws too, and this mesh is
        // biased upward to protect ridge silhouettes, so without the sink it
        // wins the depth test and drapes a smooth skin over the real hillside.
        // Only `transformed` moves: vFarXZ stays the true world xz, so colour,
        // grass paint and haze are all sampled exactly as before, and outside
        // the band the sink is zero and the surface is untouched.
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vFarXZ = (modelMatrix * vec4(position, 1.0)).xz;${
          grassBake ? '\n        vGrassW = aGrassW;' : ''
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec2 vFarXZ;\nuniform vec3 uFarCut;\nuniform vec3 uFarNightFloor;\nuniform float uFarNightDim;${
          detailArm ? '\nuniform sampler2D uFarDetail;\nuniform float uFarDetailAmt;' : ''
        }${grassBake ? '\nvarying float vGrassW;\nuniform sampler2D uGrassBake;' : ''}`,
      )
      .replace(
        'void main() {',
        'void main() {\n\tif (distance(vFarXZ, uFarCut.xy) < uFarCut.z) discard;',
      )
      .replace(
        // Everything that shapes ALBEDO, in one patch and in this order: the
        // meadow-continuum ground paint, then the night dim (see
        // FAR_NIGHT_ALBEDO_DIM), so the dim always lands on the final ground
        // colour whether or not the bake is present. One replace rather than a
        // second pass over the same anchor: chaining two replaces of
        // <color_fragment> only works because the anchor survives inside the
        // first replacement, which is a trap for whoever adds the third.
        '#include <color_fragment>',
        `#include <color_fragment>${
          detailArm
            ? `
        // Rock surface detail, sampled at world scale (see FAR_DETAIL_*). Taken
        // HERE, before the shading normal is resolved, so the normal patch below
        // reuses this one fetch instead of taking a second.
        vec3 wocFarRN = texture2D(uFarDetail, vFarXZ * ${(1 / FAR_DETAIL_YARDS).toFixed(6)}).xyz * 2.0 - 1.0;
        float wocFarGrain = clamp(0.5 + 0.5 * (wocFarRN.x + wocFarRN.y), 0.0, 1.0);
        diffuseColor.rgb *= mix(1.0,
          mix(${(1 - FAR_DETAIL_GRAIN).toFixed(4)}, ${(1 + FAR_DETAIL_GRAIN).toFixed(4)}, wocFarGrain),
          uFarDetailAmt);`
            : ''
        }${
          grassBake
            ? `
        // Gated on the weight being non-zero rather than multiplied by it: at
        // vGrassW 0 the mix below is exactly vec3(1.0), so skipping it is
        // pixel-identical, and the vista's zero-weight regions are the ones
        // that fill the most of it (every rock face past the slope threshold,
        // every full shore band). The gate is a varying, so it is not
        // wave-uniform, but it is strongly wave-COHERENT: grass weight varies
        // over whole hillsides, not per fragment.
        if (vGrassW > 0.0) {
          diffuseColor.rgb *= mix(vec3(1.0),
            texture2D(uGrassBake, vFarXZ * ${(1 / GRASS_BAKE_PATCH_YARDS).toFixed(6)}).rgb
              * ${GRASS_PAINT_GAIN.toFixed(4)},
            vGrassW);
        }`
            : ''
        }
        diffuseColor.rgb *= uFarNightDim;`,
      )
      .replace(
        // Tilt the SHADING normal by the same detail sample. This is the half
        // that stops the vista reading as plastic: flat-shaded coarse triangles
        // take one light value each however good the albedo is, and rock is
        // legible mostly through the break-up of its shading. Perturbed in world
        // space and rotated into view space (three declares viewMatrix in the
        // fragment stage), because the sample's tangent frame here IS world up:
        // the texture is projected down the y axis.
        '#include <normal_fragment_begin>',
        detailArm
          ? `#include <normal_fragment_begin>
        normal = normalize(normal + (viewMatrix
          * vec4(wocFarRN.x, 0.0, wocFarRN.y, 0.0)).xyz
          * (${FAR_DETAIL_NORMAL.toFixed(4)} * uFarDetailAmt));`
          : '#include <normal_fragment_begin>',
      )
      .replace(
        // The deep-night ambient floor (see FAR_NIGHT_FLOOR): albedo-shaped,
        // added where emissive lands so it survives the night light scale.
        // Shaped by the DIMMED albedo above, so the floor keeps the same
        // relative say against the lit terms after dark that it was tuned for.
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += uFarNightFloor * diffuseColor.rgb;',
      );
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

  // A tile's geometry data, built in time-budgeted cooperative slices.
  const buildTileData = async (
    tile: FarTile,
  ): Promise<{
    geo: THREE.BufferGeometry;
    minY: number;
    maxY: number;
  } | null> => {
    const builder = createFarTileBuilder(tile, plan.spacing, seed);
    for (;;) {
      let budgetMs = FAR_BUILD_EAGER_SLICE_BUDGET_MS;
      if (eagerInitialBuild) {
        await nextMacrotask();
      } else {
        // Race the idle wait against the eager kick so an entry curtain
        // that accelerates mid-wait is not held to the pending grant. Once
        // the initial build has settled the kick promise stays resolved, so
        // post-settle work (editor drains) must NOT race it: a resolved
        // kick would turn every polite wait into a hot microtask spin.
        const slot: IdleSlotResult | null = initialBuildSettled
          ? await idleSlot(FAR_BUILD_TIMEOUT_MS, {})
          : await Promise.race([idleSlot(FAR_BUILD_TIMEOUT_MS, {}), eagerKick.then(() => null)]);
        if (slot !== null) {
          // Real idle time is free, take what the browser granted (capped
          // at the eager bite); a forced timeout slot means the host is
          // busy, so take only the small polite bite.
          budgetMs =
            slot.source === 'idle'
              ? Math.min(
                  FAR_BUILD_EAGER_SLICE_BUDGET_MS,
                  Math.max(FAR_BUILD_SLICE_BUDGET_MS, slot.timeRemainingMs),
                )
              : FAR_BUILD_SLICE_BUDGET_MS;
        }
      }
      if (cancelled) return null;
      if (
        advanceWithinBudget(
          () => builder.step(1),
          budgetMs,
          () => performance.now(),
        )
      )
        break;
    }
    const data = builder.result();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geo.setAttribute('aGrassW', new THREE.BufferAttribute(data.grassW, 1));
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
  void buildAll().finally(settleInitialBuild);

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
      // The rock detail arrives on a deferred preload, so adopt it on the first
      // frame it exists and then never look again. Zero-cost steady state: one
      // null check per frame, and the amount gates the shader until then.
      if (detailArm && farDetail.value === null) {
        const tex = stoneDetailNormal();
        if (tex) {
          farDetail.value = tex;
          farDetailAmt.value = 1;
        }
      }
      farCut.value.set(camX, camZ, Math.max(0, detailFar - FAR_DISCARD_MARGIN));
      for (const b of built) {
        b.mesh.visible = farTileVisible(b.tile, camX, camZ, viewFar);
      }
    },
    rebuildRegion(minX, minZ, maxX, maxZ): void {
      // A vertex's clearance is measured over the cells one spacing out and
      // its normal reads one cell further still, so pad the edit by two
      // spacings to catch every tile whose surface the edit can influence.
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
    accelerateInitialBuild(): Promise<void> {
      if (initialBuildSettled || cancelled) return Promise.resolve();
      eagerInitialBuild = true;
      signalEagerKick();
      return new Promise((resolve) => initialBuildWaiters.push(resolve));
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
