// The Smith's Heart's Hammer Council alert: the pure, DOM-free view core. It
// tells the local player what a council mark asks of them, read off the auras
// the sim already mirrors (encounters/smith_heart/council*.ts):
//  - Falling Rock on you: gather three or more, away from the pillars;
//  - Wake the Stone on you: a pillar rises where you stand, so stand where the
//    cover should go;
//  - Hammer's Weight (a tank): the other tank takes the Guardian;
//  - Resonance: by a pillar you crack it; the line turns urgent while a crack
//    is climbing (the aura's value is the share of its 3 s stood).
//  - Mythic, while a soul pillar stands: the rock and Resonance lines say
//    their second duty (break its soul pips), and a climb on a soul pillar
//    reads as the good news it is (stay), never as the urgent crack.
// Every bar is the mark's own time left. Priority: the rock over the wake
// over the Weight over Resonance. The painter is the shared encounter alert's
// (encounter_alert_painter.ts); every decision is here.

import { COUNCIL_AURAS, councilSoulOf } from '../../../sim/encounters/smith_heart/council_ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';

export type CouncilAlertKind = 'rock' | 'wake' | 'weight' | 'resonance' | 'cracking';

/** Every kind class the painter toggles (the CSS keys on them). */
export const COUNCIL_ALERT_KINDS: readonly CouncilAlertKind[] = [
  'rock',
  'wake',
  'weight',
  'resonance',
  'cracking',
];

export type CouncilAlertLive = Omit<EncounterAlertLive, 'kind'> & { kind: CouncilAlertKind };
export type CouncilAlertView = CouncilAlertLive | EncounterAlertHidden;

const HIDDEN: EncounterAlertHidden = { visible: false };

interface AlertAura {
  id: string;
  remaining?: number;
  duration?: number;
  value?: number;
  value2?: number;
}

export interface CouncilAlertInput {
  auras: readonly AlertAura[];
  /** Mythic: does a soul pillar stand (asked only while a rock or a
   *  Resonance mark is on the player), and is this entity one? */
  soul?: { stands(): boolean; is(id: number): boolean };
}

function auraOf(auras: readonly AlertAura[], id: string): AlertAura | null {
  for (const a of auras) if (a.id === id) return a;
  return null;
}

function timeLeft(a: AlertAura): number {
  if (!a.duration || a.duration <= 0 || a.remaining === undefined) return 0;
  return Math.max(0, Math.min(1, a.remaining / a.duration));
}

function live(
  kind: CouncilAlertKind,
  title: string,
  line: string,
  mark: AlertAura,
): CouncilAlertLive {
  const seconds = formatNumber(Math.max(0, Math.ceil(mark.remaining ?? 0)), {
    maximumFractionDigits: 0,
  });
  return {
    visible: true,
    kind,
    title,
    line,
    hint: '',
    key: '',
    progress: timeLeft(mark),
    progressAria: t('hudChrome.council.alert.timeAria', { seconds }),
    pressable: false,
    buttonAria: title,
  };
}

/** The world as the soul scan reads it. */
export interface CouncilSoulWorld {
  entities: ReadonlyMap<number, { kind?: string; templateId: string }>;
}

/** Mythic's soul pillars as the alert asks about them: set to the frame's
 *  world, scanned at most once a frame and only when asked (while a rock or a
 *  Resonance mark is on the player). Allocates nothing per frame. */
export class CouncilSoulScan {
  private world: CouncilSoulWorld | null = null;
  private cached: boolean | null = null;

  /** This frame's world (the cached answer forgets the last frame's). */
  frame(world: CouncilSoulWorld | null | undefined): this {
    this.world = world ?? null;
    this.cached = null;
    return this;
  }

  stands(): boolean {
    if (this.cached !== null) return this.cached;
    let found = false;
    if (this.world)
      for (const e of this.world.entities.values())
        if (e.kind === 'object' && councilSoulOf(e.templateId)) {
          found = true;
          break;
        }
    this.cached = found;
    return found;
  }

  is(id: number): boolean {
    const e = this.world?.entities.get(id);
    return !!e && e.kind === 'object' && councilSoulOf(e.templateId) !== null;
  }
}

export function buildCouncilAlertView(input: CouncilAlertInput): CouncilAlertView {
  const rock = auraOf(input.auras, COUNCIL_AURAS.rockMark);
  if (rock)
    return live(
      'rock',
      t('hudChrome.council.alert.rockTitle'),
      input.soul?.stands()
        ? t('hudChrome.council.alert.rockLineSoul')
        : t('hudChrome.council.alert.rockLine'),
      rock,
    );
  const wake = auraOf(input.auras, COUNCIL_AURAS.wakeMark);
  if (wake)
    return live(
      'wake',
      t('hudChrome.council.alert.wakeTitle'),
      t('hudChrome.council.alert.wakeLine'),
      wake,
    );
  const weight = auraOf(input.auras, COUNCIL_AURAS.weight);
  if (weight)
    return live(
      'weight',
      t('hudChrome.council.alert.weightTitle'),
      t('hudChrome.council.alert.weightLine'),
      weight,
    );
  const res = auraOf(input.auras, COUNCIL_AURAS.resonance);
  if (res) {
    const cracking = (res.value ?? 0) > 0;
    // The pillar it climbs on is its value2: a soul pillar's pip is the point.
    const onSoul = cracking && !!res.value2 && (input.soul?.is(res.value2) ?? false);
    const line = onSoul
      ? t('hudChrome.council.alert.resonanceBreaking')
      : cracking
        ? t('hudChrome.council.alert.resonanceCracking')
        : input.soul?.stands()
          ? t('hudChrome.council.alert.resonanceLineSoul')
          : t('hudChrome.council.alert.resonanceLine');
    return live(
      onSoul ? 'resonance' : cracking ? 'cracking' : 'resonance',
      t('hudChrome.council.alert.resonanceTitle'),
      line,
      res,
    );
  }
  return HIDDEN;
}
