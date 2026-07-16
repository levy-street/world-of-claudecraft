import { GATHERING_PROFESSIONS } from '../sim/content/professions';
import { DUNGEONS, ITEMS, MOBS, QUESTS } from '../sim/data';
import { MAX_LEVEL } from '../sim/types';
import type { IWorld } from '../world_api';
import {
  buildDevCommand,
  type DevCommandAction,
  type DevCommandCategory,
  filteredDevActions,
} from './dev_command_view';
import { markDialogRoot } from './dialog_root';
import { tEntity } from './entity_i18n';
import { esc } from './esc';
import { type TranslationKey, t } from './i18n';
import { svgIcon } from './ui_icons';

const CATEGORIES: readonly { id: DevCommandCategory; labelKey: TranslationKey }[] = [
  { id: 'player', labelKey: 'devCommand.categories.player' },
  { id: 'spawns', labelKey: 'devCommand.categories.spawns' },
  { id: 'inventory', labelKey: 'devCommand.categories.inventory' },
  { id: 'progress', labelKey: 'devCommand.categories.progress' },
  { id: 'travel', labelKey: 'devCommand.categories.travel' },
  { id: 'scenarios', labelKey: 'devCommand.categories.scenarios' },
];

export interface DevCommandWindowDeps {
  available(): boolean;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

function optionsHtml(
  values: readonly { id: string }[],
  displayName: (value: { id: string }) => string,
): string {
  return [...values]
    .sort((a, b) => displayName(a).localeCompare(displayName(b)) || a.id.localeCompare(b.id))
    .map(
      (value) =>
        `<option value="${esc(value.id)}">${esc(displayName(value))} (${esc(value.id)})</option>`,
    )
    .join('');
}

function textField(labelKey: TranslationKey, key: string, value: string, type = 'text'): string {
  return `<label class="dev-command-field"><span>${esc(t(labelKey))}</span><input data-dev-field="${esc(key)}" type="${type}" value="${esc(value)}"></label>`;
}

function selectField(labelKey: TranslationKey, key: string, options: string): string {
  return `<label class="dev-command-field"><span>${esc(t(labelKey))}</span><select data-dev-field="${esc(key)}">${options}</select></label>`;
}

function actionFields(actionId: string): string {
  switch (actionId) {
    case 'level':
      return textField('devCommand.fields.level', 'level', String(MAX_LEVEL), 'number');
    case 'spawn':
      return `${selectField(
        'devCommand.fields.mob',
        'mob',
        optionsHtml(Object.values(MOBS), (mob) =>
          tEntity({ kind: 'mob', id: mob.id, field: 'name' }),
        ),
      )}${textField('devCommand.fields.count', 'count', '1', 'number')}${textField('devCommand.fields.level', 'mobLevel', String(MAX_LEVEL), 'number')}`;
    case 'give':
      return `${selectField(
        'devCommand.fields.item',
        'item',
        optionsHtml(Object.values(ITEMS), (item) =>
          tEntity({ kind: 'item', id: item.id, field: 'name' }),
        ),
      )}${textField('devCommand.fields.count', 'itemCount', '1', 'number')}`;
    case 'gold':
      return textField('devCommand.fields.gold', 'gold', '100', 'number');
    case 'quest':
      return selectField(
        'devCommand.fields.quest',
        'quest',
        optionsHtml(Object.values(QUESTS), (quest) =>
          tEntity({ kind: 'quest', id: quest.id, field: 'title' }),
        ),
      );
    case 'gather':
      return `${selectField(
        'devCommand.fields.profession',
        'profession',
        optionsHtml(Object.values(GATHERING_PROFESSIONS), (profession) =>
          t(`hudChrome.gathering.${profession.id}` as TranslationKey),
        ),
      )}${textField('devCommand.fields.amount', 'gatherAmount', '10', 'number')}`;
    case 'teleport':
      return `${textField('devCommand.fields.x', 'x', '0', 'number')}${textField('devCommand.fields.z', 'z', '0', 'number')}`;
    case 'dungeon':
      return `${selectField(
        'devCommand.fields.dungeon',
        'dungeon',
        optionsHtml(Object.values(DUNGEONS), (dungeon) =>
          tEntity({ kind: 'dungeon', id: dungeon.id, field: 'name' }),
        ),
      )}${selectField('devCommand.fields.difficulty', 'difficulty', `<option value="normal">${esc(t('devCommand.difficulty.normal'))}</option><option value="heroic">${esc(t('devCommand.difficulty.heroic'))}</option>`)}`;
    case 'raid':
      return selectField(
        'devCommand.fields.difficulty',
        'raidDifficulty',
        `<option value="heroic">${esc(t('devCommand.difficulty.heroic'))}</option><option value="normal">${esc(t('devCommand.difficulty.normal'))}</option>`,
      );
    case 'bot':
      return textField('devCommand.fields.name', 'botName', 'TestBot');
    default:
      return '';
  }
}

function actionHtml(action: DevCommandAction): string {
  const fields = actionFields(action.id);
  return `<article class="dev-command-card" data-dev-action="${esc(action.id)}">
    <div class="dev-command-card-copy"><h3>${esc(t(action.labelKey))}</h3><p>${esc(t(action.descriptionKey))}</p></div>
    ${fields ? `<div class="dev-command-fields">${fields}</div>` : ''}
    <button type="button" class="dev-command-run" data-dev-run="${esc(action.id)}">${esc(t('devCommand.run'))}</button>
  </article>`;
}

export class DevCommandWindow {
  private rootEl: HTMLElement | null = null;
  private category: DevCommandCategory = 'player';
  private query = '';
  private notice = '';
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly deps: DevCommandWindowDeps) {}

  get isOpen(): boolean {
    return this.rootEl?.classList.contains('open') ?? false;
  }

  toggle(): boolean {
    if (!this.deps.available()) return false;
    const root = this.root();
    if (root.classList.contains('open')) {
      this.close();
      return true;
    }
    this.returnFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    root.classList.add('open');
    this.render();
    root.focus();
    return true;
  }

  close(): void {
    if (!this.rootEl?.classList.contains('open')) return;
    this.rootEl.classList.remove('open');
    const target = this.returnFocus;
    this.returnFocus = null;
    this.deps.restoreFocus(target);
  }

  private root(): HTMLElement {
    if (this.rootEl) return this.rootEl;
    const root = document.createElement('section');
    root.id = 'dev-command-window';
    root.className = 'window panel dev-command-window';
    markDialogRoot(root, { label: t('devCommand.dialogLabel') });
    document.getElementById('ui')?.appendChild(root);
    this.rootEl = root;
    return root;
  }

  private values(): Record<string, string> {
    const values: Record<string, string> = {};
    for (const field of this.root().querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      '[data-dev-field]',
    )) {
      const key = field.dataset.devField;
      if (key) values[key] = field.value;
    }
    return values;
  }

  private run(actionId: string): void {
    const command = buildDevCommand(actionId, this.values());
    if (!command) {
      this.notice = t('devCommand.invalidValues');
      this.render(`[data-dev-run="${actionId}"]`);
      return;
    }
    this.deps.world().chat(command);
    this.notice = t('devCommand.sent', { command });
    this.render(`[data-dev-run="${actionId}"]`);
  }

  private render(focusSelector?: string): void {
    const root = this.root();
    const actions = filteredDevActions(this.category, this.query, (key) => t(key));
    root.innerHTML = `<header class="dev-command-header">
      <div><div class="dev-command-kicker">${esc(t('devCommand.kicker'))}</div><h2>${esc(t('devCommand.title'))}</h2><p>${esc(t('devCommand.subtitle'))}</p></div>
      <button type="button" class="x-btn" data-dev-close aria-label="${esc(t('devCommand.closeAria'))}">${svgIcon('close')}</button>
    </header>
    <div class="dev-command-toolbar">
      <nav class="dev-command-tabs" aria-label="${esc(t('devCommand.categoryNavAria'))}">${CATEGORIES.map((category) => `<button type="button" data-dev-category="${category.id}" aria-pressed="${category.id === this.category}">${esc(t(category.labelKey))}</button>`).join('')}</nav>
      <label class="dev-command-search"><span>${esc(t('devCommand.filterLabel'))}</span><input type="search" data-dev-search value="${esc(this.query)}" placeholder="${esc(t('devCommand.filterPlaceholder'))}"></label>
    </div>
    <div class="dev-command-grid">${actions.length ? actions.map(actionHtml).join('') : `<div class="dev-command-empty">${esc(t('devCommand.noMatches'))}</div>`}</div>
    <footer class="dev-command-footer"><span>${esc(t('devCommand.serverRequirement'))}</span><output aria-live="polite">${esc(this.notice)}</output></footer>`;

    root.querySelector('[data-dev-close]')?.addEventListener('click', () => this.close());
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-dev-category]')) {
      button.addEventListener('click', () => {
        this.category = button.dataset.devCategory as DevCommandCategory;
        this.query = '';
        this.render(`[data-dev-category="${this.category}"]`);
      });
    }
    root
      .querySelector<HTMLInputElement>('[data-dev-search]')
      ?.addEventListener('input', (event) => {
        this.query = (event.currentTarget as HTMLInputElement).value;
        this.render();
        root.querySelector<HTMLInputElement>('[data-dev-search]')?.focus();
      });
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-dev-run]')) {
      button.addEventListener('click', () => this.run(button.dataset.devRun ?? ''));
    }
    if (focusSelector) root.querySelector<HTMLElement>(focusSelector)?.focus();
  }
}
