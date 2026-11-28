// The Guardian of the Breath's wind indicator (pure view core; painter:
// breath_wind_painter.ts). The owner's playtest of 2026-11-25: players moved
// the wrong way, unsure where the wind blew, and on the low and medium
// presets the floor's dust and streaks read faint. A small badge at the top
// of the screen while the wind turns (its gather: the bearing to come) and
// while it blows: an arrow pointing the way the wind will carry you, turned
// to where you face (up is straight ahead, the heading compass's convention:
// hud.ts updateCompass reads the player's facing). Information a player acts
// on, so it shows on EVERY graphics preset (docs/design/
// graphics-settings-fairness.md); the mechanic-hints setting never hides it.
//
// Read off the wind object's template (breath_ids.ts breathWindTemplate: its
// phase and bearing ride the wire), found again only when the roster
// changes. DOM-free; allocates nothing per frame.

import { BREATH_OBJECTS, breathWindOf } from '../../../sim/encounters/smith_heart/breath_ids';
import { WIND_GUST_AURA } from '../../../sim/wind_drift';
import { t } from '../../i18n';

/** A body as the scan reads it. */
export interface BreathWindBody {
  id: number;
  templateId: string;
  kind?: string;
  pos: { x: number; z: number };
}

export interface BreathWindWorld {
  entities: ReadonlyMap<number, BreathWindBody>;
  entityRosterVersion: number;
}

export interface BreathWindView {
  visible: boolean;
  /** The arrow's turn, clockwise degrees from straight up (ahead). */
  rotDeg: number;
  /** The gather: the wind is turning to this bearing (the badge pulses). */
  turning: boolean;
  label: string;
}

/** How far from the wind object (the Cornice's middle) a player still reads
 *  it (yards): the whole Cornice, not the climb below it. */
export const BREATH_WIND_REACH = 62;

/** The phases the badge shows (a heroic storm gust and its gather too). */
const SHOWN = new Set(['gather', 'blow', 'gustgather', 'gust']);
const TURNING = new Set(['gather', 'gustgather']);

/** The claim's wind object: looked up again only when the roster changes. */
export class BreathWindScan {
  private version = Number.NaN;
  private id = -1;

  frame(world: BreathWindWorld | null | undefined): BreathWindBody | null {
    if (!world) return null;
    if (world.entityRosterVersion !== this.version) {
      this.version = world.entityRosterVersion;
      this.id = -1;
      for (const e of world.entities.values())
        if (e.templateId.startsWith(BREATH_OBJECTS.windPrefix)) {
          this.id = e.id;
          break;
        }
    }
    return this.id >= 0 ? (world.entities.get(this.id) ?? null) : null;
  }
}

export function makeBreathWindView(): BreathWindView {
  return { visible: false, rotDeg: 0, turning: false, label: '' };
}

/**
 * The badge this frame, written into `out`. `facing` is the player's (sim
 * radians: ahead is (sin f, cos f), turning right lowers it); the wind's
 * bearing is degrees in the same frame (breath_ids.ts: it blows toward
 * (sin b, cos b)).
 */
export function buildBreathWindView(
  wind: BreathWindBody | null,
  player: {
    pos: { x: number; z: number };
    facing?: number;
    dead?: boolean;
    auras?: readonly { id: string; value?: number }[];
  },
  out: BreathWindView,
): BreathWindView {
  out.visible = false;
  if (player.dead) return out;
  // The Summit Roar's follow-through gust on this body (wind_drift.ts
  // WIND_GUST_AURA, its heading in radians) outranks the Cornice's wind.
  const gust = player.auras?.find((a) => a.id === WIND_GUST_AURA);
  if (gust) return pointBadge(out, player.facing ?? 0, ((gust.value ?? 0) * 180) / Math.PI, false);
  const of = wind ? breathWindOf(wind.templateId) : null;
  if (!wind || !of || !SHOWN.has(of.phase)) return out;
  if (Math.hypot(player.pos.x - wind.pos.x, player.pos.z - wind.pos.z) > BREATH_WIND_REACH)
    return out;
  return pointBadge(out, player.facing ?? 0, of.bearingDeg, TURNING.has(of.phase));
}

/** The badge pointed at the wind's bearing (degrees) for a body facing
 *  `facing` (sim radians). */
function pointBadge(
  out: BreathWindView,
  facing: number,
  bearingDeg: number,
  turning: boolean,
): BreathWindView {
  // Both are angles in the sim's (sin a, cos a) frame, where a larger angle
  // turns LEFT (a right turn lowers the facing): the wind lies (bearing -
  // facing) to the left of ahead, so the arrow turns clockwise by its negation.
  const facingDeg = (facing * 180) / Math.PI;
  out.rotDeg = Math.round((((facingDeg - bearingDeg) % 360) + 360) % 360) % 360;
  out.turning = turning;
  out.label = out.turning ? t('hudChrome.breathWind.turning') : t('hudChrome.breathWind.blowing');
  out.visible = true;
  return out;
}
