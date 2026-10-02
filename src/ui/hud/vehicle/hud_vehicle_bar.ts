// The HUD's cannon action bar, built from the Hud's own members on first use.
// Hud members are private, so the factory takes the Hud untyped; the members it
// reads are welded to hud.ts in tests/hud_vehicle_bar.test.ts. Every closure reads
// the Hud live, as the inline construction did.
import type { GamepadKind } from '../../../game/gamepad_map';
import { keyCapLabel } from '../../../game/keybinds';
import type { FctPainter } from '../../fct_painter';
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
  fctPainter: Pick<FctPainter, 'spawn'>;
  attachTooltip(element: HTMLElement, html: () => string): void;
  showBanner(
    text: string,
    motion?: boolean,
    icon?: string,
    variant?: 'default',
    subtext?: string,
    durationMs?: number,
    source?: 'turret',
  ): unknown;
  clearSourceBanner(source: 'turret'): void;
  lastMinimapDrawAt: number;
}

/** The HUD's default banner time, passed through so the seat's banners can carry their source. */
const BANNER_MS = 2600;

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
    showBanner: (banner) =>
      h.showBanner(banner.text, true, undefined, 'default', banner.subtext, BANNER_MS, 'turret'),
    onNewTurretRun: () => {
      // The last run's verdict must not linger into the replay's intro, nor its bodies on the map.
      h.clearSourceBanner('turret');
      h.lastMinimapDrawAt = 0;
    },
    spawnFct: (event, now) => h.fctPainter.spawn(event, now),
  });
}
