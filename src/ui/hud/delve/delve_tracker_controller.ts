import { DELVE_AFFIXES, DELVES } from '../../../sim/data';
import type { IWorld } from '../../../world_api';
import { esc } from '../../esc';
import { formatNumber, type TranslationKey, t } from '../../i18n';

const DELVE_AFFIX_COLORS: Record<string, string> = {
  restless_graves: '#8b7355',
  bad_air: '#6a8a6a',
  candleblind: '#c9a227',
  old_mechanisms: '#7a8a9a',
  flooded_paths: '#4a7a9a',
  grave_tax: '#9a6a4a',
  unstable_roof: '#8a6a5a',
  cult_remnants: '#7a4a8a',
  chapel_candle: '#ffd100',
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

  invalidate(): void {
    this.lastSignature = '';
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
      riteHint = `<div class="dt-obj dt-hint">-> ${esc(riteText)}</div>`;
    }
    let exitHint = '';
    if (run.moduleIndex < run.moduleCount - 1) {
      exitHint = run.exitPortalOpen
        ? `<div class="dt-obj dt-hint">-> ${esc(t('delveUi.tracker.exitHintOpen'))}</div>`
        : `<div class="dt-obj dt-hint">${esc(t('delveUi.tracker.exitHintLocked'))}</div>`;
    }
    element.innerHTML =
      `<div class="dt-header">${esc(t('delveUi.tracker.title'))}</div>` +
      `<div class="dt-title">${esc(delveName)} <span class="dt-tier">${esc(tierLabel)}</span>${complete}</div>` +
      `<div class="dt-obj">- ${esc(moduleLine)}${moduleName ? `: ${esc(moduleName)}` : ''}</div>` +
      `<div class="dt-obj${run.objective.complete ? ' done' : ''}">- ${esc(t('delveUi.tracker.objective'))}: ${esc(objectiveLine)}</div>` +
      riteHint +
      exitHint +
      `<div class="dt-obj">- ${esc(t('delveUi.tracker.marks', { count: marks }))}</div>` +
      affixHtml;
    element.querySelectorAll<HTMLElement>('.dt-affix-icon').forEach((icon) => {
      const affixId = icon.dataset.affix ?? '';
      this.deps.attachTooltip(
        icon,
        () => `<div class="tt-title">${esc(this.affixLabel(affixId))}</div>`,
      );
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

  private affixHtml(affixes: readonly string[]): string {
    if (affixes.length === 0) return '';
    let html = `<div class="dt-affix-row"><span class="dt-affix-label">${esc(t('delveUi.tracker.affix'))}</span>`;
    for (const affixId of affixes) {
      const color = DELVE_AFFIX_COLORS[affixId] ?? '#888';
      html += `<span class="dt-affix-icon" data-affix="${esc(affixId)}" style="background:${color}" role="img" tabindex="0" aria-label="${esc(this.affixLabel(affixId))}"></span>`;
    }
    return `${html}</div>`;
  }
}
