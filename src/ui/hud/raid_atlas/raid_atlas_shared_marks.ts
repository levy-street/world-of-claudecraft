// The raid atlas's shared-marks tool (DOM): the chrome button and its panel of
// the eight raid-marker symbols, a clear-all action and one line that says who
// sees the marks or why this player cannot set them. The controller owns the
// map input and the world calls; this module owns the chrome's state (which
// symbol is armed, open or not) and reports picks through its hooks.
//
//   editable    a symbol press arms it (the map's next taps place it; a tap on a
//               shared mark removes that mark); pressing it again disarms
//   read-only   the symbols show disabled and the note names the raid leader
//
// Every label is a t() key; the symbols' names are the target markers' own
// (raid_marker_labels_view.ts) and their art the same sprites (icons.ts).

import { t } from '../../i18n';
import { raidMarkerDataUrl } from '../../icons';
import { raidMarkerDisplayName } from '../../raid_marker_labels_view';
import { RAID_ATLAS_SHARED_SYMBOLS } from './raid_atlas_shared_marks_core';

export interface RaidAtlasSharedToolHooks {
  /** A symbol was armed (or, null, disarmed). */
  armed(symbol: number | null): void;
  clearAll(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  parent?.appendChild(node);
  return node;
}

function labelled(b: HTMLButtonElement, label: string): void {
  b.setAttribute('aria-label', label);
  b.title = label;
}

export class RaidAtlasSharedMarkTools {
  private readonly toolBtn: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly note: HTMLElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly symbols = new Map<number, HTMLButtonElement>();
  private armedSymbol: number | null = null;
  private editable: boolean | null = null;
  private count = -1;

  constructor(
    tools: HTMLElement,
    chrome: HTMLElement,
    private readonly hooks: RaidAtlasSharedToolHooks,
  ) {
    const tool = el('button', 'ui-btn raid-atlas-btn raid-atlas-shared-tool', tools);
    tool.type = 'button';
    labelled(tool, t('hudChrome.raidAtlas.shared.tool'));
    tool.setAttribute('aria-expanded', 'false');
    const glyph = el('img', 'raid-atlas-shared-tool-glyph', tool);
    glyph.src = raidMarkerDataUrl(7);
    glyph.alt = '';
    tool.addEventListener('click', () => this.setOpen(!this.isOpen()));
    this.toolBtn = tool;

    const panel = el('div', 'raid-atlas-shared ui-panel-strong', chrome);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', t('hudChrome.raidAtlas.shared.title'));
    const title = el('div', 'raid-atlas-editor-title', panel);
    title.textContent = t('hudChrome.raidAtlas.shared.title');
    const row = el('div', 'raid-atlas-shared-row', panel);
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', t('hudChrome.raidAtlas.shared.symbolsAria'));
    for (const symbol of RAID_ATLAS_SHARED_SYMBOLS) {
      const b = el('button', 'ui-btn raid-atlas-btn raid-atlas-chip raid-atlas-shared-chip', row);
      b.type = 'button';
      labelled(b, raidMarkerDisplayName(symbol));
      b.setAttribute('aria-pressed', 'false');
      const img = el('img', 'raid-atlas-shared-chip-glyph', b);
      img.src = raidMarkerDataUrl(symbol);
      img.alt = '';
      b.addEventListener('click', () => this.arm(this.armedSymbol === symbol ? null : symbol));
      this.symbols.set(symbol, b);
    }
    this.note = el('p', 'raid-atlas-shared-note', panel);
    const actions = el('div', 'raid-atlas-editor-actions', panel);
    this.clearBtn = el('button', 'ui-btn raid-atlas-btn raid-atlas-remove', actions);
    this.clearBtn.type = 'button';
    this.clearBtn.textContent = t('hudChrome.raidAtlas.shared.clearAll');
    labelled(this.clearBtn, t('hudChrome.raidAtlas.shared.clearAll'));
    this.clearBtn.addEventListener('click', () => this.hooks.clearAll());
    const done = el('button', 'ui-btn raid-atlas-btn raid-atlas-done', actions);
    done.type = 'button';
    done.textContent = t('hudChrome.raidAtlas.done');
    labelled(done, t('hudChrome.raidAtlas.done'));
    done.addEventListener('click', () => this.setOpen(false));
    panel.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      this.setOpen(false);
    });
    this.panel = panel;
  }

  /** The armed symbol (the map's taps place it), or null. */
  armed(): number | null {
    return this.armedSymbol;
  }

  isOpen(): boolean {
    return this.panel.classList.contains('is-open');
  }

  /** Open or close the panel; closing disarms. */
  setOpen(open: boolean): void {
    this.panel.classList.toggle('is-open', open);
    this.toolBtn.setAttribute('aria-expanded', String(open));
    if (open) this.symbols.get(this.armedSymbol ?? 0)?.focus();
    else this.arm(null);
  }

  /** Arm (or disarm) a symbol. */
  arm(symbol: number | null): void {
    const next = this.editable ? symbol : null;
    if (next === this.armedSymbol) return;
    this.armedSymbol = next;
    for (const [s, b] of this.symbols) b.setAttribute('aria-pressed', String(s === next));
    this.toolBtn.classList.toggle('is-on', next !== null);
    this.hooks.armed(next);
  }

  /** Keep the chrome on the live permission and mark count (cheap: a write only on change). */
  sync(editable: boolean, count: number): void {
    if (editable !== this.editable) {
      this.editable = editable;
      for (const b of this.symbols.values()) b.disabled = !editable;
      this.note.textContent = t(
        editable
          ? 'hudChrome.raidAtlas.shared.noteEditable'
          : 'hudChrome.raidAtlas.shared.readOnly',
      );
      this.panel.classList.toggle('is-read-only', !editable);
      if (!editable) this.arm(null);
    }
    if (count !== this.count || this.clearBtn.hidden === editable) {
      this.count = count;
      this.clearBtn.hidden = !editable;
      this.clearBtn.disabled = count === 0;
    }
  }
}
