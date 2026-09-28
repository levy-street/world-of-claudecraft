// Binds the pointer's seat interaction (seat_interact.ts) to the live client: the camera's
// seat pick, click-to-move for the walk to the seat, the HUD's error toast and the
// localized refusal lines. Kept out of main.ts (the bootstrap firewall).

import type * as THREE from 'three';
import { pickSeatAt } from '../render/seat_pick';
import { t } from '../ui/i18n';
import { tSim } from '../ui/sim_i18n';
import type { IWorld } from '../world_api';
import { createSeatInteraction, type SeatInteraction } from './seat_interact';

interface Point {
  x: number;
  z: number;
}

export interface SeatInteractionHost {
  world: IWorld;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  input: {
    clickMoveGoal: Point | null;
    setClickMoveTarget(
      target: Point,
      stopDistance: number,
      entityId: null,
      path: Point[],
      attack: boolean,
      forced: boolean,
    ): void;
  };
  showError(text: string): void;
  resolveTarget(target: Point): Point;
  pathTo(target: Point): Point[];
}

/** How close click-to-move brings the body to a seat's stand spot. */
const SEAT_WALK_STOP = 0.25;

export function wireSeatInteraction(host: SeatInteractionHost): SeatInteraction {
  return createSeatInteraction({
    world: host.world,
    pick(x, y) {
      const hit = pickSeatAt(
        host.camera,
        x,
        y,
        host.canvas.clientWidth || window.innerWidth,
        host.canvas.clientHeight || window.innerHeight,
      );
      return hit ? { hit, eye: host.camera.position } : null;
    },
    walkTo(target) {
      const goal = host.resolveTarget(target);
      host.input.setClickMoveTarget(goal, SEAT_WALK_STOP, null, host.pathTo(goal), false, true);
      return goal;
    },
    clickMoveGoal: () => host.input.clickMoveGoal,
    showError: (text) => host.showError(text),
    errorText(kind) {
      if (kind === 'seatTaken') return tSim('error.seatTaken');
      if (kind === 'dead') return tSim('error.cantWhileDead');
      return t('questUi.errors.tooFar');
    },
    now: () => performance.now(),
  });
}
