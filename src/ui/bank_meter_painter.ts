// Cold capacity-meter painter shared by the bank window's footer.

import { bankMeterAriaLabel, bankMeterTooltipHtml } from './bank_meter_view';
import type { BankMeterModel } from './bank_view';
import { formatCount } from './count_format';
import { t } from './i18n';

export function buildBankMeter(
  meter: BankMeterModel,
  attachTooltip: (el: HTMLElement, html: () => string) => void,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'bank-meter';
  // Focusable readout: the pool lines and the materials note live only in
  // the tooltip, whose host serves hover, long-press, AND focusin; without
  // a tab stop a keyboard-only user could never reach them. role=group
  // makes the aria-label conformant on the composite (bonus-section idiom).
  // The focus key keeps a parked reader on the meter across mirror-driven
  // rebuilds; the close-button fallback would silently defeat the tab stop.
  el.setAttribute('role', 'group');
  el.tabIndex = 0;
  const share = (capacity: number): string => String(meter.total > 0 ? capacity / meter.total : 0);
  const fill = (fraction: number): string => String(Math.min(1, Math.max(0, fraction)));
  el.style.setProperty('--bank-meter-general-share', share(meter.general.capacity));
  el.style.setProperty('--bank-meter-materials-share', share(meter.materials.capacity));
  el.style.setProperty('--bank-meter-general-fill', fill(meter.general.fraction));
  el.style.setProperty('--bank-meter-materials-fill', fill(meter.materials.fraction));
  const track = document.createElement('div');
  track.className = 'bank-meter-track';
  for (const seg of ['bank-meter-seg-general', 'bank-meter-seg-materials']) {
    const segment = document.createElement('div');
    segment.className = seg;
    const segFill = document.createElement('div');
    segFill.className = 'bank-meter-fill';
    segment.appendChild(segFill);
    track.appendChild(segment);
  }
  el.appendChild(track);
  const text = document.createElement('span');
  text.className = 'bank-meter-text';
  text.textContent = t('hudChrome.bank.meterLabel', {
    used: formatCount(meter.used),
    total: formatCount(meter.total),
  });
  el.appendChild(text);
  // Both the accessible name and the tooltip body are pure copy over this
  // same model (bank_meter_view.ts); the window keeps the ATTACH, which is
  // the half that owns DOM.
  el.setAttribute('aria-label', bankMeterAriaLabel(meter));
  attachTooltip(el, () => bankMeterTooltipHtml(meter));
  return el;
}
