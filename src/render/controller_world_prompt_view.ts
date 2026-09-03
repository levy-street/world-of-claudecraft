export type ControllerWorldPromptActionKind = 'confirm' | 'subcommands';

export type ControllerWorldPromptAnchor =
  | { kind: 'entity'; entityId: number }
  | { kind: 'gatherNode'; nodeId: string }
  | { kind: 'world'; id: string };

export type ControllerWorldPromptClaim = 'death' | 'crossHotbar' | 'crossHotbarEdit' | 'bootcamp';

export interface ControllerWorldPromptAction {
  kind: ControllerWorldPromptActionKind;
  buttonLabel: string | null;
  anchor: ControllerWorldPromptAnchor;
  blocked: boolean;
}

export interface ControllerWorldPromptFrame {
  padActive: boolean;
  claimedBy: ControllerWorldPromptClaim | null;
  action: ControllerWorldPromptAction | null;
  worldPoint?: Readonly<{ x: number; y: number; z: number }> | null;
}

export interface ControllerWorldPromptScreenAnchor {
  anchor: ControllerWorldPromptAnchor;
  x: number;
  y: number;
}

export interface ControllerWorldPromptViewInput {
  frame: ControllerWorldPromptFrame | null;
  labelAnchor: ControllerWorldPromptScreenAnchor | null;
  worldAnchor: ControllerWorldPromptScreenAnchor | null;
  viewportWidth: number;
  viewportHeight: number;
}

export type ControllerWorldPromptPlacement = 'label' | 'world' | 'fallback';

export interface ControllerWorldPromptPlan {
  hidden: boolean;
  actionKind: ControllerWorldPromptActionKind;
  buttonLabel: string;
  placement: ControllerWorldPromptPlacement;
  x: number;
  y: number;
}

export const CONTROLLER_WORLD_PROMPT_FALLBACK_BOTTOM_PX = 112;

export function newControllerWorldPromptPlan(): ControllerWorldPromptPlan {
  return {
    hidden: true,
    actionKind: 'confirm',
    buttonLabel: '',
    placement: 'fallback',
    x: 0,
    y: 0,
  };
}

export function controllerWorldPromptAnchorEquals(
  left: ControllerWorldPromptAnchor,
  right: ControllerWorldPromptAnchor,
): boolean {
  if (left.kind === 'entity') return right.kind === 'entity' && left.entityId === right.entityId;
  if (left.kind === 'gatherNode') {
    return right.kind === 'gatherNode' && left.nodeId === right.nodeId;
  }
  return right.kind === 'world' && left.id === right.id;
}

function isOnscreen(
  anchor: ControllerWorldPromptScreenAnchor,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  return (
    Number.isFinite(anchor.x) &&
    Number.isFinite(anchor.y) &&
    anchor.x >= 0 &&
    anchor.x <= viewportWidth &&
    anchor.y >= 0 &&
    anchor.y <= viewportHeight
  );
}

export function controllerWorldPromptPlanInto(
  out: ControllerWorldPromptPlan,
  input: ControllerWorldPromptViewInput,
): ControllerWorldPromptPlan {
  out.hidden = true;
  out.actionKind = 'confirm';
  out.buttonLabel = '';
  out.placement = 'fallback';
  out.x = 0;
  out.y = 0;

  const frame = input.frame;
  const action = frame?.action;
  if (
    !frame?.padActive ||
    frame.claimedBy !== null ||
    !action ||
    action.blocked ||
    !action.buttonLabel
  ) {
    return out;
  }

  out.hidden = false;
  out.actionKind = action.kind;
  out.buttonLabel = action.buttonLabel;

  const labelAnchor = input.labelAnchor;
  if (
    labelAnchor &&
    controllerWorldPromptAnchorEquals(action.anchor, labelAnchor.anchor) &&
    isOnscreen(labelAnchor, input.viewportWidth, input.viewportHeight)
  ) {
    out.placement = 'label';
    out.x = labelAnchor.x;
    out.y = labelAnchor.y;
    return out;
  }

  const worldAnchor = input.worldAnchor;
  if (
    worldAnchor &&
    controllerWorldPromptAnchorEquals(action.anchor, worldAnchor.anchor) &&
    isOnscreen(worldAnchor, input.viewportWidth, input.viewportHeight)
  ) {
    out.placement = 'world';
    out.x = worldAnchor.x;
    out.y = worldAnchor.y;
    return out;
  }

  out.x = input.viewportWidth / 2;
  out.y = Math.max(0, input.viewportHeight - CONTROLLER_WORLD_PROMPT_FALLBACK_BOTTOM_PX);
  return out;
}
