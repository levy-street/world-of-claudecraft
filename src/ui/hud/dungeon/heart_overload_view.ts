// The Masterless Strength's raid HUD: the pure, DOM-free view core of the
// four Overload bars (heart_overload_painter.ts paints it), read off the
// boss's auras the sim already mirrors (encounters/smith_heart/final_ids.ts):
//   - one bar per quarter (the aura's `value`, 0 to 100), in bearing order
//     (Breath, Quench, Hammer, Heat), the one the boss stands in highlighted
//     and filling, the others draining; a bar three quarters full is in
//     danger (its burst is near);
//   - Taking Root's seconds left (the boss's root aura), or that it can be
//     dragged;
//   - Vein-Shaken's seconds left (Heroic: the state aura's `value3`), the
//     window a quarter change hits three times as hard;
//   - Heart Unbound's stacks while it stands in the central ring;
//   - part 2 (final_phase_ids.ts, the phase aura): through an intermission
//     the bars are held (frozen, dimmed), the quarters whose Splinters live
//     are lit, and the call's seconds and the living Splinters read under
//     them; in the final phase the bars are off and the soft enrage's
//     seconds (then Masterless Fury's stacks) read instead; the elements
//     poured into the boss read on their own line all fight long.
// Shown while the fight runs (the state aura is on the boss), on every
// graphics tier and whatever the hints setting: the bars are what the tanks
// and the raid act on. Allocation-light: one model, its rows reused.

import type { SmithHeartVein } from '../../../sim/content/smith_heart_layout';
import { HEART_QUARTER_ORDER } from '../../../sim/content/smith_heart_quarters';
import {
  FINAL_AURAS,
  FINAL_BOSS,
  finalZoneOf,
  overloadAuraId,
} from '../../../sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS,
  FINAL_PHASES,
  finalStageOf,
  hiddenNextOf,
  pouredAuraId,
  quarterBit,
  veinsOfMask,
} from '../../../sim/encounters/smith_heart/final_phase_ids';
import { formatList, formatNumber, t } from '../../i18n';

/** A bar this full (percent) is in danger: its burst is near. */
export const OVERLOAD_DANGER_AT = 75;

export interface OverloadAura {
  id: string;
  value?: number;
  value2?: number;
  value3?: number;
  remaining?: number;
  stacks?: number;
}

export interface OverloadBoss {
  id: number;
  templateId: string;
  dead?: boolean;
  auras: readonly OverloadAura[];
}

export interface OverloadRow {
  vein: SmithHeartVein;
  label: string;
  /** 0 to 100. */
  pct: number;
  active: boolean;
  danger: boolean;
  /** Part 2: its quarter's Splinter lives (an intermission). */
  awake: boolean;
  aria: string;
}

export interface OverloadView {
  visible: boolean;
  rows: OverloadRow[];
  /** The root's line ('Rooted 12' or 'Can be dragged'). */
  root: string;
  rooted: boolean;
  /** Vein-Shaken's line ('' when none). */
  shaken: string;
  /** Heart Unbound's line ('' when none). */
  unbound: string;
  /** Part 2: the bars held still (an intermission) or off (the final
   *  phase). */
  frozen: boolean;
  barsOff: boolean;
  /** Part 2: the call's or the enrage's line ('' when none), and whether it
   *  is urgent (Masterless Fury, or its last seconds). */
  phase: string;
  phaseUrgent: boolean;
  /** Part 2: the living Splinters' line ('' when none). */
  splinters: string;
  /** Part 2: the elements poured into it ('' when none). */
  poured: string;
  title: string;
  groupAria: string;
  activeAria: string;
}

const LABEL_KEYS: Readonly<Record<SmithHeartVein, string>> = {
  heat: 'hudChrome.finalOverload.heat',
  quench: 'hudChrome.finalOverload.quench',
  breath: 'hudChrome.finalOverload.breath',
  hammer: 'hudChrome.finalOverload.hammer',
};

const whole = (v: number) => formatNumber(Math.max(0, Math.ceil(v)), { maximumFractionDigits: 0 });

/** A fresh model (the painter keeps one and passes it back every frame). */
export function makeOverloadView(): OverloadView {
  return {
    visible: false,
    rows: HEART_QUARTER_ORDER.map((vein) => ({
      vein,
      label: '',
      pct: 0,
      active: false,
      danger: false,
      awake: false,
      aria: '',
    })),
    root: '',
    rooted: false,
    shaken: '',
    unbound: '',
    frozen: false,
    barsOff: false,
    phase: '',
    phaseUrgent: false,
    splinters: '',
    poured: '',
    title: '',
    groupAria: '',
    activeAria: '',
  };
}

function auraOf(auras: readonly OverloadAura[], id: string): OverloadAura | null {
  for (const a of auras) if (a.id === id) return a;
  return null;
}

/** The view for `boss` (the claim's Masterless Strength, or null), written
 *  into `out`. */
export function buildOverloadView(boss: OverloadBoss | null, out: OverloadView): OverloadView {
  const state = boss && !boss.dead ? auraOf(boss.auras, FINAL_AURAS.state) : null;
  if (!boss || !state) {
    out.visible = false;
    return out;
  }
  out.visible = true;
  const zone = finalZoneOf(state.value);
  const phase = auraOf(boss.auras, FINAL_PHASE_AURAS.phase);
  const stage = finalStageOf(phase?.value);
  const mask = Math.round(phase?.value2 ?? 0);
  out.frozen = stage === 'leap' || stage === 'call' || stage === 'finalLeap';
  out.barsOff =
    stage === 'final' || stage === 'kneel' || stage === 'rebirth' || stage === 'collapse';
  for (const row of out.rows) {
    const bar = auraOf(boss.auras, overloadAuraId(row.vein));
    row.pct = Math.max(0, Math.min(100, Math.round(bar?.value ?? 0)));
    row.active = row.vein === zone && !out.frozen && !out.barsOff;
    row.danger = row.pct >= OVERLOAD_DANGER_AT && !out.frozen;
    row.awake = (mask & quarterBit(row.vein)) !== 0;
    row.label = t(LABEL_KEYS[row.vein] as never);
    row.aria = t('hudChrome.finalOverload.barAria', {
      quarter: row.label,
      pct: formatNumber(row.pct, { maximumFractionDigits: 0 }),
    });
  }
  const root = auraOf(boss.auras, FINAL_AURAS.root);
  out.rooted = !!root && (root.remaining ?? 0) > 0;
  out.root =
    out.frozen || out.barsOff
      ? ''
      : out.rooted
        ? t('hudChrome.finalOverload.rooted', { seconds: whole(root?.remaining ?? 0) })
        : t('hudChrome.finalOverload.free');
  const shaken = Math.round(state.value3 ?? 0);
  out.shaken =
    shaken > 0 && !out.barsOff
      ? t('hudChrome.finalOverload.shaken', { seconds: whole(shaken) })
      : '';
  const unbound = auraOf(boss.auras, FINAL_AURAS.unbound);
  const stacks = Math.round(unbound?.stacks ?? 0);
  out.unbound =
    stacks > 0
      ? t('hudChrome.finalOverload.unbound', {
          stacks: formatNumber(stacks, { maximumFractionDigits: 0 }),
        })
      : '';
  phaseLines(boss, stage, phase, out);
  out.title = out.barsOff
    ? stage === 'final' || stage === 'kneel'
      ? t('hudChrome.finalOverload.titleFinal')
      : t('hudChrome.finalOverload.titleUnmade')
    : out.frozen
      ? t('hudChrome.finalOverload.titleCall')
      : t('hudChrome.finalOverload.title');
  out.groupAria = t('hudChrome.finalOverload.groupAria');
  const active = out.rows.find((r) => r.active);
  out.activeAria = active ? t('hudChrome.finalOverload.activeAria', { quarter: active.label }) : '';
  return out;
}

/** Part 2's lines: the call and its Splinters, the enrage or the fury, the
 *  poured elements. */
function phaseLines(
  boss: OverloadBoss,
  stage: ReturnType<typeof finalStageOf>,
  phase: OverloadAura | null,
  out: OverloadView,
): void {
  const n = (v: number) => formatNumber(Math.max(0, Math.round(v)), { maximumFractionDigits: 0 });
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
        quarter: t(`hudChrome.finalOverload.${next}`),
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
  for (const row of out.rows) {
    const p = auraOf(boss.auras, pouredAuraId(row.vein));
    const k = p ? Math.round(p.value ?? p.stacks ?? 1) : 0;
    if (k <= 0) continue;
    poured.push(
      k > 1
        ? t('hudChrome.finalOverload.pouredTimes', { quarter: row.label, times: n(k) })
        : row.label,
    );
  }
  out.poured =
    poured.length > 0 ? t('hudChrome.finalOverload.poured', { elements: formatList(poured) }) : '';
}

/** The world as the scan reads it. */
export interface OverloadWorld {
  entities: ReadonlyMap<number, OverloadBoss & { kind?: string }>;
  entityRosterVersion: number;
}

/** The Masterless Strength in the world: looked up again only when the
 *  roster changes (a body comes or goes). Allocates nothing per frame. */
export class HeartFinalScan {
  private version = Number.NaN;
  private id = -1;

  frame(world: OverloadWorld | null | undefined): OverloadBoss | null {
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
