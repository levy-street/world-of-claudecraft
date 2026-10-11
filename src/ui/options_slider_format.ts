// The Options window's slider readouts: how a slider descriptor's `fmt`
// (options_view.ts SliderFmt) turns the live value into the text beside the
// track. Split out of options_window.ts so a new readout never grows that
// painter; the per-format decisions stay in the pure options_view core.

import { formatNumber, t } from './i18n';
import { actionCamShoulderReadout, type SliderFmt } from './options_view';

const percent = (v: number): string =>
  formatNumber(v, { style: 'percent', maximumFractionDigits: 0 });

export function sliderFormatter(fmt: SliderFmt): (v: number) => string {
  if (fmt === 'degrees')
    return (v) => `${formatNumber(Math.round(v), { maximumFractionDigits: 0 })}°`;
  if (fmt === 'oneDecimal') return (v) => formatNumber(v, { maximumFractionDigits: 1 });
  if (fmt === 'shoulder')
    return (v) => {
      const r = actionCamShoulderReadout(v);
      return t(r.key, { pct: percent(r.pct) });
    };
  return percent;
}
