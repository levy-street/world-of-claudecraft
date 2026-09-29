// The Fire and Fly seat HUD's two roots: the status strip at the top centre (the wave,
// the monsters left or the countdown, Leave), which unfolds into the result card when
// the defense ends, and the tower's integrity rail at the bottom centre. Frames come
// from TurretHudView and every write goes through the shared facet, so an unchanged
// frame writes nothing. Only Leave takes the pointer (the stylesheet keeps the rest
// inert), so aim clicks and drags pass through both roots. The polite live line is a
// third, visually hidden #ui child that stays rendered while the roots hide: a region
// shown already filled is rarely spoken, and Hide Interface spares only such children.
import { TURRET_TIMING } from '../../../sim/content/turret_defense';
import type { PainterHostWriters } from '../../painter_host';
import { TURRET_RESULT_ROWS, type TurretHudFrame } from './turret_hud_view';

export const TURRET_HUD_ID = 'turret-hud';
export const TURRET_RAIL_ID = 'turret-rail';
export const TURRET_LIVE_ID = 'turret-live';
/** The rail's quarter ticks; the first one is the danger line. */
const RAIL_SEGMENTS = 4;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

interface StatRowElements {
  label: HTMLElement;
  value: HTMLElement;
}

export class TurretHudPainter {
  readonly strip = el('section', 'turret-strip ui-panel-strong');
  readonly rail = el('div', 'turret-rail');
  /** The bevel's wrapper: the hit flash's glow and swing land here, outside the bevel's clip. */
  readonly railBar = el('div', 'turret-rail-bar');
  readonly live = el('div', 'visually-hidden');
  private readonly wave = el('span', 'turret-strip-wave ui-cin');
  private readonly slot = el('span', 'turret-strip-slot ui-num');
  private readonly card = el('div', 'turret-card');
  private readonly kicker = el('div', 'turret-card-kicker ui-cin ui-muted');
  private readonly verdict = el('div', 'turret-card-verdict ui-cin');
  private readonly rows: StatRowElements[] = [];
  private readonly leave = el('button', 'turret-leave ui-btn');
  private readonly leaveLabel = el('span', 'turret-leave-label');
  private readonly keycap = el('kbd', 'turret-leave-key ui-keycap');
  private readonly caption = el('span', 'turret-rail-caption ui-cin ui-outline');
  private readonly fill = el('div', 'turret-rail-fill ui-bevel-fill');
  private readonly value = el('span', 'turret-rail-value ui-num ui-outline');

  constructor(
    private readonly writers: PainterHostWriters,
    onLeave: () => void,
  ) {
    this.strip.id = TURRET_HUD_ID;
    this.rail.id = TURRET_RAIL_ID;
    this.live.id = TURRET_LIVE_ID;
    this.leave.type = 'button';
    writers.setAttr(this.live, 'role', 'status');
    writers.setAttr(this.live, 'aria-live', 'polite');
    writers.setAttr(this.live, 'aria-atomic', 'true');
    writers.setAttr(this.kicker, 'aria-hidden', 'true');
    writers.setAttr(this.keycap, 'aria-hidden', 'true');
    writers.setAttr(this.leave, 'aria-keyshortcuts', 'Escape');
    writers.setAttr(this.rail, 'role', 'meter');
    writers.setAttr(this.rail, 'aria-valuemin', '0');
    writers.setAttr(this.rail, 'aria-valuemax', String(TURRET_TIMING.integrity));
    writers.setAttr(this.caption, 'aria-hidden', 'true');
    writers.setAttr(this.value, 'aria-hidden', 'true');
    this.leave.append(this.leaveLabel, this.keycap);
    this.leave.addEventListener('click', onLeave);
    const divider = el('div', 'ui-divider');
    writers.setAttr(divider, 'aria-hidden', 'true');
    const stats = el('dl', 'turret-card-stats');
    for (let i = 0; i < TURRET_RESULT_ROWS; i++) {
      const row = el('div', 'ui-stat-row');
      const label = el('dt', 'turret-card-label');
      const value = el('dd', 'turret-card-value ui-num');
      row.append(label, value);
      stats.append(row);
      this.rows.push({ label, value });
    }
    this.card.append(this.kicker, this.verdict, divider, stats);
    this.strip.append(this.wave, this.slot, this.card, this.leave);
    const bevel = el('div', 'turret-rail-bevel ui-bevel');
    const ticks = el('div', 'ui-bevel-ticks');
    for (let i = 0; i < RAIL_SEGMENTS; i++) ticks.append(document.createElement('span'));
    const edge = el('div', 'ui-bevel-edge');
    writers.setAttr(ticks, 'aria-hidden', 'true');
    writers.setAttr(edge, 'aria-hidden', 'true');
    bevel.append(this.fill, ticks, edge);
    this.railBar.append(bevel);
    this.rail.append(this.caption, this.railBar, this.value);
    this.show(false);
  }

  /** Shows both roots while seated; leaving clears what the live line last said. */
  show(seated: boolean): void {
    const writers = this.writers;
    writers.setDisplay(this.strip, seated ? '' : 'none');
    writers.setDisplay(this.rail, seated ? '' : 'none');
    if (!seated) writers.setText(this.live, '');
  }

  /** `keycap` is Leave's binding as the player's current input shows it. */
  paint(frame: TurretHudFrame, keycap: string): void {
    const writers = this.writers;
    const labels = frame.labels;
    writers.setAttr(this.strip, 'aria-label', labels.title);
    writers.setText(this.wave, frame.wave);
    writers.setText(this.slot, frame.slot);
    writers.setText(this.live, frame.announce);
    writers.setAttr(this.leave, 'aria-label', labels.leave);
    writers.setAttr(this.leave, 'title', labels.leave);
    writers.setText(this.keycap, keycap);
    writers.setAttr(this.rail, 'aria-label', labels.meter);
    writers.setAttr(this.rail, 'aria-valuenow', frame.integrityNow);
    writers.toggleClass(this.rail, 'low-integrity', frame.low);
    writers.setStyleProp(this.fill, '--turret-integrity', frame.integrityFill);
    writers.setText(this.caption, labels.caption);
    writers.setText(this.value, frame.integrityText);
    const result = frame.result;
    const ended = result !== null;
    writers.toggleClass(this.strip, 'ended', ended);
    writers.toggleClass(this.leave, 'ui-btn--lg', ended);
    writers.setText(this.leaveLabel, ended ? labels.leave : labels.leaveShort);
    if (!result) return;
    writers.toggleClass(this.card, 'won', result.won);
    writers.setText(this.kicker, labels.title);
    writers.setText(this.verdict, result.verdict);
    for (let i = 0; i < this.rows.length; i++) {
      writers.setText(this.rows[i].label, result.rows[i].label);
      writers.setText(this.rows[i].value, result.rows[i].value);
    }
  }
}
