// The right-hand context inspector: per-tool option panels (brush, biome
// palette, water level, placement options, camp editor, spawn point, region
// clipboard, erase help), the Select-mode placement/marker editors, the
// procedural generators, and the 2D layer/frame controls. Owns no state: it
// reads and writes through the injected deps and re-renders on refresh().

import {
  collideRadiusFor,
  MAX_COLLIDE_RADIUS,
  MAX_WATER_LEVEL,
  MIN_COLLIDE_RADIUS,
  MIN_WATER_LEVEL,
} from '../sim/map_doc';
import { formatNumber, t } from '../ui/i18n';
import { button, checkbox, el, slider } from './dom';
import { PLACEMENT_SCALE_MAX, PLACEMENT_SCALE_MIN } from './placement_transform_core';
import type { EditorTool } from './toolbar';

export interface CampSelection {
  index: number;
  mobId: string;
  count: number;
  radius: number;
}

export interface PlacementSelection {
  index: number;
  assetLabel: string;
  x: number;
  z: number;
  rotY: number;
  scale: number;
  collide: boolean;
  /** Authored collision-radius override (yards), or null = derived from scale. */
  collideRadius: number | null;
}

export interface MarkerSelection {
  label: string;
  x: number;
  z: number;
}

export interface InspectorDeps {
  getTool(): EditorTool;
  getViewMode(): '3d' | '2d';

  getBrushRadius(): number;
  setBrushRadius(v: number): void;
  getBrushStrength(): number;
  setBrushStrength(v: number): void;
  getTerrainEditStats(): { count: number; max: number };

  getPaintBiome(): number;
  setPaintBiome(id: number): void;
  clearBiomePaint(): void;

  getFlattenHardEdge(): boolean;
  setFlattenHardEdge(on: boolean): void;

  getWaterLevel(): number;
  previewWaterLevel(v: number): void;
  commitWaterLevel(v: number): void;
  resetWaterLevel(): void;

  getPlaceScale(): number;
  setPlaceScale(v: number): void;
  getPlaceCollide(): boolean;
  setPlaceCollide(on: boolean): void;
  getPlaceRandomRot(): boolean;
  setPlaceRandomRot(on: boolean): void;
  getPlaceAssetLabel(): string | null;

  mobOptions(): { id: string; label: string }[];
  getSelectedCamp(): CampSelection | null;
  updateCamp(change: { mobId?: string; count?: number; radius?: number }): void;
  deleteCamp(): void;

  getSpawn(): { x: number; z: number } | null;
  clearSpawn(): void;

  copyRegion(): void;
  pasteBeside(): void;

  getBlockerStats(): { count: number; max: number };

  getSelection(): PlacementSelection | null;
  /** Live update (slider drag); commit=false does not push an undo entry.
   *  collideRadius: number sets the override, null clears it (back to auto). */
  updateSelection(
    change: {
      x?: number;
      z?: number;
      rotY?: number;
      scale?: number;
      collide?: boolean;
      collideRadius?: number | null;
    },
    commit: boolean,
  ): void;
  duplicateSelection(): void;
  deleteSelection(): void;
  getFootprints(): boolean;
  setFootprints(on: boolean): void;

  getMarkerSelection(): MarkerSelection | null;
  updateMarker(axis: 'x' | 'z', v: number): void;
  resetMarker(): void;

  getScatterCount(): number;
  setScatterCount(v: number): void;
  runScatter(): void;
  runHills(): void;

  layers(): { kind: string; label: string; visible: boolean }[];
  toggleLayer(kind: string, on: boolean): void;
  frameAll(): void;
  zones(): { id: string; name: string }[];
  frameZone(id: string): void;
}

export const BIOME_OPTIONS: { id: number; labelKey: string; swatch: string }[] = [
  { id: 0, labelKey: 'editor.biome.vale', swatch: '#5aa850' },
  { id: 1, labelKey: 'editor.biome.marsh', swatch: '#786037' },
  { id: 2, labelKey: 'editor.biome.peaks', swatch: '#969ba5' },
  { id: 3, labelKey: 'editor.biome.beach', swatch: '#d8c27a' },
  { id: 4, labelKey: 'editor.biome.desert', swatch: '#cf9040' },
  { id: 5, labelKey: 'editor.biome.volcano', swatch: '#b04030' },
  { id: 6, labelKey: 'editor.biome.cave', swatch: '#4a4a55' },
  { id: 255, labelKey: 'editor.biome.erase', swatch: 'transparent' },
];

function num1(v: number): string {
  return formatNumber(v, { useGrouping: false, maximumFractionDigits: 1 });
}

function section(title: string): HTMLElement {
  const s = el('section', 'ed-section');
  s.appendChild(el('h2', 'ed-section-title', title));
  return s;
}

function hint(text: string): HTMLElement {
  return el('p', 'ed-hint', text);
}

export class Inspector {
  readonly root: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly deps: InspectorDeps,
  ) {
    this.root = el('aside', 'ed-inspector');
    this.root.setAttribute('aria-label', t('editor.inspector.label'));
    parent.appendChild(this.root);
    this.refresh();
  }

  refresh(): void {
    const d = this.deps;
    this.root.innerHTML = '';
    const tool = d.getTool();
    // Drives the per-tool hue (--tool-hue) shared with the tool rail, so the
    // panel header chip and slider accents match the active tool's color.
    this.root.dataset.tool = tool;

    switch (tool) {
      case 'select':
        this.selectPanel();
        break;
      case 'raise':
      case 'lower':
        this.brushPanel(true);
        break;
      case 'smooth':
        this.brushPanel(true);
        break;
      case 'flatten':
        this.brushPanel(false);
        this.flattenPanel();
        break;
      case 'paint':
        this.brushPanel(false);
        this.biomePanel();
        break;
      case 'water':
        this.waterPanel();
        break;
      case 'place':
        this.placePanel();
        this.procgenPanel();
        break;
      case 'blocker':
        this.blockerPanel();
        break;
      case 'camp':
        this.campPanel();
        break;
      case 'spawn':
        this.spawnPanel();
        break;
      case 'region':
        this.regionPanel();
        break;
      case 'erase':
        this.brushPanel(false);
        this.erasePanel();
        break;
    }

    if (d.getViewMode() === '2d') this.layersPanel();
    this.navHint();
  }

  // ---- panels -----------------------------------------------------------------

  private brushPanel(withStrength: boolean): void {
    const d = this.deps;
    const s = section(t('editor.brush.title'));
    s.appendChild(
      slider(t('editor.brush.size'), {
        min: 4,
        max: 60,
        step: 1,
        value: d.getBrushRadius(),
        onInput: (v) => d.setBrushRadius(v),
        format: num1,
      }).root,
    );
    if (withStrength) {
      s.appendChild(
        slider(t('editor.brush.strength'), {
          min: 1,
          max: 30,
          step: 1,
          value: d.getBrushStrength(),
          onInput: (v) => d.setBrushStrength(v),
          format: num1,
        }).root,
      );
    }
    s.appendChild(hint(t('editor.brush.sizeHint')));
    const stats = d.getTerrainEditStats();
    s.appendChild(
      hint(
        t('editor.brush.editCount', {
          count: formatNumber(stats.count, { useGrouping: false }),
          max: formatNumber(stats.max, { useGrouping: false }),
        }),
      ),
    );
    this.root.appendChild(s);
  }

  private flattenPanel(): void {
    const d = this.deps;
    const s = section(t('editor.tool.flatten'));
    s.appendChild(hint(t('editor.flatten.hint')));
    s.appendChild(
      checkbox(t('editor.flatten.hardEdge'), d.getFlattenHardEdge(), (on) =>
        d.setFlattenHardEdge(on),
      ).root,
    );
    this.root.appendChild(s);
  }

  private biomePanel(): void {
    const d = this.deps;
    const s = section(t('editor.biome.title'));
    const pal = el('div', 'ed-biomes');
    pal.setAttribute('role', 'radiogroup');
    pal.setAttribute('aria-label', t('editor.biome.paletteLabel'));
    for (const opt of BIOME_OPTIONS) {
      const label = t(opt.labelKey as Parameters<typeof t>[0]);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-biome';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', d.getPaintBiome() === opt.id ? 'true' : 'false');
      b.classList.toggle('active', d.getPaintBiome() === opt.id);
      const sw = el('span', 'ed-biome-swatch');
      if (opt.id === 255) sw.classList.add('ed-biome-erase');
      else sw.style.background = opt.swatch;
      b.append(sw, el('span', undefined, label));
      b.addEventListener('click', () => {
        d.setPaintBiome(opt.id);
        this.refresh();
      });
      pal.appendChild(b);
    }
    s.appendChild(pal);
    s.appendChild(hint(t('editor.biome.hint')));
    s.appendChild(button(t('editor.biome.clear'), () => d.clearBiomePaint(), 'small danger'));
    this.root.appendChild(s);
  }

  private waterPanel(): void {
    const d = this.deps;
    const s = section(t('editor.water.title'));
    s.appendChild(
      slider(t('editor.water.level'), {
        min: MIN_WATER_LEVEL,
        max: MAX_WATER_LEVEL,
        step: 0.5,
        value: d.getWaterLevel(),
        onInput: (v) => d.previewWaterLevel(v),
        onChange: (v) => d.commitWaterLevel(v),
        format: num1,
      }).root,
    );
    s.appendChild(
      hint(
        t('editor.water.hint', {
          min: num1(MIN_WATER_LEVEL),
          max: num1(MAX_WATER_LEVEL),
        }),
      ),
    );
    s.appendChild(
      button(
        t('editor.water.reset'),
        () => {
          d.resetWaterLevel();
          this.refresh();
        },
        'small',
      ),
    );
    this.root.appendChild(s);
  }

  private placePanel(): void {
    const d = this.deps;
    const s = section(t('editor.place.title'));
    const label = d.getPlaceAssetLabel();
    s.appendChild(
      label
        ? el('p', 'ed-chosen', t('editor.place.chosen', { name: label }))
        : hint(t('editor.place.none')),
    );
    s.appendChild(
      slider(t('editor.place.scale'), {
        min: PLACEMENT_SCALE_MIN,
        max: PLACEMENT_SCALE_MAX,
        step: 0.1,
        value: d.getPlaceScale(),
        onInput: (v) => d.setPlaceScale(v),
        format: num1,
      }).root,
    );
    s.appendChild(
      checkbox(t('editor.place.collide'), d.getPlaceCollide(), (on) => d.setPlaceCollide(on)).root,
    );
    s.appendChild(hint(t('editor.place.collideHint')));
    s.appendChild(
      checkbox(t('editor.place.randomRotation'), d.getPlaceRandomRot(), (on) =>
        d.setPlaceRandomRot(on),
      ).root,
    );
    this.root.appendChild(s);
  }

  private campPanel(): void {
    const d = this.deps;
    const s = section(t('editor.camp.title'));
    s.appendChild(hint(t('editor.camp.hint')));
    s.appendChild(hint(t('editor.camp.playtestNote')));
    const camp = d.getSelectedCamp();
    if (!camp) {
      s.appendChild(el('p', 'ed-muted', t('editor.camp.none')));
      this.root.appendChild(s);
      return;
    }
    const mobs = d.mobOptions();
    const chosen = mobs.find((m) => m.id === camp.mobId);
    s.appendChild(
      el('p', 'ed-chosen', t('editor.camp.selected', { mob: chosen?.label ?? camp.mobId })),
    );
    const mobRow = el('label', 'ed-field');
    mobRow.appendChild(el('span', undefined, t('editor.camp.mob')));
    const sel = document.createElement('select');
    for (const m of mobs) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      sel.appendChild(opt);
    }
    sel.value = camp.mobId;
    sel.addEventListener('change', () => {
      d.updateCamp({ mobId: sel.value });
      this.refresh();
    });
    mobRow.appendChild(sel);
    s.appendChild(mobRow);
    s.appendChild(
      slider(t('editor.camp.count'), {
        min: 1,
        max: 8,
        step: 1,
        value: camp.count,
        onInput: () => {},
        onChange: (v) => d.updateCamp({ count: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.camp.radius'), {
        min: 4,
        max: 30,
        step: 1,
        value: camp.radius,
        onInput: () => {},
        onChange: (v) => d.updateCamp({ radius: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      button(
        t('editor.camp.delete'),
        () => {
          d.deleteCamp();
          this.refresh();
        },
        'danger small',
      ),
    );
    this.root.appendChild(s);
  }

  private spawnPanel(): void {
    const d = this.deps;
    const s = section(t('editor.spawn.title'));
    s.appendChild(hint(t('editor.spawn.hint')));
    const spawn = d.getSpawn();
    if (spawn) {
      s.appendChild(
        el('p', 'ed-chosen', t('editor.spawn.position', { x: num1(spawn.x), z: num1(spawn.z) })),
      );
      s.appendChild(
        button(
          t('editor.spawn.clear'),
          () => {
            d.clearSpawn();
            this.refresh();
          },
          'small',
        ),
      );
    } else {
      s.appendChild(el('p', 'ed-muted', t('editor.spawn.unset')));
    }
    this.root.appendChild(s);
  }

  private regionPanel(): void {
    const d = this.deps;
    const s = section(t('editor.region.title'));
    s.appendChild(hint(t('editor.region.hint')));
    if (d.getViewMode() === '3d') s.appendChild(hint(t('editor.region.hint3d')));
    const row = el('div', 'ed-row');
    row.append(
      button(t('editor.region.copy'), () => d.copyRegion()),
      button(t('editor.region.pasteBeside'), () => d.pasteBeside()),
    );
    s.appendChild(row);
    this.root.appendChild(s);
  }

  private erasePanel(): void {
    const s = section(t('editor.eraseTool.title'));
    s.appendChild(hint(t('editor.eraseTool.hint')));
    s.appendChild(hint(t('editor.eraseTool.blockerHint')));
    this.root.appendChild(s);
  }

  private blockerPanel(): void {
    const d = this.deps;
    const s = section(t('editor.blockerTool.title'));
    s.appendChild(hint(t('editor.blockerTool.hint')));
    const stats = d.getBlockerStats();
    s.appendChild(
      hint(
        t('editor.blockerTool.count', {
          count: formatNumber(stats.count, { useGrouping: false }),
          max: formatNumber(stats.max, { useGrouping: false }),
        }),
      ),
    );
    this.root.appendChild(s);
  }

  private selectPanel(): void {
    const d = this.deps;
    const sel = d.getSelection();
    const s = section(t('editor.selection.title'));
    if (sel) {
      s.appendChild(el('p', 'ed-chosen', t('editor.selection.asset', { name: sel.assetLabel })));
      s.appendChild(
        this.coordField(t('editor.selection.x'), sel.x, (v) => {
          d.updateSelection({ x: v }, true);
        }),
      );
      s.appendChild(
        this.coordField(t('editor.selection.z'), sel.z, (v) => {
          d.updateSelection({ z: v }, true);
        }),
      );
      s.appendChild(
        slider(t('editor.selection.rotation'), {
          min: 0,
          max: 360,
          step: 1,
          value: Math.round(
            (((sel.rotY % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * (180 / Math.PI),
          ),
          onInput: (v) => d.updateSelection({ rotY: (v * Math.PI) / 180 }, false),
          onChange: (v) => d.updateSelection({ rotY: (v * Math.PI) / 180 }, true),
          format: num1,
        }).root,
      );
      s.appendChild(
        slider(t('editor.selection.scale'), {
          min: PLACEMENT_SCALE_MIN,
          max: PLACEMENT_SCALE_MAX,
          step: 0.1,
          value: sel.scale,
          onInput: (v) => d.updateSelection({ scale: v }, false),
          onChange: (v) => d.updateSelection({ scale: v }, true),
          format: num1,
        }).root,
      );
      s.appendChild(
        checkbox(t('editor.selection.collide'), sel.collide, (on) => {
          d.updateSelection({ collide: on }, true);
          this.refresh(); // the radius controls appear/disappear with collide
        }).root,
      );
      if (sel.collide) {
        s.appendChild(
          slider(t('editor.selection.radius'), {
            min: MIN_COLLIDE_RADIUS,
            max: MAX_COLLIDE_RADIUS,
            step: 0.1,
            value: sel.collideRadius ?? collideRadiusFor(sel.scale),
            onInput: (v) => d.updateSelection({ collideRadius: v }, false),
            onChange: (v) => d.updateSelection({ collideRadius: v }, true),
            format: num1,
          }).root,
        );
        s.appendChild(
          button(
            t('editor.selection.radiusAuto'),
            () => {
              d.updateSelection({ collideRadius: null }, true);
              this.refresh();
            },
            'small',
            t('editor.selection.radiusAutoTitle'),
          ),
        );
        s.appendChild(hint(t('editor.selection.radiusHint')));
      }
      const row = el('div', 'ed-row');
      row.append(
        button(t('editor.selection.duplicate'), () => d.duplicateSelection()),
        button(t('editor.selection.delete'), () => d.deleteSelection(), 'danger'),
      );
      s.appendChild(row);
      // Teach the direct-manipulation paths (drag-move, wheel, nudge keys).
      s.appendChild(hint(t('editor.selection.moveHint')));
      s.appendChild(hint(t('editor.selection.wheelHint')));
      s.appendChild(hint(t('editor.selection.deleteHint')));
    } else {
      const marker = d.getMarkerSelection();
      if (marker) {
        s.appendChild(el('p', 'ed-chosen', marker.label));
        s.appendChild(
          this.coordField(t('editor.selection.x'), marker.x, (v) => d.updateMarker('x', v)),
        );
        s.appendChild(
          this.coordField(t('editor.selection.z'), marker.z, (v) => d.updateMarker('z', v)),
        );
        s.appendChild(
          button(
            t('editor.marker.reset'),
            () => {
              d.resetMarker();
              this.refresh();
            },
            'small',
          ),
        );
      } else {
        s.appendChild(el('p', 'ed-muted', t('editor.selection.none')));
      }
    }
    s.appendChild(
      checkbox(t('editor.selection.footprints'), d.getFootprints(), (on) => d.setFootprints(on))
        .root,
    );
    this.root.appendChild(s);
  }

  private layersPanel(): void {
    const d = this.deps;
    const s = section(t('editor.layers.title'));
    const list = el('div', 'ed-layers');
    for (const layer of d.layers()) {
      list.appendChild(
        checkbox(layer.label, layer.visible, (on) => d.toggleLayer(layer.kind, on)).root,
      );
    }
    s.appendChild(list);
    const frame = section(t('editor.frame.title'));
    const row = el('div', 'ed-row ed-wrap');
    row.appendChild(button(t('editor.frame.all'), () => d.frameAll(), 'small'));
    for (const z of d.zones()) {
      row.appendChild(button(z.name, () => d.frameZone(z.id), 'small'));
    }
    frame.appendChild(row);
    this.root.appendChild(s);
    this.root.appendChild(frame);
  }

  private procgenPanel(): void {
    const d = this.deps;
    const s = section(t('editor.procgen.title'));
    s.appendChild(
      slider(t('editor.procgen.count'), {
        min: 10,
        max: 400,
        step: 10,
        value: d.getScatterCount(),
        onInput: (v) => d.setScatterCount(v),
        format: num1,
      }).root,
    );
    const row = el('div', 'ed-row ed-wrap');
    row.append(
      button(t('editor.procgen.scatter'), () => d.runScatter(), 'small'),
      button(t('editor.procgen.hills'), () => d.runHills(), 'small'),
    );
    s.appendChild(row);
    this.root.appendChild(s);
  }

  private navHint(): void {
    const mode = this.deps.getViewMode();
    this.root.appendChild(
      el(
        'p',
        'ed-hint ed-nav-hint',
        mode === '3d' ? t('editor.hints.nav3d') : t('editor.hints.nav2d'),
      ),
    );
  }

  private coordField(label: string, value: number, onChange: (v: number) => void): HTMLElement {
    const row = el('label', 'ed-field');
    row.appendChild(el('span', undefined, label));
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.5';
    input.value = String(Math.round(value * 100) / 100);
    input.addEventListener('keydown', (ev) => ev.stopPropagation());
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) onChange(v);
    });
    row.appendChild(input);
    return row;
  }
}
