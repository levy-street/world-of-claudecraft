import type { AurasState } from './auras_view';
import { MeterFrame } from './meters_frame';
import type { PainterHostWriters } from './painter_host';
import {
  createTargetAurasWindowView,
  type TargetAuraFilter,
  type TargetAuraWindowRow,
} from './target_auras_view';

const FRAME_STORAGE_KEY = 'woc_target_auras_frame';
const FILTER_STORAGE_KEY = 'woc_target_auras_filter';
const VISIBLE_STORAGE_KEY = 'woc_target_auras_visible';
const VISIBLE_ROWS_STORAGE_KEY = 'woc_target_auras_visible_rows';
const SHOW_SOURCES_STORAGE_KEY = 'woc_target_auras_show_sources';
const OPACITY_STORAGE_KEY = 'woc_target_auras_opacity';
const DEFAULT_WIDTH = 220;
const SINGLE_FILTER_WIDTH = 140;
const DEFAULT_HEIGHT = 240;
const DEFAULT_VISIBLE_ROWS = 12;
const MIN_VISIBLE_ROWS = 3;
const MAX_VISIBLE_ROWS = 24;
const DEFAULT_OPACITY = 100;
const MIN_OPACITY = 30;
const MAX_OPACITY = 100;
const COMPACT_ROW_MIN_HEIGHT = 17;
const COMPACT_ROW_FLUID_CQW = 4.2;
const COMPACT_ROW_MAX_HEIGHT = 20;
const SOURCE_ROW_MIN_HEIGHT = 36;
const SOURCE_ROW_FLUID_CQW = 8.5;
const SOURCE_ROW_MAX_HEIGHT = 46;
const ROW_GAP = 3;
const FRAME_CHROME_HEIGHT = 66;
const CONFIG_WIDTH = 150;
const MOBILE_CONFIG_WIDTH = 232;
const CONFIG_VIEWPORT_MARGIN = 8;
const MOBILE_CONFIG_VIEWPORT_MARGIN = 4;
const FRAME_LIMITS = {
  minWidth: 135,
  maxWidth: 680,
  minHeight: 120,
  maxHeight: 1600,
  margin: 8,
};

interface PooledRow {
  el: HTMLElement;
  fill: HTMLElement;
  icon: HTMLElement;
  name: HTMLElement;
  source: HTMLElement;
  time: HTMLElement;
  stacks: HTMLElement;
  ownMarker: HTMLElement;
  nameText: string;
  remaining: number;
  effectHtml: string;
  lastIconKey: string | null;
}

export interface TargetAurasWindowDeps {
  root: HTMLElement;
  writers: PainterHostWriters;
  document: Document;
  window: Window;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  isMobileLayout(): boolean;
  uiScale(): number;
  resolveIconUrl(iconKey: string): string;
  renderTooltip(name: string, remaining: number, effectHtml: string): string;
  attachTooltip(el: HTMLElement, html: () => string): void;
  formatCount(count: number): string;
  formatPercent(value: number): string;
  unlockLabel(): string;
  lockLabel(): string;
  configureRowsLabel(): string;
  fewerRowsLabel(): string;
  moreRowsLabel(): string;
  visibleRowsLabel(count: number): string;
  showSourcesLabel(): string;
  hideSourcesLabel(): string;
  ownAuraLabel(): string;
  opacityLabel(percent: string): string;
}

/** Detailed target aura panel: both sections stay in one window, while pooled rows
 * keep countdown updates from rebuilding the list every frame. */
export class TargetAurasWindow {
  private readonly targetEl: HTMLElement;
  private readonly sectionsEl: HTMLElement;
  private readonly debuffSectionEl: HTMLElement;
  private readonly buffSectionEl: HTMLElement;
  private readonly debuffCountEl: HTMLElement;
  private readonly buffCountEl: HTMLElement;
  private readonly debuffRowsEl: HTMLElement;
  private readonly buffRowsEl: HTMLElement;
  private readonly debuffRows: PooledRow[] = [];
  private readonly buffRows: PooledRow[] = [];
  private readonly moveButton: HTMLButtonElement;
  private readonly rowsConfigButton: HTMLButtonElement;
  private readonly visibleRowsControl: HTMLElement;
  private readonly visibleRowsValue: HTMLElement;
  private readonly fewerRowsButton: HTMLButtonElement;
  private readonly moreRowsButton: HTMLButtonElement;
  private readonly sourceToggleButton: HTMLButtonElement;
  private readonly opacityInput: HTMLInputElement;
  private readonly opacityValue: HTMLElement;
  private readonly filterButtons: HTMLButtonElement[];
  private readonly frame: MeterFrame;
  private readonly view = createTargetAurasWindowView();
  private filter: TargetAuraFilter = 'all';
  private visible = false;
  private visibleRows = DEFAULT_VISIBLE_ROWS;
  private showSources = false;
  private opacity = DEFAULT_OPACITY;
  private rowsConfigOpen = false;
  private unlocked = false;
  private cleared = false;

  constructor(private readonly deps: TargetAurasWindowDeps) {
    const { root, document: doc } = deps;
    this.targetEl = root.querySelector('.ta-target') as HTMLElement;
    this.sectionsEl = root.querySelector('.ta-sections') as HTMLElement;
    this.debuffSectionEl = root.querySelector('.ta-debuff-section') as HTMLElement;
    this.buffSectionEl = root.querySelector('.ta-buff-section') as HTMLElement;
    this.debuffCountEl = root.querySelector('.ta-debuff-count') as HTMLElement;
    this.buffCountEl = root.querySelector('.ta-buff-count') as HTMLElement;
    this.debuffRowsEl = root.querySelector('.ta-debuff-rows') as HTMLElement;
    this.buffRowsEl = root.querySelector('.ta-buff-rows') as HTMLElement;
    this.filterButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-aura-filter]'));
    this.filter = this.loadFilter();
    // This panel is a desktop affordance until a touch launcher and interaction
    // model ship. Retain the desktop preference in memory while the dynamic
    // isVisible gate keeps it inactive throughout a mobile-touch session.
    this.visible = this.loadVisible();
    this.visibleRows = this.loadVisibleRows();
    this.showSources = this.loadShowSources();
    this.opacity = this.loadOpacity();
    for (const button of this.filterButtons) {
      button.addEventListener('click', () => {
        const filter = button.dataset.auraFilter;
        if (!isTargetAuraFilter(filter) || filter === this.filter) return;
        this.filter = filter;
        this.persistFilter();
        this.refreshFilterButtons();
        this.applyFilterWidth();
        if (this.rowsConfigOpen) this.positionVisibleRowsControl();
      });
    }
    const titleEl = root.querySelector('.panel-title') as HTMLElement;
    const rowsConfigButton = doc.createElement('button');
    rowsConfigButton.type = 'button';
    rowsConfigButton.className = 'ta-rows-config-btn';
    titleEl.appendChild(rowsConfigButton);
    this.rowsConfigButton = rowsConfigButton;
    rowsConfigButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.rowsConfigOpen = !this.rowsConfigOpen;
      this.refreshVisibleRowsControl();
      if (this.rowsConfigOpen) this.filterButtons[0]?.focus();
    });

    const visibleRowsControl = doc.createElement('div');
    visibleRowsControl.className = 'ta-visible-rows-control';
    visibleRowsControl.id = 'target-auras-visible-rows-control';
    const fewerRowsButton = this.createRowsButton('ta-visible-rows-less', '\u2212');
    const visibleRowsValue = doc.createElement('span');
    visibleRowsValue.className = 'ta-visible-rows-value';
    const moreRowsButton = this.createRowsButton('ta-visible-rows-more', '+');
    const sourceToggleButton = this.createRowsButton('ta-source-toggle', '');
    const opacityControl = doc.createElement('label');
    opacityControl.className = 'ta-opacity-control';
    const opacityInput = doc.createElement('input');
    opacityInput.className = 'ta-opacity-slider';
    opacityInput.type = 'range';
    opacityInput.min = String(MIN_OPACITY);
    opacityInput.max = String(MAX_OPACITY);
    opacityInput.step = '5';
    const opacityValue = doc.createElement('span');
    opacityValue.className = 'ta-opacity-value';
    opacityControl.append(opacityInput, opacityValue);
    const filtersEl = root.querySelector('.ta-filters') as HTMLElement;
    visibleRowsControl.append(
      filtersEl,
      fewerRowsButton,
      visibleRowsValue,
      moreRowsButton,
      sourceToggleButton,
      opacityControl,
    );
    root.appendChild(visibleRowsControl);
    this.visibleRowsControl = visibleRowsControl;
    this.visibleRowsValue = visibleRowsValue;
    this.fewerRowsButton = fewerRowsButton;
    this.moreRowsButton = moreRowsButton;
    this.sourceToggleButton = sourceToggleButton;
    this.opacityInput = opacityInput;
    this.opacityValue = opacityValue;
    visibleRowsControl.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      this.rowsConfigOpen = false;
      this.refreshVisibleRowsControl();
      this.rowsConfigButton.focus();
    });
    deps.window.addEventListener('resize', () => {
      if (this.rowsConfigOpen) this.positionVisibleRowsControl();
    });
    fewerRowsButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.adjustVisibleRows(-1);
    });
    moreRowsButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.adjustVisibleRows(1);
    });
    sourceToggleButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.showSources = !this.showSources;
      this.persistShowSources();
      this.refreshVisibleRowsControl();
      this.frame.setHeight(this.preferredHeight());
    });
    opacityInput.addEventListener('input', () => {
      this.opacity = clampOpacity(Number(opacityInput.value));
      this.persistOpacity();
      this.refreshOpacityControl();
    });

    const moveButton = doc.createElement('button');
    moveButton.type = 'button';
    moveButton.className = 'ta-move-btn';
    titleEl.appendChild(moveButton);
    this.moveButton = moveButton;
    moveButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.unlocked = !this.unlocked;
      this.refreshMoveButton();
    });
    this.refreshMoveButton();
    this.refreshVisibleRowsControl();
    this.refreshOpacityControl();
    this.refreshFilterButtons();
    this.frame = new MeterFrame(
      {
        el: root,
        handles: [root.querySelector('.panel-title') as HTMLElement, this.targetEl],
        storageKey: FRAME_STORAGE_KEY,
        fallbackSize: { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT },
        limits: FRAME_LIMITS,
        canInteract: () => this.unlocked,
      },
      {
        document: doc,
        window: deps.window,
        storage: deps.storage,
        isMobileLayout: deps.isMobileLayout,
        uiScale: deps.uiScale,
      },
    );
    this.frame.init();
    if (this.filter !== 'all') this.applyFilterWidth();
    this.clear();
  }

  paint(
    targetName: string,
    state: AurasState,
    sourceName: (sourceId: number | undefined) => string,
  ): void {
    if (!this.isVisible) {
      this.deps.writers.setDisplay(this.deps.root, 'none');
      return;
    }
    this.cleared = false;
    const model = this.view.tick(state, sourceName, this.filter);
    this.deps.writers.setDisplay(this.deps.root, 'flex');
    this.deps.writers.toggleClass(
      this.deps.root,
      'empty',
      model.debuffCount + model.buffCount === 0,
    );
    this.deps.writers.toggleClass(
      this.sectionsEl,
      'only-one',
      this.filter !== 'all' || (model.debuffCount === 0) !== (model.buffCount === 0),
    );
    this.deps.writers.toggleClass(this.debuffSectionEl, 'empty-section', model.debuffCount === 0);
    this.deps.writers.toggleClass(this.buffSectionEl, 'empty-section', model.buffCount === 0);
    this.refreshMoveButton();
    this.deps.writers.setText(this.targetEl, targetName);
    this.deps.writers.setText(
      this.debuffCountEl,
      this.formatSectionCount(model.debuffCount, model.debuffTotal),
    );
    this.deps.writers.setText(
      this.buffCountEl,
      this.formatSectionCount(model.buffCount, model.buffTotal),
    );
    this.paintRows(this.debuffRows, this.debuffRowsEl, model.debuffs, model.debuffCount, true);
    this.paintRows(this.buffRows, this.buffRowsEl, model.buffs, model.buffCount, false);
  }

  clear(): void {
    if (this.cleared) return;
    this.cleared = true;
    this.refreshVisibility();
    this.deps.writers.toggleClass(this.deps.root, 'empty', true);
    this.deps.writers.toggleClass(this.sectionsEl, 'only-one', false);
    this.deps.writers.toggleClass(this.debuffSectionEl, 'empty-section', true);
    this.deps.writers.toggleClass(this.buffSectionEl, 'empty-section', true);
    this.refreshMoveButton();
    this.deps.writers.setText(this.targetEl, '');
    this.deps.writers.setText(this.debuffCountEl, this.deps.formatCount(0));
    this.deps.writers.setText(this.buffCountEl, this.deps.formatCount(0));
    this.paintRows(this.debuffRows, this.debuffRowsEl, [], 0, true);
    this.paintRows(this.buffRows, this.buffRowsEl, [], 0, false);
  }

  resetFrame(): void {
    this.frame.reset();
    this.applyFilterWidth();
    this.refreshVisibleRowsControl();
    this.unlocked = false;
    this.refreshMoveButton();
    this.refreshVisibility();
  }

  toggle(): boolean {
    if (this.deps.isMobileLayout()) {
      this.rowsConfigOpen = false;
      this.unlocked = false;
      this.refreshMoveButton();
      this.refreshVisibleRowsControl();
      this.refreshVisibility();
      return false;
    }
    this.visible = !this.visible;
    if (this.visible) {
      // Never reveal rows retained from a target seen before the panel was
      // disabled. The next cadence paint replaces this empty frame atomically.
      this.cleared = false;
      this.clear();
    } else {
      this.rowsConfigOpen = false;
      this.unlocked = false;
      this.refreshMoveButton();
      this.refreshVisibleRowsControl();
      this.refreshVisibility();
    }
    this.persistVisible();
    return this.visible;
  }

  get isVisible(): boolean {
    return this.visible && !this.deps.isMobileLayout();
  }

  relocalize(): void {
    this.refreshMoveButton();
    this.refreshVisibleRowsControl();
    this.refreshOpacityControl();
    for (const row of [...this.debuffRows, ...this.buffRows]) {
      this.deps.writers.setText(row.ownMarker, this.deps.ownAuraLabel());
    }
  }

  private createRowsButton(className: string, text: string): HTMLButtonElement {
    const button = this.deps.document.createElement('button');
    button.type = 'button';
    button.className = `ta-visible-rows-step ${className}`;
    button.textContent = text;
    return button;
  }

  private adjustVisibleRows(delta: number): void {
    const next = clampVisibleRows(this.visibleRows + delta);
    if (next === this.visibleRows) return;
    this.visibleRows = next;
    this.persistVisibleRows();
    this.refreshVisibleRowsControl();
    this.frame.setHeight(this.preferredHeight());
  }

  private refreshVisibleRowsControl(): void {
    const rowsLabel = this.deps.visibleRowsLabel(this.visibleRows);
    this.deps.writers.setAttr(this.rowsConfigButton, 'aria-expanded', String(this.rowsConfigOpen));
    this.deps.writers.setAttr(this.rowsConfigButton, 'aria-controls', this.visibleRowsControl.id);
    this.deps.writers.setAttr(this.rowsConfigButton, 'aria-label', this.deps.configureRowsLabel());
    this.deps.writers.setAttr(this.rowsConfigButton, 'title', this.deps.configureRowsLabel());
    this.deps.writers.setDisplay(this.visibleRowsControl, this.rowsConfigOpen ? 'flex' : 'none');
    this.deps.writers.setAttr(this.visibleRowsControl, 'role', 'group');
    this.deps.writers.setAttr(
      this.visibleRowsControl,
      'aria-label',
      this.deps.configureRowsLabel(),
    );
    this.deps.writers.setText(this.visibleRowsValue, this.deps.formatCount(this.visibleRows));
    this.deps.writers.setAttr(this.visibleRowsValue, 'aria-label', rowsLabel);
    this.deps.writers.setAttr(this.fewerRowsButton, 'aria-label', this.deps.fewerRowsLabel());
    this.deps.writers.setAttr(this.moreRowsButton, 'aria-label', this.deps.moreRowsLabel());
    const sourceToggleLabel = this.showSources
      ? this.deps.hideSourcesLabel()
      : this.deps.showSourcesLabel();
    this.deps.writers.setAttr(this.sourceToggleButton, 'aria-pressed', String(this.showSources));
    this.deps.writers.setAttr(this.sourceToggleButton, 'aria-label', sourceToggleLabel);
    this.deps.writers.setAttr(this.sourceToggleButton, 'title', sourceToggleLabel);
    this.deps.writers.toggleClass(this.sourceToggleButton, 'on', this.showSources);
    this.deps.writers.toggleClass(this.deps.root, 'ta-show-sources', this.showSources);
    this.deps.writers.setAttr(
      this.fewerRowsButton,
      'aria-disabled',
      String(this.visibleRows === MIN_VISIBLE_ROWS),
    );
    this.deps.writers.setAttr(
      this.moreRowsButton,
      'aria-disabled',
      String(this.visibleRows === MAX_VISIBLE_ROWS),
    );
    this.deps.writers.setStyleProp(
      this.deps.root,
      '--ta-visible-rows-height',
      visibleRowsHeight(this.visibleRows, this.showSources),
    );
    this.deps.writers.setStyleProp(
      this.deps.root,
      '--ta-preferred-height',
      `${this.preferredHeight()}px`,
    );
    if (this.rowsConfigOpen) this.positionVisibleRowsControl();
  }

  private positionVisibleRowsControl(): void {
    const mobile = this.deps.isMobileLayout();
    const scale = Math.max(0.01, this.deps.uiScale());
    const margin = mobile ? MOBILE_CONFIG_VIEWPORT_MARGIN : CONFIG_VIEWPORT_MARGIN;
    const rootLeft = this.deps.root.getBoundingClientRect().left;
    const buttonLeft = this.rowsConfigButton.getBoundingClientRect().left;
    const measuredWidth = this.visibleRowsControl.getBoundingClientRect().width;
    const controlWidth = measuredWidth || (mobile ? MOBILE_CONFIG_WIDTH : CONFIG_WIDTH) * scale;
    const maxLeft = Math.max(margin, this.deps.window.innerWidth - controlWidth - margin);
    const viewportLeft = Math.max(margin, Math.min(buttonLeft, maxLeft));
    this.deps.writers.setStyleProp(
      this.visibleRowsControl,
      'left',
      `${Math.round((viewportLeft - rootLeft) / scale)}px`,
    );
  }

  private preferredHeight(): number {
    return preferredFrameHeight(
      this.visibleRows,
      this.frame?.currentWidth ?? (this.filter === 'all' ? DEFAULT_WIDTH : SINGLE_FILTER_WIDTH),
      this.showSources,
    );
  }

  private refreshMoveButton(): void {
    const label = this.unlocked ? this.deps.lockLabel() : this.deps.unlockLabel();
    this.deps.writers.setAttr(this.moveButton, 'aria-pressed', this.unlocked ? 'true' : 'false');
    this.deps.writers.setAttr(this.moveButton, 'aria-label', label);
    this.deps.writers.setAttr(this.moveButton, 'title', label);
    this.deps.writers.toggleClass(this.moveButton, 'active', this.unlocked);
    this.deps.writers.toggleClass(this.deps.root, 'ta-unlocked', this.unlocked);
  }

  private refreshOpacityControl(): void {
    const percent = this.deps.formatPercent(this.opacity / 100);
    const label = this.deps.opacityLabel(percent);
    this.opacityInput.value = String(this.opacity);
    this.deps.writers.setText(this.opacityValue, percent);
    this.deps.writers.setAttr(this.opacityInput, 'aria-label', label);
    this.deps.writers.setAttr(this.opacityInput, 'aria-valuetext', label);
    this.deps.writers.setAttr(this.opacityInput, 'title', label);
    this.deps.writers.setStyleProp(this.deps.root, '--ta-row-opacity', String(this.opacity / 100));
  }

  private refreshFilterButtons(): void {
    for (const button of this.filterButtons) {
      const active = button.dataset.auraFilter === this.filter;
      this.deps.writers.setAttr(button, 'aria-pressed', active ? 'true' : 'false');
      this.deps.writers.toggleClass(button, 'on', active);
    }
    for (const filter of ['all', 'debuffs', 'buffs'] as const) {
      this.deps.writers.toggleClass(this.deps.root, `ta-filter-${filter}`, filter === this.filter);
    }
  }

  private loadFilter(): TargetAuraFilter {
    try {
      const saved = this.deps.storage.getItem(FILTER_STORAGE_KEY);
      return isTargetAuraFilter(saved) ? saved : 'all';
    } catch {
      return 'all';
    }
  }

  private persistFilter(): void {
    try {
      this.deps.storage.setItem(FILTER_STORAGE_KEY, this.filter);
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }

  private loadVisible(): boolean {
    try {
      return this.deps.storage.getItem(VISIBLE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private loadVisibleRows(): number {
    try {
      const saved = Number.parseInt(this.deps.storage.getItem(VISIBLE_ROWS_STORAGE_KEY) ?? '', 10);
      return Number.isFinite(saved) ? clampVisibleRows(saved) : DEFAULT_VISIBLE_ROWS;
    } catch {
      return DEFAULT_VISIBLE_ROWS;
    }
  }

  private loadShowSources(): boolean {
    try {
      return this.deps.storage.getItem(SHOW_SOURCES_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private loadOpacity(): number {
    try {
      const saved = Number.parseInt(this.deps.storage.getItem(OPACITY_STORAGE_KEY) ?? '', 10);
      return Number.isFinite(saved) ? clampOpacity(saved) : DEFAULT_OPACITY;
    } catch {
      return DEFAULT_OPACITY;
    }
  }

  private persistVisibleRows(): void {
    try {
      this.deps.storage.setItem(VISIBLE_ROWS_STORAGE_KEY, String(this.visibleRows));
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }

  private persistShowSources(): void {
    try {
      this.deps.storage.setItem(SHOW_SOURCES_STORAGE_KEY, this.showSources ? '1' : '0');
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }

  private persistOpacity(): void {
    try {
      this.deps.storage.setItem(OPACITY_STORAGE_KEY, String(this.opacity));
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }

  private persistVisible(): void {
    try {
      this.deps.storage.setItem(VISIBLE_STORAGE_KEY, this.visible ? '1' : '0');
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }

  private refreshVisibility(): void {
    this.deps.writers.setDisplay(this.deps.root, this.isVisible ? 'flex' : 'none');
  }

  private applyFilterWidth(): void {
    this.frame.setWidth(this.filter === 'all' ? DEFAULT_WIDTH : SINGLE_FILTER_WIDTH);
  }

  private formatSectionCount(visible: number, total: number): string {
    const totalText = this.deps.formatCount(total);
    return visible < total ? `${this.deps.formatCount(visible)}/${totalText}` : totalText;
  }

  private paintRows(
    pool: PooledRow[],
    container: HTMLElement,
    rows: readonly TargetAuraWindowRow[],
    count: number,
    debuff: boolean,
  ): void {
    while (pool.length < count) pool.push(this.createRow(container));
    for (let i = 0; i < count; i++) {
      const row = rows[i];
      const rec = pool[i];
      rec.nameText = row.name;
      rec.remaining = row.remaining;
      rec.effectHtml = row.effectHtml;
      this.deps.writers.setDisplay(rec.el, 'grid');
      this.deps.writers.toggleClass(rec.el, 'debuff', debuff);
      this.deps.writers.toggleClass(rec.el, 'own', row.own);
      this.deps.writers.setAttr(rec.ownMarker, 'aria-hidden', String(!row.own));
      this.deps.writers.toggleClass(rec.el, 'expiring', row.expiring);
      this.deps.writers.setAttr(rec.el, 'data-school', row.school);
      if (rec.lastIconKey !== row.iconKey) {
        rec.lastIconKey = row.iconKey;
        this.deps.writers.setStyleProp(
          rec.icon,
          'background-image',
          this.deps.resolveIconUrl(row.iconKey),
        );
      }
      this.deps.writers.setWidth(rec.fill, `${Math.round(row.remainingFraction * 100)}%`);
      this.deps.writers.setText(rec.name, row.name);
      this.deps.writers.setText(rec.source, row.sourceName);
      this.deps.writers.setText(rec.time, row.durationText);
      this.deps.writers.setText(rec.stacks, row.stacksText);
      this.deps.writers.toggleClass(rec.stacks, 'empty', row.stacksText === '');
    }
    for (let i = count; i < pool.length; i++) {
      this.deps.writers.setDisplay(pool[i].el, 'none');
    }
  }

  private createRow(container: HTMLElement): PooledRow {
    const { document: doc } = this.deps;
    const el = doc.createElement('div');
    el.className = 'ta-row';
    el.tabIndex = 0;
    const fill = doc.createElement('div');
    fill.className = 'ta-fill';
    const icon = doc.createElement('div');
    icon.className = 'ta-icon';
    const stacks = doc.createElement('span');
    stacks.className = 'ta-stacks';
    icon.appendChild(stacks);
    const name = doc.createElement('span');
    name.className = 'ta-name';
    const source = doc.createElement('span');
    source.className = 'ta-source';
    const time = doc.createElement('span');
    time.className = 'ta-time';
    const ownMarker = doc.createElement('span');
    ownMarker.className = 'ta-own-marker';
    ownMarker.textContent = this.deps.ownAuraLabel();
    el.append(fill, icon, name, source, time, ownMarker);
    container.appendChild(el);
    const rec: PooledRow = {
      el,
      fill,
      icon,
      name,
      source,
      time,
      stacks,
      ownMarker,
      nameText: '',
      remaining: 0,
      effectHtml: '',
      lastIconKey: null,
    };
    this.deps.attachTooltip(el, () =>
      this.deps.renderTooltip(rec.nameText, rec.remaining, rec.effectHtml),
    );
    return rec;
  }
}

function isTargetAuraFilter(value: string | null | undefined): value is TargetAuraFilter {
  return value === 'all' || value === 'debuffs' || value === 'buffs';
}

function clampVisibleRows(value: number): number {
  return Math.max(MIN_VISIBLE_ROWS, Math.min(MAX_VISIBLE_ROWS, Math.trunc(value)));
}

function clampOpacity(value: number): number {
  return Math.max(MIN_OPACITY, Math.min(MAX_OPACITY, Math.round(value / 5) * 5));
}

function rowSizing(showSources: boolean): { min: number; fluid: number; max: number } {
  return showSources
    ? { min: SOURCE_ROW_MIN_HEIGHT, fluid: SOURCE_ROW_FLUID_CQW, max: SOURCE_ROW_MAX_HEIGHT }
    : {
        min: COMPACT_ROW_MIN_HEIGHT,
        fluid: COMPACT_ROW_FLUID_CQW,
        max: COMPACT_ROW_MAX_HEIGHT,
      };
}

function visibleRowsHeight(count: number, showSources: boolean): string {
  const sizing = rowSizing(showSources);
  const min = count * (sizing.min + ROW_GAP);
  const fluid = Number((count * sizing.fluid).toFixed(2));
  const gap = count * ROW_GAP;
  const max = count * (sizing.max + ROW_GAP);
  return `clamp(${min}px, calc(${fluid}cqw + ${gap}px), ${max}px)`;
}

function preferredFrameHeight(count: number, width: number, showSources: boolean): number {
  const sizing = rowSizing(showSources);
  const rowHeight = Math.min(sizing.max, Math.max(sizing.min, width * (sizing.fluid / 100)));
  return Math.round(FRAME_CHROME_HEIGHT + count * (rowHeight + ROW_GAP));
}
