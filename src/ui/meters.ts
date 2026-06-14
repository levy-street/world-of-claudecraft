// Party combat meters: damage / healing / threat, segmented into encounters.
// An encounter starts on the first party damage/heal event and ends after a
// few seconds with no party combat activity AND no visible mob holding aggro
// on a party member. Finished encounters land in a small history and fold
// into the session "All" segment; the panel pages between them.
//
// "Threat" is honest about this game's AI: mobs have no damage-based threat
// table (proximity aggro + nearest-player retarget), so the tab shows each
// member's damage on the engaged mob and marks who the mob is ACTUALLY
// targeting (aggroTargetId, synced online).
import type { IWorld } from '../world_api';
import type { SimEvent } from '../sim/types';
import { CLASSES } from '../sim/data';
import { t } from '../i18n';
import { mobName } from '../i18n/content';

const ENCOUNTER_END_SECONDS = 5;
const HISTORY_CAP = 8;

export interface MemberTally {
  pid: number;
  name: string;
  cls: string | null;
  dmg: number;
  heal: number;
  /** damage per mob entity id (current/previous encounters only) */
  dmgByMob: Map<number, number>;
}

export interface Encounter {
  label: string;
  /** ms epoch of first activity */
  startedAt: number;
  /** seconds of combat (live encounters: now - startedAt) */
  duration: number;
  tallies: Map<number, MemberTally>;
  /** mob entity id with the most party damage (threat tab subject) */
  mainMobId: number | null;
  mainMobName: string;
  /** mob template id of the threat subject, for localizing its display name */
  mainMobTemplate: string;
  /** maxHp of the biggest mob damaged — used to pick the label */
  biggestMobHp: number;
}

function newEncounter(now: number): Encounter {
  return {
    label: 'Combat', startedAt: now, duration: 0, tallies: new Map(),
    mainMobId: null, mainMobName: '', mainMobTemplate: '', biggestMobHp: -1,
  };
}

export class MeterData {
  current: Encounter | null = null;
  history: Encounter[] = [];
  allTime: Encounter;
  private lastActivity = 0;

  constructor(now: number) {
    this.allTime = { ...newEncounter(now), label: 'All (session)' };
  }

  private tally(enc: Encounter, pid: number, name: string, cls: string | null): MemberTally {
    let t = enc.tallies.get(pid);
    if (!t) {
      t = { pid, name, cls, dmg: 0, heal: 0, dmgByMob: new Map() };
      enc.tallies.set(pid, t);
    }
    return t;
  }

  /** party membership check is supplied by the caller (self + party pids) */
  onEvent(ev: SimEvent, world: IWorld, partyPids: Set<number>, now: number): void {
    if (ev.type !== 'damage' && ev.type !== 'heal2') return;
    const sourceInParty = partyPids.has(ev.sourceId);
    const targetInParty = partyPids.has(ev.targetId);
    if (!sourceInParty && !targetInParty) return;

    // any party-involved combat keeps the encounter alive (tanking without
    // dealing damage must not end the segment)
    if (!this.current) this.current = newEncounter(now);
    this.lastActivity = now;

    if (ev.type === 'damage' && sourceInParty && ev.kind === 'hit' && ev.amount > 0) {
      const target = world.entities.get(ev.targetId);
      if (target && target.kind === 'mob') {
        const src = world.entities.get(ev.sourceId);
        const member = world.partyInfo?.members.find((m) => m.pid === ev.sourceId);
        const name = member?.name ?? src?.name ?? `#${ev.sourceId}`;
        const cls = member?.cls ?? (ev.sourceId === world.player.id ? world.player.templateId : null);
        for (const enc of [this.current, this.allTime]) {
          const t = this.tally(enc, ev.sourceId, name, cls);
          t.dmg += ev.amount;
          if (enc === this.current) {
            t.dmgByMob.set(ev.targetId, (t.dmgByMob.get(ev.targetId) ?? 0) + ev.amount);
          }
        }
        // encounter label/threat subject: the beefiest mob the party fought
        if (target.maxHp > this.current.biggestMobHp) {
          this.current.biggestMobHp = target.maxHp;
          this.current.label = target.name;
          this.current.mainMobName = target.name;
          this.current.mainMobTemplate = target.templateId;
          this.current.mainMobId = ev.targetId;
        }
      }
    } else if (ev.type === 'heal2' && sourceInParty && ev.amount > 0) {
      const member = world.partyInfo?.members.find((m) => m.pid === ev.sourceId);
      const src = world.entities.get(ev.sourceId);
      const name = member?.name ?? src?.name ?? `#${ev.sourceId}`;
      const cls = member?.cls ?? (ev.sourceId === world.player.id ? world.player.templateId : null);
      for (const enc of [this.current, this.allTime]) {
        this.tally(enc, ev.sourceId, name, cls).heal += ev.amount;
      }
    }
  }

  /** advance clocks + close the encounter once combat has clearly ended */
  update(world: IWorld, partyPids: Set<number>, now: number): void {
    if (!this.current) return;
    this.current.duration = Math.max(1, (now - this.current.startedAt) / 1000);
    if ((now - this.lastActivity) / 1000 < ENCOUNTER_END_SECONDS) return;
    // quiet for a while — but a mob still chasing a member keeps it open
    for (const e of world.entities.values()) {
      if (e.kind === 'mob' && !e.dead && e.aggroTargetId !== null && partyPids.has(e.aggroTargetId)) {
        return;
      }
    }
    this.endEncounter(now);
  }

  endEncounter(now: number): void {
    const enc = this.current;
    if (!enc) return;
    this.current = null;
    if (enc.tallies.size === 0) return; // nothing measured — drop it
    enc.duration = Math.max(1, (this.lastActivity - enc.startedAt) / 1000);
    this.history.unshift(enc);
    if (this.history.length > HISTORY_CAP) this.history.pop();
    this.allTime.duration += enc.duration;
  }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

type Tab = 'dmg' | 'heal' | 'threat';

export class Meters {
  private data: MeterData;
  private tab: Tab = 'dmg';
  /** 0 = current/latest, 1..N = history entries, N+1 = all-time */
  private viewIdx = 0;
  private lastRender = 0;
  private root: HTMLElement;
  private rowsEl: HTMLElement;
  private titleEl: HTMLElement;
  private subEl: HTMLElement;

  constructor(private world: IWorld) {
    this.data = new MeterData(performance.now());
    this.root = document.querySelector('#meters-window') as HTMLElement;
    this.rowsEl = this.root.querySelector('.mt-rows') as HTMLElement;
    this.titleEl = this.root.querySelector('.mt-view') as HTMLElement;
    this.subEl = this.root.querySelector('.mt-sub') as HTMLElement;
    for (const tab of ['dmg', 'heal', 'threat'] as Tab[]) {
      (this.root.querySelector(`.mt-tab[data-tab="${tab}"]`) as HTMLElement).addEventListener('click', () => {
        this.tab = tab;
        this.refreshTabs();
        this.render(true);
      });
    }
    (this.root.querySelector('.mt-prev') as HTMLElement).addEventListener('click', () => this.page(1));
    (this.root.querySelector('.mt-next') as HTMLElement).addEventListener('click', () => this.page(-1));
    (this.root.querySelector('.mt-close') as HTMLElement).addEventListener('click', () => this.toggle());
    this.refreshTabs();
  }

  toggle(): void {
    const on = this.root.style.display !== 'block';
    this.root.style.display = on ? 'block' : 'none';
    if (on) this.render(true);
  }

  get isOpen(): boolean {
    return this.root.style.display === 'block';
  }

  private page(dir: number): void {
    const max = this.data.history.length + 1; // + all-time slot
    this.viewIdx = Math.max(0, Math.min(max, this.viewIdx + dir));
    this.render(true);
  }

  private refreshTabs(): void {
    this.root.querySelectorAll('.mt-tab').forEach((el) => {
      el.classList.toggle('on', (el as HTMLElement).dataset.tab === this.tab);
    });
  }

  private partyPids(): Set<number> {
    const pids = new Set<number>([this.world.player.id]);
    for (const m of this.world.partyInfo?.members ?? []) pids.add(m.pid);
    return pids;
  }

  onEvent(ev: SimEvent): void {
    this.data.onEvent(ev, this.world, this.partyPids(), performance.now());
  }

  /** called every hud frame; renders at ~4Hz while open */
  update(): void {
    const now = performance.now();
    this.data.update(this.world, this.partyPids(), now);
    if (!this.isOpen || now - this.lastRender < 250) return;
    this.render();
  }

  private viewedEncounter(): { enc: Encounter | null; viewName: string } {
    const h = this.data.history;
    if (this.viewIdx === h.length + 1 || (this.viewIdx > 0 && h.length === 0)) {
      return { enc: this.data.allTime, viewName: t('meters.allSession') };
    }
    if (this.viewIdx === 0) {
      const enc = this.data.current ?? h[0] ?? null;
      return { enc, viewName: this.data.current ? t('meters.current') : enc ? t('meters.lastFight') : t('meters.current') };
    }
    return { enc: h[this.viewIdx - 1] ?? null, viewName: t('meters.fightN', { n: this.viewIdx }) };
  }

  render(force = false): void {
    if (!this.isOpen && !force) return;
    this.lastRender = performance.now();
    const { enc, viewName } = this.viewedEncounter();
    this.titleEl.textContent = `${t(`meters.label.${this.tab}`)} — ${viewName}`;

    if (!enc || enc.tallies.size === 0) {
      this.subEl.textContent = t('meters.empty');
      this.rowsEl.innerHTML = '';
      return;
    }

    const isThreat = this.tab === 'threat';
    const mob = isThreat && enc.mainMobId !== null ? this.world.entities.get(enc.mainMobId) : null;
    const aggroPid = mob && !mob.dead ? mob.aggroTargetId : null;
    // localize the threat subject / encounter label off the mob template id
    const mobLabel = enc.mainMobTemplate ? mobName(enc.mainMobTemplate) : enc.mainMobName;
    const encLabel = enc === this.data.allTime ? t('meters.allSession')
      : enc.mainMobTemplate ? mobName(enc.mainMobTemplate) : enc.label;
    this.subEl.textContent = isThreat
      ? (enc.mainMobName ? t('meters.target', { name: mobLabel }) : t('meters.noTarget'))
      : `${encLabel} — ${fmtDuration(enc.duration)}`;

    const rows = [...enc.tallies.values()]
      .map((t) => ({
        t,
        value: this.tab === 'dmg' ? t.dmg
          : this.tab === 'heal' ? t.heal
          : (enc.mainMobId !== null ? t.dmgByMob.get(enc.mainMobId) ?? 0 : 0),
      }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);

    const top = rows[0]?.value ?? 1;
    this.rowsEl.innerHTML = '';
    for (const { t, value } of rows) {
      const row = document.createElement('div');
      row.className = 'mt-row';
      const fill = document.createElement('div');
      fill.className = 'mt-fill';
      fill.style.width = `${Math.max(4, (value / top) * 100)}%`;
      const color = t.cls && (CLASSES as Record<string, { color: number }>)[t.cls]?.color;
      fill.style.background = color ? `#${color.toString(16).padStart(6, '0')}cc` : '#888888cc';
      const label = document.createElement('span');
      label.className = 'mt-label';
      const hasAggro = isThreat && aggroPid === t.pid;
      label.textContent = `${hasAggro ? '⚔ ' : ''}${t.name}`;
      const num = document.createElement('span');
      num.className = 'mt-num';
      num.textContent = isThreat
        ? fmtNum(value)
        : `${fmtNum(value)} (${fmtNum(value / enc.duration)}/s)`;
      if (hasAggro) row.classList.add('aggro');
      row.append(fill, label, num);
      this.rowsEl.appendChild(row);
    }
  }
}

function fmtNum(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}m`;
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  return `${Math.round(v)}`;
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;
}
