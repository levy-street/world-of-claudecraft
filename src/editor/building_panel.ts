// Building inspector: a snapshot of controller-owned state with injected actions.
import {
  MAX_BUILDING_FLOOR_HEIGHT,
  MAX_BUILDING_LEVELS,
  MAX_BUILDING_Y,
  MAX_BUILDINGS,
  MIN_BUILDING_FLOOR_HEIGHT,
} from '../sim/building';
import { FOCUS_KEY_ATTR, stampFocusKey } from '../ui/focus_restore';
import { formatNumber, type TranslationKey, t } from '../ui/i18n';
import { button, checkbox, el, selectRow } from './dom';
import './building_panel.css';

export interface BuildingPanelState {
  mode: 'wall' | 'room' | 'floor' | 'object' | 'finish';
  buildings: { id: string }[];
  activeBuildingId: string | null;
  level: number;
  levels: number;
  floorHeight: number;
  baseY: number | null;
  foundationLocked: boolean;
  gridSize: number;
  hideAbove: boolean;
  diagonal: boolean;
  wallSource: 'bare' | 'asset';
  assetLabel: string | null;
  thickness: number;
  finishTexture: string;
  finishTile: number;
  finishSide: 'front' | 'back' | 'both' | 'clicked';
  finishRun: boolean;
  importing: boolean;
  textureOptions: { value: string; label: string; thumbnail?: string }[];
  /** Already-localized controller feedback. */
  status: string | null;
}

export interface BuildingPanelDeps {
  getState(): BuildingPanelState;
  setMode(mode: BuildingPanelState['mode']): void;
  selectBuilding(id: string): void;
  newBuilding(): void;
  selectLevel(level: number): void;
  addLevel(): void;
  setFloorHeight(value: number): void;
  setBaseY(value: number): void;
  setGridSize(value: number): void;
  setHideAbove(on: boolean): void;
  setDiagonal(on: boolean): void;
  setWallSource(source: BuildingPanelState['wallSource']): void;
  setThickness(value: number): void;
  pickAsset(): void;
  selectExisting(): void;
  setFinishTexture(value: string): void;
  setFinishTile(value: number): void;
  setFinishSide(side: BuildingPanelState['finishSide']): void;
  setFinishRun(on: boolean): void;
  importTexture(): void;
}

const MODES: readonly [BuildingPanelState['mode'], TranslationKey][] = [
  ['wall', 'editor.buildMode.modeWall'],
  ['room', 'editor.buildMode.modeRoom'],
  ['floor', 'editor.buildMode.modeFloor'],
  ['object', 'editor.buildMode.modeObject'],
  ['finish', 'editor.buildMode.modeFinish'],
];

function keyed<T extends HTMLElement>(node: T, key: string): T {
  node.setAttribute(FOCUS_KEY_ATTR, `building:${key}`);
  return node;
}

function keyedField(root: HTMLElement, key: string): HTMLElement {
  stampFocusKey(root, 'input, select', `building:field:${key}`);
  return root;
}

function numberField(
  key: string,
  label: string,
  value: number | null,
  min: number,
  max: number,
  step: number,
  onChange: (value: number) => void,
  disabled = false,
  placeholder?: string,
): HTMLElement {
  const root = el('label', 'ed-building-field');
  root.append(el('span', undefined, label));
  const input = keyed(el('input'), `field:${key}`);
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = value === null ? '' : String(value);
  input.disabled = disabled;
  input.setAttribute('aria-label', label);
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener('change', () => {
    const next = input.valueAsNumber;
    if (!input.disabled && Number.isFinite(next) && next >= min && next <= max) {
      onChange(next);
    } else {
      input.value = value === null ? '' : String(value);
    }
  });
  root.append(input);
  return root;
}

function assetPicker(state: BuildingPanelState, deps: BuildingPanelDeps): HTMLElement {
  const root = el('div', 'ed-building-section');
  root.append(
    el(
      'p',
      'ed-building-hint',
      state.assetLabel
        ? t('editor.buildMode.selectedAsset', { name: state.assetLabel })
        : t('editor.buildMode.noAsset'),
    ),
    keyed(
      button(t('editor.buildMode.pickAsset'), () => deps.pickAsset()),
      'action:pickAsset',
    ),
  );
  return root;
}

function foundationSettings(state: BuildingPanelState, deps: BuildingPanelDeps): HTMLElement {
  const root = el('details', 'ed-building-settings');
  root.append(keyed(el('summary', undefined, t('editor.buildMode.settings')), 'settings'));
  const body = el('div', 'ed-building-section');
  const gridSizes = [0.25, 0.5, 1, 2, 4];
  body.append(
    keyedField(
      selectRow(
        t('editor.buildMode.gridSize'),
        gridSizes.map((size) => ({
          value: String(size),
          label: t('editor.buildMode.gridCell', { size: formatNumber(size) }),
        })),
        String(state.gridSize),
        (value) => deps.setGridSize(Number(value)),
      ).root,
      'gridSize',
    ),
    numberField(
      'floorHeight',
      t('editor.buildMode.floorHeight'),
      state.floorHeight,
      MIN_BUILDING_FLOOR_HEIGHT,
      MAX_BUILDING_FLOOR_HEIGHT,
      0.1,
      (value) => {
        if (!deps.getState().foundationLocked) deps.setFloorHeight(value);
      },
      state.foundationLocked,
    ),
    numberField(
      'baseY',
      t('editor.buildMode.baseY'),
      state.baseY,
      -MAX_BUILDING_Y,
      MAX_BUILDING_Y - state.levels * state.floorHeight,
      0.1,
      (value) => {
        if (!deps.getState().foundationLocked) deps.setBaseY(value);
      },
      state.foundationLocked,
      t('editor.buildMode.autoBase'),
    ),
  );
  if (state.foundationLocked) {
    body.append(el('p', 'ed-building-hint', t('editor.buildMode.foundationLocked')));
  }
  root.append(body);
  return root;
}

function finishControls(state: BuildingPanelState, deps: BuildingPanelDeps): HTMLElement {
  const root = el('div', 'ed-building-section');
  const options = [
    { value: '', label: t('editor.buildMode.bareFinish') },
    ...state.textureOptions.filter((option) => option.value !== ''),
  ];
  const selected = state.textureOptions.find((option) => option.value === state.finishTexture);
  if (selected?.thumbnail) {
    const image = el('img', 'ed-building-texture-preview');
    image.src = selected.thumbnail;
    image.alt = selected.label;
    image.width = 96;
    image.height = 96;
    image.loading = 'lazy';
    image.decoding = 'async';
    root.append(image);
  }
  root.append(
    keyedField(
      selectRow(t('editor.buildMode.finishTexture'), options, state.finishTexture, (value) =>
        deps.setFinishTexture(value),
      ).root,
      'finishTexture',
    ),
  );
  const importButton = button(
    state.importing ? t('editor.buildMode.importingTexture') : t('editor.buildMode.importTexture'),
    () => {
      if (!deps.getState().importing) deps.importTexture();
    },
  );
  importButton.disabled = state.importing;
  keyed(importButton, 'action:importTexture');
  root.append(
    importButton,
    numberField(
      'finishTile',
      t('editor.buildMode.finishTile'),
      state.finishTile,
      0.5,
      64,
      0.5,
      (value) => deps.setFinishTile(value),
    ),
    keyedField(
      selectRow(
        t('editor.buildMode.finishSide'),
        [
          { value: 'clicked', label: t('editor.buildMode.sideClicked') },
          { value: 'front', label: t('editor.buildMode.sideFront') },
          { value: 'back', label: t('editor.buildMode.sideBack') },
          { value: 'both', label: t('editor.buildMode.sideBoth') },
        ],
        state.finishSide,
        (value) => {
          if (value === 'clicked' || value === 'front' || value === 'back' || value === 'both') {
            deps.setFinishSide(value);
          }
        },
      ).root,
      'finishSide',
    ),
    keyedField(
      checkbox(t('editor.buildMode.finishRun'), state.finishRun, (on) => deps.setFinishRun(on))
        .root,
      'finishRun',
    ),
    el('p', 'ed-building-hint', t('editor.buildMode.finishHint')),
  );
  return root;
}

export function buildBuildModePanel(deps: BuildingPanelDeps): HTMLElement {
  const state = deps.getState();
  const root = el('section', 'ed-building-panel');
  root.setAttribute('aria-label', t('editor.buildMode.title'));
  root.append(el('h2', undefined, t('editor.buildMode.title')));
  const modes = el('div', 'ed-building-modes');
  for (const [mode, key] of MODES) {
    const control = button(t(key), () => deps.setMode(mode), mode === state.mode ? 'active' : '');
    keyed(control, `mode:${mode}`);
    control.setAttribute('aria-pressed', String(mode === state.mode));
    modes.append(control);
  }
  root.append(modes);
  if (state.mode === 'wall') {
    root.append(
      keyedField(
        checkbox(t('editor.buildMode.diagonal'), state.diagonal, (on) => deps.setDiagonal(on)).root,
        'diagonal',
      ),
    );
  }

  const buildingOptions = state.buildings.map((building, index) => ({
    value: building.id,
    label: t('editor.buildMode.buildingNumber', { number: formatNumber(index + 1) }),
  }));
  if (!state.activeBuildingId) {
    buildingOptions.unshift({ value: '', label: t('editor.buildMode.noBuilding') });
  }
  const building = selectRow(
    t('editor.buildMode.building'),
    buildingOptions,
    state.activeBuildingId ?? '',
    (id) => {
      if (id) deps.selectBuilding(id);
    },
  );
  building.input.disabled = state.buildings.length === 0;
  keyed(building.input, 'field:building');
  const newBuilding = button(t('editor.buildMode.newBuilding'), () => {
    if (deps.getState().buildings.length < MAX_BUILDINGS) deps.newBuilding();
  });
  newBuilding.disabled = state.buildings.length >= MAX_BUILDINGS;
  keyed(newBuilding, 'action:newBuilding');
  root.append(building.root, newBuilding);

  const floors = el('div', 'ed-building-section');
  floors.append(el('h3', undefined, t('editor.buildMode.levels')));
  const levelButtons = el('div', 'ed-building-levels');
  for (let level = 0; level < Math.min(MAX_BUILDING_LEVELS, state.levels); level++) {
    const label =
      level === 0
        ? t('editor.buildMode.groundFloor')
        : t('editor.buildMode.floorNumber', { number: formatNumber(level) });
    const control = button(
      label,
      () => deps.selectLevel(level),
      level === state.level ? 'active' : '',
    );
    control.setAttribute('aria-pressed', String(level === state.level));
    keyed(control, `level:${level}`);
    levelButtons.append(control);
  }
  const addLevel = button(t('editor.buildMode.addLevel'), () => {
    if (deps.getState().levels < MAX_BUILDING_LEVELS) deps.addLevel();
  });
  addLevel.disabled = state.levels >= MAX_BUILDING_LEVELS;
  keyed(addLevel, 'action:addLevel');
  floors.append(
    levelButtons,
    addLevel,
    keyedField(
      checkbox(t('editor.buildMode.hideAbove'), state.hideAbove, (on) => deps.setHideAbove(on))
        .root,
      'hideAbove',
    ),
  );
  root.append(floors, foundationSettings(state, deps));

  if (state.mode === 'wall' || state.mode === 'room') {
    const walls = el('div', 'ed-building-section');
    walls.append(el('h3', undefined, t('editor.buildMode.wallSource')));
    const source = el('div', 'ed-building-source');
    for (const [value, key] of [
      ['bare', 'editor.buildMode.bareWall'],
      ['asset', 'editor.buildMode.chosenAsset'],
    ] as const) {
      const control = button(
        t(key),
        () => deps.setWallSource(value),
        value === state.wallSource ? 'active' : '',
      );
      control.setAttribute('aria-pressed', String(value === state.wallSource));
      keyed(control, `source:${value}`);
      source.append(control);
    }
    walls.append(source);
    if (state.wallSource === 'asset') walls.append(assetPicker(state, deps));
    else {
      walls.append(
        numberField(
          'thickness',
          t('editor.buildMode.thickness'),
          state.thickness,
          0.1,
          3,
          0.1,
          (value) => deps.setThickness(value),
        ),
      );
    }
    walls.append(
      el(
        'p',
        'ed-building-hint',
        state.mode === 'room'
          ? t('editor.buildMode.roomHint')
          : state.diagonal
            ? t('editor.buildMode.diagonalHint')
            : t('editor.buildMode.wallHint'),
      ),
    );
    root.append(walls);
  } else if (state.mode === 'floor') {
    root.append(el('p', 'ed-building-hint', t('editor.buildMode.floorHint')));
  } else if (state.mode === 'object') {
    root.append(
      assetPicker(state, deps),
      keyed(
        button(t('editor.buildMode.selectExisting'), () => deps.selectExisting()),
        'action:selectExisting',
      ),
      el('p', 'ed-building-hint', t('editor.buildMode.objectHint')),
    );
  } else {
    root.append(finishControls(state, deps));
  }
  if (state.status) {
    const status = el('p', 'ed-building-status', state.status);
    status.setAttribute('role', 'status');
    root.append(status);
  }
  return root;
}
