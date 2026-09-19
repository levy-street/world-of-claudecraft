// One personal drawing, persistent bounded ribbons and guide stars, no models or lights.
// Geometry, contrast and update cadence are identical on every graphics tier.
import * as THREE from 'three';
import { WORLD_QUESTS_BY_ID } from '../sim/data';
import type { WorldQuestDef } from '../sim/types';
import type { IWorld } from '../world_api';
import { attachSceneGroupGated } from './gated_scene_attach';
import type { PublicTraceReader } from './world_quest_public_trace_core';
import { WorldQuestPublicTraceVisual } from './world_quest_public_trace_visual';
import {
  type TraceGuidancePlan,
  type TracePoint,
  type TracePresentation,
  traceCircleInto,
  traceGuidanceInto,
  tracePresentationInto,
  writeTraceRibbon,
  writeTraceSparkles,
} from './world_quest_trace_core';
import { traceRibbonGeometry, worldQuestTraceMaterials } from './world_quest_trace_materials';

/** Marker pool: the largest authored figure (the cross) has twelve vertices. */
const TRACE_CORNER_MARKERS = 12;

export class WorldQuestTraceVisual {
  readonly group = new THREE.Group();
  /** Entry waits for this gate before input can start a timed preview. */
  readonly readyForEntry: Promise<void>;
  private readonly publicTraces: WorldQuestPublicTraceVisual;
  private readonly mats = worldQuestTraceMaterials();
  private readonly outline = this.ribbon('outline', 512, this.mats.gold);
  private readonly trail = this.ribbon('trail', 1024, this.mats.blue);
  private readonly start = this.ribbon('start', 64, this.mats.gold);
  private readonly endpoint = this.ribbon('endpoint', 64, this.mats.red);
  private readonly sparkles = this.ribbon('sparkles', 256, this.mats.gold);
  private readonly nextCorner = this.ribbon('next-corner', 4, this.mats.gold);
  /** One small ring per authored vertex, shown while drawing from memory: the
   *  student keeps the corners (the "points"), never the line between them. */
  private readonly corners = Array.from({ length: TRACE_CORNER_MARKERS }, (_, i) =>
    this.ribbon(`corner-${i}`, 34, this.mats.gold),
  );
  private readonly circle: TracePoint[] = Array.from({ length: 33 }, () => ({ x: 0, z: 0 }));
  private readonly plan: TracePresentation = { state: null, points: null, outline: false };
  private readonly guide: TraceGuidancePlan = {
    visible: false,
    fromX: 0,
    fromZ: 0,
    toX: 0,
    toZ: 0,
  };
  private guideFromX = Number.NaN;
  private guideFromZ = Number.NaN;
  private guideToX = Number.NaN;
  private guideToZ = Number.NaN;
  private shape: readonly TracePoint[] | null = null;
  private shapeIndex = -1;
  private trailCount = -1;
  private tailX = Number.NaN;
  private tailZ = Number.NaN;
  private endpointX = Number.NaN;
  private endpointZ = Number.NaN;
  private disposed = false;

  constructor(
    scene: THREE.Object3D,
    private readonly groundAt: (x: number, z: number) => number,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly definitions: Readonly<Record<string, WorldQuestDef>> = WORLD_QUESTS_BY_ID,
  ) {
    this.group.name = 'world-quest-calligraphy';
    this.publicTraces = new WorldQuestPublicTraceVisual(this.group, groundAt, definitions);
    // All four variants must be present while the construction-time gate scans.
    const warm = new THREE.Mesh(traceRibbonGeometry(1), this.mats.green);
    warm.visible = false;
    this.group.add(warm);
    this.readyForEntry = attachSceneGroupGated(
      scene,
      this.group,
      compileGate,
      () => this.disposed,
    ).catch(() => {});
  }

  private ribbon(name: string, quads: number, material: THREE.MeshBasicMaterial): THREE.Mesh {
    const mesh = new THREE.Mesh(traceRibbonGeometry(quads), material);
    mesh.name = `calligraphy-${name}`;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.userData.renderCategory = 'ui3d';
    this.group.add(mesh);
    return mesh;
  }

  private paint(mesh: THREE.Mesh, points: readonly TracePoint[], width: number, lift = 0.16): void {
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const vertices = writeTraceRibbon(
      position.array as Float32Array,
      points,
      width,
      lift,
      this.groundAt,
    );
    mesh.geometry.setDrawRange(0, vertices);
    position.needsUpdate = true;
  }

  update(world: Pick<IWorld, 'worldQuestLog'> & Partial<PublicTraceReader>): void {
    if (this.disposed) return;
    if (world.entities && world.player) this.publicTraces.update(world as PublicTraceReader);
    tracePresentationInto(this.plan, world.worldQuestLog, this.definitions);
    const state = this.plan.state;
    const points = this.plan.points;
    const roundChanged =
      !!state && !!points && (this.shape !== points || this.shapeIndex !== state.shapeIndex);
    if (roundChanged) this.resetRound();
    traceGuidanceInto(this.guide, state, points);
    // The guide stars and the next-corner marker teach the first figure only; from
    // the second figure on the student draws from memory (the preview outline still
    // shows during memorization, the blue trail still paints the stroke).
    const guided = this.guide.visible && state?.shapeIndex === 0;
    this.sparkles.visible = guided;
    this.nextCorner.visible = guided;
    this.paintGuidance();
    // Corner rings for every figure drawn without stars: the exact points stay
    // visible while the connecting line must come from memory.
    const cornersShown = !!state && !!points && state.phase === 'drawing' && !guided;
    for (let i = 0; i < this.corners.length; i++)
      this.corners[i].visible = cornersShown && i < points.length - 1;
    this.outline.visible = !!state && this.plan.outline;
    this.start.visible = !!state;
    this.trail.visible = !!state && state.phase !== 'preview';
    this.endpoint.visible = state?.phase === 'failed';
    if (!state || !points) {
      this.shape = null;
      this.trailCount = -1;
      return;
    }
    if (roundChanged) {
      this.shape = points;
      this.shapeIndex = state.shapeIndex;
      this.paint(this.outline, points, 0.46);
      traceCircleInto(this.circle, points[0], 0.9);
      this.paint(this.start, this.circle, 0.2);
      for (let i = 0; i < this.corners.length; i++) {
        if (i >= points.length - 1) {
          this.corners[i].geometry.setDrawRange(0, 0);
          continue;
        }
        traceCircleInto(this.circle, points[i], 0.38);
        this.paint(this.corners[i], this.circle, 0.14);
      }
      this.trailCount = -1;
    }
    this.outline.material = state.phase === 'success' ? this.mats.green : this.mats.gold;
    this.start.material = state.phase === 'success' ? this.mats.green : this.mats.gold;
    this.trail.material =
      state.phase === 'failed'
        ? this.mats.red
        : state.phase === 'success'
          ? this.mats.gold
          : this.mats.blue;
    const tail = state.trail[state.trail.length - 1];
    if (
      state.trail.length !== this.trailCount ||
      (tail?.x ?? 0) !== this.tailX ||
      (tail?.z ?? 0) !== this.tailZ
    ) {
      this.paint(this.trail, state.trail, 0.34, 0.2);
      this.trailCount = state.trail.length;
      this.tailX = tail?.x ?? 0;
      this.tailZ = tail?.z ?? 0;
    }
    if (
      this.endpoint.visible &&
      (state.lastPosition.x !== this.endpointX || state.lastPosition.z !== this.endpointZ)
    ) {
      traceCircleInto(this.circle, state.lastPosition, 0.65);
      this.paint(this.endpoint, this.circle, 0.22, 0.22);
      this.endpointX = state.lastPosition.x;
      this.endpointZ = state.lastPosition.z;
    }
  }

  /** New round can share coordinates and even its trail tail with the previous
   * one. Clear every draw range/cache explicitly, never rely on tail equality. */
  private resetRound(): void {
    this.trail.geometry.setDrawRange(0, 0);
    this.endpoint.geometry.setDrawRange(0, 0);
    this.sparkles.geometry.setDrawRange(0, 0);
    this.nextCorner.geometry.setDrawRange(0, 0);
    this.trailCount = -1;
    this.tailX = this.tailZ = this.endpointX = this.endpointZ = Number.NaN;
    this.guideFromX = this.guideFromZ = this.guideToX = this.guideToZ = Number.NaN;
  }

  private paintGuidance(): void {
    const guide = this.guide;
    if (
      !guide.visible ||
      (guide.fromX === this.guideFromX &&
        guide.fromZ === this.guideFromZ &&
        guide.toX === this.guideToX &&
        guide.toZ === this.guideToZ)
    )
      return;
    const stars = this.sparkles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const corner = this.nextCorner.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.sparkles.geometry.setDrawRange(
      0,
      writeTraceSparkles(stars.array as Float32Array, guide, this.groundAt),
    );
    this.nextCorner.geometry.setDrawRange(
      0,
      writeTraceSparkles(corner.array as Float32Array, guide, this.groundAt, true),
    );
    stars.needsUpdate = true;
    corner.needsUpdate = true;
    this.guideFromX = guide.fromX;
    this.guideFromZ = guide.fromZ;
    this.guideToX = guide.toX;
    this.guideToZ = guide.toZ;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.group.clear();
    // Shared material lifetime belongs to the boot prewarm, not an individual renderer.
  }
}
