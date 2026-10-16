// The Wildheart Basin's encounter alert: the pure, DOM-free view core. It tells
// the local player what a Basin mechanic asks of them, read off the auras and
// entities the sim already mirrors (encounters/wildheart_basin):
//  - standing in the half the Idol's Breath marks (Zulgar's final phase): cross
//    to the other half; the bar is the warning's own clock;
//  - marked as Zulgar's Prey (the jade claw): run him across the lit sun
//    glyphs (with nobody else free to light them, light one yourself); on
//    heroic Twin Prey the line says whether he is chasing you now;
//  - Pinned by his Hunting Spear: a teammate must pull it out, or, with nobody
//    free to help, you pull it out yourself;
//  - Stalked by the Fanglord's Great Jaguar (the fang mark): kite it away from
//    its master;
//  - Pollinated by the Gorgebloom: stay off the seeds;
//  - Zulgar is Sunstruck: his damage window is open;
//  - a Hunting Spear pins an ally: pull it out;
//  - Zulgar hunts and you are not the Prey: light the dark sun glyphs (and
//    while you stand lighting one, its bar);
//  - targeting the Beastmaster or his jaguar while Pack Bond holds: pull them
//    apart.
// Priority is that order. The Great Saurian's totem rework sits between the
// personal marks and Zulgar's readouts (wildheart_saurian_alert_view.ts: its
// Stomp's ring, a Sap Totem to break, the heroic drum's rule). Two kinds are SOFT (`WILDHEART_SOFT_ALERT_KINDS`):
// they tell the player about a spear to pull, so they give the shared slot to
// the use prompt once the spear is near enough for it to offer the press. The
// painter is the shared encounter alert's (encounter_alert_painter.ts); every
// decision is here.

import { SUN_GLYPHS, ZULGAR_SPOT } from '../../../sim/content/wildheart_basin_layout';
import {
  BEAST_PACK_BOND,
  BEAST_STALKED,
  BEASTMASTER_ID,
  BLOOM_POLLINATED,
  FANGLORD_JAGUAR_ID,
  idolBreathSideOf,
  inIdolBreathHalf,
  WILDHEART_GLYPH_KINDLE,
  WILDHEART_IDOL_BREATH_WARNING,
  WILDHEART_SUN_GLYPH_DARK,
  ZULGAR_AVATAR,
  ZULGAR_PINNED,
  ZULGAR_PREY,
  ZULGAR_SUNSTRUCK_EXPOSED,
  ZULGAR_TERRACE_RADIUS,
  ZULGAR_TUNING,
} from '../../../sim/encounters/wildheart_basin/ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';
import {
  buildSaurianAlert,
  SAURIAN_ALERT_KINDS,
  type SaurianAlertEntity,
  type SaurianAlertKind,
} from './wildheart_saurian_alert_view';

export type WildheartAlertKind =
  | SaurianAlertKind
  | 'breath'
  | 'prey'
  | 'prey-alone'
  | 'prey-wait'
  | 'pinned'
  | 'pinned-self'
  | 'stalked'
  | 'pollinated'
  | 'sunstruck'
  | 'spear'
  | 'glyph-lighting'
  | 'glyph'
  | 'bonded';

/** Every kind class the painter toggles (the CSS keys on them). */
export const WILDHEART_ALERT_KINDS: readonly WildheartAlertKind[] = [
  ...SAURIAN_ALERT_KINDS,
  'breath',
  'prey',
  'prey-alone',
  'prey-wait',
  'pinned',
  'pinned-self',
  'stalked',
  'pollinated',
  'sunstruck',
  'spear',
  'glyph-lighting',
  'glyph',
  'bonded',
];

/** The kinds that give the shared slot to the use prompt when it has a spear
 *  to offer: both say "pull the spear", which the use prompt then IS. */
export const WILDHEART_SOFT_ALERT_KINDS: ReadonlySet<string> = new Set<WildheartAlertKind>([
  'pinned-self',
  'spear',
]);

export type WildheartAlertLive = Omit<EncounterAlertLive, 'kind'> & { kind: WildheartAlertKind };
export type WildheartAlertView = WildheartAlertLive | EncounterAlertHidden;

const HIDDEN: EncounterAlertHidden = { visible: false };

interface AlertAura {
  id: string;
  remaining?: number;
  duration?: number;
  value2?: number;
}

export interface WildheartAlertEntity {
  id?: number;
  templateId?: string;
  dead?: boolean;
  /** A released spirit (never counted among the living). */
  ghost?: boolean;
  hp?: number;
  auras?: readonly AlertAura[];
  pos?: { x: number; z: number };
  facing?: number;
  castingAbility?: string | null;
  castTargetId?: number | null;
  castRemaining?: number;
  castTotal?: number;
}

/** The bodies of Zulgar's fight (WildheartAlertSceneScan keeps them). */
export interface WildheartAlertScene {
  zulgar: WildheartAlertEntity | null;
  glyphs: readonly WildheartAlertEntity[];
  spears: readonly WildheartAlertEntity[];
  breaths: readonly WildheartAlertEntity[];
  /** Every player in view (who else stands free to light a glyph). */
  players: readonly WildheartAlertEntity[];
  /** The Great Saurian and its rider's Sap Totems
   *  (wildheart_saurian_alert_view.ts); absent in a scene with no ford. */
  saurian?: SaurianAlertEntity | null;
  sapTotems?: readonly SaurianAlertEntity[];
}

export const EMPTY_WILDHEART_SCENE: WildheartAlertScene = {
  zulgar: null,
  glyphs: [],
  spears: [],
  breaths: [],
  players: [],
  saurian: null,
  sapTotems: [],
};

export interface WildheartAlertInput {
  auras: readonly AlertAura[];
  targetId: number | null | undefined;
  entity: (id: number) => WildheartAlertEntity | null | undefined;
  /** The local player (the glyph they light, the half they stand in). */
  selfId?: number;
  selfPos?: { x: number; z: number };
  scene?: WildheartAlertScene;
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

function secondsText(seconds: number): string {
  return formatNumber(Math.max(0, Math.ceil(seconds)), { maximumFractionDigits: 0 });
}

function alert(
  kind: WildheartAlertKind,
  title: string,
  line: string,
  progress: number | null,
  seconds: number | null,
): WildheartAlertLive {
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
        : t('hudChrome.wildheartAlert.timeAria', { seconds: secondsText(seconds) }),
    pressable: false,
    buttonAria: title,
  };
}

/** An alert whose bar is a mark's own time left. */
function live(
  kind: WildheartAlertKind,
  title: string,
  line: string,
  mark: AlertAura | null,
): WildheartAlertLive {
  return alert(
    kind,
    title,
    line,
    mark ? timeLeft(mark) : null,
    mark ? (mark.remaining ?? 0) : null,
  );
}

/** How much of a body's own bar has run (0 as it opens, 1 as it ends). */
function barFill(e: WildheartAlertEntity): number {
  const total = e.castTotal ?? 0;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - (e.castRemaining ?? 0) / total));
}

/** The Idol's Breath warning the player stands in, or null (the sim's own
 *  half: inIdolBreathHalf off the object's centre line and facing). */
function breathOver(
  scene: WildheartAlertScene,
  me: { x: number; z: number },
): WildheartAlertEntity | null {
  for (const b of scene.breaths) {
    if (b.templateId !== WILDHEART_IDOL_BREATH_WARNING || !b.pos) continue;
    if (inIdolBreathHalf(me.x - b.pos.x, idolBreathSideOf(b.facing ?? 0))) return b;
  }
  return null;
}

/** The glyph ring's centre is 2 yd south of where Zulgar stands. */
const SPOT_FROM_RING = {
  x: ZULGAR_SPOT.x - SUN_GLYPHS.reduce((sum, g) => sum + g.x, 0) / SUN_GLYPHS.length,
  z: ZULGAR_SPOT.z - SUN_GLYPHS.reduce((sum, g) => sum + g.z, 0) / SUN_GLYPHS.length,
};

/** Nobody but the marked stands free on the terrace, so the Prey lights the
 *  glyphs themself: the sim's own fallback (zulgar_glyphs.ts), read off the
 *  glyph objects (the terrace's centre) and the players in view. */
function preyLightsAlone(scene: WildheartAlertScene, selfId: number | undefined): boolean {
  let n = 0;
  let cx = 0;
  let cz = 0;
  for (const g of scene.glyphs) {
    if (!g.pos) continue;
    cx += g.pos.x;
    cz += g.pos.z;
    n++;
  }
  if (n === 0) return false;
  cx = cx / n + SPOT_FROM_RING.x;
  cz = cz / n + SPOT_FROM_RING.z;
  for (const p of scene.players) {
    if (p.id === selfId || p.dead || p.ghost || !p.pos) continue;
    if (Math.hypot(p.pos.x - cx, p.pos.z - cz) > ZULGAR_TERRACE_RADIUS) continue;
    if (!auraOf(p.auras, ZULGAR_PREY)) return false;
  }
  return true;
}

export function buildWildheartAlertView(input: WildheartAlertInput): WildheartAlertView {
  const scene = input.scene ?? EMPTY_WILDHEART_SCENE;
  const zulgar = scene.zulgar && !scene.zulgar.dead ? scene.zulgar : null;
  // The stone jaguar's breath over the half the player stands in.
  if (zulgar && input.selfPos) {
    const breath = breathOver(scene, input.selfPos);
    if (breath)
      return alert(
        'breath',
        t('hudChrome.wildheartAlert.breathTitle'),
        t('hudChrome.wildheartAlert.breathLine'),
        1 - barFill(breath),
        breath.castRemaining ?? 0,
      );
  }
  const prey = auraOf(input.auras, ZULGAR_PREY);
  if (prey) {
    // value2 1 = he is chasing THIS prey now (always on normal's lone mark).
    const chased = prey.value2 !== 0;
    if (!chased)
      return live(
        'prey-wait',
        t('hudChrome.wildheartAlert.preyTitle'),
        t('hudChrome.wildheartAlert.preyWaitLine'),
        prey,
      );
    if (preyLightsAlone(scene, input.selfId))
      return live(
        'prey-alone',
        t('hudChrome.wildheartAlert.preyTitle'),
        t('hudChrome.wildheartAlert.preyAloneLine', {
          seconds: formatNumber(ZULGAR_TUNING.glyphKindleAloneSeconds, {
            maximumFractionDigits: 1,
          }),
        }),
        prey,
      );
    return live(
      'prey',
      t('hudChrome.wildheartAlert.preyTitle'),
      t('hudChrome.wildheartAlert.preyLine'),
      prey,
    );
  }
  const pinned = auraOf(input.auras, ZULGAR_PINNED);
  if (pinned) {
    // value2 1 = nobody stands free to help: the press is the player's own.
    const alone = pinned.value2 === 1;
    return live(
      alone ? 'pinned-self' : 'pinned',
      t('hudChrome.wildheartAlert.pinnedTitle'),
      alone
        ? t('hudChrome.wildheartAlert.pinnedSelfLine')
        : t('hudChrome.wildheartAlert.pinnedLine'),
      pinned,
    );
  }
  const stalked = auraOf(input.auras, BEAST_STALKED);
  if (stalked)
    return live(
      'stalked',
      t('hudChrome.wildheartAlert.stalkedTitle'),
      t('hudChrome.wildheartAlert.stalkedLine'),
      stalked,
    );
  const pollen = auraOf(input.auras, BLOOM_POLLINATED);
  if (pollen)
    return live(
      'pollinated',
      t('hudChrome.wildheartAlert.pollinatedTitle'),
      t('hudChrome.wildheartAlert.pollinatedLine'),
      pollen,
    );
  // The Great Saurian's ford (no boss fights there): its Stomp's ring, a Sap
  // Totem to break, the heroic drum (wildheart_saurian_alert_view.ts).
  if (scene.saurian) {
    const targeted =
      input.targetId !== null && input.targetId !== undefined
        ? input.entity(input.targetId)?.templateId
        : undefined;
    const ford = buildSaurianAlert(
      { saurian: scene.saurian, sapTotems: scene.sapTotems ?? [] },
      input.selfPos,
      targeted,
    );
    if (ford) return alert(ford.kind, ford.title, ford.line, ford.progress, ford.seconds);
  }
  if (zulgar) {
    const struck = auraOf(zulgar.auras, ZULGAR_SUNSTRUCK_EXPOSED);
    if (struck)
      return live(
        'sunstruck',
        t('hudChrome.wildheartAlert.sunstruckTitle'),
        t('hudChrome.wildheartAlert.sunstruckLine', {
          pct: formatNumber(Math.round(ZULGAR_TUNING.sunstruckVuln * 100), {
            maximumFractionDigits: 0,
          }),
        }),
        struck,
      );
    for (const spear of scene.spears) {
      if (spear.dead || (spear.hp ?? 1) <= 0) continue;
      return alert(
        'spear',
        t('hudChrome.wildheartAlert.spearTitle'),
        t('hudChrome.wildheartAlert.spearLine'),
        null,
        null,
      );
    }
    if (auraOf(zulgar.auras, ZULGAR_AVATAR)) {
      let open = false;
      for (const g of scene.glyphs) {
        if (g.templateId !== WILDHEART_SUN_GLYPH_DARK) continue;
        if (g.castingAbility === WILDHEART_GLYPH_KINDLE) {
          if (input.selfId !== undefined && g.castTargetId === input.selfId)
            return alert(
              'glyph-lighting',
              t('hudChrome.wildheartAlert.glyphLightingTitle'),
              t('hudChrome.wildheartAlert.glyphLightingLine'),
              barFill(g),
              g.castRemaining ?? 0,
            );
          open = true;
        } else if (!g.castingAbility) open = true;
      }
      if (open)
        return alert(
          'glyph',
          t('hudChrome.wildheartAlert.glyphTitle'),
          t('hudChrome.wildheartAlert.glyphLine', {
            seconds: formatNumber(ZULGAR_TUNING.glyphKindleSeconds, { maximumFractionDigits: 1 }),
            pct: formatNumber(Math.round(ZULGAR_TUNING.sunstruckVuln * 100), {
              maximumFractionDigits: 0,
            }),
            duration: formatNumber(ZULGAR_TUNING.sunstruckSeconds, { maximumFractionDigits: 1 }),
          }),
          null,
          null,
        );
    }
  }
  if (input.targetId !== null && input.targetId !== undefined) {
    const target = input.entity(input.targetId);
    const pair = target?.templateId === BEASTMASTER_ID || target?.templateId === FANGLORD_JAGUAR_ID;
    if (target && !target.dead && pair && auraOf(target.auras, BEAST_PACK_BOND))
      return live(
        'bonded',
        t('hudChrome.wildheartAlert.bondTitle'),
        t('hudChrome.wildheartAlert.bondLine'),
        null,
      );
  }
  return HIDDEN;
}
