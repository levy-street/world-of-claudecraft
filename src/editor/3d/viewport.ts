// The 3D in-world editor viewport. Reuses the real game Renderer over a frozen Sim
// built from the editor's CustomMap, drives a free editor camera, and applies edits
// through the Renderer's live editing APIs: chunk-local terrain rebuilds during a
// brush stroke (rebuildTerrain(region)) with a macro-normal rebake at stroke end,
// the shader brush ring (setEditorBrush/clearEditorBrush), live water re-seating
// (rebuildWater), and the PlacedAssetsView instancer for placements
// (add/update/remove/select/footprints/reSeat). This is the DEFAULT editor mode.
// Editor-only (dev tooling); imports the heavy Renderer.
//
// Ownership: the APP owns the document and the ACTIVE WorldContent
// (setActiveWorldContent); this viewport only reads terrain via the active
// content and pushes render updates.

import * as THREE from 'three';
import { assetsReady } from '../../render/assets/preload';
import { type SeatRegion, unionRegion } from '../../render/placed_assets';
import { Renderer } from '../../render/renderer';
import { FENCE_HALF_DEPTH } from '../../sim/colliders';
import { Sim } from '../../sim/sim';
import { type BlockerDef, DT } from '../../sim/types';
import { terrainHeight } from '../../sim/world';
import { type CustomMap, customMapToWorldContent, placementsToRenderAssets } from '../custom_map';
import { EditorCamera } from './editor_camera';

export interface EditRegion {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface Editor3DHooks {
  // The active tool wants left-click/drag for editing (so the viewport must not
  // orbit on the left button). Right-drag always orbits; middle/shift-drag pans.
  toolActive(): boolean;
  // Pointer began/continued/ended an edit over the terrain surface (world x/z).
  onEditStart(world: { x: number; z: number }, ev: PointerEvent): void;
  onEditMove(world: { x: number; z: number }, ev: PointerEvent): void;
  onEditEnd(ev: PointerEvent): void;
  // The cursor moved over the surface (for the brush gizmo); null when off-terrain.
  onHover(world: { x: number; z: number } | null): void;
  // A left-click that did not turn into a drag while no edit tool was active
  // (Select mode picking). Client coords + the terrain point under the cursor.
  onTap(clientX: number, clientY: number, world: { x: number; z: number } | null): void;
  // Direct manipulation of placements in Select mode. When enabled, a left
  // pointerdown on a pickable placement offers the drag to the app; a true
  // return claims it (the app selects the placement) and the viewport streams
  // the terrain point under the cursor until release. A false return falls
  // back to the normal orbit.
  placementDragEnabled(): boolean;
  onPlacementDragStart(index: number): boolean;
  onPlacementDragMove(world: { x: number; z: number }): void;
  onPlacementDragEnd(): void;
  // Shift+wheel (rotate) / Alt+wheel (scale) over the stage while a placement
  // is selected. True consumes the event; false falls through to camera zoom.
  onTransformWheel(kind: 'rotate' | 'scale', deltaY: number): boolean;
}

const SPAWN_RING_COLOR = 0x3fd0ff;
const SPAWN_RING_SEGMENTS = 40;
// Editor-only blocker-wall overlay: translucent boxes over the collision
// segments (the shipped game renders nothing for a blocker). Height is
// presentational; the wall thickness reuses the sim's fence half-depth so the
// drawn box matches the collider exactly.
const BLOCKER_OVERLAY_HEIGHT = 3;
const BLOCKER_COLOR = 0xe0503c;
const TAP_SLOP_PX = 5;
// Hover-cursor pick throttle (Select mode only): the placement raycast is the
// same cost as a tap pick, so cap it well below the pointer-move rate.
const HOVER_PICK_MS = 90;
// Analytic surface pick: march the pointer ray against the sim terrainHeight
// (render terrain == sim height invariant) instead of raycasting every terrain
// chunk per pointer-move. Coarse steps find the crossing; bisection refines it.
const MARCH_MAX_T = 520; // yards along the ray (covers the 220yd max orbit dist)
const MARCH_STEPS = 52;
const MARCH_REFINE = 12;

export class Editor3DViewport {
  private canvas!: HTMLCanvasElement;
  private nameplates!: HTMLDivElement;
  private readonly cam = new EditorCamera();
  private sim: Sim | null = null;
  private renderer: Renderer | null = null;
  private raf = 0;
  private lastT = 0;
  private disposed = false;
  private seed = 20061;
  private map: CustomMap;
  // Bumped by start()/reload()/dispose(); an in-flight start() that awoke with a
  // stale token abandons, so a reload during the assets await never leaves two
  // engines (and two event attachments) running.
  private generation = 0;
  // Visibility gate: while hidden the render loop stops and the edit
  // passthroughs coalesce into dirty flags, flushed on the next setVisible(true).
  private visible = true;
  private hiddenTerrainFull = false;
  private hiddenTerrainRegion: SeatRegion | null = null;
  private hiddenWater = false;
  private hiddenPlacements = false;
  private hiddenSpawn = false;
  // The app's last-told selection, reapplied after a flushed structural rebuild
  // (rebuildAll clears the view's selection).
  private selectedIndex: number | null = null;

  private spawnRing: THREE.Mesh | null = null;
  private spawnPoint: { x: number; z: number } | null = null;
  private readonly spawnMat = new THREE.MeshBasicMaterial({
    color: SPAWN_RING_COLOR,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Blocker-wall overlay (spawnRing ownership pattern: build/refresh/dispose).
  private blockersGroup: THREE.Group | null = null;
  private blockerPreviewMesh: THREE.Mesh | null = null;
  private hiddenBlockers = false;
  private readonly blockerMat = new THREE.MeshBasicMaterial({
    color: BLOCKER_COLOR,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly blockerPreviewMat = new THREE.MeshBasicMaterial({
    color: BLOCKER_COLOR,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly picker = new THREE.Raycaster();
  private readonly pickNdc = new THREE.Vector2(); // scratch, per pointer-move

  // Interaction state.
  private dragMode: 'none' | 'orbit' | 'pan' | 'edit' | 'moveplacement' = 'none';
  private lastPointer = { x: 0, y: 0 };
  private dragDist = 0;
  private lastHoverPickAt = 0;
  private readonly keys = new Set<string>();

  constructor(
    private readonly parent: HTMLElement,
    map: CustomMap,
    private readonly hooks: Editor3DHooks,
  ) {
    this.map = map;
    this.createSurfaces();
  }

  private createSurfaces(): void {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'editor-3d-canvas';
    this.nameplates = document.createElement('div');
    this.nameplates.className = 'editor-3d-nameplates';
    this.parent.append(this.canvas, this.nameplates);
  }

  /**
   * Boot the engine over the ACTIVE world content (the app has already called
   * setActiveWorldContent with a content built from this.map).
   */
  async start(): Promise<void> {
    // Generation token against the double-start race: a reload()/dispose() that
    // lands while we await assets invalidates this run; the loser abandons
    // before building anything (nothing is half-built before the await).
    const gen = ++this.generation;
    if (!this.canvas.isConnected) this.createSurfaces();
    this.seed = this.map.meta.seed;
    const world = customMapToWorldContent(this.map);
    await assetsReady();
    if (this.disposed || gen !== this.generation) return;
    // The live PlacedAssetsView owns placements, so strip them from the Sim's
    // world or the Renderer ctor would build a second, frozen copy.
    this.sim = new Sim({
      seed: this.seed,
      playerClass: 'warrior',
      world: { ...world, placements: undefined },
    });
    this.renderer = new Renderer(this.sim, this.canvas, this.nameplates);
    this.renderer.placedAssets.rebuildAll(placementsToRenderAssets(this.map.placements), true);
    // A fresh build reflects the whole document: drop any hidden-time debts
    // (before the spawn ring below, which must build even while hidden).
    this.clearHiddenWork();
    const start = this.map.playerStart ?? null;
    this.spawnPoint = start ? { x: start.x, z: start.z } : null;
    this.refreshSpawnRing();
    this.rebuildBlockers();
    // Frame the world hub to start.
    const hub = this.map.content.zones[0]?.hub ?? { x: 0, z: 0 };
    this.cam.target.set(hub.x, terrainHeight(hub.x, hub.z, this.seed), hub.z);
    this.attachEvents();
    if (this.visible) {
      this.lastT = performance.now();
      this.loop();
    }
  }

  get ready(): boolean {
    return this.renderer !== null;
  }

  // Terrain point under a cursor position (client coords). Analytic ray-march
  // first (cheap, per pointer-move); the renderer's full terrain-mesh raycast
  // only as a fallback when the march misses (horizon, camera under ground).
  // surfacePoint expects canvas-origin coordinates (the game canvas fills the
  // window; the editor canvas is offset by the top bar + tool rail), so convert.
  surfaceAt(clientX: number, clientY: number): { x: number; z: number } | null {
    if (!this.renderer) return null;
    const marched = this.marchSurface(clientX, clientY);
    if (marched) return marched;
    const r = this.canvas.getBoundingClientRect();
    const p = this.renderer.surfacePoint(clientX - r.left, clientY - r.top);
    return p ? { x: p.x, z: p.z } : null;
  }

  // March the pointer ray against terrainHeight (which the render mesh samples,
  // so the two agree): coarse fixed steps to bracket the first crossing, then a
  // bisection refine. Null when the ray never dips under the terrain in range.
  private marchSurface(clientX: number, clientY: number): { x: number; z: number } | null {
    if (!this.renderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.picker.setFromCamera(this.pickNdc, this.renderer.camera);
    const o = this.picker.ray.origin;
    const d = this.picker.ray.direction;
    if (o.y - terrainHeight(o.x, o.z, this.seed) <= 0) return null; // under ground: fall back
    let prevT = 0;
    for (let i = 1; i <= MARCH_STEPS; i++) {
      const t = (i / MARCH_STEPS) * MARCH_MAX_T;
      const dy = o.y + d.y * t - terrainHeight(o.x + d.x * t, o.z + d.z * t, this.seed);
      if (dy <= 0) {
        let lo = prevT;
        let hi = t;
        for (let j = 0; j < MARCH_REFINE; j++) {
          const mid = (lo + hi) / 2;
          const below =
            o.y + d.y * mid - terrainHeight(o.x + d.x * mid, o.z + d.z * mid, this.seed) <= 0;
          if (below) hi = mid;
          else lo = mid;
        }
        const ft = (lo + hi) / 2;
        return { x: o.x + d.x * ft, z: o.z + d.z * ft };
      }
      prevT = t;
    }
    return null;
  }

  /** True while a pointer drag is navigating (fly keys are live), so the app
   *  suppresses single-key tool shortcuts. */
  isNavigating(): boolean {
    return this.dragMode === 'orbit' || this.dragMode === 'pan';
  }

  /** Current orbit yaw (radians); the app's screen-relative nudges read it. */
  cameraYaw(): number {
    return this.cam.yaw;
  }

  // ---- live edit application -----------------------------------------------

  /** Chunk-local terrain re-mesh over the edited region (cheap; per drag sample). */
  rebuildTerrainRegion(region: EditRegion): void {
    if (!this.visible) {
      this.hiddenTerrainRegion = unionRegion(this.hiddenTerrainRegion, region);
      return;
    }
    this.renderer?.rebuildTerrain(region);
  }

  /** Stroke-end work: macro-normal rebake + re-seat the region's placements and
   *  the spawn ring (region-scoped so a stroke never rescans every placement). */
  finishTerrainStroke(region: EditRegion): void {
    if (!this.visible) {
      this.hiddenTerrainRegion = unionRegion(this.hiddenTerrainRegion, region);
      return;
    }
    if (!this.renderer) return;
    this.renderer.rebakeTerrainNormals(region);
    this.renderer.placedAssets.reSeat(region);
    this.refreshSpawnRing();
    this.rebuildBlockers(); // walls sit on terrainHeight: re-seat after a sculpt
  }

  /** Full terrain rebuild (map load / clear-all / undo of a large batch). */
  rebuildTerrainFull(): void {
    if (!this.visible) {
      this.hiddenTerrainFull = true;
      return;
    }
    if (!this.renderer) return;
    this.renderer.rebuildTerrain();
    this.renderer.rebuildWater();
    this.renderer.placedAssets.reSeat();
    this.refreshSpawnRing();
    this.rebuildBlockers();
  }

  /** Re-seat the water surface at the ACTIVE waterLevel(). */
  rebuildWater(): void {
    if (!this.visible) {
      this.hiddenWater = true;
      return;
    }
    this.renderer?.rebuildWater();
  }

  /** Project the brush ring at world (x, z); pass per pointer-move. */
  setBrush(x: number, z: number, radius: number, color?: number): void {
    this.renderer?.setEditorBrush(x, z, radius, color);
  }

  clearBrush(): void {
    this.renderer?.clearEditorBrush();
  }

  // Placement passthroughs, keyed by the document index (the app keeps document
  // order and view slots in lockstep; bulk structural changes use
  // rebuildPlacements, a single doc removal uses the surgical placementRemoved).
  placementAdded(index: number): void {
    if (!this.visible) {
      this.hiddenPlacements = true;
      return;
    }
    const asset = placementsToRenderAssets([this.map.placements[index]])[0];
    if (asset) this.renderer?.placedAssets.addPlacement(index, asset);
  }

  placementUpdated(
    index: number,
    change: { x?: number; z?: number; rotY?: number; scale?: number; collideRadius?: number },
  ): void {
    if (!this.visible) {
      this.hiddenPlacements = true;
      return;
    }
    this.renderer?.placedAssets.updatePlacement(index, change);
  }

  /** Surgical single removal at a DOCUMENT index: the view drops that slot and
   *  shifts the survivors down by one, without re-cloning every model. */
  placementRemoved(index: number): void {
    if (!this.visible) {
      this.hiddenPlacements = true;
      return;
    }
    this.renderer?.placedAssets.removePlacementAt(index);
  }

  /** Full re-instance (mid-list insert / paste / undo / bulk edits). */
  rebuildPlacements(): void {
    if (!this.visible) {
      this.hiddenPlacements = true;
      return;
    }
    this.renderer?.placedAssets.rebuildAll(placementsToRenderAssets(this.map.placements));
  }

  setSelectedPlacement(index: number | null): void {
    this.selectedIndex = index;
    // A pending hidden structural rebuild means the view's slots are stale:
    // the flush reapplies this selection after its rebuildAll.
    if (!this.visible && this.hiddenPlacements) return;
    this.renderer?.placedAssets.setSelected(index);
  }

  showFootprints(on: boolean): void {
    this.renderer?.placedAssets.showFootprints(on);
  }

  /**
   * Which placement a click lands on: raycast the placed-assets group and take
   * the nearest placement anchor to the hit; fall back to the terrain point.
   * Returns the DOCUMENT index or null.
   */
  pickPlacement(clientX: number, clientY: number): number | null {
    if (!this.renderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.picker.setFromCamera(this.pickNdc, this.renderer.camera);
    const hits = this.picker.intersectObjects(this.renderer.placedAssets.group.children, true);
    let probe: { x: number; z: number } | null = null;
    let slack = 1.5;
    if (hits.length > 0 && hits[0].point) {
      probe = { x: hits[0].point.x, z: hits[0].point.z };
      slack = 4;
    } else {
      probe = this.surfaceAt(clientX, clientY);
    }
    if (!probe) return null;
    let best = -1;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.map.placements.length; i++) {
      const p = this.map.placements[i];
      const dx = probe.x - p.x;
      const dz = probe.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best < 0) return null;
    const maxD = Math.max(slack, (this.map.placements[best].scale || 1) * 2);
    return bestD2 <= maxD * maxD ? best : null;
  }

  // ---- spawn marker ----------------------------------------------------------

  setSpawnMarker(point: { x: number; z: number } | null): void {
    this.spawnPoint = point ? { x: point.x, z: point.z } : null;
    if (!this.visible) {
      this.hiddenSpawn = true;
      return;
    }
    this.refreshSpawnRing();
  }

  private refreshSpawnRing(): void {
    if (!this.renderer) return;
    if (this.spawnRing) {
      this.renderer.scene.remove(this.spawnRing);
      this.spawnRing.geometry.dispose();
      this.spawnRing = null;
    }
    if (!this.spawnPoint) return;
    const { x, z } = this.spawnPoint;
    const radius = 1.6;
    const geo = new THREE.RingGeometry(radius - 0.22, radius, SPAWN_RING_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrainHeight(x + pos.getX(i), z + pos.getZ(i), this.seed) + 0.1);
    }
    geo.computeBoundingSphere();
    this.spawnRing = new THREE.Mesh(geo, this.spawnMat);
    this.spawnRing.position.set(x, 0, z);
    this.spawnRing.renderOrder = 2;
    this.renderer.scene.add(this.spawnRing);
  }

  // ---- blocker walls (editor-only overlay) -----------------------------------

  /** Rebuild the translucent wall boxes from this.map.blockers (any change:
   *  add, erase, undo/redo, map load). Disposes the previous geometries. */
  rebuildBlockers(): void {
    if (!this.visible) {
      this.hiddenBlockers = true;
      return;
    }
    if (!this.renderer) return;
    this.disposeBlockers();
    const blockers = this.map.blockers ?? [];
    if (blockers.length === 0) return;
    const group = new THREE.Group();
    group.name = 'editor-blockers';
    for (const b of blockers) group.add(this.blockerMesh(b, this.blockerMat));
    this.blockersGroup = group;
    this.renderer.scene.add(group);
  }

  /** Live drag preview of the wall being drawn (null clears it). */
  setBlockerPreview(seg: BlockerDef | null): void {
    if (!this.renderer) return;
    if (this.blockerPreviewMesh) {
      this.renderer.scene.remove(this.blockerPreviewMesh);
      this.blockerPreviewMesh.geometry.dispose();
      this.blockerPreviewMesh = null;
    }
    if (!seg) return;
    this.blockerPreviewMesh = this.blockerMesh(seg, this.blockerPreviewMat);
    this.renderer.scene.add(this.blockerPreviewMesh);
  }

  // One box per segment: fence-thick, seated on the terrain at the midpoint,
  // yawed with the same convention the sim's OBB collider uses.
  private blockerMesh(b: BlockerDef, mat: THREE.Material): THREE.Mesh {
    const dx = b.x2 - b.x1;
    const dz = b.z2 - b.z1;
    const len = Math.max(0.1, Math.hypot(dx, dz));
    const geo = new THREE.BoxGeometry(len, BLOCKER_OVERLAY_HEIGHT, FENCE_HALF_DEPTH * 2);
    const mesh = new THREE.Mesh(geo, mat);
    const x = (b.x1 + b.x2) / 2;
    const z = (b.z1 + b.z2) / 2;
    mesh.position.set(x, terrainHeight(x, z, this.seed) + BLOCKER_OVERLAY_HEIGHT / 2, z);
    mesh.rotation.y = Math.atan2(-dz, dx);
    mesh.renderOrder = 2;
    return mesh;
  }

  private disposeBlockers(): void {
    if (this.blockersGroup) {
      this.renderer?.scene.remove(this.blockersGroup);
      for (const child of this.blockersGroup.children) {
        (child as THREE.Mesh).geometry.dispose();
      }
      this.blockersGroup = null;
    }
  }

  // Swap to a different document (load/new/import) without leaking: rebuild the
  // Sim+Renderer since spawns come from the map (and the GL context is replaced).
  // Bumping the generation first abandons any start() still awaiting assets, so
  // a reload during boot can never leave two engines running.
  async reload(map: CustomMap): Promise<void> {
    this.generation++;
    this.map = map;
    this.detachEvents();
    this.teardownEngine();
    await this.start();
  }

  /**
   * Show/hide the viewport. Hidden: the render loop stops (no rAF pending) and
   * the edit passthroughs record dirty flags instead of doing GPU work. Shown:
   * flush the coalesced work, then resume the loop.
   */
  setVisible(v: boolean): void {
    this.parent.style.display = v ? '' : 'none';
    if (v === this.visible) return;
    this.visible = v;
    if (!v) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      return;
    }
    this.flushHiddenWork();
    if (this.renderer) {
      this.lastT = performance.now();
      this.loop();
    }
  }

  /** Apply the edits coalesced while hidden (called on becoming visible). */
  private flushHiddenWork(): void {
    if (!this.renderer) {
      // start() is still pending; it builds from the full document and clears
      // these flags itself.
      return;
    }
    if (this.hiddenTerrainFull) {
      this.hiddenTerrainFull = false;
      this.hiddenTerrainRegion = null;
      this.hiddenWater = false;
      this.hiddenSpawn = false;
      this.rebuildTerrainFull(); // terrain + water + full reSeat + spawn ring
    } else if (this.hiddenTerrainRegion) {
      const region = this.hiddenTerrainRegion;
      this.hiddenTerrainRegion = null;
      this.hiddenSpawn = false;
      this.renderer.rebuildTerrain(region);
      this.renderer.rebakeTerrainNormals(region);
      this.renderer.placedAssets.reSeat(region);
      this.refreshSpawnRing();
    }
    if (this.hiddenWater) {
      this.hiddenWater = false;
      this.renderer.rebuildWater();
    }
    if (this.hiddenPlacements) {
      this.hiddenPlacements = false;
      this.renderer.placedAssets.rebuildAll(placementsToRenderAssets(this.map.placements));
      this.renderer.placedAssets.setSelected(this.selectedIndex);
    }
    if (this.hiddenSpawn) {
      this.hiddenSpawn = false;
      this.refreshSpawnRing();
    }
    if (this.hiddenBlockers) {
      this.hiddenBlockers = false;
      this.rebuildBlockers();
    }
  }

  private clearHiddenWork(): void {
    this.hiddenTerrainFull = false;
    this.hiddenTerrainRegion = null;
    this.hiddenWater = false;
    this.hiddenPlacements = false;
    this.hiddenSpawn = false;
    this.hiddenBlockers = false;
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    cancelAnimationFrame(this.raf);
    this.detachEvents();
    this.teardownEngine();
  }

  // Free the GL context and remove the surfaces. A fresh canvas is needed for a
  // later start() because forceContextLoss() permanently kills this context.
  private teardownEngine(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.renderer) {
      try {
        this.renderer.editorCam = null;
        this.renderer.webgl.setAnimationLoop(null);
        this.renderer.webgl.dispose();
        this.renderer.webgl.forceContextLoss();
      } catch {
        // GL teardown is best-effort.
      }
    }
    this.renderer = null;
    this.sim = null;
    this.spawnRing = null;
    // The scene died with the GL context; just drop the overlay handles.
    this.blockersGroup = null;
    this.blockerPreviewMesh = null;
    this.canvas?.remove();
    this.nameplates?.remove();
  }

  // ---- loop ---------------------------------------------------------------

  private loop = (): void => {
    this.raf = 0;
    if (this.disposed || !this.visible || !this.renderer || !this.sim) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;

    this.applyKeys(dt);
    // Free camera: the target floats; only soft-floor it just above the
    // (possibly sculpted) terrain so it can never dive under the ground.
    const ground = terrainHeight(this.cam.target.x, this.cam.target.z, this.seed);
    if (this.cam.target.y < ground + 0.5) this.cam.target.y = ground + 0.5;
    // Teleport the frozen player (hidden below) to the ground under the camera
    // target so foliage/critter LOD stays populated under the cursor (the
    // renderer re-centers dressing on the player).
    const player = this.sim.player;
    if (player) {
      player.pos.x = this.cam.target.x;
      player.pos.z = this.cam.target.z;
      player.pos.y = ground;
    }
    this.renderer.editorCam = this.cam.pose();
    this.renderer.sync(1, DT, null);
    // The player is an LOD anchor, not editable content: keep its model out of
    // the scene (its view is built lazily by sync, so re-hide every frame).
    if (player) {
      const view = this.renderer.views.get(player.id);
      if (view && view.group.visible) view.group.visible = false;
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private applyKeys(dt: number): void {
    // Fly only while a navigation drag is held: the single-key tool shortcuts
    // (W water, S spawn, E erase, ...) own these keys when the pointer is up.
    if (!this.isNavigating()) return;
    const f = (this.keys.has('w') ? 1 : 0) - (this.keys.has('s') ? 1 : 0);
    const r = (this.keys.has('d') ? 1 : 0) - (this.keys.has('a') ? 1 : 0);
    const u = (this.keys.has('e') ? 1 : 0) - (this.keys.has('q') ? 1 : 0);
    if (f || r || u) this.cam.fly(f, r, u, dt);
  }

  // ---- input --------------------------------------------------------------

  private attachEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private detachEvents(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  private onContext = (e: Event): void => e.preventDefault();

  private onPointerDown = (ev: PointerEvent): void => {
    this.lastPointer = { x: ev.clientX, y: ev.clientY };
    this.dragDist = 0;
    const wantsEdit = ev.button === 0 && this.hooks.toolActive();
    if (wantsEdit) {
      const w = this.surfaceAt(ev.clientX, ev.clientY);
      if (w) {
        this.dragMode = 'edit';
        this.hooks.onEditStart(w, ev);
        this.canvas.setPointerCapture(ev.pointerId);
        return;
      }
    }
    // Select-mode direct move: a left press on a pickable placement starts a
    // drag-move (the app claims it and selects); empty ground orbits as before.
    if (
      ev.button === 0 &&
      !ev.shiftKey &&
      !this.hooks.toolActive() &&
      this.hooks.placementDragEnabled()
    ) {
      const idx = this.pickPlacement(ev.clientX, ev.clientY);
      if (idx !== null && this.hooks.onPlacementDragStart(idx)) {
        this.dragMode = 'moveplacement';
        this.canvas.style.cursor = 'grabbing';
        this.canvas.setPointerCapture(ev.pointerId);
        return;
      }
    }
    // Middle or shift+drag pans; otherwise orbit (left-drag in Select, right-drag always).
    this.dragMode = ev.button === 1 || ev.shiftKey ? 'pan' : 'orbit';
    this.canvas.setPointerCapture(ev.pointerId);
  };

  private onPointerMove = (ev: PointerEvent): void => {
    const dx = ev.clientX - this.lastPointer.x;
    const dy = ev.clientY - this.lastPointer.y;
    this.lastPointer = { x: ev.clientX, y: ev.clientY };
    this.dragDist += Math.abs(dx) + Math.abs(dy);
    if (this.dragMode === 'orbit') this.cam.orbit(dx, dy);
    else if (this.dragMode === 'pan') this.cam.pan(dx, dy);
    else if (this.dragMode === 'edit') {
      const w = this.surfaceAt(ev.clientX, ev.clientY);
      if (w) this.hooks.onEditMove(w, ev);
    } else if (this.dragMode === 'moveplacement') {
      const w = this.surfaceAt(ev.clientX, ev.clientY);
      if (w) this.hooks.onPlacementDragMove(w);
    } else {
      this.hooks.onHover(this.surfaceAt(ev.clientX, ev.clientY));
      this.updateHoverCursor(ev.clientX, ev.clientY);
    }
  };

  /** Grab-cursor feedback over pickable placements (Select mode, throttled). */
  private updateHoverCursor(clientX: number, clientY: number): void {
    if (!this.hooks.placementDragEnabled()) {
      if (this.canvas.style.cursor) this.canvas.style.cursor = '';
      return;
    }
    const now = performance.now();
    if (now - this.lastHoverPickAt < HOVER_PICK_MS) return;
    this.lastHoverPickAt = now;
    const want = this.pickPlacement(clientX, clientY) !== null ? 'grab' : '';
    if (this.canvas.style.cursor !== want) this.canvas.style.cursor = want;
  }

  private onPointerLeave = (): void => {
    if (this.dragMode === 'none') this.hooks.onHover(null);
  };

  private onPointerUp = (ev: PointerEvent): void => {
    if (this.dragMode === 'edit') {
      this.hooks.onEditEnd(ev);
    } else if (this.dragMode === 'moveplacement') {
      this.hooks.onPlacementDragEnd();
      // The pointer is usually still over the moved placement.
      this.canvas.style.cursor = this.hooks.placementDragEnabled() ? 'grab' : '';
    } else if (this.dragMode === 'orbit' && ev.button === 0 && this.dragDist <= TAP_SLOP_PX) {
      // A left tap with no edit tool armed: a Select-mode pick.
      this.hooks.onTap(ev.clientX, ev.clientY, this.surfaceAt(ev.clientX, ev.clientY));
    }
    this.dragMode = 'none';
  };

  private onWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    // Some platforms report Shift+wheel as a horizontal delta.
    const delta = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;
    if (delta === 0) return;
    if (
      (ev.shiftKey || ev.altKey) &&
      this.hooks.onTransformWheel(ev.altKey ? 'scale' : 'rotate', delta)
    ) {
      return;
    }
    this.cam.zoom(delta);
  };

  private onKeyDown = (ev: KeyboardEvent): void => {
    const k = ev.key.toLowerCase();
    if ('wasdqe'.includes(k)) this.keys.add(k);
  };

  private onKeyUp = (ev: KeyboardEvent): void => {
    this.keys.delete(ev.key.toLowerCase());
  };
}
