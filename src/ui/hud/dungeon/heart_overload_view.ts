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
//   - Heart Unbound's stacks while it stands in the central ring.
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
import { formatNumber, t } from '../../i18n';

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
      aria: '',
    })),
    root: '',
    rooted: false,
    shaken: '',
    unbound: '',
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
  for (const row of out.rows) {
    const bar = auraOf(boss.auras, overloadAuraId(row.vein));
    row.pct = Math.max(0, Math.min(100, Math.round(bar?.value ?? 0)));
    row.active = row.vein === zone;
    row.danger = row.pct >= OVERLOAD_DANGER_AT;
    row.label = t(LABEL_KEYS[row.vein] as never);
    row.aria = t('hudChrome.finalOverload.barAria', {
      quarter: row.label,
      pct: formatNumber(row.pct, { maximumFractionDigits: 0 }),
    });
  }
  const root = auraOf(boss.auras, FINAL_AURAS.root);
  out.rooted = !!root && (root.remaining ?? 0) > 0;
  out.root = out.rooted
    ? t('hudChrome.finalOverload.rooted', { seconds: whole(root?.remaining ?? 0) })
    : t('hudChrome.finalOverload.free');
  const shaken = Math.round(state.value3 ?? 0);
  out.shaken = shaken > 0 ? t('hudChrome.finalOverload.shaken', { seconds: whole(shaken) }) : '';
  const unbound = auraOf(boss.auras, FINAL_AURAS.unbound);
  const stacks = Math.round(unbound?.stacks ?? 0);
  out.unbound =
    stacks > 0
      ? t('hudChrome.finalOverload.unbound', {
          stacks: formatNumber(stacks, { maximumFractionDigits: 0 }),
        })
      : '';
  out.title = t('hudChrome.finalOverload.title');
  out.groupAria = t('hudChrome.finalOverload.groupAria');
  const active = out.rows.find((r) => r.active);
  out.activeAria = active ? t('hudChrome.finalOverload.activeAria', { quarter: active.label }) : '';
  return out;
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
