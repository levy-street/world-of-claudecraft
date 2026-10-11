import type * as THREE from 'three';
import type { Entity } from '../sim/types';
import { worldQuestCaravanForMob } from '../sim/world_quest_caravans';
import {
  CHARACTER_CULL_DRAWS,
  type CharacterCullPass,
  characterCullBits,
} from './character_cull_core';
import { animCadenceFrames, type CharacterLodBands } from './crowd_lod';
import { buildGroundQuestObject } from './quest_objects';
import {
  buildMovingWorldQuestFreightWagon,
  type MovingWorldQuestFreightWagonVisual,
} from './world_quest_freight_visual';

export type { MovingWorldQuestFreightWagonVisual };

/** Moving escorts bypass the static pool: their rigs own live mixers and
 * skeleton textures. Missing assets still leave a pickable freight body. */
export function isQuestCaravanEntity(e: Entity): boolean {
  return e.kind === 'mob' && !!worldQuestCaravanForMob(e.templateId);
}

export function buildQuestCaravanBody(e: Entity): MovingWorldQuestFreightWagonVisual {
  return (
    buildMovingWorldQuestFreightWagon(e.templateId) ?? {
      ...buildGroundQuestObject('eastbrook_freight_wagon', e.id),
      update() {},
      dispose() {},
    }
  );
}

interface CaravanEntityPresentation {
  group: THREE.Group;
  height: number;
  liveScale: number;
  lastX: number;
  lastY: number;
  lastZ: number;
  freightCaravanVisual: MovingWorldQuestFreightWagonVisual | null;
}

/** The wagon's cull radius floor: the freight body is wider than a character,
 *  so the renderer's per-character cull core is asked for at least this much. */
export const QUEST_CARAVAN_CULL_RADIUS = 6;

/** Uses the interpolated group pose, with no per-frame allocation. Only the
 * cosmetic driver's animation is culled: `onScreen` is the renderer's own
 * character-cull verdict for this body (always true when culling is off). */
export function syncQuestCaravanBody(
  view: CaravanEntityPresentation,
  dt: number,
  framePhase: number,
  distSq: number,
  lodBands: CharacterLodBands,
  reducedMotion: boolean,
  onScreen: boolean,
): void {
  const { x, y, z } = view.group.position;
  const moving = Math.hypot(x - view.lastX, z - view.lastZ) > 0.001;
  view.lastX = x;
  view.lastY = y;
  view.lastZ = z;
  const cadence = animCadenceFrames(distSq, lodBands);
  const animateDriver = !reducedMotion && onScreen && (cadence <= 1 || framePhase % cadence === 0);
  view.freightCaravanVisual?.update(dt, moving, animateDriver);
}

/** The renderer members the per-frame caravan pass reads. They are private on
 *  Renderer, so the call site passes `this` untyped; the declarations are welded to
 *  renderer.ts in tests/quest_entity_presentation.test.ts. */
interface CaravanFrameHost {
  cullCharacters: boolean;
  characterCull: CharacterCullPass;
  frameIdx: number;
  reducedMotion(): boolean;
}

/** One view's per-frame caravan pass: the renderer's character cull verdict for the
 *  wagon (every view is on screen while culling is off) and the body sync. False for a
 *  view that is not a caravan, which the entity loop then paints as usual. */
export function syncQuestCaravanView(
  host: object,
  view: CaravanEntityPresentation,
  entityId: number,
  dt: number,
  distSq: number,
  lodBands: CharacterLodBands,
): boolean {
  if (!view.freightCaravanVisual) return false;
  const h = host as CaravanFrameHost;
  const pos = view.group.position;
  const onScreen =
    !h.cullCharacters ||
    (characterCullBits(
      h.characterCull,
      pos.x,
      pos.y,
      pos.z,
      view.height,
      view.liveScale,
      QUEST_CARAVAN_CULL_RADIUS * view.liveScale,
      distSq,
    ) &
      CHARACTER_CULL_DRAWS) !==
      0;
  syncQuestCaravanBody(
    view,
    dt,
    h.frameIdx + entityId,
    distSq,
    lodBands,
    h.reducedMotion(),
    onScreen,
  );
  return true;
}

/** Attach an object body before the existing whole-entity compile gate. The
 * body remains its click target and exposes its ambience handles on the view. */
export function attachEntityViewBody(
  group: THREE.Group,
  body: THREE.Object3D | null,
  entityId: number,
  visual: { clickProxy: THREE.Object3D } | null,
  isQuestVision: boolean,
): THREE.Object3D {
  if (visual) {
    // raycasting skinned meshes is expensive, pick against the invisible
    // capsule proxy instead (three's raycaster ignores `visible`)
    if (!isQuestVision) visual.clickProxy.userData.entityId = entityId;
    return visual.clickProxy;
  }
  // every object branch in the renderer built a body; the bare group is a benign
  // fallback for the (unreachable) no-body case
  if (body) {
    group.add(body);
    body.traverse((object) => {
      object.userData.entityId = entityId;
    });
    // Prop builders hang their ambience handles (rolling rock, orbiting
    // shards, pulsing veins, pylon flame, the mail votive) on the BODY they
    // return, but the per-frame animation pass reads them from the view
    // GROUP: hoist them across or every one of those animations sits inert.
    for (const key of ['rollRock', 'riftOrbiters', 'riftPulse', 'riftFlame', 'mailGlow']) {
      if (body.userData[key] !== undefined) group.userData[key] = body.userData[key];
    }
  }
  return body ?? group;
}
