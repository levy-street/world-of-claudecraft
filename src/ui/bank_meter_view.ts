// The capacity meter's COPY: its accessible name and its tooltip body.
//
// Extracted from src/ui/bank_window.ts at Bank Storage phase 18, on the same
// terms bank_rung_view.ts was extracted at phase 13: neither of these decisions
// needs the window's private mutable state, both are a pure function of the
// meter model plus the count formatter the window already used, and inside the
// window each was reachable only by building the whole footer. The window keeps
// the element, the tab stop, the custom properties and the tooltip ATTACH,
// which are the parts that genuinely own DOM.
//
// This is also what pays for the lines phase 18's scroll-offset seam adds to a
// window that sits at an exact ratchet ceiling.
//
// The materials half is spoken ONLY when the materials pool has something to
// say: a bank with no socketed satchel keeps the existing simple line, which is
// the same `showMaterials` gate the segment geometry uses.

import type { BankMeterModel } from './bank_view';
import { formatCount } from './count_format';
import { esc } from './esc';
import { t } from './i18n';

/** The meter's accessible name.
 *
 *  The composite carries `role=group` and this label because the numbers beside
 *  the track are the only visible form of the readout, and a screen reader
 *  reaching a bare group would hear nothing. The split form exists so the two
 *  pools are announced as two budgets rather than as one total a player would
 *  then mis-plan against. */
export function bankMeterAriaLabel(meter: BankMeterModel): string {
  const used = formatCount(meter.used);
  const total = formatCount(meter.total);
  if (!meter.showMaterials) return t('hudChrome.bank.capacityAria', { used, total });
  return t('hudChrome.bank.meterPoolsAria', {
    used,
    total,
    generalUsed: formatCount(meter.general.used),
    generalTotal: formatCount(meter.general.capacity),
    materialsUsed: formatCount(meter.materials.used),
    materialsTotal: formatCount(meter.materials.capacity),
  });
}

/** The meter tooltip's body: the per-pool lines, plus the materials note that
 *  explains why a bank can refuse a deposit while the total still shows room.
 *  That note is the only place the two-pool rule is written down for a player,
 *  which is why the readout is a tab stop at all. */
export function bankMeterTooltipHtml(meter: BankMeterModel): string {
  const generalLine = `<div class="tt-sub">${esc(
    t('hudChrome.bank.meterPoolGeneral', {
      used: formatCount(meter.general.used),
      total: formatCount(meter.general.capacity),
    }),
  )}</div>`;
  if (!meter.showMaterials) return generalLine;
  return (
    generalLine +
    `<div class="tt-sub">${esc(
      t('hudChrome.bank.meterPoolMaterials', {
        used: formatCount(meter.materials.used),
        total: formatCount(meter.materials.capacity),
      }),
    )}</div>` +
    `<div class="tt-sub bank-meter-note">${esc(t('hudChrome.bank.meterMaterialsNote'))}</div>`
  );
}
