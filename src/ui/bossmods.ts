// Raid warnings ("boss mods"): a DBM-style panel that watches the boss and
// shows a countdown bar + a big center alert for each telegraphed mechanic.
// It is driven entirely by the sim's `bossWarn` events (a stable mechanic key
// + an eta in seconds, emitted ~BOSS_WARN_LEAD s before the hit), so the
// client never parses combat-log text. Toggled on/off like the damage meter;
// while off it does nothing (no panel, no alerts).

import type { SimEvent } from '../sim/types';
import type { IWorld } from '../world_api';
import { formatNumber, type TranslationKey, t } from './i18n';

const ALERT_MS = 2600; // how long the big center alert stays up
const TIMER_LINGER_MS = 400; // keep a finished bar visible briefly at 0
const RENDER_MS = 100; // ~10 Hz so the countdowns animate smoothly

// mechanic key (from the sim `bossWarn` event) -> label + accent colour.
interface MechInfo {
  labelKey: TranslationKey;
  color: string;
}
const MECH: Record<string, MechInfo> = {
  stomp: { labelKey: 'hudChrome.bossmods.mech.stomp', color: '#ff9933' },
  aoe: { labelKey: 'hudChrome.bossmods.mech.aoe', color: '#cc66ff' },
  stoneskin: { labelKey: 'hudChrome.bossmods.mech.stoneskin', color: '#c9c2b5' },
  terrify: { labelKey: 'hudChrome.bossmods.mech.terrify', color: '#b266ff' },
  mend: { labelKey: 'hudChrome.bossmods.mech.mend', color: '#66ff99' },
  enrage: { labelKey: 'hudChrome.bossmods.mech.enrage', color: '#ff5555' },
  adds: { labelKey: 'hudChrome.bossmods.mech.adds', color: '#ffcc44' },
  death_throes: { labelKey: 'hudChrome.bossmods.mech.deathThroes', color: '#9acd32' },
  gravebreaker: { labelKey: 'hudChrome.bossmods.mech.gravebreaker', color: '#ff7744' },
  raise_fallen: { labelKey: 'hudChrome.bossmods.mech.raiseFallen', color: '#aa88ff' },
  soul_rend: { labelKey: 'hudChrome.bossmods.mech.soulRend', color: '#cc66ff' },
  deathless_rage: { labelKey: 'hudChrome.bossmods.mech.deathlessRage', color: '#ff3344' },
};

function mechLabel(mechanic: string): string {
  const info = MECH[mechanic];
  return info ? t(info.labelKey) : mechanic;
}
function mechColor(mechanic: string): string {
  return MECH[mechanic]?.color ?? '#ffcc44';
}

export interface BossTimerState {
  mechanic: string;
  endsAt: number; // performance.now() ms
  total: number; // seconds, for the depleting bar
}

// Pure data layer (unit-tested): accumulate live mechanic timers + the current
// flash alert from `bossWarn` events.
export class BossModsData {
  timers: BossTimerState[] = [];
  alertMechanic: string | null = null;
  alertUntil = 0;

  onEvent(ev: SimEvent, now: number): void {
    if (ev.type !== 'bossWarn') return;
    if (ev.eta > 0) {
      // a fresh cast of the same mechanic replaces its previous timer
      this.timers = this.timers.filter((tm) => tm.mechanic !== ev.mechanic);
      this.timers.push({ mechanic: ev.mechanic, endsAt: now + ev.eta * 1000, total: ev.eta });
    }
    this.alertMechanic = ev.mechanic;
    this.alertUntil = now + ALERT_MS;
  }

  // drop expired bars (after a short linger) and clear a stale alert
  update(now: number): void {
    this.timers = this.timers.filter((tm) => tm.endsAt > now - TIMER_LINGER_MS);
    if (this.alertUntil <= now) this.alertMechanic = null;
  }

  /** active bars, soonest-first */
  ordered(): BossTimerState[] {
    return [...this.timers].sort((a, b) => a.endsAt - b.endsAt);
  }
}

export class BossMods {
  private data = new BossModsData();
  private root: HTMLElement;
  private rowsEl: HTMLElement;
  private alertEl: HTMLElement;
  private lastRender = 0;

  // `world` is kept for parity with the other panels (future per-target cues).
  constructor(private world: IWorld) {
    this.root = document.querySelector('#bossmods-window') as HTMLElement;
    this.rowsEl = this.root.querySelector('.bm-rows') as HTMLElement;
    this.alertEl = document.querySelector('#bm-alert') as HTMLElement;
    const title = this.root.querySelector('.bm-title') as HTMLElement;
    if (title) title.textContent = t('hudChrome.bossmods.title');
    const close = this.root.querySelector('.bm-close') as HTMLElement | null;
    if (close) {
      close.setAttribute('title', t('hudChrome.bossmods.close'));
      close.setAttribute('aria-label', t('hudChrome.bossmods.close'));
      close.addEventListener('click', () => this.toggle());
    }
  }

  toggle(): void {
    const on = this.root.style.display !== 'block';
    this.root.style.display = on ? 'block' : 'none';
    document.body.classList.toggle('bossmods-open', on);
    if (on) this.render(true);
    else this.hideAlert();
  }

  get isOpen(): boolean {
    return this.root.style.display === 'block';
  }

  // events only matter while the panel/warnings are enabled
  onEvent(ev: SimEvent): void {
    if (!this.isOpen) return;
    this.data.onEvent(ev, performance.now());
    if (ev.type === 'bossWarn') this.render(true); // surface a new warning immediately
  }

  update(): void {
    if (!this.isOpen) return;
    const now = performance.now();
    this.data.update(now);
    if (now - this.lastRender < RENDER_MS) return;
    this.render();
  }

  private hideAlert(): void {
    this.alertEl.style.display = 'none';
  }

  private render(force = false): void {
    if (!this.isOpen && !force) return;
    const now = performance.now();
    this.lastRender = now;

    // center alert flash
    if (this.data.alertMechanic && now < this.data.alertUntil) {
      this.alertEl.textContent = mechLabel(this.data.alertMechanic);
      this.alertEl.style.color = mechColor(this.data.alertMechanic);
      this.alertEl.style.display = 'block';
    } else {
      this.hideAlert();
    }

    // countdown bars
    const rows = this.data.ordered();
    this.rowsEl.innerHTML = '';
    if (rows.length === 0) {
      const idle = document.createElement('div');
      idle.className = 'bm-idle';
      idle.textContent = t('hudChrome.bossmods.idle');
      this.rowsEl.appendChild(idle);
      return;
    }
    for (const tm of rows) {
      const remain = Math.max(0, (tm.endsAt - now) / 1000);
      const row = document.createElement('div');
      row.className = 'bm-bar';
      const fill = document.createElement('div');
      fill.className = 'bm-fill';
      fill.style.width = `${Math.min(100, (remain / Math.max(0.1, tm.total)) * 100)}%`;
      fill.style.background = `${mechColor(tm.mechanic)}cc`;
      const label = document.createElement('span');
      label.className = 'bm-label';
      label.textContent = mechLabel(tm.mechanic);
      const num = document.createElement('span');
      num.className = 'bm-num';
      num.textContent = t('hudChrome.bossmods.secs', {
        n: formatNumber(Math.ceil(remain), { maximumFractionDigits: 0 }),
      });
      row.append(fill, label, num);
      this.rowsEl.appendChild(row);
    }
  }
}
