// Options > Cooldown Manager: build groups (a single button, a grid of buttons,
// or a line of spells), lay each one out, and sort the whole spellbook into
// them. The Auras panel's sibling (src/ui/aura_overlay_settings.ts), built from
// the same shared settings_controls builders and the same cue palette.
//
// Three parts, top to bottom:
//   - General: the switches every group shares.
//   - Groups: one card per group with its layout (orientation, size, padding,
//     opacity, visibility, timer, position), plus the three Add buttons.
//   - Tracked Spells: every castable spell the player knows, sorted into one
//     section per group and a Not Displayed section, searchable by name. A spell
//     moves by drag and drop, or by selecting it and picking its group in the
//     detail card, which also holds that spell's alerts (the keyboard and touch
//     path, since drag and drop is pointer only).
//
// Cold DOM: it rebuilds on each change and carries focus across with
// focus_restore. Every rule it applies lives in cooldown_manager_config.ts; the
// live state behind the hooks is CooldownManagerController.

import { AURA_CUE_NONE, AURA_CUES } from '../../../game/aura_cue_catalog';
import { ABILITIES } from '../../../sim/content/classes';
import type { PlayerClass } from '../../../sim/types';
import { abilityDisplayName } from '../../ability_display_name';
import { auraDisplayNameFromSource } from '../../aura_display_name';
import { resolveHudAuraIconId, resolveHudAuraIconUrl } from '../../aura_icon_runtime';
import { classDisplayName } from '../../entity_i18n';
import { restoreFirstEnabled } from '../../focus_restore';
import { formatNumber, t } from '../../i18n';
import type { TranslationKey } from '../../i18n.catalog';
import { iconDataUrl } from '../../icons';
import { settingRow, settingsCard, sliderControl, toggleControl } from '../../settings_controls';
import { tTalent } from '../../talent_i18n';
import {
  type CooldownAuraEntry,
  isCooldownAuraToken,
  parseCooldownAuraToken,
} from './cooldown_manager_auras';
import {
  COOLDOWN_ALERT_STACKS_MAX,
  COOLDOWN_GRID_MAX_SIDE,
  COOLDOWN_GROUP_NAME_MAX,
  COOLDOWN_MAX_GROUPS,
  COOLDOWN_OPACITY_MAX,
  COOLDOWN_OPACITY_MIN,
  COOLDOWN_PADDING_MAX,
  COOLDOWN_SCALE_MAX,
  COOLDOWN_SCALE_MIN,
  COOLDOWN_VISIBILITIES,
  COOLDOWN_VOLUME_MAX,
  COOLDOWN_VOLUME_MIN,
  type CooldownGroup,
  type CooldownGroupKind,
  type CooldownGroupPatch,
  type CooldownManagerLayout,
  type CooldownManagerLayoutPatch,
  type CooldownSpellConfig,
  type CooldownSpellPatch,
  type CooldownVisibility,
  cooldownGroupCapacity,
  cooldownGroupOf,
  cooldownSpellMatches,
  minGridLines,
  minGridPerLine,
} from './cooldown_manager_config';

export interface CooldownManagerHooks {
  playerClass(): PlayerClass;
  /** Every castable spell the player knows, in spellbook order. */
  spellbook(): readonly string[];
  /** Every castable spell the CLASS can have, across every spec, talent and
   *  level (a superset of spellbook()). */
  catalog(): readonly string[];
  /** Every trackable aura: the class's engines, procs and buffs, plus the
   *  auras seen on the player that those do not cover. */
  auraCatalog(): readonly CooldownAuraEntry[];
  groups(): readonly CooldownGroup[];
  /** Add a group; returns its id, or null when the group cap is reached. */
  addGroup(kind: CooldownGroupKind): string | null;
  removeGroup(id: string): void;
  patchGroup(id: string, patch: CooldownGroupPatch): void;
  resetGroupPosition(id: string): void;
  /** Put a spell in a group (null: Not Displayed). False when refused (full). */
  assign(spellId: string, groupId: string | null): boolean;
  move(spellId: string, delta: -1 | 1): void;
  getSpell(id: string): CooldownSpellConfig;
  patchSpell(id: string, patch: CooldownSpellPatch): void;
  getLayout(): CooldownManagerLayout;
  patchLayout(patch: CooldownManagerLayoutPatch): void;
  previewCue(cueId: string, volume: number): void;
  /** Only the desktop action bar paints a proc glow, so elsewhere the Hotbar
   *  Glow row would be a dead toggle and is not offered. */
  hotbarGlowAvailable(): boolean;
  setPlacement(on: boolean): void;
  /** A group was dragged on screen; the panel's position sliders follow. */
  onGroupMove(listener: (group: CooldownGroup) => void): () => void;
}

export interface CooldownManagerSettingsHost {
  hooks: CooldownManagerHooks;
  click(): void;
}

// Static tables, not template keys, so a renamed key fails tsc here.
const GROUP_NAME_KEYS: Readonly<Record<CooldownGroupKind, TranslationKey>> = {
  single: 'hudChrome.cooldownManager.groupSingle',
  grid: 'hudChrome.cooldownManager.groupGrid',
  line: 'hudChrome.cooldownManager.groupLine',
};
const ADD_GROUP_KEYS: Readonly<Record<CooldownGroupKind, TranslationKey>> = {
  single: 'hudChrome.cooldownManager.addSingle',
  grid: 'hudChrome.cooldownManager.addGrid',
  line: 'hudChrome.cooldownManager.addLine',
};
const VISIBILITY_KEYS: Readonly<Record<CooldownVisibility, TranslationKey>> = {
  always: 'hudChrome.cooldownManager.visAlways',
  combat: 'hudChrome.cooldownManager.visCombat',
  hidden: 'hudChrome.cooldownManager.visHidden',
};
const NOT_DISPLAYED = '';
/** The section of class spells the current build does not know. Not a group:
 *  dropping a spell here takes it out of every group, like Not Displayed. */
const OTHER_SPELLS = '__other';
/** The section of trackable auras (engines, procs, buffs) not in any group. */
const AURAS_SECTION = '__auras';
/** A private drag type: a word dragged in from chat or another page carries
 *  only text/plain, so it can never be dropped into a group. */
const DRAG_TYPE = 'application/x-woc-cooldown-spell';

const percent = (value: number): string =>
  formatNumber(value, { style: 'percent', maximumFractionDigits: 0 });
const count = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

function spellName(abilityId: string): string {
  const ability = ABILITIES[abilityId];
  return ability ? abilityDisplayName(ability) : abilityId;
}

/** A catalog aura's player-facing name, through the localized path its label
 *  names (the buff bar's own sim aura-name matcher for engines and seen auras). */
function auraEntryName(entry: CooldownAuraEntry): string {
  const label = entry.label;
  switch (label.type) {
    case 'ability':
      return spellName(label.id);
    case 'talent':
      return tTalent({ kind: 'talentChoice', choice: label.choice, field: 'name' });
    case 'key':
      return t(label.key);
    default:
      return auraDisplayNameFromSource(label.name);
  }
}

/** The icon element for a tracked entry: ability art, or the aura art the buff
 *  bar would paint for it. */
function entryIcon(id: string, entry: CooldownAuraEntry | undefined): HTMLElement {
  const rule = parseCooldownAuraToken(id);
  if (rule) {
    const art = document.createElement('span');
    art.className = 'ui-socket-art cdm-aura-art';
    const iconId = resolveHudAuraIconId({ id: rule.value, kind: entry?.kind ?? rule.value });
    art.style.backgroundImage = resolveHudAuraIconUrl(iconId);
    return art;
  }
  const img = document.createElement('img');
  img.className = 'ui-socket-art';
  img.src = iconDataUrl('ability', id);
  img.alt = '';
  img.draggable = false;
  return img;
}

/** The group's player-chosen name, or its numbered default. */
export function cooldownGroupName(groups: readonly CooldownGroup[], id: string): string {
  const group = groups.find((entry) => entry.id === id);
  if (!group) return '';
  return group.name || cooldownGroupDefaultName(groups, id);
}

/** "Button Group 2": numbered within its own kind, in group order. */
export function cooldownGroupDefaultName(groups: readonly CooldownGroup[], id: string): string {
  const group = groups.find((entry) => entry.id === id);
  if (!group) return '';
  let index = 0;
  for (const entry of groups) {
    if (entry.kind === group.kind) index++;
    if (entry.id === id) break;
  }
  return t(GROUP_NAME_KEYS[group.kind], { index: count(index) });
}

export class CooldownManagerSettingsPanel {
  private moveUnsubscribe: (() => void) | null = null;
  /** The spell whose detail card is open (kept across rebuilds). */
  private selected: string | null = null;
  /** The search text (kept across rebuilds so a move never clears it). */
  private query = '';

  constructor(private readonly host: CooldownManagerSettingsHost) {}

  render(parent: HTMLElement): void {
    const { hooks } = this.host;
    this.dispose();
    parent.replaceChildren();
    const refresh = (focusKeys: readonly string[] = []): void => {
      this.render(parent);
      const controls = Array.from(parent.querySelectorAll<HTMLElement>('[data-focus-key]'));
      // Buttons, selects, the search box and a group card (tabindex -1) all
      // carry a focus key; each satisfies the candidate shape (disabled?, focus).
      restoreFirstEnabled(
        focusKeys.map((key) => controls.find((control) => control.dataset.focusKey === key)),
      );
    };

    const intro = document.createElement('div');
    intro.className = 'aura-settings-intro cdm-settings-intro';
    const classLabel = document.createElement('strong');
    classLabel.textContent = t('hudChrome.auraOverlay.currentClass', {
      class: classDisplayName(hooks.playerClass()),
    });
    const hint = document.createElement('span');
    hint.textContent = t('hudChrome.cooldownManager.intro');
    intro.append(classLabel, hint);
    parent.appendChild(intro);

    this.buildGeneral(parent);
    this.buildAddBar(parent, refresh);
    const groups = hooks.groups();
    if (groups.length === 0) {
      this.note(parent, t('hudChrome.cooldownManager.noGroups'));
    } else {
      const grid = document.createElement('div');
      grid.className = 'aura-settings-grid cdm-settings-grid';
      parent.appendChild(grid);
      const sliders = new Map<string, { x: (v: number) => void; y: (v: number) => void }>();
      for (const group of groups) sliders.set(group.id, this.buildGroupCard(grid, group, refresh));
      this.moveUnsubscribe = hooks.onGroupMove((group) => {
        const pair = sliders.get(group.id);
        pair?.x(group.posX);
        pair?.y(group.posY);
      });
    }
    this.buildTracked(parent, refresh);
  }

  /** Stop listening for drags; the Options window calls this when it leaves the
   *  view or closes. */
  dispose(): void {
    this.moveUnsubscribe?.();
    this.moveUnsubscribe = null;
  }

  // ---------------------------------------------------------------- helpers

  private toggle(
    parent: HTMLElement,
    label: string,
    get: () => boolean,
    set: (value: boolean) => void,
  ): void {
    toggleControl({
      parent,
      label,
      get,
      set,
      onLabel: t('hud.options.on'),
      offLabel: t('hud.options.off'),
      onActivate: () => this.host.click(),
    });
  }

  private note(parent: HTMLElement, text: string, className = 'aura-channel-hint'): HTMLElement {
    const hint = document.createElement('div');
    hint.className = `set-note ${className}`;
    hint.textContent = text;
    parent.appendChild(hint);
    return hint;
  }

  /** Tag a slider's input with a focus key and rebuild the panel once its value
   *  settles (`change`), putting focus back on the same slider. */
  private settleRefresh(
    row: HTMLElement,
    focusKey: string,
    refresh: (keys?: readonly string[]) => void,
  ): void {
    const input = row.querySelector('input');
    if (!input) return;
    input.dataset.focusKey = focusKey;
    input.addEventListener('change', () => refresh([focusKey]));
  }

  private select(
    parent: HTMLElement,
    label: string,
    options: readonly { value: string; label: string; disabled?: boolean }[],
    value: string,
    onChange: (value: string) => void,
    focusKey?: string,
  ): HTMLSelectElement {
    const { row } = settingRow(label);
    const select = document.createElement('select');
    select.className = 'hud-select cdm-select';
    select.setAttribute('aria-label', label);
    if (focusKey) select.dataset.focusKey = focusKey;
    for (const entry of options) {
      const option = document.createElement('option');
      option.value = entry.value;
      option.textContent = entry.label;
      option.disabled = entry.disabled === true;
      select.appendChild(option);
    }
    select.value = value;
    select.addEventListener('change', () => {
      this.host.click();
      onChange(select.value);
    });
    row.appendChild(select);
    parent.appendChild(row);
    return select;
  }

  private button(
    parent: HTMLElement,
    text: string,
    className: string,
    onClick: () => void,
    focusKey?: string,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn ${className}`;
    button.textContent = text;
    if (focusKey) button.dataset.focusKey = focusKey;
    button.addEventListener('click', () => {
      this.host.click();
      onClick();
    });
    parent.appendChild(button);
    return button;
  }

  // ---------------------------------------------------------------- general

  private buildGeneral(parent: HTMLElement): void {
    const { hooks } = this.host;
    const card = settingsCard(parent, t('hudChrome.cooldownManager.generalTitle'), {
      className: 'aura-settings-card cdm-general-card',
    });
    this.toggle(
      card,
      t('hudChrome.cooldownManager.enabled'),
      () => hooks.getLayout().enabled,
      (enabled) => hooks.patchLayout({ enabled }),
    );
    sliderControl({
      parent: card,
      label: t('hudChrome.cooldownManager.idleOpacity'),
      get: () => hooks.getLayout().idleOpacity,
      set: (idleOpacity) => hooks.patchLayout({ idleOpacity }),
      min: COOLDOWN_OPACITY_MIN,
      max: COOLDOWN_OPACITY_MAX,
      step: 0.05,
      format: percent,
    });
    this.toggle(
      card,
      t('hudChrome.cooldownManager.combatOnly'),
      () => hooks.getLayout().soundInCombatOnly,
      (soundInCombatOnly) => hooks.patchLayout({ soundInCombatOnly }),
    );
    this.note(card, t('hudChrome.cooldownManager.dragHint'));
  }

  private buildAddBar(parent: HTMLElement, refresh: (keys?: readonly string[]) => void): void {
    const { hooks } = this.host;
    const bar = document.createElement('div');
    bar.className = 'aura-bulk-actions cdm-add-bar';
    const full = hooks.groups().length >= COOLDOWN_MAX_GROUPS;
    for (const kind of ['single', 'grid', 'line'] as const) {
      const add = this.button(
        bar,
        t(ADD_GROUP_KEYS[kind]),
        `cdm-add cdm-add--${kind}`,
        () => {
          const id = hooks.addGroup(kind);
          refresh(id ? [`cdm-group:${id}`] : [`cdm-add:${kind}`]);
        },
        `cdm-add:${kind}`,
      );
      add.disabled = full;
    }
    parent.appendChild(bar);
    if (full) this.note(parent, t('hudChrome.cooldownManager.groupsFull'));
  }

  // ---------------------------------------------------------------- groups

  /** The group's name box. Commits on `change` (Enter or leaving the field), so
   *  the panel rebuilds once per rename rather than per keystroke; an empty box
   *  goes back to the numbered default, which is also its placeholder. */
  private buildNameField(
    card: HTMLElement,
    group: CooldownGroup,
    groups: readonly CooldownGroup[],
    refresh: (keys?: readonly string[]) => void,
  ): void {
    const label = t('hudChrome.cooldownManager.groupName');
    const focusKey = `cdm-name:${group.id}`;
    const { row } = settingRow(label);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ui-input cdm-name';
    input.maxLength = COOLDOWN_GROUP_NAME_MAX;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = cooldownGroupDefaultName(groups, group.id);
    input.value = group.name;
    input.dataset.focusKey = focusKey;
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => {
      this.host.hooks.patchGroup(group.id, { name: input.value });
      refresh([focusKey]);
    });
    row.appendChild(input);
    card.appendChild(row);
  }

  /** One group's layout card. Returns the position sliders' setters so a drag on
   *  the live group can move them. */
  private buildGroupCard(
    parent: HTMLElement,
    group: CooldownGroup,
    refresh: (keys?: readonly string[]) => void,
  ): { x: (v: number) => void; y: (v: number) => void } {
    const { hooks } = this.host;
    const groups = hooks.groups();
    const name = cooldownGroupName(groups, group.id);
    const card = settingsCard(parent, name, { className: 'aura-settings-card cdm-group-card' });
    card.dataset.focusKey = `cdm-group:${group.id}`;
    card.tabIndex = -1;
    const live = (): CooldownGroup =>
      hooks.groups().find((entry) => entry.id === group.id) ?? group;
    const patch = (value: CooldownGroupPatch, rebuild: boolean, keys: string[] = []): void => {
      hooks.patchGroup(group.id, value);
      if (rebuild) refresh(keys);
    };
    this.buildNameField(card, group, groups, refresh);
    this.note(
      card,
      t('hudChrome.cooldownManager.spellCount', {
        count: count(group.spells.length),
        max: count(cooldownGroupCapacity(group)),
      }),
      'cdm-capacity',
    );

    const horizontal = group.orientation === 'horizontal';
    if (group.kind !== 'single') {
      this.select(
        card,
        t('hudChrome.cooldownManager.orientation'),
        [
          { value: 'horizontal', label: t('hudChrome.cooldownManager.horizontal') },
          { value: 'vertical', label: t('hudChrome.cooldownManager.vertical') },
        ],
        group.orientation,
        (value) =>
          patch({ orientation: value === 'vertical' ? 'vertical' : 'horizontal' }, true, [
            `cdm-orientation:${group.id}`,
          ]),
        `cdm-orientation:${group.id}`,
      );
    }
    if (group.kind === 'grid') {
      // The run length is "# Columns" across a horizontal grid and "# Rows" down
      // a vertical one; the run count is the other.
      const perLabel = t(
        horizontal ? 'hudChrome.cooldownManager.columns' : 'hudChrome.cooldownManager.rows',
      );
      const linesLabel = t(
        horizontal ? 'hudChrome.cooldownManager.rows' : 'hudChrome.cooldownManager.columns',
      );
      const perSlider = sliderControl({
        parent: card,
        label: perLabel,
        get: () => live().perLine,
        set: (perLine) => patch({ perLine: Math.round(perLine) }, false),
        // Never narrower than the widest run count can hold (no spell dropped).
        min: minGridPerLine(group.spells.length),
        max: COOLDOWN_GRID_MAX_SIDE,
        step: 1,
        format: count,
      });
      // The card rebuilds once the value settles (the new run count bounds the
      // other slider); the focus key carries a keyboard user back to it.
      this.settleRefresh(perSlider.row, `cdm-per:${group.id}`, refresh);
      const linesSlider = sliderControl({
        parent: card,
        label: linesLabel,
        get: () => live().lines,
        set: (lines) =>
          patch(
            {
              lines: Math.max(Math.round(lines), minGridLines(group.spells.length, live().perLine)),
            },
            false,
          ),
        min: 1,
        max: COOLDOWN_GRID_MAX_SIDE,
        step: 1,
        format: count,
      });
      this.settleRefresh(linesSlider.row, `cdm-lines:${group.id}`, refresh);
    }
    if (group.kind !== 'single') {
      this.select(
        card,
        t('hudChrome.cooldownManager.direction'),
        horizontal
          ? [
              { value: 'forward', label: t('hudChrome.cooldownManager.dirRight') },
              { value: 'reverse', label: t('hudChrome.cooldownManager.dirLeft') },
            ]
          : [
              { value: 'forward', label: t('hudChrome.cooldownManager.dirDown') },
              { value: 'reverse', label: t('hudChrome.cooldownManager.dirUp') },
            ],
        group.direction,
        (value) =>
          patch({ direction: value === 'reverse' ? 'reverse' : 'forward' }, true, [
            `cdm-direction:${group.id}`,
          ]),
        `cdm-direction:${group.id}`,
      );
    }
    sliderControl({
      parent: card,
      label: t('hudChrome.cooldownManager.iconSize'),
      get: () => live().scale,
      set: (scale) => patch({ scale }, false),
      min: COOLDOWN_SCALE_MIN,
      max: COOLDOWN_SCALE_MAX,
      step: 0.05,
      format: percent,
    });
    if (group.kind !== 'single') {
      sliderControl({
        parent: card,
        label: t('hudChrome.cooldownManager.iconPadding'),
        get: () => live().padding,
        set: (padding) => patch({ padding: Math.round(padding) }, false),
        min: 0,
        max: COOLDOWN_PADDING_MAX,
        step: 1,
        format: count,
      });
    }
    sliderControl({
      parent: card,
      label: t('hudChrome.cooldownManager.opacity'),
      get: () => live().opacity,
      set: (opacity) => patch({ opacity }, false),
      min: COOLDOWN_OPACITY_MIN,
      max: COOLDOWN_OPACITY_MAX,
      step: 0.05,
      format: percent,
    });
    this.select(
      card,
      t('hudChrome.cooldownManager.visibility'),
      COOLDOWN_VISIBILITIES.map((value) => ({ value, label: t(VISIBILITY_KEYS[value]) })),
      group.visibility,
      (value) => {
        const visibility = COOLDOWN_VISIBILITIES.find((entry) => entry === value) ?? 'always';
        patch({ visibility }, true, [`cdm-visibility:${group.id}`]);
      },
      `cdm-visibility:${group.id}`,
    );
    if (group.visibility === 'hidden')
      this.note(card, t('hudChrome.cooldownManager.visHiddenHint'));
    this.toggle(
      card,
      t('hudChrome.cooldownManager.showTimer'),
      () => live().showTimer,
      (showTimer) => patch({ showTimer }, false),
    );
    const posX = sliderControl({
      parent: card,
      label: t('hudChrome.cooldownManager.positionX'),
      get: () => live().posX,
      set: (posX) => patch({ posX }, false),
      min: 0,
      max: 1,
      step: 0.005,
      format: percent,
    });
    const posY = sliderControl({
      parent: card,
      label: t('hudChrome.cooldownManager.positionY'),
      get: () => live().posY,
      set: (posY) => patch({ posY }, false),
      min: 0,
      max: 1,
      step: 0.005,
      format: percent,
    });
    const actions = document.createElement('div');
    actions.className = 'cdm-group-actions';
    this.button(
      actions,
      t('hudChrome.cooldownManager.resetPosition'),
      'aura-reset-btn cdm-reset-position',
      () => {
        hooks.resetGroupPosition(group.id);
        posX.setValue(live().posX);
        posY.setValue(live().posY);
      },
    );
    const remove = this.button(
      actions,
      t('hudChrome.cooldownManager.deleteGroup'),
      'aura-reset-btn cdm-delete-group',
      () => {
        hooks.removeGroup(group.id);
        refresh([`cdm-add:${group.kind}`]);
      },
    );
    remove.setAttribute(
      'aria-label',
      t('hudChrome.cooldownManager.deleteGroupAria', { group: name }),
    );
    card.appendChild(actions);
    return { x: posX.setValue, y: posY.setValue };
  }

  // ---------------------------------------------------------------- spells

  private buildTracked(parent: HTMLElement, refresh: (keys?: readonly string[]) => void): void {
    const { hooks } = this.host;
    const groups = hooks.groups();
    const spellbook = hooks.spellbook();
    const known = new Set(spellbook);
    const catalog = hooks.catalog();
    const auraEntries = hooks.auraCatalog();
    const auraByToken = new Map(auraEntries.map((entry) => [entry.token, entry] as const));
    const name = (id: string): string => {
      const entry = auraByToken.get(id);
      if (entry) return auraEntryName(entry);
      return isCooldownAuraToken(id) ? t('hudChrome.cooldownManager.auraFallback') : spellName(id);
    };
    const section = document.createElement('div');
    section.className = 'aura-watch-section cdm-tracked';
    const head = document.createElement('div');
    head.className = 'aura-watch-head';
    const title = document.createElement('strong');
    title.textContent = t('hudChrome.cooldownManager.trackedTitle');
    head.appendChild(title);
    section.appendChild(head);
    this.note(section, t('hudChrome.cooldownManager.trackedHint'));
    parent.appendChild(section);

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'ui-input cdm-search';
    search.dataset.focusKey = 'cdm-search';
    search.placeholder = t('hudChrome.cooldownManager.searchPlaceholder');
    search.setAttribute('aria-label', t('hudChrome.cooldownManager.search'));
    search.value = this.query;
    section.appendChild(search);

    if (this.selected !== null) {
      this.buildDetail(section, this.selected, name(this.selected), auraByToken, refresh);
    }

    const chips: { el: HTMLElement; name: string }[] = [];
    const assigned = new Set(groups.flatMap((group) => group.spells));
    const sections: { id: string; label: string; spells: readonly string[] }[] = [
      ...groups.map((group) => ({
        id: group.id,
        label: cooldownGroupName(groups, group.id),
        spells: group.spells,
      })),
      {
        id: NOT_DISPLAYED,
        label: t('hudChrome.cooldownManager.notDisplayed'),
        spells: spellbook.filter((id) => !assigned.has(id)),
      },
      {
        id: OTHER_SPELLS,
        label: t('hudChrome.cooldownManager.otherSpells'),
        spells: catalog.filter((id) => !known.has(id) && !assigned.has(id)),
      },
      {
        id: AURAS_SECTION,
        label: t('hudChrome.cooldownManager.aurasTitle'),
        spells: auraEntries.map((entry) => entry.token).filter((token) => !assigned.has(token)),
      },
    ];
    for (const entry of sections) {
      const box = document.createElement('div');
      box.className = 'cdm-spell-section';
      box.dataset.group = entry.id;
      const label = document.createElement('div');
      label.className = 'cdm-spell-section-title';
      label.textContent = entry.label;
      const list = document.createElement('div');
      list.className = 'cdm-spell-list';
      list.setAttribute('role', 'group');
      list.setAttribute('aria-label', entry.label);
      box.append(label);
      if (entry.id === OTHER_SPELLS) {
        this.note(box, t('hudChrome.cooldownManager.otherSpellsHint'), 'cdm-other-hint');
      } else if (entry.id === AURAS_SECTION) {
        this.note(box, t('hudChrome.cooldownManager.aurasHint'), 'cdm-other-hint');
      }
      box.append(list);
      if (entry.spells.length === 0) {
        this.note(list, t('hudChrome.cooldownManager.emptySection'), 'cdm-empty');
      }
      for (const id of entry.spells) {
        const label = name(id);
        const isAura = isCooldownAuraToken(id);
        const chip = document.createElement('button');
        chip.type = 'button';
        // A spell the current build does not know (another spec, talent or a
        // higher level) is dimmed and says so: its button appears once known.
        const unknown = !isAura && !known.has(id);
        chip.className = `ui-socket cdm-spell-chip${unknown ? ' is-unknown' : ''}`;
        chip.draggable = true;
        chip.dataset.focusKey = `cdm-spell:${id}`;
        const shown = unknown ? t('hudChrome.cooldownManager.notKnown', { spell: label }) : label;
        chip.title = shown;
        chip.setAttribute(
          'aria-label',
          t('hudChrome.cooldownManager.selectSpell', { spell: shown }),
        );
        chip.setAttribute('aria-pressed', String(this.selected === id));
        chip.appendChild(entryIcon(id, auraByToken.get(id)));
        chip.addEventListener('click', () => {
          this.host.click();
          this.selected = this.selected === id ? null : id;
          refresh([this.selected === id ? 'cdm-detail-group' : `cdm-spell:${id}`]);
        });
        chip.addEventListener('dragstart', (event) => {
          event.dataTransfer?.setData(DRAG_TYPE, id);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        });
        list.appendChild(chip);
        chips.push({ el: chip, name: label });
      }
      // Drop target: the whole section, including its label, takes a spell.
      box.addEventListener('dragover', (event) => {
        event.preventDefault();
        box.classList.add('drop-target');
      });
      box.addEventListener('dragleave', (event) => {
        // Crossing onto a child chip is not leaving the section.
        const next = event.relatedTarget;
        if (next instanceof Node && box.contains(next)) return;
        box.classList.remove('drop-target');
      });
      box.addEventListener('drop', (event) => {
        event.preventDefault();
        box.classList.remove('drop-target');
        const id = event.dataTransfer?.getData(DRAG_TYPE) ?? '';
        // Only a spell this panel listed can land in a group.
        if (!catalog.includes(id) && !auraByToken.has(id) && !assigned.has(id)) return;
        const target =
          entry.id === NOT_DISPLAYED || entry.id === OTHER_SPELLS || entry.id === AURAS_SECTION
            ? null
            : entry.id;
        if (hooks.assign(id, target)) {
          this.host.click();
          refresh([`cdm-spell:${id}`]);
        }
      });
      section.appendChild(box);
    }
    if (spellbook.length === 0) this.note(section, t('hudChrome.cooldownManager.spellsEmpty'));

    // Filtering hides chips in place, so typing never rebuilds under the caret.
    const filter = (): void => {
      for (const chip of chips) chip.el.hidden = !cooldownSpellMatches(chip.name, this.query);
    };
    search.addEventListener('input', () => {
      this.query = search.value;
      filter();
    });
    filter();
  }

  /** The selected spell's card: its group, its order, and its alerts. */
  private buildDetail(
    parent: HTMLElement,
    id: string,
    spell: string,
    auraByToken: ReadonlyMap<string, CooldownAuraEntry>,
    refresh: (keys?: readonly string[]) => void,
  ): void {
    const { hooks } = this.host;
    const groups = hooks.groups();
    const isAura = isCooldownAuraToken(id);
    const card = settingsCard(parent, spell, { className: 'aura-settings-card cdm-detail-card' });
    const preview = document.createElement('div');
    preview.className = 'aura-settings-chip cdm-settings-chip';
    const label = document.createElement('span');
    label.textContent = spell;
    preview.append(entryIcon(id, auraByToken.get(id)), label);
    card.appendChild(preview);

    const current = cooldownGroupOf(groups, id);
    this.select(
      card,
      t('hudChrome.cooldownManager.group'),
      [
        { value: NOT_DISPLAYED, label: t('hudChrome.cooldownManager.notDisplayed') },
        ...groups.map((group) => {
          const name = cooldownGroupName(groups, group.id);
          const full = group.id !== current && group.spells.length >= cooldownGroupCapacity(group);
          return {
            value: group.id,
            label: full ? t('hudChrome.cooldownManager.groupFullOption', { group: name }) : name,
            disabled: full,
          };
        }),
      ],
      current ?? NOT_DISPLAYED,
      (value) => {
        hooks.assign(id, value === NOT_DISPLAYED ? null : value);
        refresh(['cdm-detail-group']);
      },
      'cdm-detail-group',
    );
    if (current === null) {
      this.note(card, t('hudChrome.cooldownManager.notInGroupHint'));
      return;
    }
    const group = groups.find((entry) => entry.id === current);
    const index = group?.spells.indexOf(id) ?? -1;
    const order = document.createElement('div');
    order.className = 'cdm-order-row';
    const earlier = this.button(
      order,
      t('hudChrome.cooldownManager.moveEarlier', { spell }),
      'cdm-order-btn',
      () => {
        hooks.move(id, -1);
        refresh(['cdm-order:up', 'cdm-order:down']);
      },
      'cdm-order:up',
    );
    earlier.disabled = index <= 0;
    const later = this.button(
      order,
      t('hudChrome.cooldownManager.moveLater', { spell }),
      'cdm-order-btn',
      () => {
        hooks.move(id, 1);
        refresh(['cdm-order:down', 'cdm-order:up']);
      },
      'cdm-order:down',
    );
    later.disabled = group === undefined || index >= group.spells.length - 1;
    card.appendChild(order);

    this.toggle(
      card,
      t('hudChrome.cooldownManager.glowWhenReady'),
      () => hooks.getSpell(id).glowWhenReady,
      (glowWhenReady) => hooks.patchSpell(id, { glowWhenReady }),
    );
    this.note(card, t('hudChrome.cooldownManager.glowWhenReadyHint'));
    // An aura has no action-bar button of its own to light.
    if (!isAura && hooks.hotbarGlowAvailable()) {
      this.toggle(
        card,
        t('hudChrome.cooldownManager.hotbarGlow'),
        () => hooks.getSpell(id).hotbarGlow,
        (hotbarGlow) => hooks.patchSpell(id, { hotbarGlow }),
      );
      this.note(card, t('hudChrome.cooldownManager.hotbarGlowHint'));
    }
    this.toggle(
      card,
      t(
        isAura
          ? 'hudChrome.cooldownManager.onlyWhileActive'
          : 'hudChrome.cooldownManager.onlyWhenReady',
      ),
      () => hooks.getSpell(id).onlyWhenReady,
      (onlyWhenReady) => hooks.patchSpell(id, { onlyWhenReady }),
    );
    if (isAura) {
      sliderControl({
        parent: card,
        label: t('hudChrome.cooldownManager.alertStacks'),
        get: () => hooks.getSpell(id).alertStacks,
        set: (alertStacks) => hooks.patchSpell(id, { alertStacks: Math.round(alertStacks) }),
        min: 0,
        max: COOLDOWN_ALERT_STACKS_MAX,
        step: 1,
        format: (value) =>
          value < 1 ? t('hudChrome.cooldownManager.alertStacksAny') : count(Math.round(value)),
      });
      this.note(card, t('hudChrome.cooldownManager.alertStacksHint'));
    }
    this.buildSound(card, id, isAura, refresh);
  }

  /** The ready sound: the Auras cue palette, a preview and a volume slider. The
   *  slider and preview exist only once a cue is chosen. */
  private buildSound(
    card: HTMLElement,
    id: string,
    isAura: boolean,
    refresh: (keys?: readonly string[]) => void,
  ): void {
    const { hooks } = this.host;
    const current = hooks.getSpell(id);
    this.select(
      card,
      t('hudChrome.cooldownManager.sound'),
      [
        { value: AURA_CUE_NONE, label: t('hudChrome.auraOverlay.soundNone') },
        ...AURA_CUES.map((cue) => ({ value: cue.id, label: t(cue.labelKey) })),
      ],
      current.soundId,
      (soundId) => {
        hooks.patchSpell(id, { soundId });
        if (soundId !== AURA_CUE_NONE) hooks.previewCue(soundId, hooks.getSpell(id).soundVolume);
        refresh(['cdm-sound']);
      },
      'cdm-sound',
    );
    this.note(
      card,
      t(isAura ? 'hudChrome.cooldownManager.auraSoundHint' : 'hudChrome.cooldownManager.soundHint'),
    );
    if (current.soundId === AURA_CUE_NONE) return;
    const volume = sliderControl({
      parent: card,
      label: t('hudChrome.auraOverlay.soundVolume'),
      get: () => hooks.getSpell(id).soundVolume,
      set: (soundVolume) => hooks.patchSpell(id, { soundVolume }),
      min: COOLDOWN_VOLUME_MIN,
      max: COOLDOWN_VOLUME_MAX,
      step: 0.05,
      format: percent,
    });
    volume.row.classList.add('aura-sound-volume');
    const cue = AURA_CUES.find((entry) => entry.id === current.soundId);
    const preview = this.button(
      card,
      t('hudChrome.auraOverlay.soundPreview'),
      'aura-sound-preview',
      () => {
        const config = hooks.getSpell(id);
        hooks.previewCue(config.soundId, config.soundVolume);
      },
    );
    preview.setAttribute(
      'aria-label',
      t('hudChrome.auraOverlay.soundPreviewAria', {
        sound: cue ? t(cue.labelKey) : t('hudChrome.auraOverlay.soundNone'),
      }),
    );
  }
}
