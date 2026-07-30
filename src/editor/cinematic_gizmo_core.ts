// Pure violation evaluation and viewport geometry for the editor Cinematic
// panel. The selected scene, fixed scrub frame, and injected world queries are
// the complete input, so forward and backward seeks produce identical output.

import {
  type HarborDeckRiderResolution,
  resolveHarborDeckRider,
} from '../render/harbor_deck_rider_core';
import { composeHarborShipAttachFrame } from '../render/harbor_ship_attach_core';
import { HARBORS, type HarborDef } from '../sim/harbor_layout';
import {
  add,
  attachmentLocalToWorld,
  cameraGeometry,
  DEG_PER_RAD,
  deckStandInPoint,
  dot,
  ENTITY_SUPPORT_EPSILON_YARDS,
  evaluateEntitySupport,
  evaluateFraming,
  HARBOR_HULL_FOOTPRINTS,
  HORIZONTAL_HALF_FOV_RAD,
  HULL_INTERSECTION_EPSILON_YARDS,
  hullWorldCollision,
  length,
  MAX_SUBJECT_FRAME_HEIGHT_PERCENT,
  MIN_SUBJECT_FRAME_HEIGHT_PERCENT,
  RIDER_DECK_EDGE_EPSILON_YARDS,
  riderDeckViolation,
  scale,
  shipTarget,
  subtract,
  supportSurfacesAt,
  VERTICAL_HALF_FOV_RAD,
  type Violation,
} from '../sim/scenes/lint_core';
import type { SceneDef, SceneOpDef } from '../sim/scenes/registry';
import type { SceneAttachFrame, SceneRigPoint } from '../sim/types';
import type { CinematicPropCue, CinematicScrubFrame } from './cinematic_scrub_core';

const SUPPORT_RAY_ORIGIN_HEIGHT_YARDS = 1.5;
const MIN_FRAMING_BOUNDS_DEPTH_YARDS = 0.25;
const TIME_EPSILON_SECONDS = 1e-7;

export type CinematicGizmoState = 'neutral' | 'violation';

export interface CinematicHullGizmo {
  readonly kind: 'hull';
  readonly state: CinematicGizmoState;
  readonly center: SceneRigPoint;
  readonly size: SceneRigPoint;
  readonly yaw: number;
}

export interface CinematicSupportGizmo {
  readonly kind: 'support';
  readonly state: CinematicGizmoState;
  readonly from: SceneRigPoint;
  readonly to: SceneRigPoint;
  readonly label: string;
}

export interface CinematicFramingGizmo {
  readonly kind: 'framing';
  readonly state: CinematicGizmoState;
  readonly camera: SceneRigPoint;
  readonly corners: readonly [SceneRigPoint, SceneRigPoint, SceneRigPoint, SceneRigPoint];
}

export type CinematicGizmo = CinematicHullGizmo | CinematicSupportGizmo | CinematicFramingGizmo;

export interface CinematicGizmoEntity {
  readonly key: string;
  readonly label: string;
  readonly point: SceneRigPoint;
  readonly riderHarborId?: HarborDef['id'];
}

export interface CinematicGizmoWorld {
  readonly seed: number;
  readonly waterLevel: number;
  readonly entities: readonly CinematicGizmoEntity[];
  terrainHeight(x: number, z: number, seed: number): number;
}

export interface CinematicGizmoFrame {
  readonly gizmos: readonly CinematicGizmo[];
  readonly violations: readonly Violation[];
}

interface ActiveShip {
  readonly harbor: HarborDef;
  readonly cue: CinematicPropCue;
  readonly frame: SceneAttachFrame;
  readonly context: OpContext;
}

interface OpContext {
  readonly index: number;
  readonly kind: string;
}

export function gizmoState(violating: boolean): CinematicGizmoState {
  return violating ? 'violation' : 'neutral';
}

export function cinematicGizmoActorIds(scene: SceneDef): ReadonlySet<string> {
  const actorIds = new Set<string>();
  for (const op of scene.ops) {
    if (op.kind === 'line' && op.speakerActorId !== undefined) {
      actorIds.add(op.speakerActorId);
    }
    if (op.kind === 'actorMove' || op.kind === 'actorFace' || op.kind === 'anim') {
      actorIds.add(op.actorId);
    }
    if (op.kind !== 'camera' || op.shot.kind === 'release' || op.shot.kind === 'attach') {
      continue;
    }
    if (op.shot.kind === 'focus' && op.shot.actorId !== undefined) {
      actorIds.add(op.shot.actorId);
    }
    if (op.shot.kind === 'dolly' && op.shot.lookAt.kind === 'subject') {
      actorIds.add(op.shot.lookAt.actorId);
    }
  }
  return actorIds;
}

export function evaluateCinematicGizmoFrame(
  scene: SceneDef,
  scrub: CinematicScrubFrame,
  world: CinematicGizmoWorld,
): CinematicGizmoFrame {
  const gizmos: CinematicGizmo[] = [];
  const violations: Violation[] = [];
  const activeShips = activeShipFrames(scene, scrub, world.waterLevel);
  const activeFrameByHarbor = new Map(activeShips.map((ship) => [ship.harbor.id, ship.frame]));
  const shipFrameAt = (harbor: HarborDef): SceneAttachFrame =>
    activeFrameByHarbor.get(harbor.id) ?? parkedShipFrame(harbor, world.waterLevel);

  for (const ship of activeShips) {
    const collision = hullWorldCollision(ship.harbor, ship.frame, world.seed, {
      terrainHeight: world.terrainHeight,
      waterLevel: world.waterLevel,
    });
    gizmos.push(hullGizmo(ship.harbor, ship.frame, gizmoState(collision !== null)));
    if (collision) {
      violations.push({
        sceneId: scene.id,
        check: 'collision.hull',
        opIndex: ship.context.index,
        opKind: ship.context.kind,
        time: scrub.timeSec,
        threshold: `no penetration beyond ${HULL_INTERSECTION_EPSILON_YARDS.toFixed(
          2,
        )} yd into pier decks, ramps, terrain, or the water floor`,
        measured: `${ship.harbor.id} hull penetrates ${collision.label} by ${collision.penetration.toFixed(
          2,
        )} yd`,
      });
    }
  }

  const currentContext = contextAt(scene, scrub.timeSec);
  const supportEntities: CinematicGizmoEntity[] = [...world.entities];
  for (const ship of activeShips) {
    supportEntities.push({
      key: `stand-in:${ship.harbor.id}`,
      label: `${ship.harbor.id} deck stand-in`,
      point: deckStandInPoint(ship.harbor, ship.frame, world.waterLevel),
      riderHarborId: ship.harbor.id,
    });
  }

  for (const entity of supportEntities) {
    const activeRiderShip =
      entity.riderHarborId === undefined
        ? undefined
        : activeShips.find((ship) => ship.harbor.id === entity.riderHarborId);
    const context = activeRiderShip?.context ?? currentContext;
    const point = presentedEntityPoint(entity, activeRiderShip, world.waterLevel);
    const support = evaluateEntitySupport(
      point,
      supportSurfacesAt(point, world.seed, {
        terrainHeight: world.terrainHeight,
        waterLevel: world.waterLevel,
        shipFrameAt,
      }),
    );
    const riderMeasured = activeRiderShip
      ? riderDeckViolation(
          entity.label,
          activeRiderShip.harbor,
          activeRiderShip.frame,
          point,
          world.waterLevel,
        )
      : null;
    const violating = !support.passing || riderMeasured !== null;
    gizmos.push({
      kind: 'support',
      state: gizmoState(violating),
      from: {
        x: point.x,
        y: point.y + SUPPORT_RAY_ORIGIN_HEIGHT_YARDS,
        z: point.z,
      },
      to: { x: point.x, y: support.nearest.y, z: point.z },
      label: entity.label,
    });
    if (!support.passing) {
      violations.push({
        sceneId: scene.id,
        check: 'support.entity',
        opIndex: context.index,
        opKind: context.kind,
        time: scrub.timeSec,
        threshold: `every presentation entity within ${ENTITY_SUPPORT_EPSILON_YARDS.toFixed(
          2,
        )} yd of terrain, a pier or ramp, or a displaced ship deck`,
        measured: `${entity.label} is ${Math.abs(support.gap).toFixed(2)} yd ${
          support.gap >= 0 ? 'above' : 'below'
        } ${support.nearest.label}`,
      });
    }
    if (riderMeasured && activeRiderShip) {
      violations.push({
        sceneId: scene.id,
        check: 'containment.rider',
        opIndex: activeRiderShip.context.index,
        opKind: activeRiderShip.context.kind,
        time: scrub.timeSec,
        threshold: `rider centers inside displaced deck bounds within ${RIDER_DECK_EDGE_EPSILON_YARDS.toFixed(
          2,
        )} yd and feet within ${ENTITY_SUPPORT_EPSILON_YARDS.toFixed(2)} yd of deck`,
        measured: riderMeasured,
      });
    }
  }

  if (scrub.camera && scrub.subject) {
    const cameraContext = activeCameraContext(scene, scrub.timeSec);
    if (cameraContext) {
      const geometry = cameraGeometry(scrub.camera.position, scrub.camera.target);
      const framing = evaluateFraming(geometry, scrub.subject);
      const violating = !framing.sizePassing || !framing.directionPassing;
      gizmos.push(framingGizmo(geometry, scrub.subject, gizmoState(violating)));
      if (!framing.sizePassing) {
        violations.push({
          sceneId: scene.id,
          check: 'framing.size',
          opIndex: cameraContext.index,
          opKind: cameraContext.kind,
          time: scrub.timeSec,
          threshold: `${MIN_SUBJECT_FRAME_HEIGHT_PERCENT.toFixed(
            1,
          )}% to ${MAX_SUBJECT_FRAME_HEIGHT_PERCENT.toFixed(1)}% of frame height`,
          measured: `${framing.frameHeightPercent.toFixed(2)}%`,
        });
      }
      if (!framing.directionPassing) {
        violations.push({
          sceneId: scene.id,
          check: 'framing.direction',
          opIndex: cameraContext.index,
          opKind: cameraContext.kind,
          time: scrub.timeSec,
          threshold: `subject direction within horizontal ${(
            HORIZONTAL_HALF_FOV_RAD * DEG_PER_RAD
          ).toFixed(1)} deg and vertical ${(VERTICAL_HALF_FOV_RAD * DEG_PER_RAD).toFixed(
            1,
          )} deg half extents`,
          measured: `horizontal ${(framing.projected.horizontal * DEG_PER_RAD).toFixed(
            1,
          )} deg, vertical ${(framing.projected.vertical * DEG_PER_RAD).toFixed(
            1,
          )} deg, depth ${framing.projected.depth.toFixed(3)}`,
        });
      }
    }
  }

  return { gizmos, violations };
}

export function hullGizmo(
  harbor: HarborDef,
  frame: SceneAttachFrame,
  state: CinematicGizmoState,
): CinematicHullGizmo {
  const footprint = HARBOR_HULL_FOOTPRINTS[harbor.id];
  return {
    kind: 'hull',
    state,
    center: attachmentLocalToWorld(frame, {
      x: footprint.x,
      y: (footprint.bottomY + footprint.topY) / 2,
      z: footprint.z,
    }),
    size: {
      x: footprint.hw * 2,
      y: footprint.topY - footprint.bottomY,
      z: footprint.hd * 2,
    },
    yaw: frame.yaw,
  };
}

export function framingGizmo(
  geometry: ReturnType<typeof cameraGeometry>,
  subject: SceneRigPoint,
  state: CinematicGizmoState,
): CinematicFramingGizmo {
  const subjectDelta = subtract(subject, geometry.camera);
  const forwardDepth = dot(subjectDelta, geometry.forward);
  const depth = Math.max(
    MIN_FRAMING_BOUNDS_DEPTH_YARDS,
    forwardDepth > 0 ? forwardDepth : length(subjectDelta),
  );
  const center = add(geometry.camera, scale(geometry.forward, depth));
  const halfWidth = Math.tan(HORIZONTAL_HALF_FOV_RAD) * depth;
  const halfHeight = Math.tan(VERTICAL_HALF_FOV_RAD) * depth;
  const left = scale(geometry.right, -halfWidth);
  const right = scale(geometry.right, halfWidth);
  const up = scale(geometry.up, halfHeight);
  const down = scale(geometry.up, -halfHeight);
  return {
    kind: 'framing',
    state,
    camera: { ...geometry.camera },
    corners: [
      add(add(center, left), up),
      add(add(center, right), up),
      add(add(center, right), down),
      add(add(center, left), down),
    ],
  };
}

function activeShipFrames(
  scene: SceneDef,
  scrub: CinematicScrubFrame,
  waterLevel: number,
): ActiveShip[] {
  const active: ActiveShip[] = [];
  for (const cue of scrub.propCues) {
    const harbor = HARBORS.find((candidate) => shipTarget(candidate) === cue.target);
    if (!harbor) continue;
    active.push({
      harbor,
      cue,
      frame: shipFrameForCue(harbor, cue, waterLevel),
      context: propContext(scene, cue),
    });
  }
  return active;
}

function shipFrameForCue(
  harbor: HarborDef,
  cue: CinematicPropCue,
  waterLevel: number,
): SceneAttachFrame {
  return composeHarborShipAttachFrame(
    {
      baseX: harbor.berth.x,
      baseY: waterLevel - harbor.berth.draft,
      baseZ: harbor.berth.z,
      baseRot: harbor.berth.rot,
    },
    cue.pose,
    { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
  );
}

function parkedShipFrame(harbor: HarborDef, waterLevel: number): SceneAttachFrame {
  return composeHarborShipAttachFrame(
    {
      baseX: harbor.berth.x,
      baseY: waterLevel - harbor.berth.draft,
      baseZ: harbor.berth.z,
      baseRot: harbor.berth.rot,
    },
    null,
    { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
  );
}

function presentedEntityPoint(
  entity: CinematicGizmoEntity,
  activeShip: ActiveShip | undefined,
  waterLevel: number,
): SceneRigPoint {
  if (!activeShip) return entity.point;
  const resolution: HarborDeckRiderResolution = {
    entityId: 0,
    target: '',
    mode: 'none',
    x: entity.point.x,
    y: entity.point.y,
    z: entity.point.z,
    yaw: 0,
  };
  resolveHarborDeckRider(
    {
      entityId: 0,
      x: entity.point.x,
      y: entity.point.y,
      z: entity.point.z,
      yaw: 0,
      midInteraction: false,
    },
    [
      {
        target: shipTarget(activeShip.harbor),
        baseX: activeShip.harbor.berth.x,
        baseY: waterLevel - activeShip.harbor.berth.draft,
        baseZ: activeShip.harbor.berth.z,
        baseRot: activeShip.harbor.berth.rot,
        frame: activeShip.frame,
        shipDecks: activeShip.harbor.shipDecks,
        displaced: true,
      },
    ],
    resolution,
  );
  return { x: resolution.x, y: resolution.y, z: resolution.z };
}

function propContext(scene: SceneDef, cue: CinematicPropCue): OpContext {
  for (let index = scene.ops.length - 1; index >= 0; index--) {
    const op = scene.ops[index];
    if (
      op.kind === 'prop' &&
      op.target === cue.target &&
      op.cue === cue.cue &&
      Math.abs(op.at - cue.startedAt) <= TIME_EPSILON_SECONDS
    ) {
      return { index: index + 1, kind: authoredOpKind(op) };
    }
  }
  return contextAt(scene, cue.startedAt);
}

function activeCameraContext(scene: SceneDef, timeSec: number): OpContext | null {
  for (let index = scene.ops.length - 1; index >= 0; index--) {
    const op = scene.ops[index];
    if (op.at > timeSec + TIME_EPSILON_SECONDS || op.kind !== 'camera') continue;
    return op.shot.kind === 'release' ? null : { index: index + 1, kind: authoredOpKind(op) };
  }
  return null;
}

function contextAt(scene: SceneDef, timeSec: number): OpContext {
  for (let index = scene.ops.length - 1; index >= 0; index--) {
    const op = scene.ops[index];
    if (op.at <= timeSec + TIME_EPSILON_SECONDS) {
      return { index: index + 1, kind: authoredOpKind(op) };
    }
  }
  return { index: 0, kind: 'start' };
}

function authoredOpKind(op: SceneOpDef): string {
  return op.kind === 'camera' ? `camera/${op.shot.kind}` : op.kind;
}
