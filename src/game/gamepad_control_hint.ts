// Pure controller-hint resolver. Tutorial chrome asks for a semantic control,
// while this module reads the live flat bindings, controller glyph family, and
// cross-hotbar layout to answer with the buttons that really perform it.

import {
  CROSS_HOTBAR_LAYER_BUTTONS,
  CROSS_HOTBAR_SLOTS_PER_LAYER,
  CROSS_HOTBAR_TRIGGERS,
  type CrossHotbarAction,
  type CrossHotbarLayout,
} from './cross_hotbar';
import {
  type GamepadBindingEntry,
  labelForGamepadAction,
  labelForGamepadTarget,
} from './gamepad_bindings';
import {
  GAMEPAD_CONFIRM,
  GAMEPAD_CYCLE_HUD,
  GAMEPAD_CYCLE_SET,
  GAMEPAD_NONE,
  type GamepadActionId,
  type GamepadKind,
  GP,
  gamepadButtonLabel,
} from './gamepad_map';
import type { TutorialBagControllerStep } from './tutorial_bag_controller_step';

export interface GamepadControlHintSource {
  entries: readonly GamepadBindingEntry[];
  kind: GamepadKind;
  crossHotbarEnabled: boolean;
  crossHotbarSets: CrossHotbarLayout;
  crossHotbarSet: number;
}

export type GamepadControlHintIntent =
  | { readonly type: 'interact' }
  | { readonly type: 'target' }
  | { readonly type: 'bagItem'; readonly step: TutorialBagControllerStep }
  | { readonly type: 'action'; readonly action: GamepadActionId }
  | {
      readonly type: 'crossHotbar';
      readonly action: Exclude<CrossHotbarAction, null>;
      readonly fallback: GamepadActionId;
    };

/** Button caps in press order. A chord is one cap (`LT + D-pad right`); changing
 *  to the other standing set is a sequence (`RB`, then the chord). */
export function gamepadControlHint(
  source: GamepadControlHintSource,
  intent: GamepadControlHintIntent,
): readonly string[] {
  if (intent.type === 'interact') {
    const label =
      labelForGamepadAction(source.entries, GAMEPAD_CONFIRM, source.kind) ??
      labelForGamepadAction(source.entries, 'interact', source.kind);
    return label ? [label] : [];
  }
  if (intent.type === 'target') {
    const label = labelForGamepadTarget(source.entries, source.kind, source.crossHotbarEnabled);
    return label ? [label] : [];
  }
  if (intent.type === 'bagItem') {
    const enterHud = safeTutorialActionLabel(source, GAMEPAD_CYCLE_HUD);
    const confirm = safeTutorialActionLabel(source, GAMEPAD_CONFIRM);
    const dpadAvailable = dpadNavigatesHud(source);
    if (!tutorialBagRouteAvailable(intent.step, enterHud, confirm, dpadAvailable)) return [];
    if (intent.step === 'enterHud') {
      return enterHud ? [enterHud] : [];
    }
    if (
      intent.step === 'navigateToBlockingWindowClose' ||
      intent.step === 'navigateToBags' ||
      intent.step === 'navigateToItem'
    ) {
      return ['D-pad'];
    }
    return confirm ? [confirm] : [];
  }
  if (intent.type === 'action') {
    const label = labelForGamepadAction(source.entries, intent.action, source.kind);
    return label ? [label] : [];
  }
  if (!source.crossHotbarEnabled) {
    const label = labelForGamepadAction(source.entries, intent.fallback, source.kind);
    return label ? [label] : [];
  }

  const setOrder = [
    source.crossHotbarSet,
    ...source.crossHotbarSets
      .map((_set, index) => index)
      .filter((i) => i !== source.crossHotbarSet),
  ];
  for (const setIndex of setOrder) {
    const position = source.crossHotbarSets[setIndex]?.findIndex(
      (candidate) => candidate?.type === intent.action.type && candidate.id === intent.action.id,
    );
    if (position === undefined || position < 0) continue;
    const chord = crossHotbarChord(position, source.kind);
    if (!chord) return [];
    if (setIndex === source.crossHotbarSet) return [chord];
    const cycle = labelForGamepadAction(source.entries, GAMEPAD_CYCLE_SET, source.kind);
    return cycle ? [cycle, chord] : [];
  }
  return [];
}

function tutorialBagRouteAvailable(
  step: TutorialBagControllerStep,
  enterHud: string | null,
  confirm: string | null,
  dpadAvailable: boolean,
): boolean {
  if (!confirm) return false;
  if (step === 'useItem') return true;
  if (!dpadAvailable) return false;
  return step !== 'enterHud' || enterHud !== null;
}

function safeTutorialActionLabel(
  source: GamepadControlHintSource,
  action: GamepadActionId,
): string | null {
  const entry = source.entries.find(
    (candidate) => candidate.action === action && candidate.button !== GP.BACK,
  );
  return entry ? gamepadButtonLabel(entry.button, source.kind) : null;
}

function dpadNavigatesHud(source: GamepadControlHintSource): boolean {
  return [GP.DPAD_UP, GP.DPAD_DOWN, GP.DPAD_LEFT, GP.DPAD_RIGHT].every((button) => {
    const action =
      source.entries.find((candidate) => candidate.button === button)?.action ?? GAMEPAD_NONE;
    return action === GAMEPAD_NONE || (source.crossHotbarEnabled && action.startsWith('slot'));
  });
}

function crossHotbarChord(position: number, kind: GamepadKind): string | null {
  const right = position >= CROSS_HOTBAR_SLOTS_PER_LAYER;
  const button = CROSS_HOTBAR_LAYER_BUTTONS[position % CROSS_HOTBAR_SLOTS_PER_LAYER];
  if (button === undefined) return null;
  const trigger = CROSS_HOTBAR_TRIGGERS[right ? 'right' : 'left'];
  return `${gamepadButtonLabel(trigger, kind)} + ${gamepadButtonLabel(button, kind)}`;
}
