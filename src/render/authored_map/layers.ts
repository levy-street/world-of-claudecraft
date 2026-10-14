// The authored-map scene layers the shipped world never builds: cave tubes
// (and the shader cutouts that hole the ground above them), boolean CARVE
// interiors, spline railways, fluid pools and ground decals. Moved out of
// renderer.ts. Each is an empty group on a map without that content, so the
// built-in world pays a handful of empty scene nodes and nothing per frame
// beyond a few early-outs.

import type * as THREE from 'three';
import type { FluidVolume, MapDecal } from '../../sim/types';
import { buildCaveMeshes, refreshCaveMeshes } from '../cave_mesh';
import { updateCaveTubeVisibility } from '../cave_tube_lod';
import {
  buildCutCavityMeshes,
  refreshCutCavityMeshes,
  updateCutCavityLod,
} from '../cut_cavity_mesh';
import { Decals } from '../decals';
import { FluidSurfaces } from '../fluid_surfaces';
import { buildRailTracks, disposeRailTracks } from '../rail_tracks';
import { setRenderCategory } from '../renderer_diagnostics';
import type { Vfx } from '../vfx';

export interface TerrainRegion {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export class AuthoredSceneLayers {
  /** Authored cave tunnels: terrain-independent tubes plus the shader cutouts
   *  that hole the ground above them (cave_mesh.ts). */
  caveGroup: THREE.Group;
  /** Boolean CARVE interiors (cut_cavity_mesh.ts): rooms and tunnels meshed
   *  from the same carve field the sim stands on. */
  cavityGroup: THREE.Group;
  /** Spline railways (WorldContent.rails), rebuilt with the cave group. */
  private railGroup: THREE.Group;
  /** Authored fluid pools (fluid_surfaces.ts): their own surfaces + lights,
   *  separate from the world's lakes. */
  readonly fluidSurfaces: FluidSurfaces;
  /** Authored ground decals: their own streamed group, meshed per camera
   *  position (render/decals.ts). */
  private decals: Decals | null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly seed: number,
  ) {
    this.caveGroup = buildCaveMeshes();
    setRenderCategory(this.caveGroup, 'terrain');
    scene.add(this.caveGroup);
    this.cavityGroup = buildCutCavityMeshes(seed);
    setRenderCategory(this.cavityGroup, 'terrain');
    scene.add(this.cavityGroup);
    this.railGroup = this.buildRails();
    this.fluidSurfaces = new FluidSurfaces(seed);
    setRenderCategory(this.fluidSurfaces.group, 'water');
    scene.add(this.fluidSurfaces.group);
    this.decals = new Decals(seed);
    setRenderCategory(this.decals.group, 'decals');
    scene.add(this.decals.group);
  }

  private buildRails(): THREE.Group {
    const group = buildRailTracks(this.seed);
    setRenderCategory(group, 'props');
    this.scene.add(group);
    return group;
  }

  /** Stream the decal meshes around the camera (the terrain's own cadence). */
  updateDecals(camX: number, camZ: number, fogFar: number): void {
    this.decals?.update(camX, camZ, fogFar);
  }

  /** Authored fluid pools run on the map's cosmetic ambience clock, not the
   *  sim clock: a map's "world speed" scales their motion with everything else. */
  updateFluids(scaledDt: number, camX: number, camZ: number, vfx: Vfx): void {
    this.fluidSurfaces.update(scaledDt, camX, camZ, vfx);
  }

  /** Cave tubes draw only near the camera (render/cave_tube_lod.ts): a mine
   *  under a mountain is invisible from outside except at its mouths. Carve
   *  interiors mesh fine only near the camera; far columns drop to a few
   *  triangles. Budgeted, nearest-first, a few tiles per frame (shadows are
   *  parked for interiors, so nothing to invalidate). */
  updateLod(camX: number, camZ: number): void {
    updateCaveTubeVisibility(this.caveGroup, camX, camZ);
    updateCutCavityLod(this.cavityGroup, this.seed, camX, camZ);
  }

  /** A sculpted region: the cave shells hole the ground they pass under, so
   *  they have to re-cut or the tunnel mouth seals over; the carve interiors
   *  re-mesh with them. */
  refreshRegion(region: TerrainRegion): void {
    refreshCaveMeshes(this.caveGroup, region);
    refreshCutCavityMeshes(this.cavityGroup, this.seed, region);
  }

  /** A full terrain rebuild: carve interiors follow the same full-replace
   *  (the content, or seed, the old tiles were extracted against is gone),
   *  and the rails rebuild with them. */
  rebuildAfterTerrain(): void {
    this.scene.remove(this.cavityGroup);
    this.cavityGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.cavityGroup = buildCutCavityMeshes(this.seed);
    setRenderCategory(this.cavityGroup, 'terrain');
    this.scene.add(this.cavityGroup);
    this.scene.remove(this.railGroup);
    disposeRailTracks(this.railGroup);
    this.railGroup = this.buildRails();
  }

  /** The cave brightness is baked into the cavity vertices: re-march every
   *  carved tile when it moves (the bake cache drops with them). */
  remarchCavities(): void {
    refreshCutCavityMeshes(this.cavityGroup, this.seed, null);
  }

  /** Editor studio mode hides every authored layer but the rails. */
  setStudioHidden(on: boolean): void {
    this.fluidSurfaces.group.visible = !on;
    if (this.decals) this.decals.group.visible = !on;
    this.caveGroup.visible = !on;
    this.cavityGroup.visible = !on;
  }

  /** Rebuild the fluid-pool surfaces + lights (editor-only; playtest builds
   *  once at boot). Pass `volumes` to render a live editor set; omit to read
   *  the active world's fluids. The caller prunes and re-adopts the lights. */
  rebuildFluids(volumes?: readonly FluidVolume[]): void {
    this.fluidSurfaces.rebuild(volumes);
  }

  /** Re-read the authored ground decals. Pass `list` to render the editor's
   *  live document; omit to read the active world's decals. Resident meshes are
   *  dropped and re-streamed against the camera on the next frame. */
  rebuildDecals(list?: readonly MapDecal[]): void {
    this.decals?.rebuild(list);
  }

  /** Decal meshes and their ref-counted texture holds (the holds are what free
   *  the art's VRAM; dropping the meshes alone would leak them). */
  dispose(): void {
    this.decals?.dispose();
    this.decals = null;
  }
}
