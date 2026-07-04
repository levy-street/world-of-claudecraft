// Thin DOM painter for the Gravemarch in-match HUD (top strip, countdown
// banner, respawn overlay, aftermath banner). Its own module composed by Hud
// (module-first: it never grows hud.ts), cloned from the 2v2 Fiesta HUD
// pattern (hud.ts renderFiestaScore/renderFiestaRespawn):
//
// - Driven every mediumHud tick from the SNAPSHOT (world.bgInfo.match) via the
//   pure battleground_hud_view.ts core, so it self-heals on reconnect.
// - DOM roots are lazily created under #ui (the getFiestaEl pattern) and each
//   sub-renderer is sig-diffed (dataset.sig), so an unchanged tick makes no
//   DOM write beyond the guarded display toggles.
// - One-shot juice (banners, audio cues, kill-feed lines) rides the SimEvents
//   in hud.handleEvents, never this painter; the single snapshot-transition
//   cue kept here is the revive chime on down -> up (the Fiesta precedent).
// - Colors are CSS class tokens (.bg-team-a / .bg-team-b in components.css),
//   never literals in TS.
//
// Gameplay-neutral graphics invariant: score, timer, structure pips, Knell
// status, and the respawn clock are actionable information; this painter reads
// no fx tier and is never shed or throttled by a graphics preset.

import { audio } from '../game/audio';
import type { IWorld } from '../world_api';
import { bgClockText, bgTeamName } from './battleground_format';
import { type BgHudStrip, type BgStructurePip, buildBgHudView } from './battleground_hud_view';
import { esc } from './esc';
import { formatNumber, t } from './i18n';

export interface BattlegroundHudDeps {
  /** The live world (offline Sim or online ClientWorld mirror). */
  world(): IWorld;
  /** The #ui overlay layer the lazily-created roots mount under. */
  uiRoot(): HTMLElement | null;
}

export class BattlegroundHud {
  private activeSeen = false;
  private wasDown = false;

  constructor(private readonly deps: BattlegroundHudDeps) {}

  /** mediumHud-band repaint from the snapshot (self-heals on reconnect). */
  update(): void {
    const view = buildBgHudView(this.deps.world().bgInfo?.match ?? null);
    if (view.kind === 'hidden') {
      if (this.activeSeen) this.teardown();
      this.activeSeen = false;
      return;
    }
    this.activeSeen = true;
    this.renderStrip(view.strip);
    this.renderCountdown(view.countdown);
    this.renderRespawn(view.respawn);
    this.renderAftermath(view.aftermath);
  }

  /** Language switch: clear every sub-sig so the next tick rebuilds with fresh t(). */
  relocalize(): void {
    for (const id of ['bg-hud-strip', 'bg-hud-countdown', 'bg-hud-respawn', 'bg-hud-aftermath']) {
      const el = document.getElementById(id);
      if (el) el.dataset.sig = '';
    }
    if (this.activeSeen) this.update();
  }

  private getEl(id: string, cls: string): HTMLElement {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = cls;
      this.deps.uiRoot()?.appendChild(el);
    }
    return el;
  }

  private renderStrip(strip: BgHudStrip): void {
    const el = this.getEl('bg-hud-strip', 'bg-hud-strip');
    el.style.display = 'flex';
    if (el.dataset.sig === strip.sig) return;
    el.dataset.sig = strip.sig;
    const num = (n: number) => formatNumber(n, { maximumFractionDigits: 0 });
    const pips = (list: BgStructurePip[], teamCls: string) =>
      list
        .map(
          (p) =>
            `<span class="bg-pip ${teamCls} ${p.kind === 'warstone' ? 'warstone' : 'bulwark'}${p.alive ? '' : ' down'}"></span>`,
        )
        .join('');
    const knell =
      strip.knell.kind === 'up'
        ? esc(t('hudChrome.bg.hud.knellUp'))
        : strip.knell.kind === 'spawns'
          ? esc(t('hudChrome.bg.hud.knellSpawns', { time: bgClockText(strip.knell.seconds) }))
          : esc(
              t('hudChrome.bg.hud.knellSilenced', {
                team: bgTeamName(strip.knell.team),
                seconds: num(strip.knell.seconds),
              }),
            );
    const knellCls =
      strip.knell.kind === 'silenced'
        ? ` silenced ${strip.knell.team === 'A' ? 'bg-team-a' : 'bg-team-b'}`
        : '';
    el.innerHTML =
      `<div class="bg-strip-row">` +
      `<span class="bg-kills bg-team-a${strip.myTeam === 'A' ? ' mine' : ''}">${num(strip.killsA)}</span>` +
      `<span class="bg-timer">${esc(bgClockText(strip.timeLeft))}</span>` +
      `<span class="bg-kills bg-team-b${strip.myTeam === 'B' ? ' mine' : ''}">${num(strip.killsB)}</span>` +
      `</div>` +
      `<div class="bg-strip-row bg-pips">` +
      `<span class="bg-pip-team">${pips(strip.pipsA, 'bg-team-a')}</span>` +
      `<span class="bg-knell${knellCls}">${knell}</span>` +
      `<span class="bg-pip-team">${pips(strip.pipsB, 'bg-team-b')}</span>` +
      `</div>`;
    el.setAttribute(
      'aria-label',
      t('hudChrome.bg.hud.stripAria', {
        teamA: bgTeamName('A'),
        killsA: num(strip.killsA),
        teamB: bgTeamName('B'),
        killsB: num(strip.killsB),
        time: bgClockText(strip.timeLeft),
      }),
    );
  }

  private renderCountdown(seconds: number | null): void {
    const el = this.getEl('bg-hud-countdown', 'bg-hud-countdown');
    if (seconds === null) {
      el.style.display = 'none';
      el.dataset.sig = '';
      return;
    }
    el.style.display = 'flex';
    const sig = `${seconds}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.innerHTML =
      `<div class="bgc-title">${esc(t('hudChrome.bg.hud.countdownTitle'))}</div>` +
      `<div class="bgc-count">${esc(formatNumber(seconds, { maximumFractionDigits: 0 }))}</div>`;
  }

  private renderRespawn(seconds: number | null): void {
    const el = this.getEl('bg-hud-respawn', 'bg-hud-respawn');
    if (seconds === null || seconds <= 0) {
      if (this.wasDown) audio.fiestaRevive();
      this.wasDown = false;
      el.style.display = 'none';
      el.dataset.sig = '';
      return;
    }
    this.wasDown = true;
    el.style.display = 'flex';
    const sig = `${seconds}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.innerHTML =
      `<div class="bgr-title">${esc(t('hudChrome.bg.hud.respawnTitle'))}</div>` +
      `<div class="bgr-count">${esc(formatNumber(seconds, { maximumFractionDigits: 0 }))}</div>` +
      `<div class="bgr-sub">${esc(t('hudChrome.bg.hud.respawnSub'))}</div>`;
  }

  private renderAftermath(
    aftermath: { outcome: 'win' | 'loss' | 'draw'; returnIn: number } | null,
  ): void {
    const el = this.getEl('bg-hud-aftermath', 'bg-hud-aftermath');
    if (!aftermath) {
      el.style.display = 'none';
      el.dataset.sig = '';
      return;
    }
    el.style.display = 'flex';
    const sig = `${aftermath.outcome}|${aftermath.returnIn}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    const title =
      aftermath.outcome === 'win'
        ? t('hudChrome.bg.end.win')
        : aftermath.outcome === 'loss'
          ? t('hudChrome.bg.end.loss')
          : t('hudChrome.bg.end.draw');
    el.innerHTML =
      `<div class="bga-title ${aftermath.outcome}">${esc(title)}</div>` +
      `<div class="bga-sub">${esc(
        t('hudChrome.bg.hud.returning', {
          seconds: formatNumber(aftermath.returnIn, { maximumFractionDigits: 0 }),
        }),
      )}</div>`;
  }

  private teardown(): void {
    for (const id of ['bg-hud-strip', 'bg-hud-countdown', 'bg-hud-respawn', 'bg-hud-aftermath']) {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = 'none';
        el.innerHTML = '';
        el.dataset.sig = '';
      }
    }
    this.wasDown = false;
  }
}
