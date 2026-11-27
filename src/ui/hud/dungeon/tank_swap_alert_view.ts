// The Smith's Heart's tank swap alert: the pure, DOM-free view core of the one
// small cue every swap of the raid shares (the Hammer Council's Hammer's
// Weight, the Breath's Wind-Battered and Thunder-Laden, the Heat's Cinder
// Grip, the Quench's Rime-Tempered, the Masterless Strength's Elemental
// Strike; which debuff and at how many stacks is the sim's data,
// encounters/smith_heart/tank_swap_ids.ts). Jose's rule of 2026-11-24: the one
// on-screen warning the raid keeps, for the tanks only, and calm.
//
//  - Swap: the local player carries a swap debuff at its count AND its boss
//    still has them as its target (being the boss's target is what "tanking"
//    means here; the debuffs only ever land on the boss's tank, so no role is
//    asked). The title the stacks, the thin bar the debuff's time left.
//  - Hidden otherwise: below the count, for everyone else (the other tank
//    included: Jose's call of 2026-11-24, the stacks are the whole cue, no
//    "taunt" prompt), once the swap happened (the boss turned to the other
//    tank), and while dead.
// An ACTION prompt: the hints setting never hides it, every graphics tier
// paints it. The painter is the shared encounter alert's.
//
// The family's second member, the tank buster alert (the team's feedback of
// 2026-11-25: "show tank busters on screen, not only as a debuff"): a boss's
// heavy hit on its tank (encounters/smith_heart/tank_buster_ids.ts) lays a
// marker on that tank as it begins, and only the player carrying it is shown
// the hit's name and a short countdown to it. The owner's call of 2026-11-27:
// no banner in the screen's middle, a compact line in the tank corner (just
// above the swap chip, beside the boss's frame; TANK_BUSTER_ALERT_LOOK below
// names the placement class the sheet seats it by).
//  - Buster: the local player carries the marker. A bar buster (Hammer's
//    Weight, Bellows Blow, Thunder Lash, Shearing Blow) shows while its boss
//    still casts it; a told one (Tempering Strike, Elemental Strike,
//    Wellspring Brand) while its boss is still on them.
//  - BusterLast: the same line in its last second (the sheet pulses it once
//    more as the kind turns). TankBusterLatch keeps it there for the rest of
//    that alert and plays each pulse once (no entry pulse on a short hit).
//  - Hidden otherwise, and while dead.

import {
  type HeartBusterKey,
  heartTankBusterByCode,
  TANK_BUSTER_AURA,
} from '../../../sim/encounters/smith_heart/tank_buster_ids';
import {
  HEART_TANK_SWAPS,
  type HeartTankSwap,
  heartTankSwapAt,
} from '../../../sim/encounters/smith_heart/tank_swap_ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';

export type TankSwapAlertKind = 'swap';

/** Every kind class the painter toggles (the CSS keys on them). */
export const TANK_SWAP_ALERT_KINDS: readonly TankSwapAlertKind[] = ['swap'];

export type TankSwapAlertLive = Omit<EncounterAlertLive, 'kind'> & { kind: TankSwapAlertKind };
export type TankSwapAlertView = TankSwapAlertLive | EncounterAlertHidden;

const HIDDEN: EncounterAlertHidden = { visible: false };

export interface TankSwapAura {
  id: string;
  value?: number;
  remaining?: number;
  duration?: number;
  stacks?: number;
  value3?: number;
  sourceId?: number;
}

export interface TankSwapBody {
  id: number;
  dead?: boolean;
  auras: readonly TankSwapAura[];
  /** A mob's current target (its tank). */
  aggroTargetId?: number | null;
  /** A body's bar under way (a bar buster shows while it runs). */
  castingAbility?: string | null;
}

export interface TankSwapAlertInput {
  self: TankSwapBody;
  entity: (id: number) => TankSwapBody | undefined;
}

/** Each swap debuff id to its family (built once). */
const SWAP_BY_AURA: ReadonlyMap<string, HeartTankSwap> = new Map(
  HEART_TANK_SWAPS.flatMap((s) => s.auras.map((id) => [id, s] as const)),
);

/** A swap aura's stacks: the wire omits a single stack, so present means 1. */
const stacksOf = (a: TankSwapAura) => Math.max(1, Math.round(a.stacks ?? 1));

/** Does the aura's boss still have `bodyId` as its target? An unseen source
 *  (out of the mirror's range, or none recorded) counts as yes. */
function stillTanking(
  a: TankSwapAura,
  bodyId: number,
  entity: TankSwapAlertInput['entity'],
): boolean {
  if (a.sourceId === undefined) return true;
  const boss = entity(a.sourceId);
  if (!boss || boss.dead) return true;
  const target = boss.aggroTargetId ?? null;
  return target === null || target === bodyId;
}

/** The swap aura on `body` due at its count, its boss still on `body`. */
function dueOn(
  body: TankSwapBody,
  entity: TankSwapAlertInput['entity'],
): { aura: TankSwapAura; swap: HeartTankSwap; stacks: number } | null {
  for (const a of body.auras) {
    const swap = SWAP_BY_AURA.get(a.id);
    if (!swap) continue;
    const stacks = stacksOf(a);
    if (stacks < heartTankSwapAt(swap, a.value3)) continue;
    if (!stillTanking(a, body.id, entity)) continue;
    return { aura: a, swap, stacks };
  }
  return null;
}

const whole = (v: number) => formatNumber(Math.max(0, Math.ceil(v)), { maximumFractionDigits: 0 });

export function buildTankSwapAlertView(input: TankSwapAlertInput): TankSwapAlertView {
  const self = input.self;
  if (self.dead) return HIDDEN;
  const mine = dueOn(self, input.entity);
  if (mine) {
    const left = Math.max(0, mine.aura.remaining ?? 0);
    const total = Math.max(1e-6, mine.aura.duration ?? left);
    const seconds = whole(left);
    const title = t('hudChrome.tankSwap.swapTitle', {
      stacks: formatNumber(mine.stacks, { maximumFractionDigits: 0 }),
    });
    return {
      visible: true,
      kind: 'swap',
      title,
      line: '',
      hint: '',
      key: '',
      progress: total > 1e-6 ? Math.max(0, Math.min(1, left / total)) : 0,
      progressAria: t('hudChrome.tankSwap.timeAria', { seconds }),
      barLabel: '',
      pressable: false,
      buttonAria: title,
    };
  }
  return HIDDEN;
}

// ---- the tank buster alert ------------------------------------------------------------------

/** The line's states, each a class the sheet keys its pulses on:
 *  - busterEnter: just landed, the entry pulse plays (never on a short hit);
 *  - buster: steady, no motion;
 *  - busterLast: the last second has just begun, the last-second pulse plays;
 *  - busterLastHold: the rest of the last second, a steady glow, no motion.
 *  Only the two pulsing kinds carry an animation, each for its pulse's length,
 *  so re-showing the panel in a steady kind never replays a pulse. */
export type TankBusterAlertKind = 'busterEnter' | 'buster' | 'busterLast' | 'busterLastHold';

/** Every kind class the painter toggles (the CSS keys on them). */
export const TANK_BUSTER_ALERT_KINDS: readonly TankBusterAlertKind[] = [
  'busterEnter',
  'buster',
  'busterLast',
  'busterLastHold',
];

/** Seconds before the hit at which the line turns `busterLast` (its second pulse). */
export const TANK_BUSTER_LAST_SECONDS = 1;

/** The entry pulse's and the last-second pulse's lengths (seconds; the sheet's
 *  heart-tank-buster-in and heart-tank-buster-last animations run as long). */
export const TANK_BUSTER_ENTER_PULSE_SECONDS = 0.4;
export const TANK_BUSTER_LAST_PULSE_SECONDS = 0.45;

/** A hit told this short (its marker's whole countdown, seconds) skips the
 *  entry pulse: the last-second pulse alone, never two pulses stacked. */
export const TANK_BUSTER_SHORT_SECONDS = 1.5;

/** How long a vanished marker still counts as the same alert (seconds): a late
 *  snapshot that drops and re-lays it is one alert, not a new one. */
export const TANK_BUSTER_GRACE_SECONDS = 0.5;

/**
 * The alert's per-instance memory (pure: the caller hands it the UI clock).
 * An instance is one marker: its buster, its boss and its countdown's length.
 * Once an instance enters its last second it stays there until it ends, even
 * if a snapshot pushes the countdown back above the line, and each pulse plays
 * at most once per instance.
 */
export class TankBusterLatch {
  private key: string | null = null;
  private startAt = 0;
  private seenAt = Number.NEGATIVE_INFINITY;
  private lastAt: number | null = null;
  private short = false;

  /** The kind for instance `key` at `left` seconds out of `total`, at `now`. */
  kind(key: string, left: number, total: number, now: number): TankBusterAlertKind {
    if (key !== this.key || now - this.seenAt > TANK_BUSTER_GRACE_SECONDS) {
      this.key = key;
      this.startAt = now;
      this.lastAt = null;
      this.short = total <= TANK_BUSTER_SHORT_SECONDS + 1e-6;
    }
    this.seenAt = now;
    if (this.lastAt === null && left <= TANK_BUSTER_LAST_SECONDS) this.lastAt = now;
    if (this.lastAt !== null)
      return now - this.lastAt < TANK_BUSTER_LAST_PULSE_SECONDS ? 'busterLast' : 'busterLastHold';
    if (!this.short && now - this.startAt < TANK_BUSTER_ENTER_PULSE_SECONDS) return 'busterEnter';
    return 'buster';
  }
}

/** The tank buster alert's input: the swap's, plus the latch and the UI clock
 *  (seconds) when the caller keeps one (the HUD does; without it the kind is
 *  read from the countdown alone). */
export interface TankBusterAlertInput extends TankSwapAlertInput {
  latch?: TankBusterLatch;
  now?: number;
}

/** The CSS class that seats the alert in the tank corner (components.css
 *  `#heart-tank-buster.tank-corner`: desktop just above the tank swap chip,
 *  right of the action bar beside the boss's frame; touch beside the swap
 *  chip, under the minimap), never the screen's middle. */
export const TANK_BUSTER_PLACEMENT_CLASS = 'tank-corner';

/** The alert's mount (the shared encounter alert painter's look): its root
 *  id, its root classes (the compact chip, seated by the placement class) and
 *  its kind classes. */
export const TANK_BUSTER_ALERT_LOOK = {
  id: 'heart-tank-buster',
  className: `ui-panel-strong encounter-alert heart-tank-buster ${TANK_BUSTER_PLACEMENT_CLASS}`,
  kinds: TANK_BUSTER_ALERT_KINDS,
} as const;

export type TankBusterAlertLive = Omit<EncounterAlertLive, 'kind'> & { kind: TankBusterAlertKind };
export type TankBusterAlertView = TankBusterAlertLive | EncounterAlertHidden;

/** Each buster's name in the catalog (a static key per buster). */
function busterName(key: HeartBusterKey): string {
  switch (key) {
    case 'weight':
      return t('hudChrome.tankBuster.weight');
    case 'blow':
      return t('hudChrome.tankBuster.blow');
    case 'thunder':
      return t('hudChrome.tankBuster.thunder');
    case 'tempering':
      return t('hudChrome.tankBuster.tempering');
    case 'strike':
      return t('hudChrome.tankBuster.strike');
    case 'shear':
      return t('hudChrome.tankBuster.shear');
    case 'brand':
      return t('hudChrome.tankBuster.brand');
  }
}

const tenths = (v: number) =>
  formatNumber(Math.max(0, Math.ceil(v * 10 - 1e-6) / 10), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

export function buildTankBusterAlertView(input: TankBusterAlertInput): TankBusterAlertView {
  const self = input.self;
  if (self.dead) return HIDDEN;
  let mark: TankSwapAura | null = null;
  for (const a of self.auras)
    if (a.id === TANK_BUSTER_AURA) {
      mark = a;
      break;
    }
  if (!mark) return HIDDEN;
  const buster = heartTankBusterByCode(mark.value);
  if (!buster) return HIDDEN;
  const left = Math.max(0, mark.remaining ?? 0);
  if (left <= 0) return HIDDEN;
  // Its boss, when the mirror sees it: a bar buster ends with its bar, a told
  // one once the boss has turned to another tank.
  const boss = mark.sourceId !== undefined ? input.entity(mark.sourceId) : undefined;
  if (boss && !boss.dead) {
    if (buster.cast !== null && boss.castingAbility !== buster.cast) return HIDDEN;
    if (buster.cast === null && !stillTanking(mark, self.id, input.entity)) return HIDDEN;
  }
  const total = Math.max(1e-6, mark.duration ?? left);
  const title = busterName(buster.key);
  const seconds = tenths(left);
  // One compact line: the name and the countdown (no "On you" under it; the
  // owner's call of 2026-11-27).
  const kind: TankBusterAlertKind =
    input.latch && input.now !== undefined
      ? input.latch.kind(
          `${buster.code}:${mark.sourceId ?? -1}:${Math.round(total * 10)}`,
          left,
          total,
          input.now,
        )
      : left <= TANK_BUSTER_LAST_SECONDS
        ? 'busterLast'
        : 'buster';
  return {
    visible: true,
    kind,
    title,
    line: '',
    hint: '',
    key: '',
    progress: Math.max(0, Math.min(1, left / total)),
    progressAria: t('hudChrome.tankBuster.timeAria', { name: title, seconds }),
    barLabel: t('hudChrome.tankBuster.seconds', { seconds }),
    pressable: false,
    buttonAria: title,
  };
}
