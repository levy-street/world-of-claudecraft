// Paints the unowned-mob target frame menu (mob_target_menu_view.ts rows)
// into the shared #ctx-menu and wires each row. Moved out of Hud's former
// openMarkerMenu with its markup, placement and key handling intact, plus the
// new Inspect row. Cold: it builds once per gesture and owns no driver; the
// menu element, placement and every action come through deps, so it never
// imports Hud or reaches a browser global.

import { CTX_MENU_PICKER_CLASS } from '../../bag_item_action_menu';
import { esc } from '../../esc';
import { svgIcon } from '../../ui_icons';
import { type MobTargetMenuAction, mobTargetMenuRows } from './mob_target_menu_view';

export interface MobTargetMenuDeps {
  /** The shared #ctx-menu element. */
  menu(): HTMLElement;
  /** Clamp the menu on screen at the gesture point. */
  place(el: HTMLElement, x: number, y: number): void;
  /** A raid marker's icon URL. */
  markerIconUrl(marker: number): string;
  markerFor(entityId: number): number | null;
  setMarker(entityId: number, marker: number): void;
  clearMarker(entityId: number): void;
  inspect(entityId: number): void;
}

export interface MobTargetMenuTarget {
  readonly id: number;
  /** The already-resolved display name for the menu title. */
  readonly name: string;
  /** A live, hostile, unowned mob while the viewer is in a party. */
  readonly markable: boolean;
}

export function openMobTargetMenu(
  deps: MobTargetMenuDeps,
  target: MobTargetMenuTarget,
  x: number,
  y: number,
): void {
  const el = deps.menu();
  // A plain paint site: clear the picker sizing an enchant picker may have left
  // (tests/ctx_menu_picker_sizing.test.ts pins every such site).
  el.classList.remove(CTX_MENU_PICKER_CLASS);
  const rows = mobTargetMenuRows({
    markable: target.markable,
    currentMarker: target.markable ? deps.markerFor(target.id) : null,
  });
  let html = `<div class="ctx-title">${esc(target.name)}</div>`;
  for (const row of rows) {
    const aria = row.aria ? ` aria-label="${esc(row.aria)}"` : '';
    const mark =
      row.marker !== null
        ? `<span class="ctx-mark" style="background-image:url(${deps.markerIconUrl(row.marker)})"></span>`
        : '';
    const check = row.selected ? `<span class="ctx-selected">${svgIcon('check')}</span>` : '';
    html += `<div class="ctx-item" role="button" tabindex="0" data-act="${row.act}"${aria}>${mark}${esc(row.label)}${check}</div>`;
  }
  el.innerHTML = html;
  deps.place(el, x, y);
  el.style.display = 'block';
  el.querySelectorAll<HTMLElement>('.ctx-item').forEach((item) => {
    const activate = () => {
      const act = item.dataset.act as MobTargetMenuAction | undefined;
      el.style.display = 'none';
      if (act === 'inspect') deps.inspect(target.id);
      else if (act === 'clear') deps.clearMarker(target.id);
      else if (act?.startsWith('m')) deps.setMarker(target.id, Number(act.slice(1)));
    };
    item.addEventListener('click', activate);
    item.addEventListener('keydown', (e) => {
      const key = (e as KeyboardEvent).key;
      if (key !== 'Enter' && key !== ' ') return;
      e.preventDefault();
      activate();
    });
  });
}
