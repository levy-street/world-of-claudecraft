// Building authoring owns transient gestures here. Committed geometry remains
// ordinary map placements, and every gesture records one shared undo command.
import { groundTextureUrl } from '../render/assets/ground_textures';
import { assetUrl } from '../render/assets/media';
import { modelMaterialOptions } from '../render/model_materials';
import { type BuildingDef, MAX_BUILDING_LEVELS, MAX_BUILDINGS } from '../sim/building';
import { MAX_PLACEMENTS } from '../sim/map_doc';
import { cloneWallFinishes, type WallFinish, wallFinishTextureRefs } from '../sim/wall_finishes';
import { formatNumber, type TranslationKey, t } from '../ui/i18n';
import type { Editor3DViewport } from './3d/viewport';
import { assetById } from './asset_catalog.generated';
import type { BuildTransformState } from './build_transform_core';
import {
  type BuildingDragPlan,
  type BuildingPoint,
  type BuildingWallAsset,
  filterExistingBuildingWalls,
  levelY,
  planBuildingDrag,
} from './building_core';
import type { BuildingPanelDeps, BuildingPanelState } from './building_panel';
import { nextCityId, snapPoint } from './city_build_core';
import { applyDefaultCollision } from './collision_defaults';
import type { AssetPlacement, CustomMap } from './custom_map';
import { localAssetUrl } from './local_assets';
import type { EditorCommand } from './undo_core';
import { userAssetPath } from './user_assets';
import { importWallTexture } from './wall_texture_import';

// Raise the shared foundation so walls, floors, grid and collision stay aligned above terrain.
const FOUNDATION_CLEARANCE = 0.05;

export interface BuildingWorkspaceDeps {
  map(): CustomMap;
  viewport(): Editor3DViewport | null;
  terrain(point: BuildingPoint): number;
  execute(command: EditorCommand): void;
  changed(): void;
  refresh(): void;
  arm(): void;
  selectExisting(): void;
  openAssets(): void;
  clearSelection(): void;
  error(message: string): void;
}

export class BuildingWorkspace {
  active = false;
  mode: BuildingPanelState['mode'] = 'wall';
  transform: BuildTransformState = { rotY: 0, scale: 3 };
  private id: string | null = null;
  private level = 0;
  private draftBase: number | null = null;
  private floorHeight = 6.6;
  private draftLevels = 1;
  private gridSize = 1;
  private hideAbove = true;
  private diagonal = false;
  private thickness = 0.3;
  private wallSource: 'bare' | 'asset' = 'bare';
  private assetId: string | null = null;
  private assetLabel: string | null = null;
  private footprints = new Map<string, BuildingWallAsset['footprint']>();
  private start: BuildingPoint | null = null;
  private hoverPoint: BuildingPoint | null = null;
  private plan: BuildingDragPlan | null = null;
  private finishTexture = '';
  private finishTile = 3;
  private finishSide: BuildingPanelState['finishSide'] = 'clicked';
  private finishRun = false;
  private importing = false;
  private imports = new Map<string, string>();
  private importGeneration = 0;

  constructor(private readonly deps: BuildingWorkspaceDeps) {
    this.id = deps.map().buildings?.[0]?.id ?? null;
  }

  private get saved(): BuildingDef | undefined {
    return this.deps.map().buildings?.find((b) => b.id === this.id);
  }

  private get building(): BuildingDef {
    return (
      this.saved ?? {
        id:
          this.id ??
          nextCityId(
            'building',
            (this.deps.map().buildings ?? []).map((b) => b.id),
          ),
        baseY: this.draftBase ?? 0,
        floorHeight: this.floorHeight,
        levels: this.draftLevels,
      }
    );
  }

  private get hasBase(): boolean {
    return this.saved !== undefined || this.draftBase !== null;
  }

  reset(): void {
    this.cancel();
    this.importGeneration++;
    this.importing = false;
    this.imports.clear();
    this.id = this.deps.map().buildings?.[0]?.id ?? null;
    this.level = 0;
    this.draftBase = null;
    this.draftLevels = 1;
    this.syncView();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.cancel();
    this.syncView();
  }

  cancel(): void {
    this.start = null;
    this.plan = null;
    this.deps.viewport()?.setBuildingPreview([]);
  }

  syncView(): void {
    const v = this.deps.viewport();
    if (!v) return;
    const b = this.building;
    this.level = Math.min(this.level, b.levels - 1);
    v.setBuildingPlane(
      this.active && this.mode !== 'finish' && this.hasBase ? levelY(b, this.level) : null,
    );
    v.setBuildingFloorFilter(this.active ? this.id : null, this.level, this.hideAbove);
    if (!this.active) {
      v.setBuildingPreview([]);
      v.setCityGridOverlay(null, 0);
      v.setCityGhostAsset(null);
      return;
    }
    const p = this.hoverPoint ?? v.cameraFocus();
    v.setCityGridOverlay(
      p,
      this.gridSize,
      this.hasBase ? levelY(b, this.level) : this.deps.terrain(p) + FOUNDATION_CLEARANCE,
    );
  }

  private refresh(): void {
    this.syncView();
    this.deps.refresh();
  }

  async pickAsset(assetId: string, label: string): Promise<void> {
    this.assetId = assetId;
    this.assetLabel = label;
    this.deps.clearSelection();
    if (this.mode === 'wall' || this.mode === 'room') this.wallSource = 'asset';
    else this.mode = 'object';
    this.cancel();
    this.refresh();
    const path = localAssetUrl(assetId) ?? userAssetPath(assetId) ?? assetById(assetId)?.path;
    const fp = path ? await this.deps.viewport()?.cityAssetFootprint(path) : null;
    if (fp?.sizeY) this.footprints.set(assetId, { ...fp, sizeY: fp.sizeY });
    if (this.assetId === assetId && this.active) {
      this.refresh();
      if (this.hoverPoint) this.hover(this.hoverPoint);
    }
  }

  setTransform(transform: BuildTransformState): void {
    this.transform = transform;
    if (this.hoverPoint) this.hover(this.hoverPoint);
  }

  private wallAsset(): BuildingWallAsset | undefined {
    if (this.wallSource !== 'asset' || !this.assetId) return undefined;
    const footprint = this.footprints.get(this.assetId);
    return footprint
      ? { assetId: this.assetId, footprint, scale: this.transform.scale, rotY: this.transform.rotY }
      : undefined;
  }

  begin(point: BuildingPoint, pointer?: { clientX: number; clientY: number }): void {
    if (this.mode === 'finish') {
      if (pointer) this.paint(pointer.clientX, pointer.clientY);
      return;
    }
    if (!this.hasBase) this.draftBase = this.deps.terrain(point) + FOUNDATION_CLEARANCE;
    this.syncView();
    if (this.mode === 'object') {
      this.placeObject(point);
      return;
    }
    if (this.mode !== 'floor' && this.wallSource === 'asset' && !this.wallAsset()) {
      this.deps.error(t('editor.buildMode.chooseWall'));
      return;
    }
    this.start = { ...point };
    this.hover(point);
  }

  hover(point: BuildingPoint): void {
    this.hoverPoint = point;
    this.syncView();
    const v = this.deps.viewport();
    if (this.mode === 'object' && this.assetId) {
      const p = snapPoint(point, this.gridSize);
      v?.setCityGhostAsset(
        localAssetUrl(this.assetId) ??
          userAssetPath(this.assetId) ??
          assetById(this.assetId)?.path ??
          null,
      );
      v?.updateCityGhost(
        p.x,
        p.z,
        this.transform.rotY,
        this.transform.scale,
        false,
        this.hasBase
          ? levelY(this.building, this.level)
          : this.deps.terrain(p) + FOUNDATION_CLEARANCE,
      );
    } else v?.setCityGhostAsset(null);
    if (!this.start || this.mode === 'finish' || this.mode === 'object') return;
    this.plan = planBuildingDrag({
      mode: this.mode,
      start: this.start,
      end: point,
      building: this.building,
      level: this.level,
      gridSize: this.gridSize,
      diagonal: this.diagonal,
      thickness: this.thickness,
      wall: this.mode === 'floor' ? undefined : this.wallAsset(),
      existingPlacementCount: this.deps.map().placements.length,
    });
    v?.setBuildingPreview(this.plan.placements, (id) => this.footprints.get(id) ?? null);
  }

  end(point?: BuildingPoint): void {
    if (!this.start) return;
    if (point) this.hover(point);
    const plan = this.plan;
    this.cancel();
    if (!plan || plan.error === 'empty') return;
    if (plan.error) {
      this.deps.error(
        t(plan.error === 'capacity' ? 'editor.buildMode.capacity' : 'editor.buildMode.invalid'),
      );
      return;
    }
    const placements = filterExistingBuildingWalls(plan.placements, this.deps.map().placements);
    if (placements.length > 0) this.commitPlacements(placements);
  }

  private commitPlacements(placements: AssetPlacement[]): void {
    const map = this.deps.map();
    const building = { ...this.building };
    if (
      map.placements.length + placements.length > MAX_PLACEMENTS ||
      (!this.saved && (map.buildings?.length ?? 0) >= MAX_BUILDINGS)
    ) {
      this.deps.error(t('editor.buildMode.capacity'));
      return;
    }
    const runId = nextCityId(
      'building_run',
      map.placements.map((p) => p.cityId ?? ''),
    );
    for (const p of placements) {
      p.cityId = runId;
      if (p.collide && p.collisionMode === undefined) applyDefaultCollision(p);
    }
    const before = map.buildings?.map((b) => ({ ...b }));
    const after = this.saved ? before : [...(before ?? []), building];
    this.id = building.id;
    this.deps.execute({
      label: 'building-gesture',
      redo: () => {
        map.buildings = after?.map((b) => ({ ...b }));
        map.placements.push(...placements);
        this.deps.changed();
      },
      undo: () => {
        const remove = new Set(placements);
        for (let i = map.placements.length - 1; i >= 0; i--)
          if (remove.has(map.placements[i])) map.placements.splice(i, 1);
        map.buildings = before?.map((b) => ({ ...b }));
        this.deps.changed();
      },
    });
    this.refresh();
  }

  private placeObject(point: BuildingPoint): void {
    if (!this.assetId) {
      this.deps.error(t('editor.buildMode.chooseAsset'));
      return;
    }
    const p = snapPoint(point, this.gridSize);
    this.commitPlacements([
      {
        ...p,
        assetId: this.assetId,
        ...this.transform,
        collide: true,
        detached: true,
        groundY: levelY(this.building, this.level),
        building: { id: this.building.id, level: this.level, kind: 'object' },
      },
    ]);
  }

  private paint(clientX: number, clientY: number): void {
    const hit = this.deps.viewport()?.pickBuildingSurface(clientX, clientY);
    const map = this.deps.map();
    const p = hit ? map.placements[hit.index] : undefined;
    if (!hit || !p || (p.building?.kind !== 'wall' && !/wall/i.test(p.assetId))) {
      this.deps.error(t('editor.buildMode.choosePaintWall'));
      return;
    }
    const targets =
      this.finishRun && p.cityId
        ? map.placements.filter(
            (q) =>
              q.cityId === p.cityId &&
              (q.building?.kind === 'wall' || (!q.building && /wall/i.test(q.assetId))),
          )
        : [p];
    const finish: WallFinish | undefined = this.finishTexture
      ? { texture: this.finishTexture, tileSize: this.finishTile }
      : undefined;
    const side = this.finishSide === 'clicked' ? hit.side : this.finishSide;
    const before = targets.map((q) => cloneWallFinishes(q.wallFinishes));
    const after = targets.map((q) => {
      const next = cloneWallFinishes(q.wallFinishes) ?? {};
      if (side === 'front' || side === 'both') next.front = finish ? { ...finish } : undefined;
      if (side === 'back' || side === 'both') next.back = finish ? { ...finish } : undefined;
      return cloneWallFinishes(next);
    });
    const apply = (values: typeof before): void => {
      targets.forEach((q, i) => {
        q.wallFinishes = cloneWallFinishes(values[i]);
      });
      this.deps.changed();
    };
    this.deps.execute({
      label: 'building-finish',
      redo: () => apply(after),
      undo: () => apply(before),
    });
  }

  private changeBuilding(next: BuildingDef): void {
    const map = this.deps.map();
    const before = map.buildings?.map((b) => ({ ...b }));
    const after = (before ?? []).map((b) => (b.id === next.id ? next : b));
    this.deps.execute({
      label: 'building-level',
      redo: () => {
        map.buildings = after.map((b) => ({ ...b }));
        this.deps.changed();
      },
      undo: () => {
        map.buildings = before?.map((b) => ({ ...b }));
        this.deps.changed();
      },
    });
    this.refresh();
  }

  async importTexture(file?: File): Promise<void> {
    if (!file) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp';
      input.addEventListener('change', () => {
        if (input.files?.[0]) void this.importTexture(input.files[0]);
      });
      input.click();
      return;
    }
    const generation = this.importGeneration;
    this.importing = true;
    this.refresh();
    try {
      const texture = await importWallTexture(file);
      if (generation !== this.importGeneration) return;
      this.finishTexture = `custom:${texture.sha256}`;
      this.imports.set(this.finishTexture, texture.name);
    } catch {
      if (generation === this.importGeneration) this.deps.error(t('editor.buildMode.importFailed'));
    } finally {
      if (generation === this.importGeneration) {
        this.importing = false;
        this.refresh();
      }
    }
  }

  panelDeps(): BuildingPanelDeps {
    return {
      getState: () => this.state(),
      setMode: (mode) => {
        this.cancel();
        this.mode = mode;
        this.deps.arm();
        this.refresh();
      },
      selectBuilding: (id) => {
        this.cancel();
        this.deps.clearSelection();
        this.id = id;
        this.level = 0;
        this.refresh();
      },
      newBuilding: () => {
        this.cancel();
        this.deps.clearSelection();
        this.id = null;
        this.level = 0;
        this.draftBase = null;
        this.draftLevels = 1;
        this.refresh();
      },
      selectLevel: (level) => {
        this.cancel();
        this.deps.clearSelection();
        this.level = level;
        this.refresh();
      },
      addLevel: () => {
        const b = this.building;
        if (b.levels >= MAX_BUILDING_LEVELS) return;
        this.cancel();
        this.deps.clearSelection();
        if (this.saved) this.changeBuilding({ ...b, levels: b.levels + 1 });
        else this.draftLevels++;
        this.level = b.levels;
        this.refresh();
      },
      setFloorHeight: (height) => {
        if (!this.saved) this.floorHeight = Math.max(2, Math.min(30, height));
        this.refresh();
      },
      setBaseY: (y) => {
        if (!this.saved) this.draftBase = Math.max(-9900, Math.min(9500, y));
        this.refresh();
      },
      setGridSize: (size) => {
        this.gridSize = Math.max(0.25, Math.min(4, size));
        this.refresh();
      },
      setHideAbove: (hide) => {
        this.deps.clearSelection();
        this.hideAbove = hide;
        this.refresh();
      },
      setDiagonal: (diagonal) => {
        this.cancel();
        this.diagonal = diagonal;
        this.refresh();
      },
      setWallSource: (source) => {
        this.wallSource = source;
        this.cancel();
        this.refresh();
      },
      setThickness: (thickness) => {
        this.thickness = Math.max(0.1, Math.min(3, thickness));
      },
      pickAsset: () => this.deps.openAssets(),
      selectExisting: () => this.deps.selectExisting(),
      setFinishTexture: (texture) => {
        this.finishTexture = texture;
        this.refresh();
      },
      setFinishTile: (tile) => {
        this.finishTile = Math.max(0.5, Math.min(64, tile));
      },
      setFinishSide: (side) => {
        this.finishSide = side;
      },
      setFinishRun: (run) => {
        this.finishRun = run;
      },
      importTexture: () => {
        void this.importTexture();
      },
    };
  }

  private state(): BuildingPanelState {
    const map = this.deps.map();
    const custom = new Set<string>(this.imports.keys());
    for (const p of map.placements)
      for (const sha of wallFinishTextureRefs(p.wallFinishes)) custom.add(`custom:${sha}`);
    const textureOptions = [
      { value: '', label: t('editor.buildMode.bare') },
      ...modelMaterialOptions()
        .filter((m) => ['stone', 'brick', 'plaster', 'wood', 'paving', 'metal'].includes(m.group))
        .map((m) => ({
          value: m.key,
          label: t(`editor.buildMode.materialNames.${m.key}` as TranslationKey),
          thumbnail: assetUrl(`/textures/terrain/${m.file}`),
        })),
      ...[...custom].map((ref, i) => ({
        value: ref,
        label:
          this.imports.get(ref) ??
          t('editor.buildMode.importedTexture', { number: formatNumber(i + 1) }),
        thumbnail: groundTextureUrl(ref.slice(7)) ?? undefined,
      })),
    ];
    const b = this.building;
    return {
      mode: this.mode,
      buildings: map.buildings ?? [],
      activeBuildingId: this.id,
      level: this.level,
      levels: b.levels,
      floorHeight: b.floorHeight,
      baseY: this.hasBase ? b.baseY : null,
      foundationLocked: this.saved !== undefined,
      gridSize: this.gridSize,
      hideAbove: this.hideAbove,
      diagonal: this.diagonal,
      wallSource: this.wallSource,
      assetLabel: this.assetLabel,
      thickness: this.thickness,
      finishTexture: this.finishTexture,
      finishTile: this.finishTile,
      finishSide: this.finishSide,
      finishRun: this.finishRun,
      importing: this.importing,
      textureOptions,
      status: null,
    };
  }
}
