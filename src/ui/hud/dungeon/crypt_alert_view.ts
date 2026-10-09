// The Hollow Crypt's encounter alert: the pure, DOM-free view core. It teaches
// the reworked fights from what the sim already mirrors (encounters/
// hollow_crypt: marrow.ts, lady.ts, lady_embrace.ts, ilvane.ts, morthen*.ts,
// knellwyrm_knell.ts): the auras on the player, the bosses' cast bars and the
// encounter objects whose template id carries their state.
//  - Measured for the Grave (Sexton Marrow's mark on the local player): a
//    grave caves in where they stand when it runs out, carry it to the edge of
//    the yard;
//  - the Frozen Embrace (the Lady holds them aloft): the group must hurt her
//    to make her set them down;
//  - the Bride's Lament being wailed (on every player): its value2 says whether
//    a lit lantern has room for the local player where they stand (1: hold
//    still) or not (0: get into a lit lantern's light, two to a lantern);
//  - standing in an Open Grave (Grave Dirt): get out;
//  - the Knellwyrm's heroic Burning Knell: standing in the marked half of the
//    Rite Ring while the mark's bar runs, get to the other half;
//  - Morthen's heroic Grasp of the Grave: standing in a ring before its hands
//    erupt (anyone's ring; the bar is the player's own mark when it is theirs),
//    step out of it;
//  - Reap the Unquiet: standing in its arc in front of Morthen while the bar
//    runs, when the sweep is not aimed at the player (the tank cannot leave
//    it), get behind him;
//  - read off the player's target: Marrow ringing the Burial Bell (immune, the
//    Toll is coming) and Cantor Ilvane under Harmony (kill the Choristers
//    first, with the share her living Choristers take off);
//  - then the two SOFT readouts (CRYPT_SOFT_ALERT_KINDS: they give the shared
//    slot to the use prompt, so a player at a candle still sees how to relight
//    it): the Rite of the Unquiet (Grave Chill is on every player while it
//    holds: relight the candles, with the count lit; on heroic, follow the
//    Ledger, it names the next candle) and a Bound Soul drifting toward
//    Morthen (step into its path).
// Every bar is the threat's own time left (the mark, or the caster's bar).
// Priority: the order above (the strike about to land on you first). The
// Dirge's silence is a plain silence and needs no alert. The painter is the
// shared encounter alert's (encounter_alert_painter.ts); every decision is here.

import {
  KNELL_HALF_MARK_TEMPLATE,
  KNELL_TUNING,
  KNELLWYRM_KNELL_MARK,
  RITE_RING,
} from '../../../sim/encounters/hollow_crypt/ids';
import { ILVANE_HARMONY, ILVANE_ID } from '../../../sim/encounters/hollow_crypt/ilvane_ids';
import { LADY_EMBRACED, LADY_LAMENT_DREAD } from '../../../sim/encounters/hollow_crypt/lady_ids';
import {
  MARROW_GRAVE_DIRT,
  MARROW_ID,
  MARROW_MEASURED,
  MARROW_TOLLING,
} from '../../../sim/encounters/hollow_crypt/marrow_ids';
import {
  MORTHEN_GRASP_MARK,
  MORTHEN_GRASP_TEMPLATE,
  MORTHEN_GRAVE_CHILL,
  MORTHEN_REAP,
  MORTHEN_TUNING,
  RITE_CANDLE_LIT,
  RITE_CANDLE_NAMED,
} from '../../../sim/encounters/hollow_crypt/morthen_ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';
import { inArc } from './sanctum_alert_view';

export type CryptAlertKind =
  | 'measured'
  | 'embraced'
  | 'lament-sheltered'
  | 'lament-open'
  | 'grave'
  | 'knell'
  | 'grasp'
  | 'reap'
  | 'toll'
  | 'harmony'
  | 'rite'
  | 'rite-named'
  | 'soul';

/** Every kind class the painter toggles (the CSS keys on them). */
export const CRYPT_ALERT_KINDS: readonly CryptAlertKind[] = [
  'measured',
  'embraced',
  'lament-sheltered',
  'lament-open',
  'grave',
  'knell',
  'grasp',
  'reap',
  'toll',
  'harmony',
  'rite',
  'rite-named',
  'soul',
];

/** The readouts that yield the shared prompt slot to the use prompt (a player
 *  at a Remembrance Candle needs the relight prompt more than the reminder). */
export const CRYPT_SOFT_ALERT_KINDS: ReadonlySet<CryptAlertKind> = new Set<CryptAlertKind>([
  'rite',
  'rite-named',
  'soul',
]);

export type CryptAlertLive = Omit<EncounterAlertLive, 'kind'> & { kind: CryptAlertKind };
export type CryptAlertView = CryptAlertLive | EncounterAlertHidden;

const HIDDEN: EncounterAlertHidden = { visible: false };

/** Extra yards past a strike's stated reach a warning still fires at (Morthen's
 *  body is wide, a ring's edge is drawn soft; a warning errs toward telling). */
const REACH_MARGIN = 1;

/** How near (yards, flat) a Bound Soul in flight must be for the alert to call
 *  it: anywhere on the Rite Ring (its diameter), never from outside the room. */
export const SOUL_ALERT_RADIUS = RITE_RING.r * 2;

interface AlertAura {
  id: string;
  remaining?: number;
  duration?: number;
  value?: number;
  value2?: number;
}

/** A body the alert reads (a boss, a crypt encounter object). */
export interface CryptAlertEntity {
  id?: number;
  kind?: string;
  templateId?: string;
  dead?: boolean;
  pos?: { x: number; y?: number; z: number };
  facing?: number;
  scale?: number;
  auras?: readonly AlertAura[];
  castingAbility?: string | null;
  castTargetId?: number | null;
  castRemaining?: number;
  castTotal?: number;
}

/** The crypt bodies the alert reads that are not the player
 *  (crypt_alert_scene_core.ts keeps them off the roster). */
export interface CryptAlertScene {
  morthen: CryptAlertEntity | null;
  knellwyrm: CryptAlertEntity | null;
  /** The Remembrance Candle objects (any state: dark, named, lit). */
  candles: readonly CryptAlertEntity[];
  /** The Bound Souls in flight. */
  souls: readonly CryptAlertEntity[];
  /** The Grasp of the Grave rings (gathering or erupted). */
  grasps: readonly CryptAlertEntity[];
  /** The Burning Knell's halves (marked or burning). */
  halves: readonly CryptAlertEntity[];
}

export const EMPTY_CRYPT_SCENE: CryptAlertScene = {
  morthen: null,
  knellwyrm: null,
  candles: [],
  souls: [],
  grasps: [],
  halves: [],
};

export interface CryptAlertInput {
  auras: readonly AlertAura[];
  targetId: number | null | undefined;
  entity: (id: number) => CryptAlertEntity | null | undefined;
  /** The local player (the floor readouts need who and where they are). */
  selfId?: number;
  selfPos?: { x: number; z: number };
  scene?: CryptAlertScene;
}

function auraOf(auras: readonly AlertAura[] | undefined, id: string): AlertAura | null {
  if (!auras) return null;
  for (const a of auras) if (a.id === id) return a;
  return null;
}

function timeLeft(a: AlertAura): number {
  if (!a.duration || a.duration <= 0 || a.remaining === undefined) return 0;
  return Math.max(0, Math.min(1, a.remaining / a.duration));
}

function barShare(e: CryptAlertEntity): number | null {
  if (!e.castTotal || e.castTotal <= 0 || e.castRemaining === undefined) return null;
  return Math.max(0, Math.min(1, e.castRemaining / e.castTotal));
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Is `p` inside the half of the Rite Ring a Burning Knell object marks:
 *  within its reach (`scale`) of the ring's centre (the object's position), on
 *  the side of the diameter its `facing` points to? The sim's inKnellHalf,
 *  measured off the object so it needs no instance origin (a yard of margin,
 *  erring toward telling). */
export function inMarkedHalf(
  half: CryptAlertEntity,
  p: { x: number; y?: number; z: number },
): boolean {
  if (!half.pos) return false;
  // Only the crag top burns (the sim's KNELL_TUNING.floorBand): the Choir Loft
  // below the south rim is inside the reach on the map but far under the fire.
  if (p.y !== undefined && half.pos.y !== undefined && p.y < half.pos.y - KNELL_TUNING.floorBand)
    return false;
  const dx = p.x - half.pos.x;
  const dz = p.z - half.pos.z;
  if (Math.hypot(dx, dz) > (half.scale ?? 0) + REACH_MARGIN) return false;
  const yaw = half.facing ?? 0;
  return dx * Math.sin(yaw) + dz * Math.cos(yaw) >= -REACH_MARGIN;
}

function live(
  kind: CryptAlertKind,
  title: string,
  line: string,
  progress: number | null,
  seconds: number | null,
): CryptAlertLive {
  return {
    visible: true,
    kind,
    title,
    line,
    hint: '',
    key: '',
    progress,
    progressAria:
      seconds === null
        ? ''
        : t('hudChrome.cryptAlert.timeAria', {
            seconds: formatNumber(Math.max(0, Math.ceil(seconds)), { maximumFractionDigits: 0 }),
          }),
    pressable: false,
    buttonAria: title,
  };
}

/** An alert whose bar is an aura's own time left (or none). */
function fromMark(
  kind: CryptAlertKind,
  title: string,
  line: string,
  mark: AlertAura | null,
): CryptAlertLive {
  return live(kind, title, line, mark ? timeLeft(mark) : null, mark ? (mark.remaining ?? 0) : null);
}

/** The readout for the player's target: Marrow at the bell, Ilvane in Harmony. */
function targetAlert(input: CryptAlertInput): CryptAlertView {
  if (input.targetId === null || input.targetId === undefined) return HIDDEN;
  const target = input.entity(input.targetId);
  if (!target || target.dead) return HIDDEN;
  if (target.templateId === MARROW_ID && auraOf(target.auras, MARROW_TOLLING))
    return fromMark(
      'toll',
      t('hudChrome.cryptAlert.tollTitle'),
      t('hudChrome.cryptAlert.tollLine'),
      null,
    );
  if (target.templateId === ILVANE_ID) {
    const harmony = auraOf(target.auras, ILVANE_HARMONY);
    if (harmony && (harmony.value ?? 0) > 0) {
      const pct = formatNumber(Math.round((harmony.value ?? 0) * 100), {
        maximumFractionDigits: 0,
      });
      return fromMark(
        'harmony',
        t('hudChrome.cryptAlert.harmonyTitle'),
        t('hudChrome.cryptAlert.harmonyLine', { pct }),
        null,
      );
    }
  }
  return HIDDEN;
}

/** The floor threats of the Rite Ring (the Knell's half, a Grasp ring, the
 *  Reap's arc): hidden when none is about to land on the player. */
function ringAlert(input: CryptAlertInput, scene: CryptAlertScene): CryptAlertView {
  const me = input.selfPos;
  if (!me) return HIDDEN;
  // The Burning Knell's marked half (the bar is the wyrm's mark bar).
  for (const half of scene.halves) {
    if (half.templateId !== KNELL_HALF_MARK_TEMPLATE || !inMarkedHalf(half, me)) continue;
    const w = scene.knellwyrm;
    const bar = w && !w.dead && w.castingAbility === KNELLWYRM_KNELL_MARK ? w : null;
    return live(
      'knell',
      t('hudChrome.cryptAlert.knellTitle'),
      t('hudChrome.cryptAlert.knellLine'),
      bar ? barShare(bar) : null,
      bar?.castRemaining ?? null,
    );
  }
  // A gathering Grasp of the Grave ring (anyone's): the bar is the player's own
  // mark when they carry one.
  for (const ring of scene.grasps) {
    if (ring.templateId !== MORTHEN_GRASP_TEMPLATE || !ring.pos) continue;
    const r = ring.scale && ring.scale > 0 ? ring.scale : MORTHEN_TUNING.graspRadius;
    if (dist(ring.pos, me) > r + REACH_MARGIN) continue;
    return fromMark(
      'grasp',
      t('hudChrome.cryptAlert.graspTitle'),
      t('hudChrome.cryptAlert.graspLine'),
      auraOf(input.auras, MORTHEN_GRASP_MARK),
    );
  }
  // Reap the Unquiet's arc in front of him (his facing is locked to the
  // sweep), when it is not aimed at the player.
  const m = scene.morthen;
  if (
    m &&
    !m.dead &&
    m.pos &&
    m.castingAbility === MORTHEN_REAP &&
    (input.selfId === undefined || m.castTargetId !== input.selfId) &&
    inArc(
      m.pos,
      m.facing ?? 0,
      me,
      MORTHEN_TUNING.reapRange + REACH_MARGIN,
      MORTHEN_TUNING.reapArcDeg,
    )
  ) {
    return live(
      'reap',
      t('hudChrome.cryptAlert.reapTitle'),
      t('hudChrome.cryptAlert.reapLine'),
      barShare(m),
      m.castRemaining ?? null,
    );
  }
  return HIDDEN;
}

/** The soft readouts: the Rite's candles, a Bound Soul on its way. */
function softAlert(input: CryptAlertInput, scene: CryptAlertScene): CryptAlertView {
  if (auraOf(input.auras, MORTHEN_GRAVE_CHILL)) {
    let lit = 0;
    let named = false;
    for (const c of scene.candles) {
      if (c.templateId === RITE_CANDLE_LIT) lit++;
      else if (c.templateId === RITE_CANDLE_NAMED) named = true;
    }
    const nums = {
      lit: formatNumber(lit, { maximumFractionDigits: 0 }),
      total: formatNumber(scene.candles.length, { maximumFractionDigits: 0 }),
    };
    return fromMark(
      named ? 'rite-named' : 'rite',
      t('hudChrome.cryptAlert.riteTitle'),
      named
        ? t('hudChrome.cryptAlert.riteNamedLine', nums)
        : t('hudChrome.cryptAlert.riteLine', nums),
      null,
    );
  }
  const me = input.selfPos;
  if (me) {
    for (const soul of scene.souls) {
      if (!soul.pos || dist(soul.pos, me) > SOUL_ALERT_RADIUS) continue;
      return fromMark(
        'soul',
        t('hudChrome.cryptAlert.soulTitle'),
        t('hudChrome.cryptAlert.soulLine'),
        null,
      );
    }
  }
  return HIDDEN;
}

export function buildCryptAlertView(input: CryptAlertInput): CryptAlertView {
  const scene = input.scene ?? EMPTY_CRYPT_SCENE;
  const measured = auraOf(input.auras, MARROW_MEASURED);
  if (measured)
    return fromMark(
      'measured',
      t('hudChrome.cryptAlert.measuredTitle'),
      t('hudChrome.cryptAlert.measuredLine'),
      measured,
    );
  const embraced = auraOf(input.auras, LADY_EMBRACED);
  if (embraced)
    return fromMark(
      'embraced',
      t('hudChrome.cryptAlert.embracedTitle'),
      t('hudChrome.cryptAlert.embracedLine'),
      embraced,
    );
  const lament = auraOf(input.auras, LADY_LAMENT_DREAD);
  if (lament) {
    // value2 1: a lit lantern's light with room for the player where they stand.
    const sheltered = lament.value2 === 1;
    return fromMark(
      sheltered ? 'lament-sheltered' : 'lament-open',
      t('hudChrome.cryptAlert.lamentTitle'),
      sheltered
        ? t('hudChrome.cryptAlert.lamentShelteredLine')
        : t('hudChrome.cryptAlert.lamentOpenLine'),
      lament,
    );
  }
  if (auraOf(input.auras, MARROW_GRAVE_DIRT))
    return fromMark(
      'grave',
      t('hudChrome.cryptAlert.graveTitle'),
      t('hudChrome.cryptAlert.graveLine'),
      null,
    );
  const ring = ringAlert(input, scene);
  if (ring.visible) return ring;
  const target = targetAlert(input);
  if (target.visible) return target;
  return softAlert(input, scene);
}
