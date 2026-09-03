import type {
  ControllerWorldPromptClaim,
  ControllerWorldPromptFrame,
} from '../render/controller_world_prompt_view';
import type { SimEvent } from '../sim/types';
import type { BgFlagInteractionCandidate } from './bg_flag_interact';
import type { NearbyInteractionCandidate } from './nearby_interaction';
import {
  type PadReelLifecycle,
  type PadReelLifecycleEvent,
  reducePadReelLifecycle,
} from './pad_reel';

export interface ControllerPromptWorldPoint {
  x: number;
  y: number;
  z: number;
}

export interface ControllerPromptResolveInput {
  padActive: boolean;
  virtualMouse: boolean;
  confirmLabel: string | null;
  uiFocused: boolean;
  death: boolean;
  crossHotbar: boolean;
  crossHotbarEdit: boolean;
  bootcamp: boolean;
  groundAim: { point: ControllerPromptWorldPoint; blocked: boolean } | null;
  fishing: { point: ControllerPromptWorldPoint | null } | null;
  bgFlag: BgFlagInteractionCandidate | null;
  nearby: NearbyInteractionCandidate | null;
  gatherWorldPoint: ControllerPromptWorldPoint | null;
}

function specializedClaim(input: ControllerPromptResolveInput): ControllerWorldPromptClaim | null {
  if (input.death) return 'death';
  if (input.crossHotbarEdit) return 'crossHotbarEdit';
  if (input.crossHotbar) return 'crossHotbar';
  if (input.bootcamp) return 'bootcamp';
  return null;
}

function emptyFrame(claimedBy: ControllerWorldPromptClaim | null): ControllerWorldPromptFrame {
  return { padActive: true, claimedBy, action: null };
}

export function resolveControllerWorldPrompt(
  input: ControllerPromptResolveInput,
): ControllerWorldPromptFrame | null {
  if (!input.padActive || input.virtualMouse) return null;
  const claimedBy = specializedClaim(input);
  if (claimedBy !== null) return emptyFrame(claimedBy);
  if (input.uiFocused) return emptyFrame(null);
  if (input.groundAim) {
    return {
      padActive: true,
      claimedBy: null,
      action: {
        kind: 'confirm',
        buttonLabel: input.confirmLabel,
        anchor: { kind: 'world', id: 'ground-aim' },
        blocked: input.groundAim.blocked,
      },
      worldPoint: input.groundAim.point,
    };
  }
  if (input.fishing) {
    return {
      padActive: true,
      claimedBy: null,
      action: {
        kind: 'confirm',
        buttonLabel: input.confirmLabel,
        anchor: { kind: 'world', id: 'fishingBobber' },
        blocked: false,
      },
      worldPoint: input.fishing.point,
    };
  }
  if (input.bgFlag) {
    return {
      padActive: true,
      claimedBy: null,
      action: {
        kind: 'confirm',
        buttonLabel: input.confirmLabel,
        anchor: input.bgFlag.anchor,
        blocked: !input.bgFlag.eligible,
      },
    };
  }
  const nearby = input.nearby;
  if (nearby?.anchor) {
    return {
      padActive: true,
      claimedBy: null,
      action: {
        kind: 'confirm',
        buttonLabel: input.confirmLabel,
        anchor: nearby.anchor,
        blocked: !nearby.eligible,
      },
      ...(nearby.interactionKind === 'gather' ? { worldPoint: input.gatherWorldPoint } : {}),
    };
  }
  return emptyFrame(null);
}

const FISHING_EVENT_TYPES = new Set<PadReelLifecycleEvent['type']>([
  'fishingBite',
  'fishingResult',
  'fishingGotAway',
  'fishingEarlyReel',
  'fishingEmptyHook',
]);

function personalFishingEvents(
  events: readonly SimEvent[],
  playerId: number,
): PadReelLifecycleEvent[] {
  const personal: PadReelLifecycleEvent[] = [];
  for (const event of events) {
    if ('pid' in event && event.pid === playerId && FISHING_EVENT_TYPES.has(event.type as never)) {
      personal.push(event as PadReelLifecycleEvent);
    }
  }
  return personal;
}

export interface ControllerPromptCoordinatorDeps {
  playerId(): number;
  castingAbility(): string | null;
  playerDead(): boolean;
  resolve(lifecycle: PadReelLifecycle): ControllerPromptResolveInput;
}

export interface ControllerPromptCoordinator {
  onEvents(events: readonly SimEvent[]): void;
  frame(): ControllerWorldPromptFrame | null;
  reset(): void;
  fishingLifecycle(): PadReelLifecycle;
}

export function createControllerPromptCoordinator(
  deps: ControllerPromptCoordinatorDeps,
): ControllerPromptCoordinator {
  let fishingLifecycle: PadReelLifecycle = 'idle';

  const normalize = (events: readonly PadReelLifecycleEvent[] = []): void => {
    fishingLifecycle = deps.playerDead()
      ? 'idle'
      : reducePadReelLifecycle(fishingLifecycle, deps.castingAbility(), events);
  };

  return {
    onEvents(events) {
      normalize(personalFishingEvents(events, deps.playerId()));
    },
    frame() {
      normalize();
      return resolveControllerWorldPrompt(deps.resolve(fishingLifecycle));
    },
    reset() {
      fishingLifecycle = 'idle';
    },
    fishingLifecycle() {
      return fishingLifecycle;
    },
  };
}

export function createBootcampConfirmClaim(confirmLabel: () => string | null): () => boolean {
  let prompt: HTMLElement | null = null;
  return () => {
    if (typeof document === 'undefined') return false;
    if (!prompt?.isConnected) prompt = document.querySelector<HTMLElement>('.tut-prompt');
    const label = confirmLabel();
    if (!prompt || prompt.style.display === 'none' || !label) return false;
    return [...prompt.querySelectorAll<HTMLElement>('.tut-keycap')].some(
      (keycap) => keycap.textContent?.trim() === label,
    );
  };
}
