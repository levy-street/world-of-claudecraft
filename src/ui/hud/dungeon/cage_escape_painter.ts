// The Iron Cage escape prompt: the thin painter over cage_escape_view.ts. A
// self-mounted panel, centred low over the action bar, shown while the local
// player is caged: the title, the prompt naming the interact key (a keycap),
// and the escape bar filling with every counted press and draining as the cage
// mends. The whole panel is a button, so a tap (or a click) is a press too: on
// a touch screen it IS the escape control. The skeleton is built once; every
// per-frame value rides the PainterHost elided writers, so a still frame
// writes nothing.

import type { PainterHostWriters } from '../../painter_host';
import type { CageEscapeView } from './cage_escape_view';

export interface CageEscapeDeps {
  /** The HUD layer the panel mounts into (null before the HUD exists). */
  layer: () => HTMLElement | null;
  writers: PainterHostWriters;
  /** One escape press (the same command the interact key sends). */
  onPress: () => void;
}

interface Slots {
  title: HTMLElement;
  prompt: HTMLElement;
  key: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
}

export class CageEscapePrompt {
  private root: HTMLButtonElement | null = null;
  private slots: Slots | null = null;

  constructor(private readonly deps: CageEscapeDeps) {}

  paint(view: CageEscapeView): void {
    const w = this.deps.writers;
    if (!view.visible) {
      if (this.root) w.setDisplay(this.root, 'none');
      return;
    }
    const root = this.ensureRoot();
    const slots = this.slots;
    if (!root || !slots) return;
    w.setDisplay(root, 'flex');
    w.setText(slots.title, view.title);
    w.setText(slots.prompt, view.prompt);
    w.setText(slots.key, view.key);
    w.setStyleProp(slots.key, 'display', view.key ? 'inline-flex' : 'none');
    w.setWidth(slots.fill, `${(view.progress * 100).toFixed(1)}%`);
    w.setAttr(root, 'aria-label', view.buttonAria);
    w.setAttr(slots.bar, 'aria-valuenow', String(Math.round(view.progress * 100)));
    w.setAttr(slots.bar, 'aria-valuetext', view.progressAria);
    w.toggleClass(root, 'is-near', view.progress >= 0.75);
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.slots = null;
  }

  private ensureRoot(): HTMLButtonElement | null {
    if (this.root) return this.root;
    const layer = this.deps.layer();
    if (!layer) return null;
    const doc = layer.ownerDocument;
    const root = doc.createElement('button');
    root.type = 'button';
    root.id = 'bastion-cage-escape';
    root.className = 'ui-panel-strong bastion-cage-escape';
    const title = doc.createElement('div');
    title.className = 'bce-title ui-cin';
    const line = doc.createElement('div');
    line.className = 'bce-line';
    const key = doc.createElement('span');
    key.className = 'ui-keycap bce-key';
    const prompt = doc.createElement('span');
    prompt.className = 'bce-prompt';
    line.append(key, prompt);
    const bar = doc.createElement('div');
    bar.className = 'ui-bar bce-bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    const fill = doc.createElement('div');
    fill.className = 'ui-bar-fill bce-fill';
    bar.append(fill);
    root.append(title, line, bar);
    // Every press, however it arrives (a click, a tap, the pointer held on a
    // touch screen), is one escape press; the sim counts and rate-limits them.
    root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.deps.onPress();
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.deps.onPress();
      }
    });
    layer.appendChild(root);
    this.root = root;
    this.slots = { title, prompt, key, bar, fill };
    return root;
  }
}
