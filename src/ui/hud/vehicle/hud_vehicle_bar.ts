// The HUD's cannon action bar, built from the Hud's own members on first use.
// Hud members are private, so the factory takes the Hud untyped; the members it
// reads are welded to hud.ts in tests/hud_vehicle_bar.test.ts. Every closure reads
// the Hud live, as the inline construction did.
import type { GamepadKind } from '../../../game/gamepad_map';
import { keyCapLabel } from '../../../game/keybinds';
import { VehicleActionBarController } from './vehicle_action_bar_controller';

type VehicleBarDeps = ConstructorParameters<typeof VehicleActionBarController>[0];

/** The private Hud members the factory reads. */
interface VehicleBarHost {
  sim: VehicleBarDeps['world'];
  writerFacet: VehicleBarDeps['writers'];
  keybinds: { primaryLabel(action: string): string };
  optionsHooks: {
    gamepad: { kind(): GamepadKind };
    gliderPitchHold?(value: -1 | 0 | 1): void;
  } | null;
  peekGuard: { consume(): boolean };
  renderer: VehicleBarDeps['presentation'];
  playerGroundAim: VehicleBarDeps['cancelOnEnter'][number];
  empowerHold: VehicleBarDeps['cancelOnEnter'][number];
  attachTooltip(element: HTMLElement, html: () => string): void;
}

export function createHudVehicleBar(hud: object): VehicleActionBarController {
  const h = hud as VehicleBarHost;
  return new VehicleActionBarController({
    world: h.sim,
    writers: h.writerFacet,
    keyLabel: (slot) => keyCapLabel(h.keybinds.primaryLabel(`slot${slot}`)),
    padKind: () => h.optionsHooks?.gamepad.kind() ?? 'generic',
    consumePeek: () => h.peekGuard.consume(),
    presentation: h.renderer,
    cancelOnEnter: [h.playerGroundAim, h.empowerHold],
    attachTooltip: (element, html) => h.attachTooltip(element, html),
    gliderPitchHold: (value) => h.optionsHooks?.gliderPitchHold?.(value),
  });
}
