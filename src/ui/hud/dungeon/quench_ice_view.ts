// The Guardian of the Quench's ice-state indicator (pure view core; painter:
// quench_ice_painter.ts). The team's playtest of 2026-11-25: "hard to see the
// mechanics, especially when the ice is about to break and when you're
// underwater; add a UI indicator (top middle of the screen) for the
// ice/water state", "a frosty blue screen border plus a blue tint when
// you're in the water". A small badge at the top of the screen while the
// local player fights on the lake (they carry its cold bar):
//   ice       on the ice (calm)
//   breaking  standing on ice that is breaking (a crack's footprint: it
//             opens into a hole under them), urgent and pulsing
//   water     fallen through into the freezing water, with the seconds
//             until they climb out; the screen's frost veil shows with it
// Information a player acts on, so it shows on EVERY graphics preset
// (docs/design/graphics-settings-fairness.md); the mechanic-hints setting
// never hides it. The veil is a light tint and a frosted edge: it never hides
// the world in the middle of the screen.
//
// Read off the player's own auras (QUENCH_AURAS.cold: in the fight;
// QUENCH_AURAS.trapped: in the water) and the cracks' objects (their radius
// rides `scale`, quench_ids.ts crackTemplate), found again only when the
// roster changes. DOM-free; allocates nothing per frame.

import {
  QUENCH_AURAS,
  QUENCH_OBJECTS,
  QUENCH_TUNING,
} from '../../../sim/encounters/smith_heart/quench_ids';
import { t } from '../../i18n';

/** A body as the scan reads it. */
export interface QuenchIceBody {
  id: number;
  templateId: string;
  pos: { x: number; z: number };
  scale?: number;
}

export interface QuenchIceWorld {
  entities: ReadonlyMap<number, QuenchIceBody>;
  entityRosterVersion: number;
}

export type QuenchIceState = 'ice' | 'breaking' | 'water';

export interface QuenchIceView {
  visible: boolean;
  state: QuenchIceState;
  label: string;
  /** The seconds left in the water ('' otherwise). */
  seconds: string;
  /** The screen's frost veil (in the water). */
  veil: boolean;
}

/** How far past a crack's footprint a body still reads it as breaking under
 *  it (yards): a step, so the badge warns a raider at its very edge too. */
export const QUENCH_ICE_BREAK_MARGIN = 0.75;

/** The claim's cracks: their ids, gathered again only when the roster changes. */
export class QuenchIceScan {
  private version = Number.NaN;
  private readonly ids: number[] = [];

  /** The cracks this frame (a reused list of ids). */
  frame(world: QuenchIceWorld | null | undefined): readonly number[] {
    if (!world) return this.ids;
    if (world.entityRosterVersion !== this.version) {
      this.version = world.entityRosterVersion;
      this.ids.length = 0;
      for (const e of world.entities.values())
        if (e.templateId.startsWith(QUENCH_OBJECTS.crackPrefix)) this.ids.push(e.id);
    }
    return this.ids;
  }
}

export function makeQuenchIceView(): QuenchIceView {
  return { visible: false, state: 'ice', label: '', seconds: '', veil: false };
}

/**
 * The badge this frame, written into `out`: hidden unless the player carries
 * the lake's cold bar (or is held in its water); in the water over breaking
 * ice over plain ice.
 */
export function buildQuenchIceView(
  world: QuenchIceWorld | null | undefined,
  cracks: readonly number[],
  player: {
    pos: { x: number; z: number };
    dead?: boolean;
    auras: readonly { id: string; remaining?: number }[];
  },
  out: QuenchIceView,
): QuenchIceView {
  out.visible = false;
  out.veil = false;
  out.seconds = '';
  if (player.dead) return out;
  let cold = false;
  let trapped: { remaining?: number } | null = null;
  for (const a of player.auras) {
    if (a.id === QUENCH_AURAS.cold) cold = true;
    else if (a.id === QUENCH_AURAS.trapped) trapped = a;
  }
  if (!cold && !trapped) return out;
  out.visible = true;
  if (trapped) {
    out.state = 'water';
    out.veil = true;
    out.label = t('hudChrome.quenchIce.water');
    // The root outlasts the water by a second (quench_ice.ts), so the
    // seconds shown are the time left before the climb out.
    const left = Math.max(0, Math.ceil((trapped.remaining ?? 0) - 1));
    if (left > 0) out.seconds = t('hudChrome.quenchAlert.secondsBar', { seconds: left });
    return out;
  }
  if (world && breakingUnder(world, cracks, player.pos)) {
    out.state = 'breaking';
    out.label = t('hudChrome.quenchIce.breaking');
    return out;
  }
  out.state = 'ice';
  out.label = t('hudChrome.quenchIce.onIce');
  return out;
}

/** Is `at` on a crack's footprint (its radius, the margin past it)? */
export function breakingUnder(
  world: QuenchIceWorld,
  cracks: readonly number[],
  at: { x: number; z: number },
): boolean {
  for (const id of cracks) {
    const e = world.entities.get(id);
    if (!e) continue;
    const r =
      (e.scale !== undefined && e.scale > 0 ? e.scale : QUENCH_TUNING.holeR) +
      QUENCH_ICE_BREAK_MARGIN;
    const dx = at.x - e.pos.x;
    const dz = at.z - e.pos.z;
    if (dx * dx + dz * dz <= r * r) return true;
  }
  return false;
}
