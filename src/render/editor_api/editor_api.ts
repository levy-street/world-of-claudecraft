// The map editor's facade onto the renderer: `renderer.editor`. Every
// editor-facing hook (lens, visibility, authored lighting/weather/skybox,
// sculpt and paint rebuilds, brush, picks, the Studio scene layers) lives here
// instead of on the Renderer class, which hands this facade a narrow host
// (RendererEditorHost) back onto the private state these hooks touch.
//
// The shipped game never calls any of it (editorCam stays null and no
// override is set), so each hook is inert until the editor turns it on. The
// facade also owns the editor-only state the renderer's frame reads back
// (ambienceScale, the residency rect, the parked shadow map, ...).

import * as THREE from 'three';
import { DUNGEON_LIST, getActiveWorldContent } from '../../sim/data';
import type { DungeonLayout } from '../../sim/dungeon_layout';
import { DEFAULT_ASSET_VIEW_DISTANCE } from '../../sim/map_doc';
import { interiorPresentationMode } from '../../sim/map_presentation';
import type { FluidVolume, MapDecal, MapWeather, ZoneDef } from '../../sim/types';
import {
  type AuthoredLightingRig,
  type AuthoredSceneLayers,
  applyOrthographicLens,
  type EditorBirdsConfig,
  EditorShadowCache,
  EditorSkybox,
  type EditorVisibility,
  type LightingRigTargets,
  MapWeatherLayers,
  rebuildBirdFlock,
  setRaycasterFromOrthographicLens,
  ZoneAtmosphere,
  type ZoneResidencyRect,
  zoneAllowedByResidencyFilter,
} from '../authored_map';
import type { BattlegroundView } from '../battleground';
import type { BirdsView } from '../birds';
import { refreshCavityPaint } from '../cut_cavity_mesh';
import type { LogicalFrameDrawStats } from '../draw_stats_core';
import type { DungeonInteriors } from '../dungeon';
import type { EditorLightingProfile } from '../editor_lighting';
import { buildFarTerrain, type FarTerrainView } from '../far_terrain';
import type { FarVistaPlan } from '../far_terrain_core';
import type { FoliageView } from '../foliage';
import type { PlacedAssetsView } from '../placed_assets';
import { swapBudgetedLights } from '../point_light_budget';
import { setRenderCategory } from '../renderer_diagnostics';
import { freezeStaticMatrices, freezeStaticSubtreeMatrices } from '../static_matrix';
import { buildTerrain, type TerrainView } from '../terrain';
import { buildWater, type WaterView } from '../water';
import { MIN_OUTDOOR_FOG_FAR } from '../zone_streaming';

/** Editor visibility can extend beyond the shipped fog ceiling, but the
 *  prepared-zone guard still prevents unloaded terrain from being exposed. */
export const EDITOR_MAX_OUTDOOR_FOG_FAR = 4000;

export interface TerrainRegion {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Something the editor invalidates after a terrain or water edit. */
interface Invalidatable {
  invalidate(): void;
}

/**
 * The renderer's private state the editor hooks read and replace. Views the
 * editor rebuilds (terrain, far terrain, water, birds) are accessors so the
 * renderer's own field is what changes.
 */
export interface RendererEditorHost {
  scene(): THREE.Scene;
  camera(): THREE.PerspectiveCamera;
  raycaster(): THREE.Raycaster;
  webgl(): THREE.WebGLRenderer;
  authoredLighting(): AuthoredLightingRig;
  terrain: TerrainView;
  farTerrain: FarTerrainView;
  water: WaterView;
  birds: BirdsView;
  sky(): THREE.Object3D;
  cliffScree(): Invalidatable;
  cityClutter(): Invalidatable;
  foliage(): FoliageView;
  preparedZones(): Set<string>;
  viewLights(): THREE.PointLight[];
  builtInteriors(): Set<string>;
  bgViews(): Map<number, BattlegroundView>;
  blankPresentation(): boolean;
  seed(): number;
  editorActive(): boolean;
  viewport(): { width: number; height: number };
  authoredLayers(): AuthoredSceneLayers | null;
  placedAssets(): PlacedAssetsView | null;
  lightRig(): LightingRigTargets;
  setEnvIntensity(intensity: number): void;
  outdoorFog(): boolean;
  waterRipples(): boolean;
  farVista(): FarVistaPlan;
  playerPos(): { x: number; z: number };
  zones(): readonly ZoneDef[];
  prepareZoneAt(x: number, z: number): Promise<void>;
  resetVisibleZoneCheck(): void;
  viewIds(): Iterable<number>;
  removeView(id: number): void;
  markLightRankDirty(): void;
  /** Prune `stale` from the fire-light registry and adopt `fresh` through the
   *  sink (the renderer owns the registry; this is the only way in). */
  replaceFireLights(stale: ReadonlySet<THREE.PointLight>, fresh: readonly THREE.PointLight[]): void;
  dungeons(): DungeonInteriors | null;
  drawStats(): LogicalFrameDrawStats | null;
  /** Water-simulation passes three's auto-reset dropped last frame. */
  waterSimulationPasses(): number;
}

export class RendererEditorApi {
  // Editor-only lens override (editor_lens.ts): the shared PerspectiveCamera
  // gets a true orthographic projection matrix while the map editor asks.
  private orthographic = false;
  private orthoViewHeight = 100;
  /** The editor's visibility sliders, read by the renderer's fog pass. */
  readonly visibility: EditorVisibility = { distance: 900, haze: 0.25 };
  /** Cosmetic ambience speed (map "world speed"). Scales shader/vfx motion
   *  only; never the sim or actionable timing. */
  ambienceScale = 1;
  /** Maker-chosen placed-asset view distance (yards), capped at the fog. */
  placedAssetViewDistance = DEFAULT_ASSET_VIEW_DISTANCE;
  /** Zone isolate: only zones intersecting this rect may be resident. */
  zoneResidencyFilter: ZoneResidencyRect | null = null;
  /** Map-authored weather: the cloud deck and aurora (map_weather.ts). */
  readonly mapWeather: MapWeatherLayers;
  /** Authored per-zone atmosphere, adopted per zone crossing. */
  readonly zoneAtmosphere: ZoneAtmosphere;
  /** The editor free-cam's parked sun-shadow map (shadow_cache.ts). */
  readonly shadowCache = new EditorShadowCache();
  /** World-editor dungeon mode: per-interior layout overrides. */
  readonly dungeonLayoutOverrides = new Map<string, DungeonLayout>();
  private readonly skybox: EditorSkybox;
  /** The document's authored map lights, while the editor is hosting us. */
  private mapLights: THREE.PointLight[] = [];

  constructor(private readonly host: RendererEditorHost) {
    this.mapWeather = new MapWeatherLayers(host.scene());
    this.skybox = new EditorSkybox(host.scene());
    this.zoneAtmosphere = new ZoneAtmosphere(this);
  }

  // ---- lens --------------------------------------------------------------

  /** Re-apply the orthographic lens (after any updateProjectionMatrix). */
  applyProjection(): void {
    if (!this.host.editorActive() || !this.orthographic) return;
    const { width, height } = this.host.viewport();
    applyOrthographicLens(this.host.camera(), width, height, this.orthoViewHeight);
  }

  /** Editor-only Blender-style perspective/orthographic lens switch. */
  setEditorOrthographic(on: boolean, viewHeight: number): void {
    const nextViewHeight = Math.max(0.02, viewHeight);
    // The editor feeds its lens state from the render loop: rebuilding and
    // inverting an unchanged projection was pure per-frame CPU work.
    const sameHeight = Math.abs(this.orthoViewHeight - nextViewHeight) < 1e-5;
    if (this.orthographic === on && sameHeight) return;
    this.orthographic = on;
    this.orthoViewHeight = nextViewHeight;
    this.host.camera().updateProjectionMatrix();
    this.applyProjection();
  }

  /** Raycaster projection matching the editor lens (the shared camera keeps
   *  its PerspectiveCamera class, so setFromCamera alone would miss it). */
  setRaycasterFromCamera(raycaster: THREE.Raycaster, coords: THREE.Vector2): void {
    if (this.host.editorActive() && this.orthographic) {
      setRaycasterFromOrthographicLens(raycaster, this.host.camera(), coords);
    } else raycaster.setFromCamera(coords, this.host.camera());
  }

  // ---- view and atmosphere -----------------------------------------------

  /** Zone isolate (editor): restrict residency to zones intersecting `rect`, or
   *  null to restore normal streaming. The caller follows with rebuildTerrain(),
   *  which drops already-built terrain outside the rect. */
  setZoneResidencyFilter(rect: ZoneResidencyRect | null): void {
    this.zoneResidencyFilter = rect ? { ...rect } : null;
    this.host.resetVisibleZoneCheck(); // recompute the streaming lane next frame
  }

  /** Configure the editor view without changing production terrain density. */
  setEditorVisibility(profile: EditorVisibility): void {
    const distance = Math.min(EDITOR_MAX_OUTDOOR_FOG_FAR, profile.distance);
    this.visibility.distance = Math.max(MIN_OUTDOOR_FOG_FAR, distance);
    this.visibility.haze = Math.max(0, Math.min(1, profile.haze));
  }

  /** Ambience animation speed (map "world speed"): scales cosmetic motion only
   *  (uTime shaders, water, birds, weather, placed fire), clamped; 1 = shipped. */
  setAmbienceScale(scale: number): void {
    this.ambienceScale = Number.isFinite(scale) ? Math.min(4, Math.max(0.1, scale)) : 1;
    const placed = this.host.placedAssets();
    if (placed) placed.ambienceScale = this.ambienceScale;
  }

  /** Placed-asset view distance (yards from the camera), capped at the fog. */
  setPlacedAssetViewDistance(distance: number): void {
    this.placedAssetViewDistance = Number.isFinite(distance)
      ? Math.min(2000, Math.max(120, distance))
      : DEFAULT_ASSET_VIEW_DISTANCE;
  }

  setEditorWeather(weather: MapWeather | null): void {
    this.mapWeather.set(weather);
  }

  /** Apply an authored lighting profile over the boot rig, or restore the
   *  shipped values with null (authored_map/lighting_rig.ts). Editor, playtest
   *  and an authored map's boot share this path so their lighting matches. */
  setEditorLighting(profile: EditorLightingProfile | null): void {
    const h = this.host;
    const env = h
      .authoredLighting()
      .apply(profile, h.lightRig(), () => h.authoredLayers()?.remarchCavities());
    if (env === null) return;
    h.setEnvIntensity(env);
    this.invalidateShadows();
  }

  /** Editor override for the ambient bird flock (null = the shipped default). */
  setBirdsConfig(cfg: EditorBirdsConfig | null): void {
    const h = this.host;
    h.birds = rebuildBirdFlock(h.scene(), h.birds, h.seed(), cfg);
  }

  /** Editor skybox override (null restores the procedural HDRI dome). */
  setEditorSkybox(url: string | null): void {
    this.skybox.set(url);
  }

  /** Invalidate the zone cache after live editor changes to atmosphere data. */
  refreshEditorAtmosphere(): void {
    this.zoneAtmosphere.refresh();
  }

  /**
   * Editor studio mode (Collision Master): hide every worldly scene dressing,
   * the sky dome, water and birds, so the backdrop gradient reads as a neutral
   * void. The editor viewport pairs this with a hidden terrain group and its own
   * grid floor.
   */
  setEditorStudio(on: boolean): void {
    const h = this.host;
    h.sky().visible = !on && h.outdoorFog();
    h.birds.group.visible = !on && !h.blankPresentation();
    h.water.group.visible =
      !on && interiorPresentationMode(getActiveWorldContent().presentationMode) === null;
    h.authoredLayers()?.setStudioHidden(on);
    // No inhabitants in the studio: drop every live entity view (the blank
    // scratch map's Pale Keeper included) and block re-creation while on.
    if (on) {
      for (const id of [...h.viewIds()]) h.removeView(id);
    }
  }

  // ---- lights, shadows, scene layers -------------------------------------

  /**
   * Hand the document's authored point lights to the SAME budget the game runs
   * (swapBudgetedLights owns the why and the swap rules). Pass the live list on
   * every rebuild of the editor's light group, the empty one included.
   */
  setEditorMapLights(lights: readonly THREE.PointLight[]): void {
    this.mapLights = swapBudgetedLights(this.host.viewLights(), this.mapLights, lights);
    this.host.markLightRankDirty();
  }

  /** Mark the editor's cached shadow map stale, so the next frame re-renders
   *  the shadow pass once. No-op outside the editor free-cam. */
  invalidateShadows(): void {
    this.shadowCache.invalidate();
  }

  /** The painted clutter stamps changed (brush stroke, undo): re-scatter. */
  invalidateCityClutter(): void {
    this.host.cityClutter().invalidate();
  }

  /** Rebuild the procedural grass after a grass-clear brush edit so the
   *  scrubbed tufts vanish (the mask is read when chunks rebuild). */
  rebuildGrass(): void {
    this.host.foliage().rebuildGrass();
    this.invalidateShadows();
  }

  /** Rebuild the fluid-pool surfaces + lights (editor-only; playtest builds
   *  once at boot). Pass `volumes` to render a live editor set. Pool lights
   *  live in the shared ranked budget: the stale set leaves, the rebuilt set
   *  is adopted (hidden until ranked, so the carrier count holds). */
  rebuildFluids(volumes?: readonly FluidVolume[]): void {
    const layers = this.host.authoredLayers();
    if (!layers) return;
    const stale = new Set(layers.fluidSurfaces.lights);
    layers.rebuildFluids(volumes);
    this.host.replaceFireLights(stale, layers.fluidSurfaces.lights);
  }

  /** Re-read the authored ground decals (`list` = the editor's live document). */
  rebuildDecals(list?: readonly MapDecal[]): void {
    this.host.authoredLayers()?.rebuildDecals(list);
  }

  /** Editor picks (the Carve tool's volumetric brushes) raycast these. */
  get caveMeshGroup(): THREE.Group | null {
    return this.host.authoredLayers()?.caveGroup ?? null;
  }
  get carveCavityGroup(): THREE.Group | null {
    return this.host.authoredLayers()?.cavityGroup ?? null;
  }

  /** Triangles drawn in the last logical frame (the editor's stats readout). */
  frameTriangles(): number {
    // Composer tiers keep three's render counter MONOTONIC (info.autoReset is
    // off so the off-screen passes accumulate), so the raw
    // `info.render.triangles` there is a running total that climbs into the
    // billions within minutes; the per-frame delta lives in the draw-stats
    // tracker. Direct tiers read the live post-frame counter, plus the
    // water-simulation passes three's auto-reset dropped (perfStats does the
    // same arithmetic).
    const stats = this.host.drawStats();
    const frame = stats ? stats.currentFrame() : null;
    return frame
      ? frame.triangles
      : this.host.webgl().info.render.triangles + this.host.waterSimulationPasses() * 2;
  }

  // ---- dungeon and battleground modes ------------------------------------

  /** World-editor dungeon mode: override (or clear) the layout an interior
   *  renders with, tearing down every built copy so the lazy per-frame pass
   *  rebuilds it from the new layout. */
  setDungeonLayoutOverride(interior: string, layout: DungeonLayout | null): void {
    if (layout) this.dungeonLayoutOverrides.set(interior, layout);
    else this.dungeonLayoutOverrides.delete(interior);
    const dungeons = this.host.dungeons();
    if (!dungeons) return;
    const built = this.host.builtInteriors();
    for (const key of [...built]) {
      const id = key.slice(0, key.lastIndexOf(':'));
      const keyInterior =
        id === 'arena' ? 'arena' : DUNGEON_LIST.find((d) => d.id === id)?.interior;
      if (keyInterior !== interior) continue;
      dungeons.disposeInterior(key);
      built.delete(key);
    }
  }

  /** Drop every built battleground field so the next sync rebuilds it from the
   *  current layout (after the editor swaps the placements). */
  rebuildBattlegroundViews(): void {
    for (const view of this.host.bgViews().values()) {
      this.host.scene().remove(view.group);
      view.dispose();
    }
    this.host.bgViews().clear();
  }

  // ---- terrain and water --------------------------------------------------

  private pointerRay(clientX: number, clientY: number): THREE.Raycaster {
    const { width, height } = this.host.viewport();
    const ndc = new THREE.Vector2((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1);
    this.host.raycaster().setFromCamera(ndc, this.host.camera());
    return this.host.raycaster();
  }

  /**
   * The point on the DRAWN terrain mesh under the pointer, either face (the
   * Mesh Fix tool aims at the stretched leftover polys of a cut, which are as
   * often seen from inside the cave as from outside). Null when the ray meets
   * no terrain triangle.
   */
  terrainMeshPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const ray = this.pointerRay(clientX, clientY);
    const hits = ray.intersectObjects(this.host.terrain.group.children, false);
    return hits.length > 0 && hits[0].point ? hits[0].point.clone() : null;
  }

  /**
   * Raycast a screen point onto the actual terrain surface (follows sculpted
   * height), returning the world hit point, or null. Falls back to the y=0 plane
   * past the built terrain footprint.
   */
  surfacePoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const ray = this.pointerRay(clientX, clientY);
    const hits = ray.intersectObjects(this.host.terrain.group.children, false);
    // The terrain material is double-sided (its underside draws black), so
    // the raycaster now reports the sheet's BACK faces too: from inside a
    // carve a pointer ray would "land" on the ground overhead. Only a face
    // that faces the ray is a surface.
    const dir = ray.ray.direction;
    const hit = hits.find((h) => h.point && (!h.face || h.face.normal.dot(dir) < 0));
    if (hit?.point) return hit.point.clone();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, pt) ? pt : null;
  }

  /** A new textured swatch or a grown paint grid: put the new paint runtime
   *  onto the live terrain material. False means the material has no paint
   *  path yet and the caller must run the full rebuild. */
  swapPaintLayers(): boolean {
    const verdict = this.host.terrain.refreshPaint();
    if (verdict === 'rebuild') return false;
    refreshCavityPaint();
    this.invalidateShadows();
    return true;
  }

  /**
   * Re-mesh the terrain from the current active world content (after a sculpt or
   * biome-paint edit). With a `region` (world-space bounds of the edit), only the
   * chunks intersecting it re-mesh in place (cheap enough for a live brush drag);
   * the macro normal map is left stale until rebakeTerrainNormals at stroke end.
   * Without one it is the full rebuild (map load): dispose the old chunk
   * geometries and the one shared material (and its build-specific normal map)
   * exactly once, but never the shared splat/detail textures.
   */
  rebuildTerrain(region?: TerrainRegion): void {
    const h = this.host;
    h.cliffScree().invalidate();
    h.cityClutter().invalidate();
    this.invalidateShadows();
    // Painted texture cells ride a live field texture beside the vertex
    // tints; refresh it first so the re-meshed chunks and the fragment paint
    // agree about the stroke that just landed. A grown grid or a changed
    // texture set is swapped onto the live material here; only a material
    // compiled without the paint path forces the full rebuild.
    const paintVerdict = h.terrain.refreshPaint();
    refreshCavityPaint();
    if (region && paintVerdict !== 'rebuild') {
      h.terrain.rebuildRegion(region.minX, region.minZ, region.maxX, region.maxZ);
      h.authoredLayers()?.refreshRegion(region);
      // Grass placed over the old ground goes stale with it: a cut leaves
      // tufts floating over the opening, a sculpt leaves them buried or
      // airborne. Drop just the chunks under the edit; they rebuild lazily.
      h.foliage().rebuildGrassRegion(region.minX, region.minZ, region.maxX, region.maxZ);
      return;
    }
    h.scene().remove(h.terrain.group);
    h.terrain.dispose();
    h.terrain = buildTerrain(h.seed());
    // The full build re-reads the paint (a new runtime): the interiors follow.
    refreshCavityPaint();
    h.terrain.setChunkSwapListener(() => this.invalidateShadows());
    setRenderCategory(h.terrain.group, 'terrain');
    h.scene().add(h.terrain.group);
    freezeStaticSubtreeMatrices(h.terrain.group);
    // Carve interiors and rails follow the same full-replace.
    h.authoredLayers()?.rebuildAfterTerrain();
    // The far-vista mesh samples the same heightfield, so a full rebuild
    // (map load / content swap) replaces it too: dispose the old tiles and
    // their one shared material, then rebuild from the current content.
    h.scene().remove(h.farTerrain.group);
    h.farTerrain.dispose();
    h.farTerrain = buildFarTerrain(h.seed(), h.farVista(), h.playerPos());
    setRenderCategory(h.farTerrain.group, 'terrain');
    h.scene().add(h.farTerrain.group);
    // A full editor rebuild replaces the zone cache along with the geometry.
    // Re-run the same preparation path for every resident zone so the renderer
    // cannot mistake an empty replacement view for an already-ready region.
    // The ACTIVE zone list (an authored map's ids never match the static one),
    // filtered by the isolate rect: this rebuild is also how isolate mode
    // UNLOADS everything outside its zone.
    const residentZones = h
      .zones()
      .filter(
        (zone) =>
          h.preparedZones().has(zone.id) &&
          zoneAllowedByResidencyFilter(this.zoneResidencyFilter, zone),
      );
    h.preparedZones().clear();
    for (const zone of residentZones) {
      void h.prepareZoneAt(zone.hub.x, zone.hub.z);
    }
  }

  /**
   * Rebake the macro normal DataTexture over the edited region (the per-pixel
   * relief that goes stale after a sculpt). Debounce to stroke END in the
   * editor: it re-uploads the texture, so never call it per drag sample.
   */
  rebakeTerrainNormals(region: TerrainRegion): void {
    this.host.terrain.rebakeNormalRegion(region.minX, region.minZ, region.maxX, region.maxZ);
    // The far layer is a static snapshot of the heightfield, so a sculpt or
    // biome paint must invalidate the tiles it intersects or the edit
    // reverts to the old geometry when the camera backs across the detail
    // handoff. Stroke end is the right cadence (this hook), matching the
    // normal rebake's own debounce: never per drag sample.
    this.host.farTerrain.rebuildRegion(region.minX, region.minZ, region.maxX, region.maxZ);
  }

  /**
   * Re-seat the water surface at the ACTIVE waterLevel() and recompute the
   * shoreline depth attribute from the current terrain (after a water-level
   * edit), or only inside `region` after a sculpt stroke (refreshRegion). In
   * place: it never changes which sheets exist, only level/shore/cull.
   */
  rebuildWater(region?: TerrainRegion): void {
    const h = this.host;
    h.cliffScree().invalidate();
    h.cityClutter().invalidate();
    if (region) h.water.refreshRegion(region.minX, region.minZ, region.maxX, region.maxZ);
    else h.water.setLevel();
  }

  /**
   * Full water rebuild: dispose every existing lake mesh and rebuild from the
   * CURRENT `waterBodies()` (declared lake list). Needed after the editor adds,
   * removes, or moves a lake marker: `rebuildWater()` only reseats existing
   * meshes in place, so a moved marker would otherwise leave the water mesh,
   * shader `uCenter`/`uRadius`, and shore-depth attribute at the OLD footprint
   * while the terrain basin itself has already moved.
   */
  rebuildWaterBodies(): void {
    const h = this.host;
    h.cliffScree().invalidate();
    h.cityClutter().invalidate();
    // One group holds every zone plane plus the apron, so detaching it is the
    // whole scene removal; dispose() then releases the geometry, the shared
    // material, and the height-field render targets in one place.
    h.scene().remove(h.water.group);
    h.water.dispose();
    h.water = buildWater(h.seed(), h.webgl());
    setRenderCategory(h.water.group, 'water');
    h.scene().add(h.water.group);
    freezeStaticSubtreeMatrices(h.water.group);
    h.water.setWavesEnabled(h.waterRipples());
    for (const zone of h.zones()) {
      if (!h.preparedZones().has(zone.id)) continue;
      void h.water.ensureZone(zone).then((meshes) => {
        for (const mesh of meshes) freezeStaticMatrices(mesh);
      });
    }
  }

  /** Project the editor brush ring onto the terrain at world (x, z). Uniform
   *  writes only; call per pointer-move. */
  setEditorBrush(x: number, z: number, radius: number, color?: THREE.ColorRepresentation): void {
    this.host.terrain.setBrush(x, z, radius, color);
  }

  /** Hide the editor brush ring. */
  clearEditorBrush(): void {
    this.host.terrain.clearBrush();
  }

  dispose(): void {
    this.skybox.dispose();
  }
}
