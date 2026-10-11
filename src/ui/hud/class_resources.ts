import { esc } from '../esc';
import { formatNumber, t, tPlural } from '../i18n';
import type { PainterHostWriters } from '../painter_host';
import { createShadowChargeMeter } from './priest';
import type { ShadowChargePlayer } from './priest/shadow_charge_view';
import { createDoomMeter } from './warlock';
import type { DoomMeterInput } from './warlock/doom_meter_view';

/** Class resource composition keeps localized construction out of the HUD coordinator. */
export function createClassResourceMeters(
  doc: Document,
  parent: HTMLElement,
  playerFrame: HTMLElement,
  writers: PainterHostWriters,
  attachTooltip: (element: HTMLElement, html: () => string) => void,
): {
  paint(input: DoomMeterInput): void;
  paintShadow(player: ShadowChargePlayer, spec: string | null): void;
  relocalize(): void;
} {
  const count = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });
  const doom = createDoomMeter(doc, parent, playerFrame, writers, {
    label: () => t('hudChrome.warlock.doomLabel'),
    formatCount: count,
    formatEmptyStatus: (value, max) => t('hudChrome.warlock.doomEmptyStatus', { value, max }),
    formatStatus: (value, max, seconds) =>
      t('hudChrome.warlock.doomStatus', {
        value,
        max,
        remaining: tPlural('hudChrome.plurals.secondsRemaining', seconds),
      }),
    fateThreadsLabel: () => t('hudChrome.warlock.fateThreadsLabel'),
    formatFateThreadsStatus: (value, max) =>
      t('hudChrome.warlock.fateThreadsStatus', { value, max }),
  });
  const shadow = createShadowChargeMeter(
    doc,
    doc.getElementById('ui') ?? parent,
    writers,
    {
      count: (value, max) =>
        t('hudChrome.priest.chargeCount', { value: count(value), max: count(max) }),
      gloomLabel: () => t('hudChrome.priest.gloomtitheLabel'),
      bombLabel: () => t('hudChrome.priest.bombLabel'),
      readyLabel: () => t('hudChrome.priest.bombReady'),
      gloomStatus: (value, max) =>
        t('hudChrome.priest.gloomtitheStatus', { value: count(value), max: count(max) }),
      bombStatus: (value, max) =>
        t('hudChrome.priest.bombStatus', { value: count(value), max: count(max) }),
      gloomTooltip: () => esc(t('hudChrome.priest.gloomtitheTooltip')),
      bombTooltip: () => esc(t('hudChrome.priest.bombTooltip')),
    },
    attachTooltip,
  );
  return {
    paint: doom.paint,
    paintShadow: shadow.paint,
    relocalize() {
      doom.relocalize();
      shadow.relocalize();
    },
  };
}
