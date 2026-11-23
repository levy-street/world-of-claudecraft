import { formatNumber, t } from '../../ui/i18n';
import type { PickScreenBox } from './placement_pick_bounds';
import './placement_pick_panel.css';

export interface PlacementPickRow {
  index: number;
  label: string;
  details?: string;
}

/** DOM-only picking feedback. The chooser never touches map state itself. */
export class PlacementPickPanel {
  readonly root = document.createElement('div');
  private readonly outline = document.createElement('div');
  private readonly target = document.createElement('p');
  private readonly detail = document.createElement('p');
  private readonly hint = document.createElement('p');
  private readonly button = document.createElement('button');
  private readonly navigation = document.createElement('div');
  private readonly count = document.createElement('span');
  private readonly previous = document.createElement('button');
  private readonly next = document.createElement('button');
  private readonly floorControl = document.createElement('label');
  private readonly floorCheckbox = document.createElement('input');
  private readonly floorStatus = document.createElement('p');
  private outlineKey = '';
  private readonly list = document.createElement('div');
  private readonly close = document.createElement('button');
  private rows: readonly PlacementPickRow[] = [];
  private selected: number | null = null;
  private pinned = false;
  private opened = false;

  constructor(
    parent: HTMLElement,
    private readonly onChoose: (index: number, additive: boolean) => void,
    private readonly onPreview: (index: number | null) => void,
    private readonly onDismiss: () => void = () => {},
    onFloorVisibilityChange?: (hideAbove: boolean) => void,
  ) {
    this.root.className = 'ed-pick-panel';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', t('editor.picking.chooser'));
    this.outline.className = 'ed-pick-outline';
    this.outline.hidden = true;
    this.outline.setAttribute('aria-hidden', 'true');
    this.target.setAttribute('role', 'status');
    this.target.setAttribute('aria-live', 'polite');
    this.detail.className = 'ed-pick-hint';
    this.hint.className = 'ed-pick-hint';
    this.hint.textContent = t('editor.picking.hint');
    this.button.type = 'button';
    this.button.setAttribute('aria-expanded', 'false');
    this.button.addEventListener('click', () => this.open());
    this.navigation.className = 'ed-pick-navigation';
    this.count.dataset.pickCount = '';
    for (const [button, action, direction] of [
      [this.previous, 'previous', -1],
      [this.next, 'next', 1],
    ] as const) {
      button.type = 'button';
      button.dataset.pickAction = action;
      button.textContent = t(
        action === 'previous' ? 'editor.picking.previous' : 'editor.picking.next',
      );
      button.addEventListener('click', (event) => {
        const position = this.rows.findIndex((row) => row.index === this.selected);
        const row = this.rows[(position + direction + this.rows.length) % this.rows.length];
        if (row) this.choose(row.index, event.shiftKey);
      });
    }
    this.navigation.append(this.previous, this.count, this.next);
    this.list.className = 'ed-pick-list';
    this.list.hidden = true;
    this.list.setAttribute('role', 'group');
    this.list.setAttribute('aria-label', t('editor.picking.chooser'));
    this.close.type = 'button';
    this.close.hidden = true;
    this.close.textContent = t('editor.picking.close');
    this.close.addEventListener('click', () => this.closeChooser());
    this.floorControl.className = 'ed-pick-floor-control';
    this.floorControl.hidden = true;
    this.floorCheckbox.type = 'checkbox';
    this.floorCheckbox.addEventListener('change', () =>
      onFloorVisibilityChange?.(this.floorCheckbox.checked),
    );
    this.floorControl.append(
      this.floorCheckbox,
      document.createTextNode(t('editor.picking.hideAbove')),
    );
    this.floorStatus.className = 'ed-pick-hint';
    this.floorStatus.hidden = true;
    this.root.addEventListener('keydown', (event) => this.key(event));
    this.root.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.root.append(
      this.target,
      this.detail,
      this.hint,
      this.button,
      this.navigation,
      this.list,
      this.close,
      this.floorControl,
      this.floorStatus,
    );
    parent.append(this.outline, this.root);
  }

  get isVisible(): boolean {
    return !this.root.hidden;
  }
  get isOpen(): boolean {
    return this.opened;
  }
  get currentIndex(): number | null {
    return this.selected;
  }
  get isPinned(): boolean {
    return this.pinned;
  }

  update(rows: readonly PlacementPickRow[], selected: number | null, pin = false): boolean {
    if ((this.opened || this.pinned) && !pin) return false;
    this.rows = rows;
    this.selected = selected;
    this.pinned = pin && selected !== null;
    this.root.hidden = !rows.some((row) => row.index === selected);
    this.button.hidden = rows.length < 2;
    this.previous.disabled = this.next.disabled = rows.length < 2;
    this.navigation.hidden = rows.length < 2;
    this.button.textContent = t('editor.picking.choose', {
      count: formatNumber(rows.length, { useGrouping: false }),
    });
    this.refreshCurrent();
    if (this.opened) this.renderRows();
    return true;
  }

  setSelected(index: number, row: PlacementPickRow): void {
    if (!this.rows.some((candidate) => candidate.index === index)) this.update([row], index, true);
    else {
      this.rows = this.rows.map((candidate) => (candidate.index === index ? row : candidate));
      this.selected = index;
      this.pinned = true;
      this.refreshCurrent();
    }
  }

  setFloorVisibility(level: number | null, hideAbove: boolean): void {
    this.floorControl.hidden = this.floorStatus.hidden = level === null;
    this.floorCheckbox.checked = hideAbove;
    if (level !== null)
      this.floorStatus.textContent = hideAbove
        ? t('editor.picking.filteredFloors', { level: formatNumber(level + 1) })
        : t('editor.picking.allFloors');
  }

  setOutline(box: PickScreenBox | null, behind = false): void {
    const key = box ? `${box.left},${box.top},${box.width},${box.height},${behind}` : '';
    if (key === this.outlineKey) return;
    this.outlineKey = key;
    this.outline.hidden = !box;
    if (!box) return;
    this.outline.style.left = `${box.left}px`;
    this.outline.style.top = `${box.top}px`;
    this.outline.style.width = `${box.width}px`;
    this.outline.style.height = `${box.height}px`;
    this.outline.dataset.behind = String(behind);
  }

  open(): void {
    if (this.rows.length < 2) return;
    this.opened = true;
    this.pinned = true;
    this.root.hidden = false;
    this.list.hidden = false;
    this.close.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.hint.textContent = t('editor.picking.keyboard');
    this.renderRows();
    (this.list.querySelector('[aria-pressed="true"]') as HTMLButtonElement | null)?.focus();
  }

  hide(): void {
    if (this.root.contains(document.activeElement)) this.onDismiss();
    // Already hidden: skip the DOM writes (non-picking tools reset the pick
    // state on every pointer move).
    const idle = this.root.hidden && this.outline.hidden && !this.opened;
    this.opened = false;
    this.pinned = false;
    this.rows = [];
    this.selected = null;
    if (idle) return;
    this.root.hidden = true;
    this.outline.hidden = true;
    this.outlineKey = '';
    this.list.hidden = true;
    this.close.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    this.hint.textContent = t('editor.picking.hint');
  }

  dispose(): void {
    if (this.root.contains(document.activeElement)) this.onDismiss();
    this.root.remove();
    this.outline.remove();
  }

  private choose(index: number, additive: boolean): void {
    this.selected = index;
    this.pinned = true;
    this.refreshCurrent();
    this.onChoose(index, additive);
  }

  private refreshCurrent(): void {
    const row = this.rows.find((entry) => entry.index === this.selected);
    const text = row ? t('editor.picking.target', { name: row.label }) : '';
    if (this.target.textContent !== text) this.target.textContent = text;
    const details = row?.details ?? '';
    if (this.detail.textContent !== details) this.detail.textContent = details;
    this.detail.hidden = !details;
    const position = this.rows.findIndex((entry) => entry.index === this.selected) + 1;
    this.count.textContent = t('editor.picking.position', {
      current: formatNumber(position),
      count: formatNumber(this.rows.length),
    });
    for (const button of this.list.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.index) === this.selected));
    }
  }

  private renderRows(): void {
    const focusIndex = (document.activeElement as HTMLElement | null)?.dataset.index;
    this.list.replaceChildren();
    this.rows.forEach((row, position) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.index = String(row.index);
      button.setAttribute('aria-pressed', String(row.index === this.selected));
      const name = document.createElement('span');
      name.textContent = row.label;
      const depth = document.createElement('small');
      depth.textContent = t(position === 0 ? 'editor.picking.front' : 'editor.picking.behind');
      const details = document.createElement('small');
      details.textContent = row.details ?? '';
      button.append(name, depth, details);
      button.addEventListener('focus', () => this.onPreview(row.index));
      button.addEventListener('pointerenter', () => this.onPreview(row.index));
      button.addEventListener('pointerleave', () => this.onPreview(this.selected));
      button.addEventListener('click', (event) => this.choose(row.index, event.shiftKey));
      this.list.append(button);
      if (focusIndex === button.dataset.index) button.focus();
    });
  }

  private closeChooser(): void {
    this.opened = false;
    this.list.hidden = true;
    this.close.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    this.hint.textContent = t('editor.picking.hint');
    this.onPreview(this.selected);
    this.button.focus();
  }

  private key(event: KeyboardEvent): void {
    // Never let editor Delete, arrows or camera shortcuts run while choosing.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeChooser();
      return;
    }
    if (!this.opened || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...this.list.querySelectorAll('button')];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
}
