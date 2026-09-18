import { DELVE_AFFIXES, DELVES } from '../../../sim/data';
import type { IWorld } from '../../../world_api';
import { currencyIconHtml } from '../../currency_art';
import { esc } from '../../esc';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import { delveAffixImageUrl } from './delve_affix_art';

const DELVE_AFFIX_COLORS: Record<string, string> = {
  restless_graves: 'var(--color-delve-affix-restless-graves)',
  bad_air: 'var(--color-delve-affix-bad-air)',
  candleblind: 'var(--color-delve-affix-candleblind)',
  old_mechanisms: 'var(--color-delve-affix-old-mechanisms)',
  flooded_paths: 'var(--color-delve-affix-flooded-paths)',
  grave_tax: 'var(--color-delve-affix-grave-tax)',
  unstable_roof: 'var(--color-delve-affix-unstable-roof)',
  cult_remnants: 'var(--color-delve-affix-cult-remnants)',
  chapel_candle: 'var(--color-delve-affix-chapel-candle)',
  high_water: 'var(--color-delve-affix-high-water)',
  lively_choir: 'var(--color-delve-affix-lively-choir)',
  belligerent_dead: 'var(--color-delve-affix-belligerent-dead)',
};

export interface DelveTrackerControllerDeps {
  element: HTMLElement;
  world(): Pick<IWorld, 'delveRun' | 'delveMarks'>;
  delveName(delveId: string): string;
  mobName(mobId: string): string;
  attachTooltip(element: HTMLElement, html: () => string): void;
  closeRitePanel(restoreFocus: boolean): void;
}

/** Paints the authoritative delve run tracker only when its visible state changes. */
export class DelveTrackerController {
  private lastSignature = '';

  constructor(private readonly deps: DelveTrackerControllerDeps) {}

  /**
   * Re-localize after an in-game language switch (the Hud's woc:languagechange
   * fan-out). Every member of the signature below is an id, a number or a
   * boolean, so setLanguage alone never moves it and a plain update() from the
   * fan-out early-returns with the old locale still on screen. Clearing forces
   * exactly one rebuild, which re-latches the signature in the same call.
   *
   * Needs no open check: update() paints only while a delve run exists and
   * clears the strip when it does not.
   */
  relocalize(): void {
    this.lastSignature = '';
    this.update();
  }

  update(): void {
    const { element } = this.deps;
    const world = this.deps.world();
    const run = world.delveRun;
    if (!run) {
      this.lastSignature = '';
      if (element.innerHTML !== '') element.innerHTML = '';
      element.style.display = 'none';
      this.deps.closeRitePanel(false);
      return;
    }
    if (run.rite && run.rite.phase !== 'choose') this.deps.closeRitePanel(false);
    const signature = JSON.stringify([
      run.delveId,
      run.tierId,
      run.moduleIndex,
      run.moduleCount,
      run.modules,
      run.objective,
      run.affixes,
      run.completed,
      run.exitPortalOpen,
      run.rite,
      world.delveMarks,
    ]);
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    element.style.display = 'block';

    const delveName = this.deps.delveName(run.delveId);
    const tierLabel =
      run.tierId === 'heroic' ? t('delveUi.board.tier.heroic') : t('delveUi.board.tier.normal');
    const moduleId = run.modules[run.moduleIndex];
    const moduleName = moduleId ? t(`delveUi.moduleName.${moduleId}` as TranslationKey) : '';
    const moduleLine = t('delveUi.tracker.module', {
      current: formatNumber(run.moduleIndex + 1, { maximumFractionDigits: 0 }),
      total: formatNumber(run.moduleCount, { maximumFractionDigits: 0 }),
    });
    const objectiveLine = this.objectiveLine(run);
    const complete =
      run.objective.complete || run.completed
        ? ` <span class="quest-complete">(${esc(t('delveUi.tracker.complete'))})</span>`
        : '';
    const affixHtml = this.affixHtml(run.affixes);
    const marks = formatNumber(world.delveMarks, { maximumFractionDigits: 0 });
    let riteHint = '';
    if (run.rite) {
      const riteText =
        run.rite.phase === 'choose'
          ? t('delveUi.tracker.riteChoose')
          : run.rite.phase === 'playback'
            ? t('delveUi.tracker.ritePlayback')
            : run.rite.phase === 'input'
              ? t('delveUi.tracker.riteInput', {
                  current: formatNumber(run.rite.current, { maximumFractionDigits: 0 }),
                  total: formatNumber(run.rite.total, { maximumFractionDigits: 0 }),
                })
              : t('delveUi.tracker.riteOpen');
      riteHint = `<div class="dt-obj dt-hint ui-meta">-> ${esc(riteText)}</div>`;
    }
    let exitHint = '';
    if (run.moduleIndex < run.moduleCount - 1) {
      exitHint = run.exitPortalOpen
        ? `<div class="dt-obj dt-hint ui-meta">-> ${esc(t('delveUi.tracker.exitHintOpen'))}</div>`
        : `<div class="dt-obj dt-hint ui-meta">${esc(t('delveUi.tracker.exitHintLocked'))}</div>`;
    }
    element.innerHTML =
      `<div class="dt-header ui-cin">${esc(t('delveUi.tracker.title'))}</div>` +
      `<div class="dt-title ui-cin">${esc(delveName)} <span class="dt-tier ui-chip">${esc(tierLabel)}</span>${complete}</div>` +
      `<div class="dt-obj ui-meta">- ${esc(moduleLine)}${moduleName ? `: ${esc(moduleName)}` : ''}</div>` +
      `<div class="dt-obj ui-meta${run.objective.complete ? ' done' : ''}">- ${esc(t('delveUi.tracker.objective'))}: ${esc(objectiveLine)}</div>` +
      riteHint +
      exitHint +
      `<div class="dt-obj ui-meta ui-num">- ${currencyIconHtml('delve_mark')}${esc(t('delveUi.tracker.marks', { count: marks }))}</div>` +
      affixHtml;
    element.querySelectorAll<HTMLElement>('.dt-affix-icon').forEach((icon) => {
      this.attachAffixIcon(icon);
    });
  }

  private objectiveLine(run: NonNullable<IWorld['delveRun']>): string {
    const isFinale = run.moduleIndex >= run.moduleCount - 1;
    if (!isFinale) return t('delveUi.objective.clear_room');
    if (run.objective.kind === 'kill_boss') {
      const bossId = DELVES[run.delveId]?.bosses[0] ?? 'deacon_varric';
      return t('delveUi.objective.kill_boss', { boss: this.deps.mobName(bossId) });
    }
    return t(`delveUi.objective.${run.objective.kind}` as TranslationKey);
  }

  private affixLabel(affixId: string): string {
    const affix = DELVE_AFFIXES[affixId];
    if (!affix) return affixId;
    if (affix.blessing) return t(`delveUi.blessing.${affixId}` as TranslationKey);
    return t(`delveUi.affix.${affixId}` as TranslationKey);
  }

  private attachAffixIcon(icon: HTMLElement): void {
    const affixId = icon.dataset.affix ?? '';
    this.deps.attachTooltip(
      icon,
      () => `<div class="tt-title">${esc(this.affixLabel(affixId))}</div>`,
    );
    if (icon.tagName !== 'IMG') return;
    icon.addEventListener(
      'error',
      () => {
        const fallback = icon.ownerDocument.createElement('span');
        fallback.className = icon.className;
        fallback.dataset.affix = affixId;
        fallback.style.background =
          DELVE_AFFIX_COLORS[affixId] ?? 'var(--color-delve-affix-unknown)';
        fallback.setAttribute('role', 'img');
        fallback.tabIndex = 0;
        fallback.setAttribute('aria-label', this.affixLabel(affixId));
        icon.replaceWith(fallback);
        this.attachAffixIcon(fallback);
      },
      { once: true },
    );
  }

  private affixHtml(affixes: readonly string[]): string {
    if (affixes.length === 0) return '';
    let html = `<div class="dt-affix-row"><span class="dt-affix-label ui-meta">${esc(t('delveUi.tracker.affix'))}</span>`;
    for (const affixId of affixes) {
      const imageUrl = delveAffixImageUrl(affixId);
      if (imageUrl) {
        html += `<img class="dt-affix-icon" data-affix="${esc(affixId)}" src="${imageUrl}" alt="" draggable="false" role="img" tabindex="0" aria-label="${esc(this.affixLabel(affixId))}">`;
      } else {
        const color = DELVE_AFFIX_COLORS[affixId] ?? 'var(--color-delve-affix-unknown)';
        html += `<span class="dt-affix-icon" data-affix="${esc(affixId)}" style="background:${color}" role="img" tabindex="0" aria-label="${esc(this.affixLabel(affixId))}"></span>`;
      }
    }
    return `${html}</div>`;
  }
}
