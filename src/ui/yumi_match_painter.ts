// Thin facet-routed painter for the Protect Yumi match HUD: the top strip
// (both Yumi HP bars around a title + teleport/sudden-death readout) and the
// center bench-respawn overlay.
//
// The consumer half of the pure-core + thin-painter split over
// yumi_match_view.ts. It owns only presentation state: the event-fed live
// cache (yumiStatus heartbeats), the yumiDown bench countdown (decremented on
// its own performance.now clock, UI timing only), and the lazily-built DOM
// under the injected mount. EVERY per-frame write routes through the
// PainterHost elided writers; colors are CSS classes over the team tokens
// (--color-team-blue / --color-team-red in tokens.css), never literal hex in
// TS. Localized text re-renders through t() each update and relies on writer
// elision, so a language switch applies on the next frame.
//
// Fairness invariant: while a match is visible BOTH bars paint, on every
// graphics tier, driven from the same model for every player.

import type { ArenaInfo } from '../world_api';
import { formatNumber, t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import { type YumiHudModel, type YumiLiveState, yumiMatchView } from './yumi_match_view';

interface YumiHudEls {
  root: HTMLElement;
  title: HTMLElement;
  timer: HTMLElement;
  sub: HTMLElement;
  toggle: HTMLElement;
  mineSide: HTMLElement;
  mineName: HTMLElement;
  mineFill: HTMLElement;
  mineNum: HTMLElement;
  theirsSide: HTMLElement;
  theirsName: HTMLElement;
  theirsFill: HTMLElement;
  theirsNum: HTMLElement;
  respawn: HTMLElement;
  respawnTitle: HTMLElement;
  respawnCount: HTMLElement;
}

export class YumiMatchPainter {
  private els: YumiHudEls | null = null;
  private readonly live: YumiLiveState = {
    seen: false,
    myHp: 0,
    myMax: 1,
    enemyHp: 0,
    enemyMax: 1,
    teleportIn: 0,
    suddenDeathIn: 0,
    suddenDeath: false,
  };
  private respawnLeft = 0;
  private lastNow = -1;
  // User-chosen strip collapse (session-scoped): the bars fold down to the
  // title chip. A deliberate player choice, not a tier knob, so the fairness
  // invariant is untouched (the expand control stays visible).
  private collapsed = false;

  constructor(
    private readonly w: PainterHostWriters,
    private readonly mount: () => HTMLElement | null,
  ) {}

  /** Fold a 1/s yumiStatus heartbeat into the live cache. */
  onStatus(ev: {
    myHp: number;
    myMax: number;
    enemyHp: number;
    enemyMax: number;
    teleportIn: number;
    suddenDeathIn: number;
    suddenDeath: boolean;
  }): void {
    this.live.seen = true;
    this.live.myHp = ev.myHp;
    this.live.myMax = ev.myMax;
    this.live.enemyHp = ev.enemyHp;
    this.live.enemyMax = ev.enemyMax;
    this.live.teleportIn = ev.teleportIn;
    this.live.suddenDeathIn = ev.suddenDeathIn;
    this.live.suddenDeath = ev.suddenDeath;
  }

  /** Seed my bench countdown from the yumiDown event. */
  onDown(seconds: number): void {
    this.respawnLeft = seconds;
  }

  /** Match over: drop all event-fed state so the next bout starts clean. */
  reset(): void {
    this.live.seen = false;
    this.live.suddenDeath = false;
    this.respawnLeft = 0;
  }

  update(info: ArenaInfo | null): void {
    // UI-clock countdown for the bench overlay (presentation only; the sim's
    // own timer revives the entity, this just animates toward it).
    const now = performance.now();
    if (this.lastNow >= 0 && this.respawnLeft > 0) {
      this.respawnLeft = Math.max(0, this.respawnLeft - (now - this.lastNow) / 1000);
    }
    this.lastNow = now;

    const m = yumiMatchView(info, this.live, this.respawnLeft);
    if (!m.active) {
      if (this.els) {
        this.w.setDisplay(this.els.root, 'none');
        this.w.setDisplay(this.els.respawn, 'none');
      }
      if (this.live.seen) this.reset();
      return;
    }
    const els = this.ensureEls();
    if (!els) return;
    this.paint(els, m);
  }

  private paint(els: YumiHudEls, m: YumiHudModel): void {
    const num = (n: number) => formatNumber(n, { maximumFractionDigits: 0 });
    this.w.setDisplay(els.root, 'flex');
    this.w.toggleClass(els.root, 'sudden', m.suddenDeath);
    this.w.toggleClass(els.root, 'collapsed', this.collapsed);
    this.w.setAttr(els.toggle, 'aria-expanded', this.collapsed ? 'false' : 'true');
    this.w.setAttr(
      els.toggle,
      'aria-label',
      this.collapsed ? t('yumi.hud.expand') : t('yumi.hud.collapse'),
    );
    this.w.setText(els.title, t('yumi.hud.title'));
    // The match clock: time left until sudden death, then the state label.
    // Localized digits via formatNumber (clock-style m:ss).
    const timer = m.suddenDeath
      ? t('yumi.hud.suddenDeath')
      : `${num(Math.floor(m.suddenDeathIn / 60))}:${formatNumber(m.suddenDeathIn % 60, {
          minimumIntegerDigits: 2,
          maximumFractionDigits: 0,
        })}`;
    this.w.setText(els.timer, timer);
    this.w.toggleClass(els.timer, 'sudden', m.suddenDeath);
    const sub =
      m.phase === 'countdown'
        ? t('yumi.hud.getReady')
        : t('yumi.hud.teleportIn', { s: num(m.teleportIn) });
    this.w.setText(els.sub, sub);
    // Teleports freeze in sudden death: the line would count nothing down.
    this.w.setDisplay(els.sub, m.suddenDeath ? 'none' : 'block');
    this.w.setText(els.mineName, t('yumi.hud.yourYumi'));
    this.w.setText(els.theirsName, t('yumi.hud.enemyYumi'));
    // Team identity: my bar wears MY team's color (matching the spawn-plaza
    // accents in world), so blue/red always means team A/B, not mine/theirs.
    this.w.toggleClass(els.mineSide, 'team-blue', m.team === 'A');
    this.w.toggleClass(els.mineSide, 'team-red', m.team === 'B');
    this.w.toggleClass(els.theirsSide, 'team-blue', m.team === 'B');
    this.w.toggleClass(els.theirsSide, 'team-red', m.team === 'A');
    this.w.setWidth(els.mineFill, `${(m.myFrac * 100).toFixed(1)}%`);
    this.w.setWidth(els.theirsFill, `${(m.enemyFrac * 100).toFixed(1)}%`);
    this.w.setText(els.mineNum, `${num(m.myHp)} / ${num(m.myMax)}`);
    this.w.setText(els.theirsNum, `${num(m.enemyHp)} / ${num(m.enemyMax)}`);
    this.w.setAttr(
      els.root,
      'aria-label',
      t('yumi.hud.aria', {
        mine: num(m.myHp),
        theirs: num(m.enemyHp),
        max: num(m.myMax),
      }),
    );
    const showRespawn = m.down && m.respawnIn > 0;
    this.w.setDisplay(els.respawn, showRespawn ? 'flex' : 'none');
    if (showRespawn) {
      this.w.setText(els.respawnTitle, t('yumi.respawn.title'));
      this.w.setText(els.respawnCount, num(m.respawnIn));
    }
  }

  // Build the DOM once under the mount; static structure only (all text and
  // dynamic state flow through the elided writers in paint()).
  private ensureEls(): YumiHudEls | null {
    if (this.els) return this.els;
    const mount = this.mount();
    if (!mount) return null;
    const root = document.createElement('div');
    root.id = 'yumi-hud';
    root.className = 'yumi-hud';
    root.setAttribute('role', 'status');
    const side = (cls: string) => {
      const el = document.createElement('div');
      el.className = `yh-side ${cls}`;
      const name = document.createElement('span');
      name.className = 'yh-name';
      const track = document.createElement('div');
      track.className = 'yh-track';
      const fill = document.createElement('div');
      fill.className = 'yh-fill';
      track.appendChild(fill);
      const numEl = document.createElement('span');
      numEl.className = 'yh-num';
      el.append(name, track, numEl);
      return { el, name, fill, num: numEl };
    };
    const mine = side('mine');
    const mid = document.createElement('div');
    mid.className = 'yh-mid';
    const title = document.createElement('div');
    title.className = 'yh-title';
    const timer = document.createElement('div');
    timer.className = 'yh-timer';
    const sub = document.createElement('div');
    sub.className = 'yh-sub';
    mid.append(title, timer, sub);
    const theirs = side('theirs');
    // The collapse toggle folds the strip to the title chip (a user choice;
    // aria-label/expanded flow through the elided writers in paint()). The
    // chevron glyph is pure CSS, so the button carries no text to localize.
    const toggle = document.createElement('button');
    toggle.className = 'yh-toggle';
    toggle.setAttribute('type', 'button');
    toggle.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
    });
    root.append(mine.el, mid, theirs.el, toggle);
    mount.appendChild(root);

    const respawn = document.createElement('div');
    respawn.id = 'yumi-respawn';
    respawn.className = 'yumi-respawn';
    respawn.setAttribute('role', 'status');
    const respawnTitle = document.createElement('div');
    respawnTitle.className = 'yr-title';
    const respawnCount = document.createElement('div');
    respawnCount.className = 'yr-count';
    respawn.append(respawnTitle, respawnCount);
    mount.appendChild(respawn);

    this.els = {
      root,
      title,
      timer,
      sub,
      toggle,
      mineSide: mine.el,
      mineName: mine.name,
      mineFill: mine.fill,
      mineNum: mine.num,
      theirsSide: theirs.el,
      theirsName: theirs.name,
      theirsFill: theirs.fill,
      theirsNum: theirs.num,
      respawn,
      respawnTitle,
      respawnCount,
    };
    return this.els;
  }
}
