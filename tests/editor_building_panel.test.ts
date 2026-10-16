// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BuildingPanelDeps,
  type BuildingPanelState,
  buildBuildModePanel,
} from '../src/editor/building_panel';
import {
  captureFocusKey,
  FOCUS_KEY_ATTR,
  findFocusKey,
  restoreFirstEnabled,
} from '../src/ui/focus_restore';
import { type TranslationKey, t } from '../src/ui/i18n';

function harness(overrides: Partial<BuildingPanelState> = {}) {
  const state: BuildingPanelState = {
    mode: 'wall',
    buildings: [{ id: 'castle' }],
    activeBuildingId: 'castle',
    level: 0,
    levels: 2,
    floorHeight: 4,
    baseY: null,
    foundationLocked: false,
    gridSize: 1,
    hideAbove: true,
    diagonal: false,
    wallSource: 'bare',
    assetLabel: null,
    thickness: 0.3,
    finishTexture: '',
    finishTile: 2,
    finishSide: 'clicked',
    finishRun: false,
    importing: false,
    textureOptions: [],
    status: null,
    ...overrides,
  };
  const deps = {
    getState: () => state,
    setMode: vi.fn(),
    selectBuilding: vi.fn(),
    newBuilding: vi.fn(),
    selectLevel: vi.fn(),
    addLevel: vi.fn(),
    setFloorHeight: vi.fn(),
    setBaseY: vi.fn(),
    setGridSize: vi.fn(),
    setHideAbove: vi.fn(),
    setDiagonal: vi.fn(),
    setWallSource: vi.fn(),
    setThickness: vi.fn(),
    pickAsset: vi.fn(),
    selectExisting: vi.fn(),
    setFinishTexture: vi.fn(),
    setFinishTile: vi.fn(),
    setFinishSide: vi.fn(),
    setFinishRun: vi.fn(),
    importTexture: vi.fn(),
  } satisfies BuildingPanelDeps;
  const root = buildBuildModePanel(deps);
  document.body.append(root);
  const control = (key: TranslationKey) => {
    const found = [...root.querySelectorAll('button')].find(
      (entry) => entry.textContent === t(key),
    );
    if (!found) throw new Error(`Missing control: ${key}`);
    return found;
  };
  const field = (key: TranslationKey) => {
    const found = [
      ...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'),
    ].find(
      (entry) =>
        entry.getAttribute('aria-label') === t(key) ||
        entry.closest('label')?.textContent?.trim() === t(key),
    );
    if (!found) throw new Error(`Missing field: ${key}`);
    return found;
  };
  const change = (key: TranslationKey, value: string) => {
    const target = field(key);
    target.value = value;
    target.dispatchEvent(new Event('change'));
    return target;
  };
  return { state, deps, root, control, field, change };
}

beforeEach(() => document.body.replaceChildren());

describe('building panel modes and floors', () => {
  it.each(['wall', 'room', 'floor', 'object', 'finish'] as const)(
    'gives every %s control a distinct stable focus identity',
    (mode) => {
      const h = harness({ mode });
      const controls = [...h.root.querySelectorAll('button, input, select, summary')];
      const keys = controls.map((control) => control.getAttribute(FOCUS_KEY_ATTR));
      expect(keys.every((key) => key?.startsWith('building:'))).toBe(true);
      expect(new Set(keys).size).toBe(controls.length);
    },
  );

  it.each([
    ['building:mode:room', { mode: 'room' }],
    ['building:level:1', { level: 1 }],
    ['building:source:asset', { wallSource: 'asset' }],
    ['building:field:gridSize', { gridSize: 0.5 }],
    ['building:field:diagonal', { diagonal: true }],
  ] satisfies [string, Partial<BuildingPanelState>][])(
    'restores %s after a panel rebuild',
    (key, changes) => {
      const h = harness();
      const details = h.root.querySelector('details');
      if (details) details.open = true;
      const previous = findFocusKey(h.root, key);
      expect(previous).not.toBeNull();
      previous?.focus();
      const captured = captureFocusKey(h.root);
      expect(captured).toBe(key);
      if (captured === null) throw new Error('Focused building control has no identity');
      Object.assign(h.state, changes);
      const rebuilt = buildBuildModePanel(h.deps);
      const newDetails = rebuilt.querySelector('details');
      if (newDetails) newDetails.open = true;
      h.root.replaceWith(rebuilt);
      restoreFirstEnabled([findFocusKey(rebuilt, captured)]);
      expect(document.activeElement).not.toBe(previous);
      expect(captureFocusKey(rebuilt)).toBe(key);
    },
  );

  it('lets the caller fall back when a focused add-floor button becomes disabled', () => {
    const h = harness({ levels: 15 });
    h.control('editor.buildMode.addLevel').focus();
    const captured = captureFocusKey(h.root);
    if (captured === null) throw new Error('Focused floor control has no identity');
    h.state.levels = 16;
    const rebuilt = buildBuildModePanel(h.deps);
    h.root.replaceWith(rebuilt);
    restoreFirstEnabled([
      findFocusKey(rebuilt, captured),
      findFocusKey(rebuilt, 'building:mode:wall'),
      findFocusKey(rebuilt, 'building:action:newBuilding'),
    ]);
    expect(captureFocusKey(rebuilt)).toBe('building:mode:wall');
  });

  it('exposes every build mode and announces the active one', () => {
    const h = harness({ mode: 'room' });
    for (const [key, mode] of [
      ['editor.buildMode.modeWall', 'wall'],
      ['editor.buildMode.modeRoom', 'room'],
      ['editor.buildMode.modeFloor', 'floor'],
      ['editor.buildMode.modeObject', 'object'],
      ['editor.buildMode.modeFinish', 'finish'],
    ] as const) {
      const control = h.control(key);
      expect(control.getAttribute('aria-pressed')).toBe(String(mode === 'room'));
      control.click();
      expect(h.deps.setMode).toHaveBeenLastCalledWith(mode);
    }
    expect(h.root.textContent).toContain(t('editor.buildMode.roomHint'));
  });

  it('switches buildings and zero-based levels and exposes cutaway without opening settings', () => {
    const h = harness({ buildings: [{ id: 'castle' }, { id: 'tower' }], level: 1 });
    h.change('editor.buildMode.building', 'tower');
    expect(h.deps.selectBuilding).toHaveBeenCalledWith('tower');
    const levels = h.root.querySelectorAll<HTMLButtonElement>('.ed-building-levels button');
    expect(levels).toHaveLength(2);
    expect(levels[1].getAttribute('aria-pressed')).toBe('true');
    levels[0].click();
    expect(h.deps.selectLevel).toHaveBeenCalledWith(0);
    h.control('editor.buildMode.addLevel').click();
    expect(h.deps.addLevel).toHaveBeenCalledOnce();
    h.control('editor.buildMode.newBuilding').click();
    expect(h.deps.newBuilding).toHaveBeenCalledOnce();
    (h.field('editor.buildMode.hideAbove') as HTMLInputElement).click();
    expect(h.deps.setHideAbove).toHaveBeenCalledWith(false);
    expect(h.root.querySelector('details')?.open).toBe(false);
  });

  it('disables adding floors at the shared level limit', () => {
    const h = harness({ levels: 16 });
    expect(h.root.querySelectorAll('.ed-building-levels button')).toHaveLength(16);
    expect(h.control('editor.buildMode.addLevel').disabled).toBe(true);
    h.control('editor.buildMode.addLevel').click();
    expect(h.deps.addLevel).not.toHaveBeenCalled();
  });

  it('locks foundation height controls after the first placement while retaining grid control', () => {
    const h = harness({ foundationLocked: true, baseY: 36 });
    expect(h.field('editor.buildMode.baseY').disabled).toBe(true);
    expect(h.field('editor.buildMode.floorHeight').disabled).toBe(true);
    h.change('editor.buildMode.baseY', '40');
    h.change('editor.buildMode.floorHeight', '8');
    expect(h.deps.setBaseY).not.toHaveBeenCalled();
    expect(h.deps.setFloorHeight).not.toHaveBeenCalled();
    h.change('editor.buildMode.gridSize', '0.5');
    expect(h.deps.setGridSize).toHaveBeenCalledWith(0.5);
  });

  it('accepts explicit foundation settings and rejects empty or out-of-range heights', () => {
    const h = harness();
    expect(h.field('editor.buildMode.baseY').value).toBe('');
    h.change('editor.buildMode.baseY', '36');
    h.change('editor.buildMode.floorHeight', '6');
    expect(h.deps.setBaseY).toHaveBeenCalledWith(36);
    expect(h.deps.setFloorHeight).toHaveBeenCalledWith(6);
    h.change('editor.buildMode.floorHeight', '99');
    h.change('editor.buildMode.baseY', '');
    expect(h.deps.setFloorHeight).toHaveBeenCalledOnce();
    expect(h.deps.setBaseY).toHaveBeenCalledOnce();
  });
});

describe('building panel assets and finishes', () => {
  it.each(['bare', 'asset'] as const)(
    'offers diagonal drawing for %s walls with a labelled checkbox',
    (wallSource) => {
      const h = harness({ wallSource });
      const toggle = h.field('editor.buildMode.diagonal') as HTMLInputElement;
      expect(toggle.type).toBe('checkbox');
      expect(toggle.checked).toBe(false);
      expect(toggle.closest('details')).toBeNull();
      toggle.click();
      expect(h.deps.setDiagonal).toHaveBeenCalledWith(true);
      const enabled = harness({ wallSource, diagonal: true });
      expect((enabled.field('editor.buildMode.diagonal') as HTMLInputElement).checked).toBe(true);
      expect(enabled.root.textContent).toContain(t('editor.buildMode.diagonalHint'));
      (enabled.field('editor.buildMode.diagonal') as HTMLInputElement).click();
      expect(enabled.deps.setDiagonal).toHaveBeenCalledWith(false);
    },
  );

  it.each(['room', 'floor', 'object', 'finish'] as const)(
    'keeps diagonal drawing out of %s mode',
    (mode) => {
      const h = harness({ mode, diagonal: true });
      expect(h.root.textContent).not.toContain(t('editor.buildMode.diagonal'));
      expect(h.root.textContent).not.toContain(t('editor.buildMode.diagonalHint'));
    },
  );

  it('offers wall source choice and only shows thickness for bare walls', () => {
    const bare = harness();
    bare.control('editor.buildMode.chosenAsset').click();
    expect(bare.deps.setWallSource).toHaveBeenCalledWith('asset');
    bare.change('editor.buildMode.thickness', '0.7');
    expect(bare.deps.setThickness).toHaveBeenCalledWith(0.7);
    const asset = harness({ wallSource: 'asset', assetLabel: 'CastleWall 01' });
    asset.control('editor.buildMode.pickAsset').click();
    expect(asset.deps.pickAsset).toHaveBeenCalledOnce();
    expect(asset.root.textContent).toContain('CastleWall 01');
    expect(asset.root.textContent).not.toContain(t('editor.buildMode.thickness'));
  });

  it('provides object selection and floor drawing guidance in their respective modes', () => {
    const object = harness({ mode: 'object' });
    object.control('editor.buildMode.selectExisting').click();
    expect(object.deps.selectExisting).toHaveBeenCalledOnce();
    const floor = harness({ mode: 'floor' });
    expect(floor.root.textContent).toContain(t('editor.buildMode.floorHint'));
    expect(floor.root.textContent).not.toContain(t('editor.buildMode.wallSource'));
  });

  it('loads just the selected thumbnail and routes finish, side, repeat, and connected-run changes', () => {
    const h = harness({
      mode: 'finish',
      finishTexture: 'stone1',
      textureOptions: Array.from({ length: 200 }, (_, index) => ({
        value: `stone${index}`,
        label: `Stone ${index}`,
        thumbnail: `/textures/stone${index}.webp`,
      })),
    });
    expect(h.root.querySelectorAll('img')).toHaveLength(1);
    expect(h.root.querySelector('img')?.getAttribute('src')).toBe('/textures/stone1.webp');
    h.change('editor.buildMode.finishTexture', 'stone2');
    expect(h.deps.setFinishTexture).toHaveBeenCalledWith('stone2');
    h.change('editor.buildMode.finishTexture', '');
    expect(h.deps.setFinishTexture).toHaveBeenLastCalledWith('');
    h.change('editor.buildMode.finishSide', 'both');
    expect(h.deps.setFinishSide).toHaveBeenCalledWith('both');
    h.change('editor.buildMode.finishTile', '4');
    expect(h.deps.setFinishTile).toHaveBeenCalledWith(4);
    const checks = h.root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    checks[checks.length - 1].click();
    expect(h.deps.setFinishRun).toHaveBeenCalledWith(true);
    h.control('editor.buildMode.importTexture').click();
    expect(h.deps.importTexture).toHaveBeenCalledOnce();
  });

  it('prevents concurrent imports and renders controller feedback as status text', () => {
    const h = harness({ mode: 'finish', importing: true, status: 'Texture imported' });
    expect(h.control('editor.buildMode.importingTexture').disabled).toBe(true);
    h.control('editor.buildMode.importingTexture').click();
    expect(h.deps.importTexture).not.toHaveBeenCalled();
    expect(h.root.querySelector('[role="status"]')?.textContent).toBe('Texture imported');
  });
});
