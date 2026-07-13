// Thin painter for the choice-row talents tab (talent_rows_view.ts core), in the
// classic MoP band layout: each tier is ONE compact horizontal band (level badge
// plus three icon+name pills), so all six tiers fit without scrolling; the
// option description lives in the shared hover tooltip (and in the button's
// accessible name, so keyboard/AT users lose nothing). A cold window body
// (repainted on open/tab-switch/pick, never per frame). Owns no state.

import { esc } from './esc';
import { t } from './i18n';
import { talentEffectIconRef, talentIconDataUrl } from './talent_icons';
import type { TalentRowsVM } from './talent_rows_view';

export interface TalentRowsTabDeps {
  /** Send a pick (or null to clear) for a row; server/Sim re-validates. */
  pickRow(rowIndex: number, optionId: string | null): void;
  /** Repaint the window after a pick (and once more shortly after, so the
   *  online mirror's authoritative snapshot lands in the repaint). */
  rerender(): void;
  /** The shared HUD hover tooltip (PainterHostPresentation). */
  attachTooltip(el: HTMLElement, html: () => string): void;
}

export function paintTalentRowsTab(
  body: HTMLElement,
  vm: TalentRowsVM,
  deps: TalentRowsTabDeps,
): void {
  const wrap = document.createElement('div');
  wrap.className = 'tal-rows';
  const soon = t('hudChrome.talentRows.comingSoon');
  const parts: string[] = [];
  for (const row of vm.rows) {
    const opts = row.options
      .map((o) => {
        const icon = talentIconDataUrl(talentEffectIconRef(o.effect, 'choice'));
        const aria = `${o.name}. ${o.description}${o.pending ? ` (${soon})` : ''}`;
        return (
          `<button type="button" class="tal-row-opt${o.picked ? ' picked' : ''}` +
          `${o.pending ? ' pending' : ''}"` +
          ` data-row="${row.index}" data-opt="${esc(o.id)}"` +
          ` aria-pressed="${o.picked}" aria-label="${esc(aria)}"` +
          ` ${row.unlocked && !o.pending ? '' : 'disabled'}>` +
          `<img src="${icon}" alt="" draggable="false"><b>${esc(o.name)}</b>` +
          (o.pending ? `<i class="tal-soon">${esc(soon)}</i>` : '') +
          `</button>`
        );
      })
      .join('');
    // The level badge on the left already says when the row unlocks; a locked
    // row just dims (no redundant "requires level" text, owner call).
    parts.push(
      `<div class="tal-row${row.unlocked ? '' : ' locked'}">` +
        `<span class="tal-row-lv${row.unlocked ? '' : ' locked'}">${row.level}</span>` +
        `<div class="tal-row-opts">${opts}</div>` +
        `</div>`,
    );
  }
  wrap.innerHTML = parts.join('');
  wrap.querySelectorAll<HTMLButtonElement>('.tal-row-opt').forEach((btn) => {
    const rowIndex = Number(btn.dataset.row);
    const optId = btn.dataset.opt ?? null;
    const opt = vm.rows[rowIndex]?.options.find((o) => o.id === optId);
    if (opt) {
      deps.attachTooltip(
        btn,
        () =>
          `<b>${esc(opt.name)}</b><br><span>${esc(opt.description)}</span>` +
          (opt.pending ? `<br><i>${esc(soon)}</i>` : ''),
      );
    }
    btn.addEventListener('click', () => {
      const wasPicked = btn.getAttribute('aria-pressed') === 'true';
      // Click a picked option to clear it; click another to swap (free respec).
      deps.pickRow(rowIndex, wasPicked ? null : optId);
      deps.rerender();
    });
  });
  body.appendChild(wrap);
}
