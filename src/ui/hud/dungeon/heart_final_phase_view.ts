// The Masterless Strength's raid HUD: the pure, DOM-free view core of its
// phase readout (heart_final_phase_painter.ts paints it), read off the boss's
// auras the sim already mirrors (encounters/smith_heart/final_ids.ts and
// final_phase_ids.ts):
//   - Vein-Shaken's seconds left (Heroic: the state aura's `value3`), the
//     window a quarter change hits three times as hard;
//   - part 2 (the phase aura): through an intermission the call's seconds
//     and the living Splinters; the striding, the kneel, the rebirth; in the
//     final phase the soft enrage's seconds (then Masterless Fury's stacks);
//     Mythic's collapse, what falls next and when; the elements poured into
//     the boss on their own line all fight long.
// The four Overload bars and Heart Unbound's stacks are NOT here any more:
// they are the room's, the ring round the central well that the whole raid
// sees (Jose's brief of 2026-11-20; src/render/smith_heart_fx/
// final_overload_ring.ts). Through part 1 with no switch mark and nothing
// poured, the readout is hidden.
// Shown on every graphics tier and whatever the hints setting: these clocks
// are what the raid acts on. Allocation-light: one model, reused.

import type { SmithHeartVein } from '../../../sim/content/smith_heart_layout';
import { HEART_QUARTER_ORDER } from '../../../sim/content/smith_heart_quarters';
import { FINAL_AURAS, FINAL_BOSS } from '../../../sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS,
  FINAL_PHASES,
  finalStageOf,
  hiddenNextOf,
  pouredAuraId,
  veinsOfMask,
} from '../../../sim/encounters/smith_heart/final_phase_ids';
import { formatList, formatNumber, t } from '../../i18n';

export interface FinalPhaseAura {
  id: string;
  value?: number;
  value2?: number;
  value3?: number;
  remaining?: number;
  stacks?: number;
}

export interface FinalPhaseBoss {
  id: number;
  templateId: string;
  dead?: boolean;
  auras: readonly FinalPhaseAura[];
}

export interface FinalPhaseView {
  visible: boolean;
  /** Part 2's heading ('' through part 1). */
  title: string;
  /** Vein-Shaken's line ('' when none). */
  shaken: string;
  /** Part 2: the call's or the enrage's line ('' when none), and whether it
   *  is urgent (Masterless Fury, or its last seconds). */
  phase: string;
  phaseUrgent: boolean;
  /** Part 2: the living Splinters' line ('' when none). */
  splinters: string;
  /** The elements poured into it ('' when none). */
  poured: string;
}

const LABEL_KEYS: Readonly<Record<SmithHeartVein, string>> = {
  heat: 'hudChrome.finalOverload.heat',
  quench: 'hudChrome.finalOverload.quench',
  breath: 'hudChrome.finalOverload.breath',
  hammer: 'hudChrome.finalOverload.hammer',
};

const whole = (v: number) => formatNumber(Math.max(0, Math.ceil(v)), { maximumFractionDigits: 0 });
const n = (v: number) => formatNumber(Math.max(0, Math.round(v)), { maximumFractionDigits: 0 });

/** A fresh model (the painter keeps one and passes it back every frame). */
export function makeFinalPhaseView(): FinalPhaseView {
  return {
    visible: false,
    title: '',
    shaken: '',
    phase: '',
    phaseUrgent: false,
    splinters: '',
    poured: '',
  };
}

function auraOf(auras: readonly FinalPhaseAura[], id: string): FinalPhaseAura | null {
  for (const a of auras) if (a.id === id) return a;
  return null;
}

/** The view for `boss` (the claim's Masterless Strength, or null), written
 *  into `out`. */
export function buildFinalPhaseView(
  boss: FinalPhaseBoss | null,
  out: FinalPhaseView,
): FinalPhaseView {
  const state = boss && !boss.dead ? auraOf(boss.auras, FINAL_AURAS.state) : null;
  if (!boss || !state) {
    out.visible = false;
    return out;
  }
  const phase = auraOf(boss.auras, FINAL_PHASE_AURAS.phase);
  const stage = finalStageOf(phase?.value);
  const barsOff =
    stage === 'final' || stage === 'kneel' || stage === 'rebirth' || stage === 'collapse';
  const frozen = stage === 'leap' || stage === 'call' || stage === 'finalLeap';
  const shaken = Math.round(state.value3 ?? 0);
  out.shaken =
    shaken > 0 && !barsOff ? t('hudChrome.finalOverload.shaken', { seconds: whole(shaken) }) : '';
  phaseLines(boss, stage, phase, out);
  out.title = barsOff
    ? stage === 'final' || stage === 'kneel'
      ? t('hudChrome.finalOverload.titleFinal')
      : t('hudChrome.finalOverload.titleUnmade')
    : frozen
      ? t('hudChrome.finalOverload.titleCall')
      : '';
  out.visible = !!(out.title || out.shaken || out.phase || out.splinters || out.poured);
  return out;
}

/** Part 2's lines: the call and its Splinters, the enrage or the fury, the
 *  poured elements. */
function phaseLines(
  boss: FinalPhaseBoss,
  stage: ReturnType<typeof finalStageOf>,
  phase: FinalPhaseAura | null,
  out: FinalPhaseView,
): void {
  const secs = Math.max(0, Math.round(phase?.value3 ?? 0));
  out.phase = '';
  out.phaseUrgent = false;
  out.splinters = '';
  if (stage === 'call') {
    out.phase = t('hudChrome.finalOverload.call', { seconds: whole(secs) });
    out.phaseUrgent = secs <= 10;
    // The living Splinters: one per awake quarter (the mask; the wire drops
    // a stack count of one).
    out.splinters = t('hudChrome.finalOverload.splinters', {
      count: n(veinsOfMask(Math.round(phase?.value2 ?? 0)).length),
    });
  } else if (stage === 'leap' || stage === 'finalLeap') {
    out.phase = t('hudChrome.finalOverload.striding');
  } else if (stage === 'kneel') {
    out.phase = t('hudChrome.finalOverload.kneeling');
  } else if (stage === 'rebirth') {
    out.phase = t('hudChrome.finalOverload.rising');
    out.phaseUrgent = true;
  } else if (stage === 'collapse') {
    // What falls next and when (the hidden aura): always urgent, the bar is
    // the fight's clock now.
    const h = auraOf(boss.auras, FINAL_PHASE_AURAS.hidden);
    const next = hiddenNextOf(h?.value2);
    const left = Math.max(0, Math.round(h?.value3 ?? 0));
    out.phaseUrgent = next === 'ring' || left <= FINAL_PHASES.fallWarn;
    if (next === null) out.phase = t('hudChrome.finalOverload.allFallen');
    else if (next === 'ring')
      out.phase = t('hudChrome.finalOverload.ringFallsIn', { seconds: whole(left) });
    else
      out.phase = t('hudChrome.finalOverload.fallsIn', {
        quarter: t(LABEL_KEYS[next] as never),
        seconds: whole(left),
      });
  } else if (stage === 'final') {
    const fury = auraOf(boss.auras, FINAL_PHASE_AURAS.fury);
    const furyStacks = Math.round(fury?.value ?? fury?.stacks ?? 0);
    if (furyStacks > 0) {
      out.phase = t('hudChrome.finalOverload.fury', { stacks: n(furyStacks) });
      out.phaseUrgent = true;
    } else {
      out.phase = t('hudChrome.finalOverload.enrage', { seconds: whole(secs) });
      out.phaseUrgent = secs <= 15;
    }
  }
  const poured: string[] = [];
  for (const vein of HEART_QUARTER_ORDER) {
    const p = auraOf(boss.auras, pouredAuraId(vein));
    const k = p ? Math.round(p.value ?? p.stacks ?? 1) : 0;
    if (k <= 0) continue;
    const label = t(LABEL_KEYS[vein] as never);
    poured.push(
      k > 1 ? t('hudChrome.finalOverload.pouredTimes', { quarter: label, times: n(k) }) : label,
    );
  }
  out.poured =
    poured.length > 0 ? t('hudChrome.finalOverload.poured', { elements: formatList(poured) }) : '';
}

/** The world as the scan reads it. */
export interface FinalPhaseWorld {
  entities: ReadonlyMap<number, FinalPhaseBoss & { kind?: string }>;
  entityRosterVersion: number;
}

/** The Masterless Strength in the world: looked up again only when the
 *  roster changes (a body comes or goes). Allocates nothing per frame. */
export class HeartFinalScan {
  private version = Number.NaN;
  private id = -1;

  frame(world: FinalPhaseWorld | null | undefined): FinalPhaseBoss | null {
    if (!world) return null;
    if (world.entityRosterVersion !== this.version) {
      this.version = world.entityRosterVersion;
      this.id = -1;
      for (const e of world.entities.values())
        if (e.templateId === FINAL_BOSS && e.kind !== 'object') {
          this.id = e.id;
          break;
        }
    }
    return this.id >= 0 ? (world.entities.get(this.id) ?? null) : null;
  }
}
