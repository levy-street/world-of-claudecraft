// The Key Bindings panel's keyboard overview painter: a live keyboard drawn
// from the player's current bindings, every key in use coloured by its
// action's category and captioned with the action. Under the board sit its
// options as labelled rows: the modifier layer (none / Shift / Ctrl / Alt), the
// keyboard size (full size, tenkeyless, 75%, 60%) and, when the browser
// reports an OS layout other than QWERTY (Colemak, Dvorak, AZERTY, QWERTZ),
// which legends to print: that layout's characters or the QWERTY caps that are
// physically on most boards. Size and legend choices are remembered
// (keyboard_layout_pref_core.ts). Legends come from Chromium's
// navigator.keyboard.getLayoutMap and fall back to the code labels elsewhere.
// Either way a key IS its physical code, so both labellings point at the same
// binding. Also: a category legend, a list of any bindings on keys the chosen
// size does not draw, and a detail line that spells out everything bound to
// the hovered or focused key. The keys are buttons: clicking a bound key arms
// the shared key capture for that action (press the new key; a key another
// action holds asks first, exactly like the panel's rows) with Unbind / Cancel
// beside the status, and clicking an empty key opens an action picker that
// binds the action to that key in the current layer. The same painter fills
// the pop-out window (keyboard_map_window.ts). The geometry and per-key
// annotation come from the pure keyboard_map_core.ts; this module owns only
// the DOM. Registered in tests/architecture.test.ts UI_DOM_MODULES.

import { audio } from '../game/audio';
import {
  actionKind,
  isModifierCode,
  isReservedCode,
  type Keybinds,
  keyLabel,
} from '../game/keybinds';
import {
  captureFocusKey,
  FOCUS_KEY_ATTR,
  findFocusKey,
  restoreFirstEnabled,
} from './focus_restore';
import { type TranslationKey, t } from './i18n';
import { keybindConflictPrompt } from './keybind_conflict_prompt_core';
import {
  loadKeyboardFormFactor,
  loadKeyboardLegendSource,
  saveKeyboardFormFactor,
  saveKeyboardLegendSource,
} from './keyboard_layout_pref_core';
import {
  buildKeyboardMap,
  categoryClass,
  KEYBOARD_FORM_FACTORS,
  KEYBOARD_LAYERS,
  KEYBOARD_LEGEND_SOURCES,
  type KeyboardFormFactor,
  type KeyboardKeyBinding,
  type KeyboardKeyView,
  type KeyboardLayer,
  type KeyboardLegendSource,
  legendsDifferFromQwerty,
  splitCombo,
} from './keyboard_map_core';

export interface KeyboardMapPaintDeps {
  /** The bindings to show (the live Keybinds snapshot, already filtered of
   *  any action the panel itself hides). */
  bindings: () => Record<string, (string | null)[]>;
  actionName: (actionId: string) => string;
  actionCategory: (actionId: string) => string;
  /** Ordered category names with their localized labels, for the legend. */
  categories: () => { id: string; label: string }[];
  /** The modifier layer to show first, and where a switch is remembered. */
  layer: KeyboardLayer;
  onLayerChange: (layer: KeyboardLayer) => void;
  /** Rebinding through the keys; omitted for a read-only board. */
  rebind?: KeyboardMapRebindDeps;
  /** Shown as a Pop Out button in the header when given. */
  onPopOut?: () => void;
}

export interface KeyboardMapRebindDeps {
  keybinds: () => Keybinds;
  /** OptionsHooks.captureKey: arm a one-shot key capture, or null to clear it. */
  captureKey: (cb: ((code: string | null) => void) | null) => void;
  /** The HUD's shared are-you-sure dialog (the panel rows' conflict prompt). */
  confirmDialog: (
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
  ) => void;
  /** After any bind / unbind: refresh keycaps and any other open view.
   *  `status` is the localized outcome line, for a view that rebuilds this
   *  board and wants to keep showing it. */
  onChanged: (status: string) => void;
  /** The actions an empty key may be given, in menu order. */
  assignable: () => { id: string; label: string }[];
  /** The shared gold dropdown (OptionsWindowDeps.buildDropdown). */
  buildDropdown: (
    options: { value: string; label: string }[],
    current: string,
    onChange?: (value: string) => void,
    placeholder?: string,
    a11y?: { ariaLabel?: string; labelledBy?: string },
  ) => HTMLElement;
}

export interface KeyboardMapHandle {
  /** Redraw the board from the live bindings (after an outside rebind). */
  repaint: () => void;
  /** Drop any key capture this board armed. Call before discarding the board
   *  (a panel rebuild, the window closing), or the one-shot capture outlives
   *  it and the player's next keypress rebinds through a detached board. */
  dispose: () => void;
}

/** Quarter-unit grid columns per key unit (keys are 1, 1.25, 1.5 ... wide). */
const COLS_PER_UNIT = 4;

// --- real key legends -------------------------------------------------------
// navigator.keyboard.getLayoutMap() (Chromium) maps a KeyboardEvent.code to the
// character the key prints under the active OS layout. It is fetched once per
// session and applied only to the codes that carry a printed character; named
// keys (Enter, Shift, arrows) keep their labels. Where the API is missing
// (Firefox, Safari) the code labels stand, which read as QWERTY.
interface KeyboardLayoutMapLike {
  get(code: string): string | undefined;
}
interface NavigatorKeyboardLike {
  keyboard?: { getLayoutMap?: () => Promise<KeyboardLayoutMapLike> };
}
const PRINTED_CODE_RE =
  /^(Key[A-Z]|Digit\d|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|IntlBackslash)$/;
let layoutMap: KeyboardLayoutMapLike | null = null;
let layoutMapLoad: Promise<void> | null = null;

/** Resolve the browser's layout map once; resolves (never rejects) when known. */
function loadLayoutMap(): Promise<void> {
  if (layoutMapLoad) return layoutMapLoad;
  const keyboard = (navigator as NavigatorKeyboardLike).keyboard;
  const getter = keyboard?.getLayoutMap;
  layoutMapLoad = getter
    ? getter
        .call(keyboard)
        .then((map) => {
          layoutMap = map;
        })
        .catch(() => undefined)
    : Promise.resolve();
  return layoutMapLoad;
}

/** The character the OS layout prints for a bare code, or null when unknown
 *  (no layout map, or not a printing key). */
function layoutCharacter(code: string): string | null {
  if (!layoutMap || !PRINTED_CODE_RE.test(code)) return null;
  const printed = layoutMap.get(code);
  return printed && printed.trim().length > 0 ? printed.toUpperCase() : null;
}

/** The keycap legend for a bare code: the printed character when the browser
 *  knows it, else the code label ("KeyA" -> "A"). */
function keyLegend(code: string): string {
  return layoutCharacter(code) ?? keyLabel(code);
}

/** Whether the OS layout the browser reports prints something other than
 *  QWERTY on the letter and digit keys (so a legend choice is worth offering). */
function layoutIsNonQwerty(): boolean {
  return layoutMap !== null && legendsDifferFromQwerty(layoutCharacter, keyLabel);
}

/** Paint the overview into `root` (appended) and return its handle. */
export function paintKeyboardMap(root: HTMLElement, deps: KeyboardMapPaintDeps): KeyboardMapHandle {
  const wrap = document.createElement('section');
  wrap.className = 'kbm';
  wrap.setAttribute('aria-label', t('hudChrome.keyboardMap.title'));

  // Header: the title and, in the panel, the Pop Out button. The options live
  // under the board (below) so the picture stays the first thing in the block.
  const head = document.createElement('div');
  head.className = 'kbm-head';
  const title = document.createElement('div');
  title.className = 'kbm-title';
  title.textContent = t('hudChrome.keyboardMap.title');
  head.appendChild(title);
  if (deps.onPopOut) {
    const onPopOut = deps.onPopOut;
    const pop = document.createElement('button');
    pop.type = 'button';
    pop.className = 'btn kbm-popout';
    pop.textContent = t('hudChrome.keyboardMap.popOut');
    pop.addEventListener('click', () => {
      audio.click();
      onPopOut();
    });
    head.appendChild(pop);
  }

  const board = document.createElement('div');
  board.className = 'kbm-board';
  const hiddenLine = document.createElement('div');
  hiddenLine.className = 'kbm-hidden';
  hiddenLine.hidden = true;
  const options = document.createElement('div');
  options.className = 'kbm-opts';
  const detail = document.createElement('div');
  detail.className = 'kbm-detail';
  detail.setAttribute('role', 'status');
  // The action row under the detail line: Unbind / Cancel while a capture is
  // armed, or the assign picker for an empty key.
  const actions = document.createElement('div');
  actions.className = 'kbm-actions';
  actions.hidden = true;

  let layer: KeyboardLayer = deps.layer;
  let formFactor: KeyboardFormFactor = loadKeyboardFormFactor();
  let legendSource: KeyboardLegendSource = loadKeyboardLegendSource();
  // The capture armed from a key click, so a second click or a repaint can
  // clear it instead of leaving a stale one-shot callback behind.
  let armed: { binding: KeyboardKeyBinding } | null = null;
  const rebind = deps.rebind;

  let disposed = false;

  const hint = (): string =>
    t(rebind ? 'hudChrome.keyboardMap.hintInteractive' : 'hudChrome.keyboardMap.hint');
  detail.textContent = hint();

  /** The legend this board prints for a bare code, per the player's choice. */
  const legendFor = (code: string): string =>
    legendSource === 'layout' ? keyLegend(code) : keyLabel(code);
  /** A combo's label in the same legends: "Shift+" + the key. */
  const comboLegend = (combo: string): string => {
    const { head: mods, code } = splitCombo(combo);
    return mods + legendFor(code);
  };

  /** One labelled option row: a caption and a group of aria-pressed buttons,
   *  exactly one of which is current. */
  const optionRow = <T extends string>(
    labelKey: TranslationKey,
    entries: { id: T; labelKey: TranslationKey }[],
    current: () => T,
    onPick: (id: T) => void,
  ): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'kbm-opt-row';
    const caption = document.createElement('span');
    caption.className = 'kbm-opt-label';
    caption.textContent = t(labelKey);
    const group = document.createElement('div');
    group.className = 'kbm-layers';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', t(labelKey));
    const buttons = new Map<T, HTMLButtonElement>();
    for (const entry of entries) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn kbm-layer';
      b.textContent = t(entry.labelKey);
      b.setAttribute('aria-pressed', String(entry.id === current()));
      b.addEventListener('click', () => {
        if (current() === entry.id) return;
        audio.click();
        onPick(entry.id);
        for (const [id, btn] of buttons) btn.setAttribute('aria-pressed', String(id === current()));
        resetInteraction();
        paintBoard();
      });
      buttons.set(entry.id, b);
      group.appendChild(b);
    }
    row.append(caption, group);
    return row;
  };

  /** (Re)build the option rows; the legend row appears only once the browser
   *  has reported a non-QWERTY layout. */
  const paintOptions = (): void => {
    options.replaceChildren(
      optionRow(
        'hudChrome.keyboardMap.layerGroup',
        KEYBOARD_LAYERS,
        () => layer,
        (id) => {
          layer = id;
          deps.onLayerChange(layer);
        },
      ),
      optionRow(
        'hudChrome.keyboardMap.formGroup',
        KEYBOARD_FORM_FACTORS,
        () => formFactor,
        (id) => {
          formFactor = id;
          saveKeyboardFormFactor(id);
        },
      ),
    );
    if (layoutIsNonQwerty()) {
      options.appendChild(
        optionRow(
          'hudChrome.keyboardMap.legendGroup',
          KEYBOARD_LEGEND_SOURCES,
          () => legendSource,
          (id) => {
            legendSource = id;
            saveKeyboardLegendSource(id);
          },
        ),
      );
    }
  };

  const bindingLine = (b: KeyboardKeyBinding): string =>
    t('hudChrome.keyboardMap.bindingLine', { key: comboLegend(b.combo), action: b.name });

  const describe = (key: KeyboardKeyView): string => {
    if (key.bindings.length === 0)
      return t('hudChrome.keyboardMap.keyDetail', {
        key: key.legend,
        bindings: t('hud.options.unbound'),
      });
    // A bare binding is already named by the {key} prefix; only a modifier
    // combo needs its own label ("3: Iron Bellow, Ctrl+3: Pet: Taunt").
    const parts = key.bindings.map((b) =>
      splitCombo(b.combo).head === '' ? b.name : bindingLine(b),
    );
    return t('hudChrome.keyboardMap.keyDetail', {
      key: key.legend,
      bindings: parts.join(t('hudChrome.keyboardMap.separator')),
    });
  };

  /** Drop any armed capture and the action row; the detail goes back to the hint. */
  const resetInteraction = (): void => {
    if (armed) rebind?.captureKey(null);
    armed = null;
    actions.hidden = true;
    actions.replaceChildren();
    detail.textContent = hint();
  };

  const actionButton = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = label;
    b.addEventListener('click', () => {
      audio.click();
      onClick();
    });
    return b;
  };

  /** Commit a bind, asking first when `combo` is held by another action. */
  const bindWithConfirm = (
    io: KeyboardMapRebindDeps,
    actionId: string,
    index: number,
    combo: string,
    done: () => string,
  ): void => {
    const commit = () => {
      if (!io.keybinds().bind(actionId, index, combo)) {
        // A reserved code (Escape, the camera buttons): nothing changed.
        finish(t('hudChrome.keyboardMap.notBindable'));
        return;
      }
      const status = done();
      finish(status);
      io.onChanged(status);
    };
    const conflict = io.keybinds().findBindConflict(actionId, index, combo);
    const prompt = keybindConflictPrompt({
      key: comboLegend(conflict?.code ?? combo),
      other: conflict ? deps.actionName(conflict.id) : null,
      action: deps.actionName(actionId),
    });
    if (!prompt) {
      commit();
      return;
    }
    // The capture has fired: drop the board to idle (ring off, Cancel gone, the
    // prompt's title as the status) before asking, like the rows and the on-bar
    // mode, so a cancelled prompt never leaves a "Press a key" state behind
    // with nothing armed.
    finish(t(prompt.titleKey));
    io.confirmDialog(
      t(prompt.titleKey),
      t(prompt.bodyKey, prompt.params),
      t(prompt.acceptKey),
      t(prompt.cancelKey),
      commit,
    );
  };

  /** A bound key was clicked: capture a new key for that binding. */
  const startRebind = (io: KeyboardMapRebindDeps, binding: KeyboardKeyBinding): void => {
    resetInteraction();
    armed = { binding };
    detail.textContent = t('hudChrome.keyboardMap.pressKey', { action: binding.name });
    const code = splitCombo(binding.combo).code;
    for (const cell of board.querySelectorAll<HTMLElement>('.kbm-key[data-code]'))
      cell.classList.toggle('capturing', cell.dataset.code === code);
    // No Unbind here on purpose: the panel rows offer none either, and a stored
    // [null, null] row is exactly the shape the load-time repair
    // (keybinds_repair.ts, Signature B) reads as loader eviction and re-seeds.
    actions.replaceChildren(
      actionButton(t('hudChrome.actionBar.cancel'), () => {
        resetInteraction();
        paintBoard();
      }),
    );
    actions.hidden = false;
    io.captureKey((code) => {
      // A stale capture: a later click re-armed for another binding, or the
      // board was reset. Drop it.
      if (armed?.binding !== binding) return;
      armed = null;
      if (code === null) {
        finish(t('hud.options.keybindCancelled'));
        return;
      }
      bindWithConfirm(io, binding.actionId, binding.index, code, () =>
        t('hudChrome.keyboardMap.boundTo', {
          action: binding.name,
          key: comboLegend(io.keybinds().codeAt(binding.actionId, binding.index) ?? code),
        }),
      );
    });
  };

  /** An empty key was clicked: pick an action to put on it in this layer. */
  const startAssign = (io: KeyboardMapRebindDeps, key: KeyboardKeyView): void => {
    resetInteraction();
    const combo = `${layer}${key.code}`;
    const comboLabel = comboLegend(combo);
    detail.textContent = t('hudChrome.keyboardMap.assignHint', { key: comboLabel });
    const picker = io.buildDropdown(
      io.assignable().map((a) => ({ value: a.id, label: a.label })),
      '',
      (actionId) => {
        const kb = io.keybinds();
        // The primary slot when free, else the alternate (replacing it when
        // both are taken): the primary is the one the panel rows show first.
        const index = kb.codeAt(actionId, 0) === null ? 0 : 1;
        // A held (movement) action ignores modifiers and stores the bare key
        // (Keybinds.bind), so check and report the combo that actually lands.
        const stored = actionKind(actionId) === 'held' ? key.code : combo;
        bindWithConfirm(io, actionId, index, stored, () =>
          t('hudChrome.keyboardMap.boundTo', {
            action: deps.actionName(actionId),
            key: comboLegend(stored),
          }),
        );
      },
      t('hudChrome.keyboardMap.assignPlaceholder', { key: comboLabel }),
      { ariaLabel: t('hudChrome.keyboardMap.assignPlaceholder', { key: comboLabel }) },
    );
    actions.replaceChildren(
      picker,
      actionButton(t('hudChrome.actionBar.cancel'), () => {
        resetInteraction();
        paintBoard();
      }),
    );
    actions.hidden = false;
  };

  /** End an interaction with a status line and a fresh board. */
  const finish = (status: string): void => {
    armed = null;
    actions.hidden = true;
    actions.replaceChildren();
    paintBoard();
    detail.textContent = status;
  };

  /** Roving tabindex: one Tab stop per block, arrows walk the caps. */
  const roveBlock = (el: HTMLElement, rows: HTMLButtonElement[][]): void => {
    const caps = rows.flat();
    if (caps.length === 0) return;
    for (const cap of caps) cap.tabIndex = -1;
    caps[0].tabIndex = 0;
    el.addEventListener('focusin', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLButtonElement) || !caps.includes(target)) return;
      for (const cap of caps) cap.tabIndex = cap === target ? 0 : -1;
    });
    el.addEventListener('keydown', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLButtonElement) || !caps.includes(target)) return;
      const r = rows.findIndex((row) => row.includes(target));
      const c = rows[r].indexOf(target);
      let next: HTMLButtonElement | undefined;
      if (e.key === 'ArrowRight') next = caps[(caps.indexOf(target) + 1) % caps.length];
      else if (e.key === 'ArrowLeft')
        next = caps[(caps.indexOf(target) - 1 + caps.length) % caps.length];
      else if (e.key === 'ArrowDown' && rows[r + 1])
        next = rows[r + 1][Math.min(c, rows[r + 1].length - 1)];
      else if (e.key === 'ArrowUp' && rows[r - 1])
        next = rows[r - 1][Math.min(c, rows[r - 1].length - 1)];
      else if (e.key === 'Home') next = caps[0];
      else if (e.key === 'End') next = caps[caps.length - 1];
      if (!next) return;
      e.preventDefault();
      next.focus();
    });
  };

  const paintBoard = (): void => {
    // A rebuild from a focused cap keeps that cap focused (src/ui/CLAUDE.md,
    // focus across a REBUILD): in the pop-out the trap cycles Tab only while
    // focus is inside, so a drop to <body> would hand Tab to the game.
    const focusKey = captureFocusKey(board);
    board.replaceChildren();
    const view = buildKeyboardMap(
      deps.bindings(),
      layer,
      { legend: legendFor, name: deps.actionName, category: deps.actionCategory },
      formFactor,
    );
    for (const block of view.blocks) {
      const el = document.createElement('div');
      el.className = `kbm-block kbm-block-${block.id}`;
      el.style.setProperty('--kbm-cols', String(block.units * COLS_PER_UNIT));
      const capRows: HTMLButtonElement[][] = [];
      for (const row of block.rows) {
        const capRow: HTMLButtonElement[] = [];
        for (const key of row) {
          if (key.spacer) {
            const cell = document.createElement('div');
            cell.className = 'kbm-key kbm-spacer';
            cell.style.setProperty('--kbm-w', String(key.w * COLS_PER_UNIT));
            cell.style.setProperty('--kbm-h', String(key.h));
            cell.setAttribute('aria-hidden', 'true');
            el.appendChild(cell);
            continue;
          }
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.dataset.code = key.code;
          cell.setAttribute(FOCUS_KEY_ATTR, key.code);
          cell.style.setProperty('--kbm-w', String(key.w * COLS_PER_UNIT));
          cell.style.setProperty('--kbm-h', String(key.h));
          const bound = key.layerBinding;
          cell.className = `kbm-key${bound ? ` in-use kbm-cat-${categoryClass(bound.category)}` : ''}`;
          const legend = document.createElement('span');
          legend.className = 'kbm-legend';
          legend.textContent = key.legend;
          cell.appendChild(legend);
          if (bound) {
            const action = document.createElement('span');
            action.className = 'kbm-action';
            action.textContent = bound.name;
            cell.appendChild(action);
          }
          if (key.otherLayers) {
            const dot = document.createElement('span');
            dot.className = 'kbm-dot';
            cell.appendChild(dot);
          }
          const text = describe(key);
          cell.setAttribute('aria-label', text);
          cell.title = text;
          const show = () => {
            if (!armed && actions.hidden) detail.textContent = text;
          };
          cell.addEventListener('mouseenter', show);
          cell.addEventListener('focus', show);
          // Escape is reserved and a bare modifier never reaches a keydown
          // capture (Input skips it), so neither can take a binding here.
          const assignable = !isReservedCode(key.code) && !isModifierCode(key.code);
          if (rebind && (bound || assignable)) {
            cell.addEventListener('click', () => {
              audio.click();
              if (bound) startRebind(rebind, bound);
              else startAssign(rebind, key);
            });
          } else if (rebind) {
            // A cap that can take no binding is not a control: out of the Tab
            // order and the arrow walk, still hoverable for its detail line.
            cell.classList.add('kbm-fixed');
            cell.disabled = true;
          }
          if (armed && splitCombo(armed.binding.combo).code === key.code)
            cell.classList.add('capturing');
          if (!cell.disabled) capRow.push(cell);
          el.appendChild(cell);
        }
        if (capRow.length > 0) capRows.push(capRow);
      }
      roveBlock(el, capRows);
      board.appendChild(el);
    }
    if (focusKey !== null) restoreFirstEnabled([findFocusKey(board, focusKey)]);
    // Bindings on keys this board does not draw stay listed, so shrinking the
    // picture never hides a live binding.
    hiddenLine.hidden = view.hidden.length === 0;
    hiddenLine.textContent = hiddenLine.hidden
      ? ''
      : t('hudChrome.keyboardMap.notOnLayout', {
          bindings: view.hidden.map(bindingLine).join(t('hudChrome.keyboardMap.separator')),
        });
  };
  paintOptions();
  paintBoard();
  // Real legends arrive asynchronously on first use; repaint (and offer the
  // legend choice) once they do. The promise is memoized, so every board
  // painted while the first fetch is in flight still hears the answer.
  if (!layoutMap)
    loadLayoutMap().then(() => {
      if (disposed || !wrap.isConnected) return;
      paintOptions();
      paintBoard();
    });

  const legend = document.createElement('div');
  legend.className = 'kbm-legend-row';
  for (const cat of deps.categories()) {
    const item = document.createElement('span');
    item.className = 'kbm-legend-item';
    const swatch = document.createElement('span');
    swatch.className = `kbm-swatch kbm-cat-${categoryClass(cat.id)}`;
    swatch.setAttribute('aria-hidden', 'true');
    item.append(swatch, document.createTextNode(cat.label));
    legend.appendChild(item);
  }
  const dotItem = document.createElement('span');
  dotItem.className = 'kbm-legend-item';
  const dotSwatch = document.createElement('span');
  dotSwatch.className = 'kbm-swatch kbm-swatch-dot';
  dotSwatch.setAttribute('aria-hidden', 'true');
  dotItem.append(dotSwatch, document.createTextNode(t('hudChrome.keyboardMap.otherLayers')));
  legend.appendChild(dotItem);

  wrap.append(head, board, hiddenLine, legend, options, detail, actions);
  root.appendChild(wrap);
  return {
    repaint: () => {
      // A repaint from outside during an interaction drops it (the bindings it
      // was about moved); a quiet one keeps the status line the last action set.
      if (armed || !actions.hidden) resetInteraction();
      paintBoard();
    },
    dispose: () => {
      disposed = true;
      resetInteraction();
    },
  };
}
