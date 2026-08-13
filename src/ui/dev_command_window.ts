import { DEV_KIT_ROLES } from '../sim/content/dev_kit_roles';
import { GATHERING_PROFESSIONS } from '../sim/content/professions';
import { DUNGEONS, ITEMS, MOBS, QUESTS } from '../sim/data';
import { ALL_CLASSES, MAX_LEVEL } from '../sim/types';
import type { IWorld } from '../world_api';
import {
  buildDevCommand,
  type DevCommandAction,
  type DevCommandCategory,
  devCategoryVisible,
  filteredDevActions,
} from './dev_command_view';
import {
  DEV_ITEM_PICKER_LIMIT,
  type DevItemCandidate,
  rankDevItems,
  resolveDevItem,
} from './dev_item_picker_view';
import { markDialogRoot } from './dialog_root';
import { classDisplayName, tEntity } from './entity_i18n';
import { esc } from './esc';
import { getLanguage, type SupportedLanguage, type TranslationKey, t } from './i18n';
import { svgIcon } from './ui_icons';

// Localized candidate list for the item picker, built once on first use. 672 items
// times a tEntity lookup is not free, and the picker re-filters on every keystroke,
// so the localized names are resolved once rather than per render. Cleared when the
// locale changes so a language switch does not strand English names in the list.
let itemCandidates: DevItemCandidate[] | null = null;
let itemCandidatesLang: SupportedLanguage | null = null;

function devItemCandidates(): readonly DevItemCandidate[] {
  const lang = getLanguage();
  if (itemCandidates && itemCandidatesLang === lang) return itemCandidates;
  itemCandidatesLang = lang;
  itemCandidates = Object.values(ITEMS).map((item) => ({
    id: item.id,
    name: tEntity({ kind: 'item', id: item.id, field: 'name' }),
    slot: item.slot,
    quality: item.quality,
    // ItemDef.heroicOf marks a generated heroic variant. All 57 duplicate display
    // names in ITEMS are exactly these, so this flag is what makes an otherwise
    // identical-looking pair of rows distinguishable.
    heroic: item.heroicOf !== undefined,
  }));
  return itemCandidates;
}

// Delay before a blur tears the suggestion list down, so a row's mousedown still
// lands. Mirrors the social panel's SUGGEST_BLUR_CLEAR_MS.
const DEV_ITEM_BLUR_CLEAR_MS = 120;

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

// The item field is a combobox, not a <select>: a native select over all ~672 ITEMS
// rendered taller than the viewport and covered the window it belonged to.
//
// The input IS the command field (data-dev-field="item"), so it carries the item id
// and the existing values() collection keeps working untouched. That also means a
// tester who already knows an id can just paste it; the status line below resolves
// whatever is typed and says whether it names a real item.
function itemPickerField(): string {
  return `<label class="dev-command-field dev-item-pick">
    <span>${esc(t('devCommand.fields.item'))}</span>
    <input
      data-dev-field="item"
      data-dev-item-search
      type="text"
      value=""
      autocomplete="off"
      spellcheck="false"
      role="combobox"
      aria-expanded="false"
      aria-autocomplete="list"
      aria-controls="dev-item-suggest"
      placeholder="${esc(t('devCommand.itemSearchPlaceholder'))}">
    <div id="dev-item-suggest" class="dev-item-suggest" role="listbox" aria-label="${esc(t('devCommand.itemResultsAria'))}"></div>
    <output class="dev-item-status" data-dev-item-status aria-live="polite"></output>
  </label>`;
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
      return `${itemPickerField()}${textField('devCommand.fields.count', 'itemCount', '1', 'number')}`;
    case 'kit':
    case 'biskit':
      // Every spec across all nine classes, grouped by class so the list reads as the
      // talent tree does. Only this character's class actually applies, but the field
      // is built statically without a world handle, so the server does the rejecting
      // and names the legal specs back. Blank = the spec already chosen. The BIS-20
      // card shares the selector (its own field key) so both kits read identically.
      return selectField(
        'devCommand.fields.spec',
        actionId === 'kit' ? 'kitSpec' : 'bisSpec',
        `<option value="">${esc(t('devCommand.kitCurrentSpec'))}</option>${ALL_CLASSES.map(
          (cls) =>
            `<optgroup label="${esc(classDisplayName(cls))}">${(DEV_KIT_ROLES[cls] ?? [])
              .map((role) => `<option value="${esc(role.spec)}">${esc(role.spec)}</option>`)
              .join('')}</optgroup>`,
        ).join('')}`,
      );
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

  // Index of the highlighted suggestion, or -1 when none. DOM focus never leaves the
  // input (aria-activedescendant drives the highlight), so this is the only cursor.
  private itemIndex = -1;
  private itemMatches: readonly { item: DevItemCandidate }[] = [];

  // Paint the suggestion list for the current input value. Deliberately does NOT call
  // this.render(): that rewrites the whole window's innerHTML, which would destroy the
  // input mid-keystroke and drop focus.
  private renderItemSuggest(input: HTMLInputElement, box: HTMLElement): void {
    const result = rankDevItems(devItemCandidates(), input.value);
    this.itemMatches = result.matches;
    this.itemIndex = -1;
    input.removeAttribute('aria-activedescendant');

    if (result.idle) {
      box.style.display = 'none';
      box.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    if (result.matches.length === 0) {
      box.innerHTML = `<div class="dev-item-empty">${esc(t('devCommand.itemNoMatches'))}</div>`;
      box.style.display = 'block';
      input.setAttribute('aria-expanded', 'false');
      return;
    }

    const rows = result.matches.map(({ item }, i) => {
      // A non-focusable div, not a button: DOM focus stays on the input while the
      // arrow keys move the active option, and a focusable row would also be pulled
      // into this dialog's focus-trap tab cycle. Same reasoning as .soc-sugg-item.
      const tags = [
        item.heroic
          ? `<span class="dev-item-tag heroic">${esc(t('devCommand.itemHeroicTag'))}</span>`
          : '',
        item.slot ? `<span class="dev-item-tag">${esc(item.slot)}</span>` : '',
      ].join('');
      const quality = item.quality ? ` qt-${esc(item.quality)}` : '';
      return `<div id="dev-item-opt-${i}" class="dev-item-opt" data-i="${i}" role="option" aria-selected="false"><span class="dev-item-name${quality}">${esc(item.name)}</span>${tags}<span class="dev-item-id">${esc(item.id)}</span></div>`;
    });
    if (result.total > result.matches.length) {
      rows.push(
        `<div class="dev-item-more">${esc(t('devCommand.itemMore', { shown: String(result.matches.length), total: String(result.total) }))}</div>`,
      );
    }
    box.innerHTML = rows.join('');
    box.style.display = 'block';
    input.setAttribute('aria-expanded', 'true');
  }

  private moveItemHighlight(input: HTMLInputElement, box: HTMLElement, delta: number): void {
    if (this.itemMatches.length === 0) return;
    const count = this.itemMatches.length;
    this.itemIndex = (this.itemIndex + delta + count) % count;
    for (const [i, node] of box.querySelectorAll<HTMLElement>('.dev-item-opt').entries()) {
      const active = i === this.itemIndex;
      node.classList.toggle('active', active);
      node.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) node.scrollIntoView({ block: 'nearest' });
    }
    input.setAttribute('aria-activedescendant', `dev-item-opt-${this.itemIndex}`);
  }

  private chooseItem(input: HTMLInputElement, box: HTMLElement, index: number): void {
    const picked = this.itemMatches[index];
    if (!picked) return;
    input.value = picked.item.id;
    box.style.display = 'none';
    box.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    this.itemMatches = [];
    this.itemIndex = -1;
    this.updateItemStatus(input);
    input.focus();
  }

  // Resolve whatever is currently typed and say what it is. This is what tells a
  // tester that a half-typed name is not yet a real id, instead of letting them fire
  // a command the server will silently drop.
  private updateItemStatus(input: HTMLInputElement): void {
    const status = this.root().querySelector<HTMLElement>('[data-dev-item-status]');
    if (!status) return;
    const value = input.value.trim();
    if (value === '') {
      status.textContent = '';
      return;
    }
    const resolved = resolveDevItem(devItemCandidates(), value);
    status.textContent = resolved
      ? t('devCommand.itemChosen', { name: resolved.name })
      : t('devCommand.itemUnknown');
    status.classList.toggle('unknown', resolved === null);
  }

  private wireItemPicker(root: HTMLElement): void {
    const input = root.querySelector<HTMLInputElement>('[data-dev-item-search]');
    const box = root.querySelector<HTMLElement>('#dev-item-suggest');
    if (!input || !box) return;

    input.addEventListener('input', () => {
      this.renderItemSuggest(input, box);
      this.updateItemStatus(input);
    });
    input.addEventListener('keydown', (event) => {
      const open = this.itemMatches.length > 0;
      if (event.key === 'ArrowDown' && open) {
        event.preventDefault();
        this.moveItemHighlight(input, box, 1);
      } else if (event.key === 'ArrowUp' && open) {
        event.preventDefault();
        this.moveItemHighlight(input, box, -1);
      } else if (event.key === 'Enter' && open && this.itemIndex >= 0) {
        // Only swallow Enter when a row is actually highlighted, so Enter on a typed
        // id still falls through to the form instead of feeling dead.
        event.preventDefault();
        this.chooseItem(input, box, this.itemIndex);
      } else if (event.key === 'Escape' && open) {
        // Close the list without closing the window: the dialog's own Escape handler
        // would otherwise dismiss the whole Command Center on the first press.
        event.preventDefault();
        event.stopPropagation();
        this.renderItemSuggest(input, box);
        box.style.display = 'none';
        input.setAttribute('aria-expanded', 'false');
        this.itemMatches = [];
      }
    });
    // mousedown, not click: blur fires first on click and would have already torn the
    // list down before the handler ran. preventDefault runs for EVERY mousedown in
    // the box, row or not: grabbing the scrollbar (or the box padding) must not blur
    // the input, because the blur teardown below would drop the list mid-drag.
    box.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const row = (event.target as HTMLElement).closest<HTMLElement>('.dev-item-opt');
      if (!row) return;
      this.chooseItem(input, box, Number(row.dataset.i));
    });
    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        box.style.display = 'none';
        input.setAttribute('aria-expanded', 'false');
      }, DEV_ITEM_BLUR_CLEAR_MS);
    });
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
    // Staff-only tabs (Spawns) are dropped for non-admin accounts; if the active
    // tab just became invisible (an admin advert can land after open), fall back.
    const accountAdmin = this.deps.world().accountAdmin;
    if (!devCategoryVisible(this.category, accountAdmin)) this.category = 'player';
    const actions = filteredDevActions(this.category, this.query, (key) => t(key));
    root.innerHTML = `<header class="dev-command-header">
      <div><div class="dev-command-kicker">${esc(t('devCommand.kicker'))}</div><h2>${esc(t('devCommand.title'))}</h2><p>${esc(t('devCommand.subtitle'))}</p></div>
      <button type="button" class="x-btn" data-dev-close aria-label="${esc(t('devCommand.closeAria'))}">${svgIcon('close')}</button>
    </header>
    <div class="dev-command-toolbar">
      <nav class="dev-command-tabs" aria-label="${esc(t('devCommand.categoryNavAria'))}">${CATEGORIES.filter(
        (category) => devCategoryVisible(category.id, accountAdmin),
      )
        .map(
          (category) =>
            `<button type="button" data-dev-category="${category.id}" aria-pressed="${category.id === this.category}">${esc(t(category.labelKey))}</button>`,
        )
        .join('')}</nav>
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
    // The give action's combobox is re-created by every innerHTML rewrite above, so
    // its listeners have to be re-attached here rather than once at construction.
    this.itemMatches = [];
    this.itemIndex = -1;
    this.wireItemPicker(root);
    if (focusSelector) root.querySelector<HTMLElement>(focusSelector)?.focus();
  }
}
