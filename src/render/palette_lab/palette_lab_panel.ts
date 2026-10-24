// Palette lab panel: the in-game DOM surface (`?palette=on` only). A temporary
// DEV tool, so its text is dev-channel English like the perf overlay and the
// Ignivar placer, never a player string: the panel only exists behind the
// opt-in flag and never ships in a normal session.
//
// Click a card to wear that look; Alt+[ / Alt+] step through the zone's
// looks; hold Alt+\ (or the Stock button) to flash the shipped look for an
// instant A/B; Alt+P folds the panel away. Buttons blur after a click so the
// game's Space (jump) never re-presses the last one.

import { hexString, STOCK_LOOK_ID, type ZoneLook } from './zone_look_core';

export interface PaletteLabPanelView {
  zoneName: string;
  biome: string;
  sharedWith: string[];
  looks: ZoneLook[];
  selected: string;
  compare: boolean;
  timePhase: number | null;
  chosenCount: number;
}

export interface PaletteLabPanelHandlers {
  onSelect(lookId: string): void;
  onCycle(step: number): void;
  /** Pick the look at this card number (0 is stock). */
  onPick(index: number): void;
  onCompare(on: boolean): void;
  onTime(phase: number | null): void;
  onCopy(all: boolean): void;
  onResetZone(): void;
  onResetAll(): void;
}

export interface PaletteLabPanel {
  render(view: PaletteLabPanelView): void;
  setStatus(text: string): void;
}

const TIMES: ReadonlyArray<[string, number | null]> = [
  ['Dawn', 0.25],
  ['Morning', 0.36],
  ['Noon', 0.5],
  ['Golden', 0.68],
  ['Dusk', 0.75],
  ['Night', 0],
  ['Live', null],
];

const CSS = `
#palette-lab{position:fixed;top:12px;left:12px;z-index:400;width:352px;max-height:calc(100vh - 220px);
  display:flex;flex-direction:column;background:rgba(12,14,22,0.9);color:#e8e6df;border:1px solid #5d5240;
  border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,0.55);font:12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;
  pointer-events:auto;user-select:none}
#palette-lab.wpl-folded .wpl-body{display:none}
#palette-lab .wpl-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #3a3428;cursor:default}
#palette-lab .wpl-title{font-weight:700;letter-spacing:.04em;color:#f3d38a}
#palette-lab .wpl-zone{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#cfc8b8}
#palette-lab .wpl-body{display:flex;flex-direction:column;min-height:0}
#palette-lab .wpl-shared{padding:4px 10px 0;color:#9a937f;font-size:11px}
#palette-lab .wpl-row{display:flex;gap:4px;padding:6px 10px;flex-wrap:wrap;align-items:center}
#palette-lab button{all:unset;box-sizing:border-box;cursor:pointer;padding:3px 7px;border-radius:4px;
  background:#262a36;border:1px solid #3e4354;color:#e8e6df;font-size:11px;line-height:1.3}
#palette-lab button:hover{background:#323848;border-color:#5a6278}
#palette-lab button.wpl-on{background:#5a4a22;border-color:#c9a14a;color:#fff3d0}
#palette-lab .wpl-label{color:#9a937f;font-size:11px;margin-right:2px}
#palette-lab .wpl-list{overflow:auto;padding:2px 8px 6px;display:flex;flex-direction:column;gap:5px;min-height:0}
#palette-lab .wpl-card{all:unset;box-sizing:border-box;display:block;cursor:pointer;padding:6px 7px;border-radius:6px;
  background:#1b1e28;border:1px solid #30354a}
#palette-lab .wpl-card:hover{border-color:#6a7290;background:#222634}
#palette-lab .wpl-card.wpl-sel{border-color:#e0b452;background:#2a2618;box-shadow:inset 0 0 0 1px #e0b45255}
#palette-lab .wpl-name{display:flex;justify-content:space-between;font-weight:650;color:#f1ece0}
#palette-lab .wpl-key{color:#8d8672;font-weight:400;font-size:10px}
#palette-lab .wpl-note{color:#a8a190;font-size:11px;margin-top:2px}
#palette-lab .wpl-strip{display:flex;height:16px;margin-top:5px;border-radius:3px;overflow:hidden;border:1px solid #00000066}
#palette-lab .wpl-sky{flex:0 0 64px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#ffffffcc;text-shadow:0 1px 1px #000}
#palette-lab .wpl-chip{flex:1}
#palette-lab .wpl-foot{display:flex;gap:4px;flex-wrap:wrap;padding:6px 10px;border-top:1px solid #3a3428}
#palette-lab .wpl-status{padding:0 10px 8px;color:#9fc7a0;font-size:11px;min-height:14px}
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', undefined, label);
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', () => {
    onClick();
    b.blur();
  });
  return b;
}

function swatchStrip(look: ZoneLook): HTMLElement {
  const strip = el('div', 'wpl-strip');
  const sky = el('div', 'wpl-sky', look.sky.amount > 0 ? '' : 'HDRI');
  sky.style.background =
    look.sky.amount > 0
      ? `linear-gradient(180deg, ${hexString(look.sky.zenith)}, ${hexString(look.sky.horizon)})`
      : 'linear-gradient(180deg, #4a7fc8, #b9d3ea)';
  sky.title = 'sky (zenith to horizon)';
  strip.appendChild(sky);
  const chips: ReadonlyArray<[number, string]> = [
    [look.ground.grassYellow, 'grass light'],
    [look.ground.grass, 'grass'],
    [look.ground.grassDark, 'grass shade'],
    [look.ground.dirt, 'dirt'],
    [look.ground.sand, 'sand'],
    [look.fog.color, 'fog / haze'],
    [look.light.sun, 'sun'],
    [look.light.hemiSky, 'shade fill (hemi sky)'],
    [look.water.shallow, 'water shallow'],
    [look.water.deep, 'water deep'],
    [look.grade.shadowTint, 'grade shadow tint'],
    [look.grade.highlightTint, 'grade highlight tint'],
  ];
  for (const [hex, title] of chips) {
    const chip = el('div', 'wpl-chip');
    chip.style.background = hexString(hex);
    chip.title = `${title} ${hexString(hex)}`;
    strip.appendChild(chip);
  }
  return strip;
}

export function mountPaletteLabPanel(h: PaletteLabPanelHandlers): PaletteLabPanel {
  const style = el('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = el('div');
  root.id = 'palette-lab';
  // The panel sits over the game canvas: keep its presses away from the
  // camera drag and click-to-move handlers underneath.
  for (const type of ['pointerdown', 'mousedown', 'wheel', 'contextmenu'] as const) {
    root.addEventListener(type, (e) => e.stopPropagation());
  }

  const head = el('div', 'wpl-head');
  const title = el('span', 'wpl-title', 'Palette Lab');
  const zone = el('span', 'wpl-zone');
  const fold = button('Fold', 'Fold the panel (Alt+P)', () => root.classList.toggle('wpl-folded'));
  head.append(title, zone, fold);

  const body = el('div', 'wpl-body');
  const shared = el('div', 'wpl-shared');
  const nav = el('div', 'wpl-row');
  const compare = button('Hold: Stock', 'Hold to flash the shipped look (Alt+\\)', () => undefined);
  compare.addEventListener('pointerdown', () => h.onCompare(true));
  for (const type of ['pointerup', 'pointerleave', 'pointercancel'] as const) {
    compare.addEventListener(type, () => h.onCompare(false));
  }
  nav.append(
    button('◀ Prev', 'Previous look (Alt+[)', () => h.onCycle(-1)),
    button('Next ▶', 'Next look (Alt+])', () => h.onCycle(1)),
    compare,
  );
  const times = el('div', 'wpl-row');
  times.appendChild(el('span', 'wpl-label', 'Time'));
  const timeButtons = TIMES.map(([label, phase]) => {
    const b = button(
      label,
      phase === null ? 'Follow the live clock' : `Freeze the sky at ${label.toLowerCase()}`,
      () => h.onTime(phase),
    );
    times.appendChild(b);
    return { b, phase };
  });
  const list = el('div', 'wpl-list');
  const foot = el('div', 'wpl-foot');
  const copyAll = button('Copy all', 'Copy every chosen look as table rows', () => h.onCopy(true));
  foot.append(
    button('Copy look', 'Copy this zone’s look as table rows', () => h.onCopy(false)),
    copyAll,
    button('Reset zone', 'Back to the shipped look here', () => h.onResetZone()),
    button('Reset all', 'Back to the shipped look everywhere', () => h.onResetAll()),
  );
  const keys = el(
    'div',
    'wpl-shared',
    'Alt+[ / Alt+] step \u00b7 Alt+0..9 pick \u00b7 hold Alt+\\ for stock \u00b7 Alt+P fold',
  );
  const status = el('div', 'wpl-status');
  body.append(shared, nav, times, list, foot, keys, status);
  root.append(head, body);
  document.body.appendChild(root);

  window.addEventListener(
    'keydown',
    (e) => {
      if (!e.altKey || isTyping(e.target)) return;
      let handled = true;
      if (e.code === 'BracketLeft') h.onCycle(-1);
      else if (e.code === 'BracketRight') h.onCycle(1);
      else if (e.code === 'Backslash') h.onCompare(true);
      else if (e.code === 'KeyP') root.classList.toggle('wpl-folded');
      else if (/^Digit[0-9]$/.test(e.code)) h.onPick(Number(e.code.slice(5)));
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  window.addEventListener(
    'keyup',
    (e) => {
      if (e.code === 'Backslash' || e.key === 'Alt') h.onCompare(false);
    },
    true,
  );
  window.addEventListener('blur', () => h.onCompare(false));

  return {
    render(view): void {
      zone.textContent = `${view.zoneName} · ${view.biome}`;
      shared.textContent =
        view.sharedWith.length > 0
          ? `Fog and light rows are per biome: shared with ${view.sharedWith.join(', ')}`
          : '';
      compare.classList.toggle('wpl-on', view.compare);
      for (const { b, phase } of timeButtons)
        b.classList.toggle('wpl-on', phase === view.timePhase);
      copyAll.textContent = `Copy all (${view.chosenCount})`;
      list.replaceChildren(
        ...view.looks.map((look, i) => {
          const card = el('button', 'wpl-card');
          card.type = 'button';
          if (look.id === view.selected) card.classList.add('wpl-sel');
          const name = el('div', 'wpl-name');
          name.append(
            el('span', undefined, look.name),
            el('span', 'wpl-key', look.id === STOCK_LOOK_ID ? 'shipped' : `${i}`),
          );
          card.append(name, el('div', 'wpl-note', look.note), swatchStrip(look));
          card.addEventListener('click', () => {
            h.onSelect(look.id);
            card.blur();
          });
          return card;
        }),
      );
    },
    setStatus(text): void {
      status.textContent = text;
    },
  };
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}
