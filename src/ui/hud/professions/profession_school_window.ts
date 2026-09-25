// Thin DOM consumer for the Profession Schools board (rank-gated crafting
// institutions; first implementation: the Enchanters School).
//
// The consumer half of the pure-core + thin-consumer split (reference
// commission_order_window.ts, this family's closest sibling): paints
// #school-board-window from the structured ProfessionSchoolsModel
// (profession_school_view.ts) and reports the join/swear/submit clicks back
// through the injected callbacks. It owns no state; display names resolve
// through profession_school_i18n.ts, never raw catalog English. Reuses the
// vendor family's row anatomy (.vendor-item, .vi-name, .vi-sub) and the
// professions family's empty-state class (.prof-empty), the commission board
// precedent.

import { markDialogRoot } from '../../dialog_root';
import { durationText } from '../../duration_text';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import type { PainterHostPresentation } from '../../painter_host';
import { svgIcon } from '../../ui_icons';
import { craftNameText } from './craft_name_view';
import { schoolNameText, schoolRankNameText, schoolTaskKindText } from './profession_school_i18n';
import type { ProfessionSchoolRow, ProfessionSchoolsModel } from './profession_school_view';

export interface ProfessionSchoolWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  onJoin(schoolId: string): void;
  onSwear(schoolId: string): void;
  onSubmitTask(taskId: string): void;
  onClose(): void;
  /** True while a submit_school_task for this taskId is in flight: the
   *  professions family's pendingSend convention (src/ui/hud/professions/
   *  CLAUDE.md, "In-flight sends mirror a pendingSend flag onto the root's
   *  aria-busy"), scoped per task here because submitSchoolTask always
   *  answers by naming the SAME taskId it was sent with. join/swear carry no
   *  answering event (the deeds.ts setActiveTitle/setActiveBorder precedent:
   *  a membership action has no cost to refund), so they take no busy state. */
  taskPending(taskId: string): boolean;
}

function rankProgressLine(row: ProfessionSchoolRow): string {
  if (row.nextRankPoints !== null) {
    return t('hudChrome.school.nextRankLine', {
      points: formatNumber(row.points, { maximumFractionDigits: 0 }),
      nextPoints: formatNumber(row.nextRankPoints, { maximumFractionDigits: 0 }),
    });
  }
  if (!row.sworn) return t('hudChrome.school.swearToProgress');
  return '';
}

function renderTaskRow(
  task: ProfessionSchoolRow['tasks'][number],
  deps: ProfessionSchoolWindowDeps,
): HTMLElement {
  const item = document.createElement('div');
  item.className = 'vendor-item ui-card school-task-row';
  const itemName = task.item?.name ?? task.requiredItemId;
  const socket = task.item
    ? `<span class="crafting-recipe-socket ui-socket ui-socket--bag">${deps.itemIcon(task.item)}</span>`
    : '';
  const requirement = t('hudChrome.school.taskRequirement', {
    item: itemName,
    count: formatNumber(task.requiredCount, { maximumFractionDigits: 0 }),
  });
  const points = t('hudChrome.school.taskPoints', {
    points: formatNumber(task.points, { maximumFractionDigits: 0 }),
  });
  const kind = schoolTaskKindText(task.kind);
  item.innerHTML = `${socket}<span class="vi-name">${esc(kind)}<span class="vi-sub">${esc(requirement)}, ${esc(points)}</span></span>`;
  if (task.item) {
    const displayItem = task.item;
    deps.attachTooltip(item, () => deps.itemTooltip(displayItem));
  }
  const pending = deps.taskPending(task.taskId);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vi-price-chip ui-btn school-task-submit-btn';
  btn.disabled = !task.ready || pending;
  if (pending) btn.setAttribute('aria-busy', 'true');
  btn.textContent = task.ready
    ? t('hudChrome.school.submitButton')
    : t('hudChrome.school.readyIn', { duration: durationText(task.readySeconds) });
  btn.addEventListener('click', () => {
    if (task.ready && !pending) deps.onSubmitTask(task.taskId);
  });
  item.appendChild(btn);
  return item;
}

function renderSchoolRow(row: ProfessionSchoolRow, deps: ProfessionSchoolWindowDeps): HTMLElement {
  const section = document.createElement('div');
  section.className = 'ui-card school-row';
  const name = schoolNameText(row.schoolId);
  const rankLine = row.joined
    ? t('hudChrome.school.rankLine', {
        rank: schoolRankNameText(row.schoolId, row.rankId ?? ''),
        points: formatNumber(row.points, { maximumFractionDigits: 0 }),
      })
    : '';
  const progressLine = row.joined ? rankProgressLine(row) : '';
  const qualifyHint = !row.joined
    ? t('hudChrome.school.qualifyHint', {
        skill: formatNumber(row.joinProficiency, { maximumFractionDigits: 0 }),
        profession: craftNameText(row.professionId),
        current: formatNumber(row.playerCraftSkill, { maximumFractionDigits: 0 }),
      })
    : '';
  const swornBadge = row.sworn
    ? `<span class="ui-chip school-sworn-badge">${esc(t('hudChrome.school.swornBadge'))}</span>`
    : '';
  const header = document.createElement('div');
  header.className = 'vendor-section-title school-header';
  header.setAttribute('role', 'heading');
  header.setAttribute('aria-level', '3');
  header.innerHTML = `<span>${esc(name)}</span>${swornBadge}`;
  section.appendChild(header);
  const body = document.createElement('div');
  body.className = 'vi-sub school-status';
  body.textContent = [rankLine, progressLine, qualifyHint].filter((s) => s.length > 0).join(' ');
  section.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'school-actions';
  if (!row.joined) {
    const joinBtn = document.createElement('button');
    joinBtn.type = 'button';
    joinBtn.className = 'vi-price-chip ui-btn';
    joinBtn.textContent = t('hudChrome.school.joinButton');
    joinBtn.addEventListener('click', () => deps.onJoin(row.schoolId));
    actions.appendChild(joinBtn);
  } else if (!row.sworn) {
    const swearBtn = document.createElement('button');
    swearBtn.type = 'button';
    swearBtn.className = 'vi-price-chip ui-btn';
    swearBtn.textContent = t('hudChrome.school.swearButton');
    swearBtn.addEventListener('click', () => deps.onSwear(row.schoolId));
    actions.appendChild(swearBtn);
  }
  if (actions.childElementCount > 0) section.appendChild(actions);

  if (row.joined) {
    const tasks = document.createElement('div');
    tasks.className = 'school-tasks';
    for (const task of row.tasks) tasks.appendChild(renderTaskRow(task, deps));
    section.appendChild(tasks);
  }
  return section;
}

/** Paint the school board from a prepared model. */
export function renderProfessionSchoolWindow(
  el: HTMLElement,
  model: ProfessionSchoolsModel,
  deps: ProfessionSchoolWindowDeps,
): void {
  deps.hideTooltip();
  const scrollTop = el.scrollTop;
  el.innerHTML = `<div class="panel-title ui-win-head"><span class="ui-win-title">${esc(t('hudChrome.school.title'))}</span><button type="button" class="x-btn ui-x-btn" data-close aria-label="${esc(t('hudChrome.school.close'))}">${svgIcon('close')}</button></div>`;
  markDialogRoot(el, { label: t('hudChrome.school.title') });

  const intro = document.createElement('div');
  intro.className = 'vi-sub school-intro';
  intro.textContent = t('hudChrome.school.intro');
  el.appendChild(intro);

  const body = document.createElement('div');
  body.className = 'school-board-sections';
  for (const row of model.schools) body.appendChild(renderSchoolRow(row, deps));
  el.appendChild(body);

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'flex';
  el.scrollTop = scrollTop;
}
