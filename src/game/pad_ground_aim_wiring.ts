// Composition glue between the pad placement mode, the Hud's ground-aim
// surface, and the per-frame reticle sync, extracted from main.ts (which stays
// a firewall). Pure math lives in pad_ground_aim.ts; this module only binds it
// to the injected world, input, and Hud facets.

import { currentInputHintMode } from './input_hint_mode';
import {
  activePvpOpponentIds,
  isAttackableEntity,
  type PickInteractionWorld,
} from './interactions';
import { nextSnapPoint, reticleStickDelta } from './pad_ground_aim';

interface GroundAimHudFacet {
  isGroundAimActive(): boolean;
  cancelGroundAim(): boolean;
  groundAimAbilityRange(): number | null;
  nudgeGroundAimPoint(dx: number, dz: number): void;
  updateGroundAimPoint(point: { x: number; z: number } | null): void;
  commitGroundAimAt(point?: { x: number; z: number } | null): boolean;
  groundAimReticle(): {
    point: { x: number; z: number };
    radius: number;
    school: string;
    dimmed: boolean;
    blocked: boolean;
  } | null;
}

type GroundAimWorldFacet = Pick<
  PickInteractionWorld,
  'player' | 'playerId' | 'duelInfo' | 'arenaInfo' | 'bgInfo' | 'entities'
>;

export interface PadGroundAimWiringDeps {
  hud: GroundAimHudFacet;
  world: () => GroundAimWorldFacet;
  camYaw: () => number;
  reticleSpeed: () => number;
}

export function padGroundAimCallbacks(deps: PadGroundAimWiringDeps): {
  isGroundAimActive: () => boolean;
  cancelGroundAim: () => void;
  onGroundAimStick: (x: number, y: number, dt: number) => void;
  onGroundAimCommit: () => void;
  onGroundAimSnap: (direction: 1 | -1) => void;
} {
  return {
    isGroundAimActive: () => deps.hud.isGroundAimActive(),
    cancelGroundAim: () => deps.hud.cancelGroundAim(),
    onGroundAimStick: (x, y, dt) => {
      const range = deps.hud.groundAimAbilityRange();
      if (range === null) return;
      const delta = reticleStickDelta(x, y, deps.camYaw(), dt, range, deps.reticleSpeed());
      deps.hud.nudgeGroundAimPoint(delta.dx, delta.dz);
    },
    onGroundAimCommit: () => deps.hud.commitGroundAimAt(),
    onGroundAimSnap: (direction) => {
      const range = deps.hud.groundAimAbilityRange();
      if (range === null) return;
      const world = deps.world();
      const player = world.player;
      const pvpOpponents = activePvpOpponentIds(world);
      const candidates: { x: number; z: number }[] = [];
      for (const entity of world.entities.values()) {
        if (!entity || !isAttackableEntity(entity, world.playerId ?? -1, pvpOpponents)) continue;
        if (Math.hypot(entity.pos.x - player.pos.x, entity.pos.z - player.pos.z) > range) continue;
        candidates.push({ x: entity.pos.x, z: entity.pos.z });
      }
      const point = nextSnapPoint(
        { x: player.pos.x, z: player.pos.z },
        candidates,
        deps.hud.groundAimReticle()?.point ?? null,
        direction,
      );
      if (point) deps.hud.updateGroundAimPoint(point);
    },
  };
}

export interface GroundAimReticleSyncDeps {
  hud: GroundAimHudFacet;
  isMobileTouch: () => boolean;
  cursorPoint: () => { x: number; y: number } | null;
  groundPoint: (x: number, y: number) => { x: number; z: number } | null;
  setReticle: (
    reticle: {
      x: number;
      z: number;
      radius: number;
      school: string;
      dimmed: boolean;
      blocked: boolean;
    } | null,
  ) => void;
}

/** The bound per-frame sync main.ts calls: built once, closures capture
 *  stable bindings, and the common not-aiming frame costs one call. */
export function createGroundAimReticleSync(deps: GroundAimReticleSyncDeps): () => void {
  return () => syncGroundAimReticleFrame(deps);
}

/** Per-frame reticle sync. Touch placement is updated directly by
 *  MobileControls (some mobile Chromium builds park a synthetic hover cursor at
 *  (0, 0), which would erase the finger-owned point every frame), and pad stick
 *  steering owns the point while the pad was the last active input. */
export function syncGroundAimReticleFrame(deps: GroundAimReticleSyncDeps): void {
  if (!deps.hud.isGroundAimActive()) {
    deps.setReticle(null);
    return;
  }
  if (!deps.isMobileTouch() && currentInputHintMode() !== 'pad') {
    const cursor = deps.cursorPoint();
    if (cursor) deps.hud.updateGroundAimPoint(deps.groundPoint(cursor.x, cursor.y));
  }
  const reticle = deps.hud.groundAimReticle();
  deps.setReticle(
    reticle
      ? {
          x: reticle.point.x,
          z: reticle.point.z,
          radius: reticle.radius,
          school: reticle.school,
          dimmed: reticle.dimmed,
          blocked: reticle.blocked,
        }
      : null,
  );
}
