import { actionCameraScreenPoint } from '../ui/action_camera_anchor';
import type { CombatAimIntent } from './combat_aim';
import { pointAlongCombatAim, resolveCombatAimIntent } from './combat_aim';

interface CombatAimInput {
  readonly camYaw: number;
  combatAimUsesFacing(): boolean;
  cursorPoint(): { x: number; y: number } | null;
}

interface CombatAimPlayer {
  pos: { x: number; y: number; z: number };
  facing: number;
}

interface CombatAimMeta {
  combatAimAngle?: number;
}

interface CombatAimOnlineSink {
  setCombatAimAngle(angle: number): void;
  setMouselookFacing(facing: number): void;
  flushInput(): boolean;
}

export interface CombatAimControllerDeps {
  canvas: Pick<HTMLCanvasElement, 'getBoundingClientRect'>;
  input: CombatAimInput;
  player(): CombatAimPlayer;
  groundPoint(clientX: number, clientY: number, planeY: number): { x: number; z: number } | null;
  offlineMeta(): CombatAimMeta | null;
  online(): CombatAimOnlineSink | null;
}

export interface CombatAimController {
  screenPoint(): { x: number; y: number } | null;
  current(): CombatAimIntent;
  point(): { x: number; z: number };
  sync(): void;
}

/** Resolves and synchronizes cursor or facing aim without coupling main.ts to the wire sink. */
export function createCombatAimController(deps: CombatAimControllerDeps): CombatAimController {
  function usesFacing(): boolean {
    return deps.input.combatAimUsesFacing();
  }

  function screenPoint(): { x: number; y: number } | null {
    if (!usesFacing()) return deps.input.cursorPoint();
    return actionCameraScreenPoint(deps.canvas.getBoundingClientRect());
  }

  function current(): CombatAimIntent {
    const player = deps.player();
    const screen = screenPoint();
    const cursorPoint = screen ? deps.groundPoint(screen.x, screen.y, player.pos.y) : null;
    return resolveCombatAimIntent({
      player: player.pos,
      facing: usesFacing() ? deps.input.camYaw : player.facing,
      cursorPoint,
      useFacing: usesFacing(),
    });
  }

  return {
    screenPoint,
    current,
    point() {
      const aim = current();
      return aim.point ?? pointAlongCombatAim(deps.player().pos, aim.angle);
    },
    sync() {
      const aim = current();
      const offlineMeta = deps.offlineMeta();
      if (offlineMeta) offlineMeta.combatAimAngle = aim.angle;
      const online = deps.online();
      if (!online) return;
      online.setCombatAimAngle(aim.angle);
      if (usesFacing()) online.setMouselookFacing(deps.input.camYaw);
      online.flushInput();
    },
  };
}
