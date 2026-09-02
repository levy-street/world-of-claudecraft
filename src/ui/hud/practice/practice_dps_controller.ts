// Thin, cold consumer of practice_dps_view.ts: paints the #practice-tracker
// strip (the right tracker stack, beside the delve and rift trackers) with the
// local player's live DPS on a training dummy and the last few finished runs,
// so a build or rotation change can be compared on the spot.
//
// Driven by Meters.update() (src/ui/meters.ts), the same per-frame call that
// advances the encounter ledger this reads, so the readout can never run ahead
// of or behind the Damage Meters window. It rebuilds at most every
// PRACTICE_PAINT_INTERVAL_MS and elides the write by comparing the freshly
// built markup against the last markup it BUILT (never the live innerHTML,
// whose reserialization drops esc()'s entity forms and would defeat the
// compare on any name with a quote in it): the memo holds resolved strings,
// so a runtime language switch moves the fresh side of the comparison by
// itself and the strip needs no arm in the Hud's language fan-out (the
// quest tracker's lastHtml exemption in tests/language_fanout_registry.test.ts
// is the same idiom). No forced-reflow layout read, no driver of its own.
//
// Actionable, so it stays on every graphics tier and in the mobile cross-hotbar
// mode (docs/design/graphics-settings-fairness.md): a player reads the live
// number to decide what to change next.

import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import { fmtDuration, fmtNum, fmtPerSecond } from '../../meters_format';
import type { PracticeDpsModel, PracticeRun } from './practice_dps_view';

export interface PracticeDpsControllerDeps {
  element: HTMLElement;
  /** The current model, or null when the strip has nothing to show. */
  model(): PracticeDpsModel | null;
  /** Localized display name of a dummy template id. */
  dummyName(templateId: string): string;
}

/** Repaint cadence: a live DPS number reads fine at 4 Hz, and the ledger it
 *  summarizes only closes a run on a whole-second idle window. */
export const PRACTICE_PAINT_INTERVAL_MS = 250;

function runLine(run: PracticeRun, isBest: boolean, label: string): string {
  const cls = isBest ? 'pt-run pt-best' : 'pt-run';
  const summary = t('hudChrome.practiceDps.runSummary', {
    total: fmtNum(run.total),
    time: fmtDuration(run.duration),
  });
  return (
    `<div class="${cls}"><span class="pt-run-label">${esc(label)}</span>` +
    `<span class="pt-run-dps">${esc(fmtPerSecond(run.dps))}</span>` +
    `<span class="pt-run-sum">${esc(summary)}</span></div>`
  );
}

/** Paints the practice DPS strip only when its resolved markup changes. */
export class PracticeDpsController {
  private nextPaintAt = 0;
  /** The last markup written, or null while the strip is hidden and empty. */
  private lastHtml: string | null = null;

  constructor(private readonly deps: PracticeDpsControllerDeps) {}

  /** `now` is the caller's clock (performance.now from Meters.update). */
  update(now: number): void {
    if (now < this.nextPaintAt) return;
    this.nextPaintAt = now + PRACTICE_PAINT_INTERVAL_MS;
    const { element } = this.deps;
    const model = this.deps.model();
    if (!model) {
      if (this.lastHtml === null) return;
      this.lastHtml = null;
      element.innerHTML = '';
      element.style.display = 'none';
      return;
    }
    const html = this.markup(model);
    if (html === this.lastHtml) return;
    if (this.lastHtml === null) element.style.display = 'block';
    this.lastHtml = html;
    element.innerHTML = html;
  }

  private markup(model: PracticeDpsModel): string {
    const dummyId = model.live?.dummyTemplateId ?? model.targetDummyId;
    const title = dummyId ? this.deps.dummyName(dummyId) : t('hudChrome.practiceDps.title');
    let body: string;
    if (model.live) {
      const live = esc(t('hudChrome.practiceDps.liveDps', { value: fmtNum(model.live.dps) }));
      const thisRun = runLine(model.live, false, t('hudChrome.practiceDps.liveLabel'));
      body = `<div class="pt-live">${live}</div>${thisRun}`;
    } else {
      body = `<div class="pt-obj">${esc(t('hudChrome.practiceDps.prompt'))}</div>`;
    }
    const previous = model.previous
      .map((run, i) =>
        runLine(
          run,
          run.dps === model.bestDps,
          t('hudChrome.practiceDps.runLabel', { index: formatNumber(i + 1) }),
        ),
      )
      .join('');
    const history = previous
      ? `<div class="pt-obj">${esc(t('hudChrome.practiceDps.previous'))}</div>${previous}`
      : '';
    return `<div class="pt-header">${esc(title)}</div>${body}${history}`;
  }
}
