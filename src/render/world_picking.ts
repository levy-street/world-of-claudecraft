// Screen-to-world picking (`renderer.picking`), moved out of renderer.ts:
// entity clicks (nameplate health bar, then a direct mesh hit, then the
// forgiving sloppy assist), gather-node clicks, click-to-move ground points,
// and the placed-building movers. Pure presentation: it reads the world and
// the drawn views, never writes either.

import * as THREE from 'three';
import type { IWorld } from '../world_api';
import { resolveGatherNodePick } from './gather_nodes';
import { isProjectedNameplateAnchorVisible } from './nameplate_projection';
import type { PlacedAssetsView } from './placed_assets';
import type { MoverHit } from './placed_movers';
import type { EntityView } from './renderer';
import { nearestSloppyPickId, type SloppyPickCandidate } from './sloppy_pick';
import { resolveWorldDirectPick } from './world_direct_pick';

/** What picking reads from the renderer. */
export interface WorldPickingHost {
  sim(): IWorld;
  camera(): THREE.PerspectiveCamera;
  viewport(): { width: number; height: number };
  views(): ReadonlyMap<number, EntityView>;
  clickTargets(): THREE.Object3D[];
  gatherNodeMeshes(): THREE.Object3D[];
  /** The nameplate painter's health-bar hit, or null. */
  nameplatePick(clientX: number, clientY: number): number | null;
  placedAssets(): PlacedAssetsView | null;
}

export class WorldPicking {
  private readonly raycastNdc = new THREE.Vector2();
  private readonly raycastGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly raycastHit = new THREE.Vector3();
  private readonly raycastHits: THREE.Intersection[] = [];
  private readonly directHitIds: number[] = [];
  // Persistent scratch for the sloppy-pick column build. pick() is also the
  // per-frame hover-cursor path (updateHoverCursor in main.ts), so a fresh array
  // here would be per-frame garbage on every cursor-over-empty-ground frame.
  // Reused like viewCandidates: cleared with .length = 0, grown in place.
  private readonly sloppyCandidates: SloppyPickCandidate[] = [];
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly tmpV3 = new THREE.Vector3();

  constructor(
    private readonly host: WorldPickingHost,
    private readonly raycaster: THREE.Raycaster,
  ) {}

  // Click-to-move (#95): where a screen click meets the ground. Intersects a
  // horizontal plane at the player's foot height, robust on the gentle terrain
  // here and far cheaper than raycasting the terrain mesh.
  groundPoint(clientX: number, clientY: number, planeY: number): { x: number; z: number } | null {
    this.raycastNdc.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.raycastNdc, this.host.camera());
    this.raycastGroundPlane.constant = -planeY;
    return this.raycaster.ray.intersectPlane(this.raycastGroundPlane, this.raycastHit)
      ? { x: this.raycastHit.x, z: this.raycastHit.z }
      : null;
  }

  /** The moving part of a placed building under the cursor (the bank's vault
   *  door), with the world point hit, or null. */
  pickPlacedMover(clientX: number, clientY: number): MoverHit | null {
    const view = this.host.placedAssets();
    if (!view) return null;
    const { width, height } = this.host.viewport();
    this.raycastNdc.set((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1);
    this.raycaster.setFromCamera(this.raycastNdc, this.host.camera());
    const far = this.raycaster.far;
    this.raycaster.far = 80;
    const hit = view.pickMover(this.raycaster);
    this.raycaster.far = far;
    return hit;
  }

  /** Work a picked mover: open it if shut, shut it if open. */
  togglePlacedMover(id: number): void {
    this.host.placedAssets()?.toggleMover(id);
  }

  // Click/tap-to-harvest (#1866): raycasts the static gather-node meshes
  // (`gatherNodeMeshes`, with per-instance ids in src/render/gather_nodes.ts)
  // and returns the hit node's content id, or null.
  // A separate method from `pick()` on purpose: nodes are static content keyed
  // by string id, not entities keyed by numeric id, so widening `pick()`'s
  // return contract would force every existing caller to re-discriminate.
  pickGatherNode(clientX: number, clientY: number): string | null {
    const { width, height } = this.host.viewport();
    this.raycastNdc.set((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1);
    this.raycaster.setFromCamera(this.raycastNdc, this.host.camera());
    const hits = this.raycastHits;
    hits.length = 0;
    this.raycaster.intersectObjects(this.host.gatherNodeMeshes(), true, hits);
    const result = resolveGatherNodePick(hits);
    hits.length = 0;
    return result;
  }

  pick(clientX: number, clientY: number, attackIntent = false): number | null {
    const direct = this.pickDirect(clientX, clientY, attackIntent);
    if (direct !== null) return direct;
    return this.pickSloppy(clientX, clientY);
  }

  // The direct half of pick(): a visible nameplate health bar or an entity mesh.
  // Split out so gather-node callers can slot their raycast before pickSloppy.
  pickDirect(clientX: number, clientY: number, attackIntent = false): number | null {
    const nameplate = this.host.nameplatePick(clientX, clientY);
    if (nameplate !== null) return nameplate;
    const { width, height } = this.host.viewport();
    this.raycastNdc.set((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1);
    this.raycaster.setFromCamera(this.raycastNdc, this.host.camera());
    const sim = this.host.sim();
    const views = this.host.views();
    const hits = this.raycastHits;
    hits.length = 0;
    this.raycaster.intersectObjects(this.host.clickTargets(), true, this.raycastHits);
    const directHitIds = this.directHitIds;
    directHitIds.length = 0;
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        if (o.userData.entityId !== undefined && o.userData.entityId !== sim.playerId) {
          const id = o.userData.entityId as number;
          // a hidden view is not clickable: the player cannot see it, and its
          // matrixWorld is frozen while hidden (the rig gate in sync), so a hit
          // against it would be a ghost hitbox at the hide-time position
          const hitView = views.get(id);
          if (hitView && !hitView.group.visible) break;
          const e = sim.entities.get(id);
          // The graveyard angel is hidden from the living, so it must not be
          // click-pickable either (the capsule proxy ignores `visible`): skip it
          // unless the local player is a released spirit.
          if (e?.templateId === 'spirit_healer' && !sim.player?.ghost) break;
          directHitIds.push(id);
          break;
        }
        o = o.parent;
      }
    }
    hits.length = 0;
    if (directHitIds.length === 0) return null;
    return resolveWorldDirectPick(directHitIds, sim, this.raycaster.ray, attackIntent);
  }

  // The forgiving-assist half of pick(): snap to the nearest targetable
  // character within a small screen radius when nothing was hit directly.
  pickSloppy(clientX: number, clientY: number): number | null {
    // Forgiving assist: nothing under the ray, so snap to the nearest
    // targetable character within a small screen radius, chibi proportions
    // and melee scrums (often hidden behind the player's own model) make
    // precise capsule clicks fiddly. Objects (doors/loot) still need a
    // direct hit; the local player never competes for the click.
    //
    // Each candidate is a vertical screen COLUMN from the body midpoint up to an
    // overhead anchor a touch above the head (the +1.0 the chat-bubble path uses;
    // slightly higher than the nameplate's own NAMEPLATE_ANCHOR_LIFT of 0.8, which
    // with the 26px radius just helps the column reach the floating name text).
    // So a click on the floating name (what a healer does to target a party
    // member) registers on its owner instead of falling outside a body-only radius.
    const SLOPPY_PICK_PX = 26;
    const sim = this.host.sim();
    const camera = this.host.camera();
    const viewport = this.host.viewport();
    const candidates = this.sloppyCandidates;
    candidates.length = 0;
    for (const [id, v] of this.host.views()) {
      if (id === sim.playerId || !v.visual || !v.group.visible) continue;
      const e = sim.entities.get(id);
      if (!e || (e.kind === 'mob' && e.dead && !e.lootable)) continue;
      // A lying corpse (dead + lootable) has no upright body: collapse its sloppy
      // column to a ground-level point so a near-eye click above/behind the flat
      // body no longer snaps to it (issue 1486). Like the flattened pick proxy, this
      // sheds the upright column; the exact drop is approximate (a ground-level
      // anchor inside the 26px assist radius is all this path needs), not a parity
      // match of the proxy's min(standHeight, radius*2) height.
      const dead = !!e.dead;
      // body midpoint anchor (also the in-front-of-camera cull); ground-hug if dead
      this.tmpV.copy(v.group.position);
      this.tmpV.y += v.height * v.liveScale * (dead ? 0.15 : 0.5);
      this.tmpV.project(camera);
      if (this.tmpV.z > 1) continue;
      const midX = (this.tmpV.x * 0.5 + 0.5) * viewport.width;
      const midY = (-this.tmpV.y * 0.5 + 0.5) * viewport.height;
      // Overhead anchor (the +1.0 chat-bubble offset, see the note above).
      // Collapse the column to the body point if the anchor is not safely in
      // front of the camera: a point behind the near plane projects to bogus
      // screen coords that could steal an unrelated click (close / first-person
      // camera puts the head behind the near plane). Same guard the real
      // nameplate path uses before trusting its projection. A dead corpse has no
      // overhead column at all, so keep top == mid (the ground point).
      let topX = midX;
      let topY = midY;
      if (!dead) {
        this.tmpV2.copy(v.group.position);
        this.tmpV2.y += (v.height + v.mountLift) * e.scale + 1.0;
        if (isProjectedNameplateAnchorVisible(camera, this.tmpV2, this.tmpV3)) {
          this.tmpV2.project(camera);
          if (this.tmpV2.z <= 1) {
            topX = (this.tmpV2.x * 0.5 + 0.5) * viewport.width;
            topY = (-this.tmpV2.y * 0.5 + 0.5) * viewport.height;
          }
        }
      }
      candidates.push({ id, midX, midY, topX, topY });
    }
    return nearestSloppyPickId(clientX, clientY, candidates, SLOPPY_PICK_PX);
  }
}
