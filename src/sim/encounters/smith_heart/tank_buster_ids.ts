// The Smith's Heart's tank busters as data (the team's feedback of 2026-11-25:
// "show tank busters on screen, not only as a debuff"): each boss's heavy hit
// aimed at its tank, and how the tank is told it is coming. The sim lays one
// quiet marker on the tank as each one begins (tank_buster.ts
// `warnTankBuster`: the buster's `code` in the aura's `value`, the seconds to
// the hit in `remaining`, the boss in `sourceId`); the HUD's tank buster alert
// (src/ui/hud/dungeon/tank_swap_alert_view.ts, the tank swap's family) reads
// that marker on the local player only, so nobody but the targeted tank is
// ever shown it.
//
//   Hammer Council         Hammer's Weight: its 1.5 s bar at the tank.
//   Guardian of the Breath Bellows Blow (the Wind) and Thunder Lash (the
//                          Storm): their 1.5 s bars at the tank.
//   Guardian of the Quench Tempering Strike: her cleaving swing, told
//                          `strikeWindup` seconds out (quench_strike_windup.ts).
//   Guardian of the Heat   Wellspring Brand (heat_brand.ts): hurled at the
//                          tank on its own clock, told HEAT_DIFFICULTY
//                          `brand.lead` seconds out (the owner's call of
//                          2026-11-27); Cinder Grip on every swing stays the
//                          tank swap alert's background count.
//   Masterless Strength    Elemental Strike (every 8 s, told `ELEMENT_TUNING
//                          strikeLead` seconds out) and a Splinter's Shearing
//                          Blow (its 2 s bar at the Splinter's tank).
// A bar's warning ends with the bar (`cast`: the HUD hides it once the boss
// no longer casts it). Pure data over the fights' id leaves.

import { BREATH_CASTS } from './breath_ids';
import { COUNCIL_CASTS } from './council_ids';
import { FINAL_PHASE_CASTS } from './final_phase_ids';
import { HEAT_NAMES } from './heat_ids';

/** The one marker every buster lays on its tank. */
export const TANK_BUSTER_AURA = 'heart_tank_buster';

export type HeartBusterKey =
  | 'weight'
  | 'blow'
  | 'thunder'
  | 'tempering'
  | 'strike'
  | 'shear'
  | 'brand';

export interface HeartTankBuster {
  key: HeartBusterKey;
  /** The marker's `value` (1-based; 0 is none). */
  code: number;
  /** The English name (the marker's name; the HUD shows its catalog key). */
  name: string;
  /** The boss's bar that IS the buster (the warning lasts while it casts it),
   *  or null for a swing or a clock the sim tells ahead of time. */
  cast: string | null;
}

export const HEART_TANK_BUSTERS: readonly HeartTankBuster[] = [
  { key: 'weight', code: 1, name: "Hammer's Weight", cast: COUNCIL_CASTS.weight },
  { key: 'blow', code: 2, name: 'Bellows Blow', cast: BREATH_CASTS.blow },
  { key: 'thunder', code: 3, name: 'Thunder Lash', cast: BREATH_CASTS.thunder },
  { key: 'tempering', code: 4, name: 'Tempering Strike', cast: null },
  { key: 'strike', code: 5, name: 'Elemental Strike', cast: null },
  { key: 'shear', code: 6, name: 'Shearing Blow', cast: FINAL_PHASE_CASTS.shear },
  { key: 'brand', code: 7, name: HEAT_NAMES.brand, cast: null },
];

/** The buster `key` names. */
export function heartTankBuster(key: HeartBusterKey): HeartTankBuster {
  for (const b of HEART_TANK_BUSTERS) if (b.key === key) return b;
  throw new Error(`unknown tank buster ${key}`);
}

/** The buster a marker's `value` carries, or null. */
export function heartTankBusterByCode(code: number | undefined): HeartTankBuster | null {
  if (code === undefined) return null;
  for (const b of HEART_TANK_BUSTERS) if (b.code === Math.round(code)) return b;
  return null;
}
