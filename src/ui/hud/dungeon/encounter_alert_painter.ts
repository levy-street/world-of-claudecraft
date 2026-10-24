// The shared encounter alert: the thin painter every dungeon's pure alert
// view paints through (the Wildheart Basin's wildheart_alert_view.ts, the
// Gravewyrm Sanctum's sanctum_alert_view.ts), each under its own root id and
// kind list (AlertLook). A self-mounted panel in the dungeon prompts' slot
// (low over the action bar), shown while a mechanic asks something of the
// local player: the title, the line saying what to do, an optional hint and
// the bar (with the words a view prints on it). A view may mark the panel
// pressable: then the whole panel is a button, and a tap (or a click) is the
// interact press. The skeleton is built once; every per-frame value rides the
// PainterHost elided writers, so a still frame writes nothing.

import type { PainterHostWriters } from '../../painter_host';
import type { EncounterAlertView } from './encounter_alert_view';

/** One encounter alert's mount: its root id, root classes and kind classes. */
export interface AlertLook {
  id: string;
  className: string;
  kinds: readonly string[];
}

export interface EncounterAlertDeps {
  /** The HUD layer the panel mounts into (null before the HUD exists). */
  layer: () => HTMLElement | null;
  writers: PainterHostWriters;
  /** One interact press (the same command the interact key sends). */
  onPress: () => void;
}

interface Slots {
  title: HTMLElement;
  line: HTMLElement;
  hint: HTMLElement;
  key: HTMLElement;
  hintText: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  barLabel: HTMLElement;
}

export class EncounterAlert {
  private root: HTMLButtonElement | null = null;
  private slots: Slots | null = null;
  private pressable = false;

  constructor(
    private readonly deps: EncounterAlertDeps,
    private readonly look: AlertLook,
  ) {}

  paint(view: EncounterAlertView): void {
    const w = this.deps.writers;
    if (!view.visible) {
      this.pressable = false;
      if (this.root) w.setDisplay(this.root, 'none');
      return;
    }
    const root = this.ensureRoot();
    const slots = this.slots;
    if (!root || !slots) return;
    this.pressable = view.pressable;
    w.setDisplay(root, 'flex');
    for (const k of this.look.kinds) w.toggleClass(root, `is-${k}`, view.kind === k);
    w.toggleClass(root, 'is-pressable', view.pressable);
    w.setText(slots.title, view.title);
    w.setText(slots.line, view.line);
    w.setDisplay(slots.hint, view.hint ? 'flex' : 'none');
    w.setText(slots.hintText, view.hint);
    w.setText(slots.key, view.key);
    w.setStyleProp(slots.key, 'display', view.key ? 'inline-flex' : 'none');
    w.setAttr(root, 'aria-label', view.buttonAria);
    w.setDisplay(slots.bar, view.progress === null ? 'none' : 'block');
    const progress = view.progress ?? 0;
    w.setWidth(slots.fill, `${(progress * 100).toFixed(1)}%`);
    w.setAttr(slots.bar, 'aria-valuenow', String(Math.round(progress * 100)));
    w.setAttr(slots.bar, 'aria-valuetext', view.progressAria);
    w.setText(slots.barLabel, view.barLabel ?? '');
    w.setStyleProp(slots.barLabel, 'display', view.barLabel ? 'block' : 'none');
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.slots = null;
  }

  private press(e: Event): void {
    if (!this.pressable) return;
    e.preventDefault();
    this.deps.onPress();
  }

  private ensureRoot(): HTMLButtonElement | null {
    if (this.root) return this.root;
    const layer = this.deps.layer();
    if (!layer) return null;
    const doc = layer.ownerDocument;
    const root = doc.createElement('button');
    root.type = 'button';
    const { id, className } = this.look;
    root.id = id;
    root.className = className;
    const title = doc.createElement('div');
    title.className = 'fa-title ui-cin';
    const line = doc.createElement('div');
    line.className = 'fa-line';
    const hint = doc.createElement('div');
    hint.className = 'fa-hint';
    const key = doc.createElement('span');
    key.className = 'ui-keycap fa-key';
    const hintText = doc.createElement('span');
    hint.append(key, hintText);
    const bar = doc.createElement('div');
    bar.className = 'ui-bar fa-bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    const fill = doc.createElement('div');
    fill.className = 'ui-bar-fill fa-fill';
    const barLabel = doc.createElement('div');
    barLabel.className = 'fa-bar-label';
    bar.append(fill);
    root.append(title, line, hint, bar, barLabel);
    // A pressable view takes the press as an interact press; otherwise the
    // panel ignores the pointer.
    root.addEventListener('pointerdown', (e) => this.press(e));
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') this.press(e);
    });
    layer.appendChild(root);
    this.root = root;
    this.slots = { title, line, hint, key, hintText, bar, fill, barLabel };
    return root;
  }
}
