// City Build inspector panel: the subtool tab strip (Kit / Walls / Roads /
// Prefabs / Routes), the persistent build-settings bar (grid size, rotation
// snap), and each subtool's controls. Pure DOM consumer over an injected deps
// bag; all state lives in the app (the panel is rebuilt by inspector.refresh).

import { type TranslationKey, t } from '../ui/i18n';
import {
  CITY_GRID_SIZES,
  CITY_ROT_SNAPS,
  type CityBuildSettings,
  WALL_STYLES,
} from './city_build_core';
import { button, checkbox, el, selectRow, slider } from './dom';

export type CitySubtool = 'kit' | 'wall' | 'road' | 'prefab' | 'route';

export interface CityBuildPanelDeps {
  getSubtool(): CitySubtool;
  setSubtool(sub: CitySubtool): void;
  getSettings(): CityBuildSettings;
  setSettings(settings: CityBuildSettings): void;
  // Kit
  kitLabel(): string | null;
  openAssetBrowser(): void;
  // Walls
  getWallStyle(): string;
  setWallStyle(id: string): void;
  getWallScale(): number;
  setWallScale(v: number): void;
  getWallHeight(): number;
  setWallHeight(v: number): void;
  getWallThickness(): number;
  setWallThickness(v: number): void;
  getWallPostEvery(): number;
  setWallPostEvery(v: number): void;
  getWallClosed(): boolean;
  setWallClosed(on: boolean): void;
  getWallWalkTop(): boolean;
  setWallWalkTop(on: boolean): void;
  getWallStairs(): boolean;
  setWallStairs(on: boolean): void;
  // Whether the active style has a stairs asset (fences do not).
  wallHasStairs(): boolean;
  wallPointCount(): number;
  hasActiveWall(): boolean;
  undoWallPoint(): void;
  finishWall(): void;
  cancelWall(): void;
  // Roads
  getRoadKind(): 'road' | 'path';
  setRoadKind(kind: 'road' | 'path'): void;
  roadPointCount(): number;
  finishRoad(): void;
  cancelRoad(): void;
  roadList(): { id: string; label: string; points: number }[];
  deleteRoad(id: string): void;
  // Prefabs
  prefabList(): { name: string; count: number }[];
  savePrefab(name: string): boolean;
  armedPrefab(): string | null;
  armPrefab(name: string | null): void;
  deletePrefab(name: string): void;
  hasSelection(): boolean;
  // Routes
  routeNpcName(): string | null;
  routePointCount(): number;
  getRouteMode(): 'loop' | 'pingpong';
  setRouteMode(mode: 'loop' | 'pingpong'): void;
  getRouteSpeed(): number;
  setRouteSpeed(v: number): void;
  getRouteWait(): number;
  setRouteWait(v: number): void;
  finishRoute(): void;
  clearRoute(): void;
}

function section(title: string): HTMLElement {
  const node = el('section', 'ed-section');
  node.appendChild(el('h2', undefined, title));
  return node;
}

function hint(text: string): HTMLElement {
  return el('p', 'ed-hint', text);
}

const TABS: readonly { sub: CitySubtool; labelKey: TranslationKey }[] = [
  { sub: 'kit', labelKey: 'editor.city.tabKit' },
  { sub: 'wall', labelKey: 'editor.city.tabWalls' },
  { sub: 'road', labelKey: 'editor.city.tabRoads' },
  { sub: 'prefab', labelKey: 'editor.city.tabPrefabs' },
  { sub: 'route', labelKey: 'editor.city.tabRoutes' },
];

export function buildCityBuildPanel(deps: CityBuildPanelDeps, refresh: () => void): HTMLElement {
  const root = section(t('editor.city.title'));

  // Subtool tabs
  const tabs = el('div', 'ed-inspector-tabs');
  tabs.setAttribute('role', 'tablist');
  const active = deps.getSubtool();
  for (const tab of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ed-inspector-tab${tab.sub === active ? ' active' : ''}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', tab.sub === active ? 'true' : 'false');
    b.textContent = t(tab.labelKey);
    b.addEventListener('click', () => {
      deps.setSubtool(tab.sub);
      refresh();
    });
    tabs.appendChild(b);
  }
  root.appendChild(tabs);

  // Build settings bar (shared by kit + prefab stamps)
  const settings = deps.getSettings();
  root.appendChild(el('h3', 'ed-subtitle', t('editor.city.settings')));
  root.appendChild(
    selectRow(
      t('editor.city.gridSize'),
      CITY_GRID_SIZES.map((g) => ({
        value: String(g),
        label: g === 0 ? t('editor.city.gridOff') : String(g),
      })),
      String(settings.gridSize),
      (v) => {
        deps.setSettings({ ...deps.getSettings(), gridSize: Number(v) });
      },
    ).root,
  );
  root.appendChild(
    selectRow(
      t('editor.city.rotSnap'),
      CITY_ROT_SNAPS.map((d) => ({ value: String(d), label: `${d}°` })),
      String(settings.rotSnapDeg),
      (v) => {
        deps.setSettings({ ...deps.getSettings(), rotSnapDeg: Number(v) });
      },
    ).root,
  );
  root.appendChild(hint(t('editor.city.snapHint')));

  switch (active) {
    case 'kit': {
      const label = deps.kitLabel();
      if (label)
        root.appendChild(el('p', 'ed-chosen', t('editor.city.kitChosen', { name: label })));
      else root.appendChild(hint(t('editor.city.kitNone')));
      root.appendChild(button(t('editor.city.kitPick'), () => deps.openAssetBrowser(), 'primary'));
      root.appendChild(
        slider(t('editor.city.kitScale'), {
          min: 0.5,
          max: 10,
          step: 0.1,
          value: settings.kitScale,
          onInput: (v) => {
            deps.setSettings({ ...deps.getSettings(), kitScale: v });
          },
        }).root,
      );
      root.appendChild(
        checkbox(t('editor.city.kitTileSnap'), settings.tileSnap, (on) => {
          deps.setSettings({ ...deps.getSettings(), tileSnap: on });
        }).root,
      );
      root.appendChild(hint(t('editor.city.kitTileHint')));
      break;
    }
    case 'wall': {
      root.appendChild(
        selectRow(
          t('editor.city.wallStyle'),
          WALL_STYLES.map((s) => ({ value: s.id, label: t(s.labelKey as TranslationKey) })),
          deps.getWallStyle(),
          (v) => {
            deps.setWallStyle(v);
            refresh();
          },
        ).root,
      );
      root.appendChild(
        slider(t('editor.city.wallScale'), {
          min: 0.3,
          max: 12,
          step: 0.1,
          value: deps.getWallScale(),
          onInput: (v) => deps.setWallScale(v),
        }).root,
      );
      root.appendChild(
        slider(t('editor.city.wallHeight'), {
          min: 0.25,
          max: 3,
          step: 0.05,
          value: deps.getWallHeight(),
          onInput: (v) => deps.setWallHeight(v),
        }).root,
      );
      root.appendChild(
        slider(t('editor.city.wallThickness'), {
          min: 0.25,
          max: 3,
          step: 0.05,
          value: deps.getWallThickness(),
          onInput: (v) => deps.setWallThickness(v),
        }).root,
      );
      root.appendChild(
        slider(t('editor.city.wallPostEvery'), {
          min: 0,
          max: 8,
          step: 1,
          value: deps.getWallPostEvery(),
          onInput: (v) => deps.setWallPostEvery(Math.round(v)),
          format: (v) => (v === 0 ? t('editor.city.wallPostsOff') : String(Math.round(v))),
        }).root,
      );
      root.appendChild(
        checkbox(t('editor.city.wallClosed'), deps.getWallClosed(), (on) => {
          deps.setWallClosed(on);
          refresh();
        }).root,
      );
      root.appendChild(
        checkbox(t('editor.city.wallWalkTop'), deps.getWallWalkTop(), (on) => {
          deps.setWallWalkTop(on);
          refresh();
        }).root,
      );
      if (deps.wallHasStairs() && deps.getWallWalkTop()) {
        root.appendChild(
          checkbox(t('editor.city.wallStairs'), deps.getWallStairs(), (on) => {
            deps.setWallStairs(on);
          }).root,
        );
      }
      root.appendChild(hint(t('editor.city.wallWalkHint')));
      const n = deps.wallPointCount();
      root.appendChild(hint(t('editor.city.wallDrawing')));
      if (n > 0) root.appendChild(hint(t('editor.city.wallNodes', { n })));
      else if (deps.hasActiveWall()) root.appendChild(hint(t('editor.city.wallLiveEdit')));
      if (n > 0) {
        const row = el('div', 'ed-row');
        const finish = button(
          t('editor.city.wallFinish'),
          () => {
            deps.finishWall();
            refresh();
          },
          'primary small',
        );
        finish.disabled = n < 2;
        row.appendChild(finish);
        row.appendChild(
          button(
            t('editor.city.wallUndoPoint'),
            () => {
              deps.undoWallPoint();
              refresh();
            },
            'small',
          ),
        );
        row.appendChild(
          button(
            t('editor.city.wallCancel'),
            () => {
              deps.cancelWall();
              refresh();
            },
            'small',
          ),
        );
        root.appendChild(row);
      }
      root.appendChild(hint(t('editor.city.wallEditHint')));
      break;
    }
    case 'road': {
      root.appendChild(
        selectRow(
          t('editor.city.roadType'),
          [
            { value: 'road', label: t('editor.city.roadTypeRoad') },
            { value: 'path', label: t('editor.city.roadTypePath') },
          ],
          deps.getRoadKind(),
          (v) => deps.setRoadKind(v === 'path' ? 'path' : 'road'),
        ).root,
      );
      root.appendChild(hint(t('editor.city.roadDrawing')));
      if (deps.roadPointCount() > 0) {
        const row = el('div', 'ed-row');
        row.appendChild(
          button(
            t('editor.city.roadFinish'),
            () => {
              deps.finishRoad();
              refresh();
            },
            'primary small',
          ),
        );
        row.appendChild(
          button(
            t('editor.city.roadCancel'),
            () => {
              deps.cancelRoad();
              refresh();
            },
            'small',
          ),
        );
        root.appendChild(row);
      }
      const roads = deps.roadList();
      if (roads.length > 0) {
        root.appendChild(el('h3', 'ed-subtitle', t('editor.city.roadList')));
        for (const road of roads) {
          const row = el('div', 'ed-row');
          row.appendChild(el('span', 'ed-chosen', road.label));
          row.appendChild(
            button(
              t('editor.city.roadDelete'),
              () => {
                deps.deleteRoad(road.id);
                refresh();
              },
              'small',
            ),
          );
          root.appendChild(row);
        }
      }
      root.appendChild(hint(t('editor.city.roadHint')));
      break;
    }
    case 'prefab': {
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'ed-text-input';
      nameInput.placeholder = t('editor.city.prefabName');
      nameInput.maxLength = 40;
      const saveRow = el('div', 'ed-row');
      saveRow.appendChild(nameInput);
      saveRow.appendChild(
        button(
          t('editor.city.prefabSave'),
          () => {
            const name = nameInput.value.trim();
            if (!name) return;
            if (deps.savePrefab(name)) refresh();
          },
          'primary small',
        ),
      );
      root.appendChild(saveRow);
      if (!deps.hasSelection()) root.appendChild(hint(t('editor.city.prefabNeedSelection')));
      const prefabs = deps.prefabList();
      if (prefabs.length === 0) {
        root.appendChild(hint(t('editor.city.prefabNone')));
      } else {
        const armed = deps.armedPrefab();
        for (const prefab of prefabs) {
          const row = el('div', 'ed-row');
          row.appendChild(
            el(
              'span',
              'ed-chosen',
              `${prefab.name} (${t('editor.city.prefabCount', { n: prefab.count })})`,
            ),
          );
          row.appendChild(
            button(
              t('editor.city.prefabStamp'),
              () => {
                deps.armPrefab(armed === prefab.name ? null : prefab.name);
                refresh();
              },
              armed === prefab.name ? 'primary small' : 'small',
            ),
          );
          row.appendChild(
            button(
              t('editor.city.prefabDelete'),
              () => {
                deps.deletePrefab(prefab.name);
                refresh();
              },
              'small',
            ),
          );
          root.appendChild(row);
        }
      }
      break;
    }
    case 'route': {
      const npcName = deps.routeNpcName();
      if (!npcName) {
        root.appendChild(hint(t('editor.city.routePick')));
        break;
      }
      root.appendChild(el('p', 'ed-chosen', t('editor.city.routeEditing', { name: npcName })));
      root.appendChild(hint(t('editor.city.routeAddHint')));
      root.appendChild(
        el('p', 'ed-hint', t('editor.city.routeCount', { n: deps.routePointCount() })),
      );
      root.appendChild(
        selectRow(
          t('editor.city.routeMode'),
          [
            { value: 'loop', label: t('editor.city.routeModeLoop') },
            { value: 'pingpong', label: t('editor.city.routeModePingPong') },
          ],
          deps.getRouteMode(),
          (v) => deps.setRouteMode(v === 'pingpong' ? 'pingpong' : 'loop'),
        ).root,
      );
      root.appendChild(
        slider(t('editor.city.routeSpeed'), {
          min: 0.5,
          max: 8,
          step: 0.1,
          value: deps.getRouteSpeed(),
          onInput: (v) => deps.setRouteSpeed(v),
        }).root,
      );
      root.appendChild(
        slider(t('editor.city.routeWait'), {
          min: 0,
          max: 60,
          step: 0.5,
          value: deps.getRouteWait(),
          onInput: (v) => deps.setRouteWait(v),
        }).root,
      );
      {
        const row = el('div', 'ed-row');
        row.appendChild(
          button(
            t('editor.city.routeFinish'),
            () => {
              deps.finishRoute();
              refresh();
            },
            'primary small',
          ),
        );
        row.appendChild(
          button(
            t('editor.city.routeClear'),
            () => {
              deps.clearRoute();
              refresh();
            },
            'small',
          ),
        );
        root.appendChild(row);
      }
      break;
    }
  }
  return root;
}
