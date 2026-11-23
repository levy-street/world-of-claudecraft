// The camera's boss-aware zoom ceiling, wired to the world (the pure core is
// camera_zoom_ceiling.ts). Once a frame from main.ts updateCamera, before the
// renderer mirrors the distance: a few times a second it reads which big
// bosses count (the player's target, a boss in the fight, a boss standing
// close) and their DRAWN height off the character manifest, then the live
// ceiling eases toward it and the camera distance follows it in. Offline and
// online alike: it reads only the IWorld surface.

import { VISUALS, visualKeyFor } from '../render/characters/manifest';
import { dungeonAt, MOBS } from '../sim/data';
import type { Entity } from '../sim/types';
import type { IWorld } from '../world_api';
import {
  BASE_ZOOM_MAX,
  clampCamDist,
  easeZoomCeiling,
  zoomCeilingFor,
} from './camera_zoom_ceiling';

/** Seconds between context reads (the ease runs every frame). */
const SCAN_SEC = 0.25;
/** A boss this close counts even before the pull (its arena). */
const NEAR_YD = 45;
/** A boss in the fight counts this far out. */
const ENGAGED_YD = 70;

interface ZoomInput {
  camDist: number;
  zoomMax: number;
}

const state = { scan: 0, target: BASE_ZOOM_MAX };

/** The drawn height (yards) of a mob: its visual's height at its scale. */
function drawnHeight(e: Entity): number {
  const v = VISUALS[visualKeyFor(e)];
  return v ? v.height * (e.scale ?? 1) : 0;
}

function bossHeights(world: IWorld, me: Entity): number[] {
  const out: number[] = [];
  const target = me.targetId !== null ? world.entities.get(me.targetId) : undefined;
  for (const e of world.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const tpl = MOBS[e.templateId];
    if (!tpl || (!tpl.boss && !tpl.elite)) continue;
    const d = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
    const engaged = e.aggroTargetId !== null && d <= ENGAGED_YD;
    if (e !== target && !engaged && d > NEAR_YD) continue;
    out.push(drawnHeight(e));
  }
  return out;
}

/** One frame: refresh the context now and then, ease the ceiling, pull the
 *  camera in under it. */
export function tickCameraZoomCeiling(input: ZoomInput, world: IWorld, dt: number): void {
  state.scan -= dt;
  if (state.scan <= 0) {
    state.scan = SCAN_SEC;
    const me = world.player;
    const inDungeon = !!me && !me.dead && dungeonAt(me.pos.x) !== null;
    state.target = zoomCeilingFor({
      inDungeon,
      bossHeights: inDungeon && me ? bossHeights(world, me) : [],
    });
  }
  input.zoomMax = easeZoomCeiling(input.zoomMax, state.target, dt);
  input.camDist = clampCamDist(input.camDist, input.zoomMax);
}
