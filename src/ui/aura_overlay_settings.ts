import { ABILITIES } from '../sim/content/classes';
import type { PlayerClass } from '../sim/types';
import { abilityDisplayName } from './ability_display_name';
import type {
  AuraOverlayConfig,
  AuraOverlayLayoutConfig,
  AuraOverlayLayoutPatch,
  AuraOverlayPatch,
} from './aura_overlay_config';
import type { AuraOverlayPart } from './aura_overlay_controller';
import type { AuraOverlayProcDef, AuraOverlayProcId } from './aura_overlay_view';
import { classDisplayName } from './entity_i18n';
import type { FocusTrapHandle } from './focus_manager';
import { restoreFirstEnabled } from './focus_restore';
import { formatNumber, t } from './i18n';
import { iconDataUrl } from './icons';
import { colorControl, settingsCard, sliderControl, toggleControl } from './settings_controls';
import { tTalent } from './talent_i18n';

export interface AuraOverlayHooks {
  playerClass(): PlayerClass;
  defs(): readonly AuraOverlayProcDef[];
  get(id: AuraOverlayProcId): AuraOverlayConfig;
  patch(id: AuraOverlayProcId, patch: AuraOverlayPatch): void;
  getLayout(): AuraOverlayLayoutConfig;
  patchLayout(patch: AuraOverlayLayoutPatch): void;
  reset(id: AuraOverlayProcId): void;
  nudge(id: AuraOverlayProcId, part: AuraOverlayPart, deltaX: number, deltaY: number): void;
  setAll(enabled: boolean): void;
  beginPlacement(id: AuraOverlayProcId, part: AuraOverlayPart): void;
  endPlacement(): void;
  setPlacement(on: boolean): void;
  onPositionChange(
    listener: (id: AuraOverlayProcId, config: AuraOverlayConfig) => void,
  ): () => void;
  onPlacementChange(listener: (id: AuraOverlayProcId, part: AuraOverlayPart) => void): () => void;
}

export interface AuraOverlaySettingsHost {
  auras: AuraOverlayHooks;
  click(): void;
  openFocusTrap(root: () => HTMLElement, returnFocusTo: HTMLElement): FocusTrapHandle;
}

const percent = (value: number): string =>
  formatNumber(value, { style: 'percent', maximumFractionDigits: 0 });
function procDisplayName(def: AuraOverlayProcDef): string {
  if (def.labelKey) return t(def.labelKey);
  if (def.talentChoice) {
    return tTalent({ kind: 'talentChoice', choice: def.talentChoice, field: 'name' });
  }
  const ability = ABILITIES[def.iconAbilityId];
  return ability ? abilityDisplayName(ability) : def.iconAbilityId;
}

export class AuraOverlaySettingsPanel {
  private placementToolbar: HTMLElement | null = null;
  private placementMenu: HTMLElement | null = null;
  private placementFocus: FocusTrapHandle | null = null;
  private placementSelectionUnsubscribe: (() => void) | null = null;

  constructor(private readonly host: AuraOverlaySettingsHost) {}

  render(parent: HTMLElement): void {
    const hooks = this.host.auras;
    parent.replaceChildren();

    const intro = document.createElement('div');
    intro.className = 'aura-settings-intro';
    const classLabel = document.createElement('strong');
    classLabel.textContent = t('hudChrome.auraOverlay.currentClass', {
      class: classDisplayName(hooks.playerClass()),
    });
    const hint = document.createElement('span');
    hint.textContent = t('hudChrome.auraOverlay.previewHint');
    intro.append(classLabel, hint);
    parent.appendChild(intro);

    const defs = hooks.defs();
    if (defs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'set-note';
      empty.textContent = t('hudChrome.auraOverlay.noProcs');
      parent.appendChild(empty);
      return;
    }

    const refresh = (focusKeys: readonly string[] = []): void => {
      this.render(parent);
      const controls = Array.from(parent.querySelectorAll<HTMLButtonElement>('[data-focus-key]'));
      restoreFirstEnabled(
        focusKeys.map((key) => controls.find((control) => control.dataset.focusKey === key)),
      );
    };
    const actions = document.createElement('div');
    actions.className = 'aura-bulk-actions';
    const allOn = document.createElement('button');
    allOn.type = 'button';
    allOn.className = 'btn aura-all-on';
    allOn.textContent = t('hudChrome.auraOverlay.allOn');
    const allOff = document.createElement('button');
    allOff.type = 'button';
    allOff.className = 'btn aura-all-off';
    allOff.textContent = t('hudChrome.auraOverlay.allOff');
    const setup = document.createElement('button');
    setup.type = 'button';
    setup.className = 'btn aura-setup-btn';
    setup.dataset.focusKey = 'aura-setup';
    setup.textContent = t('hudChrome.auraOverlay.reposition');
    const setAll = (enabled: boolean): void => {
      this.host.click();
      hooks.setAll(enabled);
      this.render(parent);
    };
    allOn.addEventListener('click', () => setAll(true));
    allOff.addEventListener('click', () => setAll(false));
    const firstDef = defs[0];
    setup.addEventListener('click', () => {
      this.host.click();
      this.openPlacement(setup, firstDef, procDisplayName(firstDef), () => refresh(['aura-setup']));
    });
    actions.append(allOn, allOff, setup);
    parent.appendChild(actions);

    const grid = document.createElement('div');
    grid.className = 'aura-settings-grid';
    parent.appendChild(grid);
    const orderedDefs = defs
      .map((def, index) => ({ def, index, order: hooks.get(def.id).groundOrder }))
      .sort((a, b) => a.order - b.order || a.index - b.index);
    const positionById = new Map(orderedDefs.map(({ def }, index) => [def.id, index + 1] as const));
    for (const { def } of orderedDefs) {
      this.buildProcCard(grid, def, positionById.get(def.id) ?? 1, defs.length, refresh);
    }
  }

  private buildProcCard(
    parent: HTMLElement,
    def: AuraOverlayProcDef,
    position: number,
    positionCount: number,
    refresh: (focusKeys?: readonly string[]) => void,
  ): void {
    const hooks = this.host.auras;
    const displayName = procDisplayName(def);
    const card = settingsCard(parent, displayName, {
      className: 'aura-settings-card',
    });
    const preview = document.createElement('div');
    preview.className = `aura-settings-chip aura-overlay-${def.theme}`;
    const icon = document.createElement('img');
    icon.src = iconDataUrl('ability', def.iconAbilityId);
    icon.alt = '';
    const label = document.createElement('span');
    label.textContent = displayName;
    preview.style.setProperty('--aura-color', hooks.get(def.id).color);
    preview.append(icon, label);
    card.appendChild(preview);
    const orderRow = document.createElement('div');
    orderRow.className = 'aura-order-row';
    const orderLabel = document.createElement('span');
    orderLabel.className = 'aura-order-position';
    orderLabel.textContent = t('hudChrome.auraOverlay.spellPosition', {
      position,
      count: positionCount,
    });
    const reorderButtons = document.createElement('span');
    reorderButtons.className = 'aura-order-buttons';
    const reorder = (direction: -1 | 1): void => {
      this.host.click();
      hooks.nudge(def.id, 'ground', direction, 0);
      const role = direction < 0 ? 'up' : 'down';
      const fallbackRole = direction < 0 ? 'down' : 'up';
      refresh([`aura-order:${def.id}:${role}`, `aura-order:${def.id}:${fallbackRole}`]);
    };
    const moveUp = document.createElement('button');
    moveUp.type = 'button';
    moveUp.className = 'btn aura-order-btn aura-order-up';
    moveUp.dataset.focusKey = `aura-order:${def.id}:up`;
    moveUp.title = t('hudChrome.auraOverlay.spellOrder');
    moveUp.setAttribute('aria-label', t('hudChrome.auraOverlay.moveEarlier'));
    moveUp.disabled = position <= 1;
    moveUp.addEventListener('click', () => reorder(-1));
    const moveDown = document.createElement('button');
    moveDown.type = 'button';
    moveDown.className = 'btn aura-order-btn aura-order-down';
    moveDown.dataset.focusKey = `aura-order:${def.id}:down`;
    moveDown.title = t('hudChrome.auraOverlay.spellOrder');
    moveDown.setAttribute('aria-label', t('hudChrome.auraOverlay.moveLater'));
    moveDown.disabled = position >= positionCount;
    moveDown.addEventListener('click', () => reorder(1));
    reorderButtons.append(moveUp, moveDown);
    orderRow.append(orderLabel, reorderButtons);
    card.appendChild(orderRow);

    const toggle = (
      labelText: string,
      get: () => boolean,
      patch: (value: boolean) => AuraOverlayPatch,
    ): void => {
      toggleControl({
        parent: card,
        label: labelText,
        get,
        set: (value) => hooks.patch(def.id, patch(value)),
        onLabel: t('hud.options.on'),
        offLabel: t('hud.options.off'),
        onActivate: () => this.host.click(),
      });
    };
    toggle(
      t('hudChrome.auraOverlay.enabled'),
      () => hooks.get(def.id).enabled,
      (enabled) => ({
        enabled,
      }),
    );
    toggle(
      t('hudChrome.auraOverlay.icon'),
      () => hooks.get(def.id).showIcon,
      (showIcon) => ({
        showIcon,
      }),
    );
    toggle(
      t('hudChrome.auraOverlay.arcs'),
      () => hooks.get(def.id).showArcs,
      (showArcs) => ({
        showArcs,
      }),
    );
    toggle(
      t('hudChrome.auraOverlay.groundRing'),
      () => hooks.get(def.id).showGroundRing,
      (showGroundRing) => ({
        showGroundRing,
      }),
    );
    sliderControl({
      parent: card,
      label: t('hudChrome.auraOverlay.opacity'),
      get: () => hooks.get(def.id).opacity,
      set: (opacity) => hooks.patch(def.id, { opacity }),
      min: 0.25,
      max: 1,
      step: 0.05,
      format: percent,
    });
    colorControl({
      parent: card,
      label: t('hudChrome.auraOverlay.color'),
      get: () => hooks.get(def.id).color,
      set: (color) => {
        hooks.patch(def.id, { color });
        preview.style.setProperty('--aura-color', color);
      },
    });
    const iconPositionLabel = document.createElement('div');
    iconPositionLabel.className = 'set-note aura-position-label';
    iconPositionLabel.textContent = t('hudChrome.auraOverlay.icon');
    card.appendChild(iconPositionLabel);
    sliderControl({
      parent: card,
      label: t('hudChrome.auraOverlay.size'),
      get: () => hooks.get(def.id).scale,
      set: (scale) => hooks.patch(def.id, { scale }),
      min: 0.65,
      max: 1.6,
      step: 0.05,
      format: percent,
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn aura-reset-btn';
    reset.dataset.focusKey = `aura-reset:${def.id}`;
    reset.textContent = t('hudChrome.auraOverlay.reset');
    reset.addEventListener('click', () => {
      this.host.click();
      hooks.reset(def.id);
      refresh([`aura-reset:${def.id}`]);
    });
    card.appendChild(reset);
  }

  private openPlacement(
    source: HTMLElement,
    def: AuraOverlayProcDef,
    abilityName: string,
    refreshMenu: () => void,
  ): void {
    const hooks = this.host.auras;
    const menu = source.closest<HTMLElement>('#options-menu');
    this.closePlacement();
    menu?.classList.add('aura-placement-hidden');

    const toolbar = document.createElement('div');
    toolbar.className = 'aura-placement-toolbar';
    toolbar.setAttribute('role', 'dialog');
    toolbar.setAttribute('aria-modal', 'true');
    toolbar.setAttribute(
      'aria-label',
      t('hudChrome.auraOverlay.positioning', { aura: abilityName }),
    );
    const title = document.createElement('strong');
    title.textContent = t('hudChrome.auraOverlay.positioning', { aura: abilityName });
    const defs = hooks.defs();
    let selectedId = def.id;
    let selectedPart: AuraOverlayPart = 'icon';
    const selector = document.createElement('label');
    selector.className = 'aura-placement-selector';
    const selectorLabel = document.createElement('span');
    selectorLabel.textContent = t('hudChrome.auraOverlay.selectAura');
    const auraSelect = document.createElement('select');
    auraSelect.className = 'hud-select aura-placement-select';
    for (const entry of defs) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = procDisplayName(entry);
      auraSelect.appendChild(option);
    }
    selector.append(selectorLabel, auraSelect);
    const iconPart = document.createElement('button');
    iconPart.type = 'button';
    iconPart.className = 'btn aura-placement-part aura-placement-icon';
    iconPart.textContent = t('hudChrome.auraOverlay.icon');
    const arcsPart = document.createElement('button');
    arcsPart.type = 'button';
    arcsPart.className = 'btn aura-placement-part aura-placement-arcs';
    arcsPart.textContent = t('hudChrome.auraOverlay.arcs');
    arcsPart.title = t('hudChrome.auraOverlay.crescentsSpellOrder');
    const groundPart = document.createElement('button');
    groundPart.type = 'button';
    groundPart.className = 'btn aura-placement-part aura-placement-ground';
    groundPart.textContent = t('hudChrome.auraOverlay.groundRing');
    groundPart.title = t('hudChrome.auraOverlay.groundRingSpellOrder');
    let nudgeButtons: HTMLButtonElement[] = [];
    let sizeControl: ReturnType<typeof sliderControl> | null = null;
    let opacityControl: ReturnType<typeof sliderControl> | null = null;
    const actionHint = document.createElement('span');
    actionHint.className = 'aura-placement-action-hint';
    const selectedSize = (): number => {
      const config = hooks.get(selectedId);
      if (selectedPart === 'icon') return config.scale;
      const layout = hooks.getLayout();
      return selectedPart === 'arcs' ? layout.crescentBlockScale : layout.groundRingBlockScale;
    };
    const syncSelection = (id: AuraOverlayProcId, part: AuraOverlayPart): void => {
      selectedId = id;
      selectedPart = part;
      auraSelect.value = id;
      const selectedDef = defs.find((entry) => entry.id === id);
      if (selectedDef) {
        const label = t('hudChrome.auraOverlay.positioning', {
          aura: procDisplayName(selectedDef),
        });
        title.textContent = label;
        toolbar.setAttribute('aria-label', label);
      }
      iconPart.classList.toggle('active', part === 'icon');
      iconPart.setAttribute('aria-pressed', String(part === 'icon'));
      arcsPart.classList.toggle('active', part === 'arcs');
      arcsPart.setAttribute('aria-pressed', String(part === 'arcs'));
      groundPart.classList.toggle('active', part === 'ground');
      groundPart.setAttribute('aria-pressed', String(part === 'ground'));
      for (const button of nudgeButtons) {
        const vertical =
          button.classList.contains('aura-placement-up') ||
          button.classList.contains('aura-placement-down');
        button.disabled = part !== 'icon' && vertical;
      }
      const left = nudgeButtons.find((button) => button.classList.contains('aura-placement-left'));
      const right = nudgeButtons.find((button) =>
        button.classList.contains('aura-placement-right'),
      );
      left?.setAttribute(
        'aria-label',
        t(part === 'icon' ? 'hudChrome.auraOverlay.moveLeft' : 'hudChrome.auraOverlay.moveEarlier'),
      );
      right?.setAttribute(
        'aria-label',
        t(part === 'icon' ? 'hudChrome.auraOverlay.moveRight' : 'hudChrome.auraOverlay.moveLater'),
      );
      left?.setAttribute(
        'title',
        t(part === 'icon' ? 'hudChrome.auraOverlay.moveLeft' : 'hudChrome.auraOverlay.moveEarlier'),
      );
      right?.setAttribute(
        'title',
        t(part === 'icon' ? 'hudChrome.auraOverlay.moveRight' : 'hudChrome.auraOverlay.moveLater'),
      );
      actionHint.textContent = t(
        part === 'icon'
          ? 'hudChrome.auraOverlay.screenPosition'
          : 'hudChrome.auraOverlay.spellOrder',
      );
      const sizeLabel = sizeControl?.row.querySelector<HTMLElement>('.set-name');
      const sizeInput = sizeControl?.row.querySelector<HTMLInputElement>('input');
      const label =
        part === 'icon'
          ? t('hudChrome.auraOverlay.iconSize')
          : part === 'arcs'
            ? t('hudChrome.auraOverlay.crescentBlockSize')
            : t('hudChrome.auraOverlay.groundRingBlockSize');
      if (sizeLabel) sizeLabel.textContent = label;
      sizeInput?.setAttribute('aria-label', label);
      sizeControl?.setValue(selectedSize());
      opacityControl?.setValue(hooks.get(selectedId).opacity);
    };
    const selectPlacement = (id: AuraOverlayProcId, part: AuraOverlayPart): void => {
      syncSelection(id, part);
      hooks.beginPlacement(id, part);
    };
    iconPart.addEventListener('click', () => {
      this.host.click();
      selectPlacement(selectedId, 'icon');
    });
    arcsPart.addEventListener('click', () => {
      this.host.click();
      selectPlacement(selectedId, 'arcs');
    });
    groundPart.addEventListener('click', () => {
      this.host.click();
      selectPlacement(selectedId, 'ground');
    });
    auraSelect.addEventListener('change', () => {
      this.host.click();
      selectPlacement(auraSelect.value as AuraOverlayProcId, selectedPart);
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn aura-placement-reset';
    reset.textContent = t('hudChrome.auraOverlay.reset');
    sizeControl = sliderControl({
      parent: toolbar,
      label: t('hudChrome.auraOverlay.size'),
      get: selectedSize,
      set: (value) => {
        if (selectedPart === 'icon') {
          hooks.patch(selectedId, { scale: value });
        } else if (selectedPart === 'arcs') {
          hooks.patchLayout({ crescentBlockScale: value });
        } else {
          hooks.patchLayout({ groundRingBlockScale: value });
        }
      },
      min: 0.65,
      max: 1.6,
      step: 0.05,
      format: percent,
    });
    sizeControl.row.classList.add('aura-placement-size');
    opacityControl = sliderControl({
      parent: toolbar,
      label: t('hudChrome.auraOverlay.opacity'),
      get: () => hooks.get(selectedId).opacity,
      set: (opacity) => hooks.patch(selectedId, { opacity }),
      min: 0.25,
      max: 1,
      step: 0.05,
      format: percent,
    });
    opacityControl.row.classList.add('aura-placement-opacity');
    const sliderBlock = document.createElement('div');
    sliderBlock.className = 'aura-placement-sliders';
    sliderBlock.append(sizeControl.row, opacityControl.row);
    const partControls = document.createElement('div');
    partControls.className = 'aura-placement-parts';
    partControls.append(iconPart, arcsPart, groundPart);
    const selectionBlock = document.createElement('div');
    selectionBlock.className = 'aura-placement-selection';
    selectionBlock.append(title, selector, partControls);
    const nudges = [
      { className: 'left', label: t('hudChrome.auraOverlay.moveLeft'), x: -1, y: 0 },
      { className: 'up', label: t('hudChrome.auraOverlay.moveUp'), x: 0, y: -1 },
      { className: 'down', label: t('hudChrome.auraOverlay.moveDown'), x: 0, y: 1 },
      { className: 'right', label: t('hudChrome.auraOverlay.moveRight'), x: 1, y: 0 },
    ];
    nudgeButtons = nudges.map(({ className, label, x, y }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `btn aura-placement-nudge aura-placement-${className}`;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', () => {
        this.host.click();
        hooks.nudge(selectedId, selectedPart, x, y);
      });
      return button;
    });
    const actionControls = document.createElement('div');
    actionControls.className = 'aura-placement-actions';
    actionControls.append(actionHint, ...nudgeButtons);
    const footerActions = document.createElement('div');
    footerActions.className = 'aura-placement-footer-actions';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'btn aura-placement-done';
    done.textContent = t('hudChrome.auraOverlay.done');

    reset.addEventListener('click', () => {
      this.host.click();
      if (selectedPart === 'icon') hooks.reset(selectedId);
      else if (selectedPart === 'arcs') hooks.patchLayout({ crescentBlockScale: 1 });
      else hooks.patchLayout({ groundRingBlockScale: 1 });
      sizeControl?.setValue(selectedSize());
      opacityControl?.setValue(hooks.get(selectedId).opacity);
    });
    done.addEventListener('click', () => {
      this.host.click();
      this.closePlacement(false);
      refreshMenu();
    });
    footerActions.append(reset, done);
    const footer = document.createElement('div');
    footer.className = 'aura-placement-footer';
    footer.append(actionControls, footerActions);
    toolbar.append(selectionBlock, sliderBlock, footer);
    document.body.appendChild(toolbar);
    this.placementToolbar = toolbar;
    this.placementMenu = menu;
    this.placementFocus = this.host.openFocusTrap(() => toolbar, source);
    this.placementSelectionUnsubscribe = hooks.onPlacementChange((id, part) =>
      syncSelection(id, part),
    );
    selectPlacement(def.id, 'icon');
    this.placementFocus.focusFirst('.aura-placement-icon');
  }

  closePlacement(returnFocus = true): void {
    if (this.placementToolbar) this.host.auras.endPlacement();
    this.placementToolbar?.remove();
    this.placementMenu?.classList.remove('aura-placement-hidden');
    this.placementFocus?.release(returnFocus);
    this.placementSelectionUnsubscribe?.();
    this.placementToolbar = null;
    this.placementMenu = null;
    this.placementFocus = null;
    this.placementSelectionUnsubscribe = null;
  }
}
