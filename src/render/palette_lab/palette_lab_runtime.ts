// Palette lab, the live half: applies the chosen look of the zone the player
// stands in, every frame, to the running renderer. Loaded by dynamic import
// only under `?palette=on` (palette_lab_flag.ts), so a normal session never
// fetches this chunk.
//
// What a look reaches, and how fast:
// - Instantly (uniform and table writes): the display grade, the sky
//   gradient, bloom, exposure (on a click they SNAP; walking over a zone
//   border they cross-fade over about a second) and water (always a snap).
// - Within the renderer's own zone ease (~0.7 s): the fog and light rows
//   (BIOME_FOG / BIOME_LIGHT / BIOME_GOD_RAYS are read by key every frame, so
//   writing a row in place is all it takes), and the distant-zone haze field,
//   re-baked from those rows.
// - Within a second or two, nearest first: the ground. Its colours are baked
//   into vertex buffers, so a changed zone's chunks are re-meshed off the main
//   thread and only their colour buffers swapped in (renderer.editor
//   .recolorGround), and the near grass blades re-place over a few frames.
//
// The renderer is reached through the `window.__game` debug global (re-read
// every frame: a graphics rebuild replaces it), and only through public
// surfaces plus module-level shared uniforms, never a private field:
// renderer.ts and main.ts carry no line for the lab at all.

import type * as THREE from 'three';
import {
  DUNGEON_X_THRESHOLD,
  STRIP_MAX_X,
  STRIP_MIN_X,
  STRIP_ZONES,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  WORLD_MIN_Z,
  ZONES,
  zoneAt,
} from '../../sim/data';
import type { BiomeId, ZoneDef } from '../../sim/types';
import { refreshBiomeHazeField } from '../biome_haze_field';
import { type BiomeHazePreset, hazeLightLevel } from '../biome_haze_field_core';
import { recolorLiveBladeGrassView } from '../blade_grass';
import { recolorLiveBladeGrassBandView } from '../blade_grass_band';
import { celShadingSettings } from '../cel_shading';
import {
  currentDayNightPhase,
  dayNightPhaseOverride,
  setDayNightPhaseOverride,
} from '../day_night_clock';
import { globalDayness } from '../day_night_core';
import { FAR_WORLD_MARGIN } from '../far_terrain_core';
import {
  type GroundPaletteTable,
  groundPaletteVersion,
  setGroundPaletteOverrides,
} from '../ground_palette_override_core';
import { setMeadowFullness } from '../meadow_fullness_core';
import { BIOME_FOG, BIOME_GOD_RAYS, BIOME_LIGHT } from '../outdoor_biome_presets';
import { BLOOM_STRENGTH, BLOOM_THRESHOLD } from '../post';
import { setWaterPalette, stockWaterPalette } from '../water';
import { precipForBiome } from '../weather_field_core';
import { livePaletteAoPass, setLabRim } from './lab_lighting';
import { livePaletteBloomPass } from './palette_bloom';
import { paletteGradeUniforms } from './palette_grade';
import { paletteLabPanelEnabled } from './palette_lab_flag';
import { mountPaletteLabPanel, type PaletteLabPanel } from './palette_lab_panel';
import { paletteSkyUniforms } from './palette_sky';
import {
  applyLookPatch,
  cycleLookId,
  DEFAULT_ZONE_NIGHT_SELECTIONS,
  DEFAULT_ZONE_SELECTIONS,
  fogSceneHex,
  gradeUniformValues,
  groundKey,
  hexToSrgb01,
  type LookBloom,
  type LookGround,
  type LookPatch,
  type LookSelections,
  lookDisplayModel,
  lookToShippingSnippet,
  parseSelections,
  resolveZoneLookId,
  rimColorLinear,
  STOCK_LOOK_ID,
  skyUniformValues,
  stockLookFor,
  type ZoneLook,
} from './zone_look_core';
import { ZONE_LOOKS } from './zone_looks';

const STORAGE_KEY = 'woc.paletteLab.selections.v3';
const NIGHT_STORAGE_KEY = 'woc.paletteLab.nightSelections.v3';
// Ground margin past a zone's rect: the palette blends over 65 yards either
// side of a border, so chunks that far out also carry the zone's colour.
const GROUND_BLEND_MARGIN = 70;
// Zone-border cross-fade rate (1/s) for the grade, sky, water and bloom.
const BORDER_EASE_RATE = 2.5;
// How often the stale-chunk sweep looks for ground built under an old table.
const STALE_SWEEP_INTERVAL_MS = 1500;
// Offsets into the flat eased-value array (liveTargets).
const LIVE = {
  wb: 0,
  tone: 4,
  shadow: 8,
  highlight: 12,
  green: 16,
  zenith: 20,
  horizon: 24,
  exposure: 28,
  bloomStrength: 29,
  bloomThreshold: 30,
  rim: 31,
  rimPower: 32,
  rimColor: 33,
  aoTint: 36,
  aoScale: 39,
  shadowStrength: 40,
  canopyLift: 41,
} as const;
// Leaf and bush materials the canopy lift brightens (GLB material names), and
// the far sprites that stand in for them, which must move together or the
// handoff between a real tree and its sprite shows.
const CANOPY_MATERIAL = /^(Leaves(_.*)?|foliage:impostor-(tree|dress).*)$/;
// How often the canopy walk looks for leaf materials a streamed zone added.
const CANOPY_REWALK_MS = 4000;
// How much of a surface's own colour the rim takes: high, so a leaf's rim is a
// lighter leaf green and a cloak's a lighter cloak, never a white frost.
const RIM_ALBEDO = 0.85;

interface LabRendererHandle {
  webgl: { toneMappingExposure: number };
  scene: THREE.Scene;
  editor: {
    recolorGround(
      region: { minX: number; minZ: number; maxX: number; maxZ: number },
      cx: number,
      cz: number,
      cancelled?: () => boolean,
    ): Promise<number>;
    recolorStaleGround(cx: number, cz: number, cancelled?: () => boolean): Promise<number>;
  };
}

interface LabGameHandle {
  renderer?: LabRendererHandle;
  world?: { player?: { pos: { x: number; z: number } } | null };
}

interface LabEditorHandle {
  viewport3d?: {
    renderer?: LabRendererHandle | null;
    sim?: { player?: { pos: { x: number; z: number } } | null } | null;
  } | null;
}

function game(): LabGameHandle | null {
  const w = window as unknown as { __game?: LabGameHandle; __editor?: LabEditorHandle };
  if (w.__game) return w.__game;
  const v3d = w.__editor?.viewport3d;
  if (!v3d?.renderer) return null;
  return {
    renderer: v3d.renderer,
    world: v3d.sim ?? undefined,
  };
}

function readStorage(key = STORAGE_KEY): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(value: string, key = STORAGE_KEY): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the selections just do not persist.
  }
}

/** The public face of the lab (also `window.__paletteLab`, for capture rigs). */
export interface PaletteLabApi {
  /** Select a look for the zone the player stands in. */
  apply(lookId: string): boolean;
  select(zoneId: string, lookId: string): boolean;
  looks(zoneId?: string): { id: string; name: string }[];
  current(): { zone: string | null; look: string };
  setTime(phase: number | null): void;
  snippet(zoneId?: string): string;
  /** Live-edit the current zone's chosen look for this session (console use):
   *  `__paletteLab.tweak({ light: { hemiScale: 3 }, grade: { lift: 0.05 } })`. */
  tweak(patch: Omit<LookPatch, 'id' | 'name' | 'note'>): boolean;
}

class PaletteLabRuntime implements PaletteLabApi {
  private readonly selections: LookSelections = {
    ...DEFAULT_ZONE_SELECTIONS,
    ...parseSelections(readStorage(STORAGE_KEY)),
  };
  private readonly nightSelections: LookSelections = {
    ...DEFAULT_ZONE_NIGHT_SELECTIONS,
    ...parseSelections(readStorage(NIGHT_STORAGE_KEY)),
  };
  private readonly lookCache = new Map<string, ZoneLook[]>();
  private readonly zonesById = new Map(ZONES.map((z) => [z.id, z]));
  private stockBloom: LookBloom | null = null;
  private zone: ZoneDef | null = null;
  private renderer: LabRendererHandle | null = null;
  private compare = false;
  // Inside an instanced interior (dungeon, raid, rift): the stock look, since
  // an overworld zone's grade has no business recolouring a crypt.
  private indoors = false;
  private wasNight = false;
  private rowsDirty = true;
  private snapNext = true;
  private liveNow: number[] = [];
  private readonly targetCache = new WeakMap<ZoneLook, number[]>();
  private readonly celSaturation = celShadingSettings()?.saturation ?? 1;
  private exposureBase = Number.NaN;
  private exposureWritten = Number.NaN;
  private appliedGround = new Map<string, string>();
  private pendingGroundZones = new Set<string>();
  private groundRun = 0;
  private groundBusy = false;
  private sweepBusy = false;
  private readonly stockWater = stockWaterPalette();
  private aoPass: unknown = null;
  private aoBase = 1;
  private sun: THREE.DirectionalLight | null = null;
  private sunFor: LabRendererHandle | null = null;
  private canopyFor: LabRendererHandle | null = null;
  private canopySceneChildren = 0;
  private canopyRewalkAt = 0;
  private canopyLiftWritten = Number.NaN;
  private readonly canopyBase = new WeakMap<THREE.Material, THREE.Color>();
  private readonly canopyMats = new Set<THREE.MeshStandardMaterial>();
  private nextSweepAt = 0;
  private lastFrame = 0;
  private status = '';
  private panel: PaletteLabPanel | null = null;

  start(): void {
    this.wasNight = this.isNight();
    this.seedGroundTable();
    const frame = (now: number): void => {
      const dt = this.lastFrame > 0 ? Math.min(0.25, (now - this.lastFrame) / 1000) : 0;
      this.lastFrame = now;
      this.tick(dt);
      this.sweepStaleGround(now);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private isNight(): boolean {
    return globalDayness(currentDayNightPhase()) < 0.45;
  }

  private seedGroundTable(): void {
    const table: Record<string, LookGround> = {};
    for (const zone of ZONES) {
      const look = this.groundLook(zone);
      if (look.id !== STOCK_LOOK_ID) table[zone.id] = look.ground;
      this.appliedGround.set(zone.id, groundKey(look.ground));
    }
    setGroundPaletteOverrides(Object.keys(table).length > 0 ? (table as GroundPaletteTable) : null);
  }

  /** The panel mounts with the first live world when `?palette=on`, never on the launcher. */
  private ensurePanel(): void {
    if (!paletteLabPanelEnabled() || this.panel) return;
    this.panel = mountPaletteLabPanel({
      onSelect: (id) => this.apply(id),
      onCycle: (step) => this.cycle(step),
      onPick: (index) => this.pick(index),
      onCompare: (on) => this.setCompare(on),
      onTime: (phase) => this.setTime(phase),
      onCopy: (all) => void this.copy(all),
      onResetZone: () => this.resetZone(),
      onResetAll: () => this.resetAll(),
    });
    this.panel.setStatus(this.status);
  }

  // -- looks -----------------------------------------------------------------

  private looksFor(zone: ZoneDef): ZoneLook[] {
    const cached = this.lookCache.get(zone.id);
    if (cached) return cached;
    const stock = stockLookFor(
      zone.biome,
      stockWaterPalette(),
      this.stockBloomLook(),
      this.celSaturation,
    );
    const list = [stock, ...(ZONE_LOOKS[zone.id] ?? []).map((p) => applyLookPatch(stock, p))];
    this.lookCache.set(zone.id, list);
    return list;
  }

  private stockBloomLook(): LookBloom {
    if (!this.stockBloom) {
      const live = livePaletteBloomPass();
      // Read off the live pass before the lab ever writes it; the shipped
      // constants when this tier has no bloom pass.
      this.stockBloom = live
        ? { strength: live.strength, threshold: live.threshold }
        : { strength: BLOOM_STRENGTH, threshold: BLOOM_THRESHOLD };
    }
    return this.stockBloom;
  }

  private selectedId(zone: ZoneDef): string {
    return resolveZoneLookId(zone.id, this.selections, this.nightSelections, this.isNight());
  }

  /** The look a zone shows right now (stock while comparing). */
  private shownLook(zone: ZoneDef): ZoneLook {
    const list = this.looksFor(zone);
    if (this.compare || this.indoors) return list[0];
    const id = this.selectedId(zone);
    return list.find((l) => l.id === id) ?? list[0];
  }

  /** The look a zone's GROUND bakes with: never the compare hold (a re-bake per
   *  key press would be seconds of churn for an instant A/B). */
  private groundLook(zone: ZoneDef): ZoneLook {
    const list = this.looksFor(zone);
    const id = this.selectedId(zone);
    return list.find((l) => l.id === id) ?? list[0];
  }

  // -- PaletteLabApi ---------------------------------------------------------

  apply(lookId: string): boolean {
    return this.zone ? this.select(this.zone.id, lookId) : false;
  }

  select(zoneId: string, lookId: string): boolean {
    const zone = this.zonesById.get(zoneId);
    if (!zone || !this.looksFor(zone).some((l) => l.id === lookId)) return false;
    const target =
      this.isNight() && (zoneId in this.nightSelections || zoneId in DEFAULT_ZONE_NIGHT_SELECTIONS)
        ? this.nightSelections
        : this.selections;
    const storageKey = target === this.nightSelections ? NIGHT_STORAGE_KEY : STORAGE_KEY;
    if (lookId === STOCK_LOOK_ID) delete target[zoneId];
    else target[zoneId] = lookId;
    writeStorage(JSON.stringify(target), storageKey);
    this.rowsDirty = true;
    this.snapNext = true;
    this.refreshPanel();
    return true;
  }

  looks(zoneId?: string): { id: string; name: string }[] {
    const zone = zoneId ? this.zonesById.get(zoneId) : this.zone;
    return zone ? this.looksFor(zone).map((l) => ({ id: l.id, name: l.name })) : [];
  }

  current(): { zone: string | null; look: string } {
    return {
      zone: this.zone?.id ?? null,
      look: this.zone ? this.selectedId(this.zone) : STOCK_LOOK_ID,
    };
  }

  setTime(phase: number | null): void {
    setDayNightPhaseOverride(phase);
    this.refreshPanel();
  }

  snippet(zoneId?: string): string {
    const zone = zoneId ? this.zonesById.get(zoneId) : this.zone;
    return zone
      ? lookToShippingSnippet(zone.id, zone.biome, this.groundLook(zone), this.celSaturation)
      : '';
  }

  tweak(patch: Omit<LookPatch, 'id' | 'name' | 'note'>): boolean {
    if (!this.zone) return false;
    const list = this.looksFor(this.zone);
    const at = list.findIndex((l) => l.id === this.selectedId(this.zone as ZoneDef));
    if (at <= 0) return false; // the stock look is the reference: never edited
    const cur = list[at];
    list[at] = applyLookPatch(cur, { ...patch, id: cur.id, name: cur.name, note: cur.note });
    this.rowsDirty = true;
    this.snapNext = true;
    this.refreshPanel();
    return true;
  }

  private pick(index: number): void {
    if (!this.zone) return;
    const look = this.looksFor(this.zone)[index];
    if (look) this.select(this.zone.id, look.id);
  }

  private cycle(step: number): void {
    if (!this.zone) return;
    const ids = this.looksFor(this.zone).map((l) => l.id);
    this.select(this.zone.id, cycleLookId(ids, this.selectedId(this.zone), step));
  }

  private setCompare(on: boolean): void {
    if (this.compare === on) return;
    this.compare = on;
    this.rowsDirty = true;
    this.snapNext = true;
    this.refreshPanel();
  }

  private resetZone(): void {
    if (!this.zone) return;
    const zoneId = this.zone.id;
    const defId =
      this.isNight() && zoneId in DEFAULT_ZONE_NIGHT_SELECTIONS
        ? DEFAULT_ZONE_NIGHT_SELECTIONS[zoneId]
        : (DEFAULT_ZONE_SELECTIONS[zoneId] ?? STOCK_LOOK_ID);
    this.select(zoneId, defId);
  }

  private resetAll(): void {
    for (const id of Object.keys(this.selections)) delete this.selections[id];
    Object.assign(this.selections, DEFAULT_ZONE_SELECTIONS);
    for (const id of Object.keys(this.nightSelections)) delete this.nightSelections[id];
    Object.assign(this.nightSelections, DEFAULT_ZONE_NIGHT_SELECTIONS);
    writeStorage('{}', STORAGE_KEY);
    writeStorage('{}', NIGHT_STORAGE_KEY);
    this.rowsDirty = true;
    this.snapNext = true;
    this.refreshPanel();
  }

  private async copy(all: boolean): Promise<void> {
    const zones = all ? ZONES.filter((z) => this.selections[z.id]) : this.zone ? [this.zone] : [];
    const text = [
      `// Palette lab selections: ${JSON.stringify(this.selections)}`,
      ...zones.map((z) =>
        lookToShippingSnippet(z.id, z.biome, this.groundLook(z), this.celSaturation),
      ),
    ].join('\n\n');
    console.info(text);
    try {
      await navigator.clipboard.writeText(text);
      this.setStatus(all ? 'Copied every chosen look' : 'Copied this zone’s look');
    } catch {
      this.setStatus('Clipboard blocked: the look is in the console');
    }
  }

  // -- the frame -------------------------------------------------------------

  private tick(dt: number): void {
    const g = game();
    const renderer = g?.renderer ?? null;
    const pos = g?.world?.player?.pos;
    if (!renderer || !pos) return;
    this.ensurePanel();
    if (renderer !== this.renderer) {
      // A new renderer (boot, or a graphics rebuild): its terrain is built from
      // the override table already, its bloom pass re-registered, its exposure
      // fresh. Re-apply everything from scratch.
      this.renderer = renderer;
      this.exposureBase = Number.NaN;
      this.exposureWritten = Number.NaN;
      this.rowsDirty = true;
      this.snapNext = true;
    }
    const indoors = pos.x > DUNGEON_X_THRESHOLD;
    if (indoors !== this.indoors) {
      this.indoors = indoors;
      this.rowsDirty = true;
      this.snapNext = true;
    }
    const night = this.isNight();
    if (night !== this.wasNight) {
      this.wasNight = night;
      this.rowsDirty = true;
      this.refreshPanel();
    }
    const zone = zoneAt(pos.x, pos.z);
    if (zone.id !== this.zone?.id) {
      this.zone = zone;
      this.rowsDirty = true;
      this.refreshPanel();
    }
    if (this.rowsDirty) {
      this.rowsDirty = false;
      this.writeRows(zone);
      this.syncGround();
    }
    this.easeLive(zone, renderer, this.snapNext ? 1 : 1 - Math.exp(-dt * BORDER_EASE_RATE));
    this.snapNext = false;
  }

  /**
   * Write every biome's fog/light/god-ray row from the look its zones show:
   * the player's own zone for its biome, else the first zone of that biome
   * with a chosen look, else stock. Then re-bake the distant-zone haze from
   * the same rows, so a realm seen across a border wears its chosen air.
   */
  private writeRows(current: ZoneDef): void {
    const hazePresets = {} as Record<BiomeId, BiomeHazePreset>;
    for (const biome of Object.keys(BIOME_FOG) as BiomeId[]) {
      const owner =
        current.biome === biome
          ? current
          : (ZONES.find((z) => z.biome === biome && this.selections[z.id]) ??
            ZONES.find((z) => z.biome === biome));
      const look = owner
        ? this.shownLook(owner)
        : stockLookFor(biome, stockWaterPalette(), this.stockBloomLook(), this.celSaturation);
      const fog = BIOME_FOG[biome];
      fog.color = fogSceneHex(look, this.celSaturation);
      fog.near = look.fog.near;
      fog.far = look.fog.far;
      const light = BIOME_LIGHT[biome];
      light.hemiSky = look.light.hemiSky;
      light.hemiGround = look.light.hemiGround;
      light.sun = look.light.sun;
      light.sunScale = look.light.sunScale;
      light.hemiScale = look.light.hemiScale;
      light.envScale = look.light.envScale;
      BIOME_GOD_RAYS[biome] = look.godRays;
      hazePresets[biome] = {
        color: fog.color,
        far: fog.far,
        light: hazeLightLevel(light.sunScale, light.hemiScale, light.envScale),
        precip: precipForBiome(biome) ?? undefined,
      };
    }
    refreshBiomeHazeField(hazePresets);
  }

  /** Grade, sky, water, bloom and exposure: eased toward the shown look. */
  private easeLive(zone: ZoneDef, renderer: LabRendererHandle, k: number): void {
    const look = this.shownLook(zone);
    const target = this.liveTargets(look);
    const now = this.liveNow;
    if (now.length !== target.length || k >= 1) {
      this.liveNow = target.slice();
    } else {
      let gap = 0;
      for (let i = 0; i < now.length; i++) {
        now[i] += (target[i] - now[i]) * k;
        gap = Math.max(gap, Math.abs(target[i] - now[i]));
      }
      // Land exactly: an exponential ease never arrives, and a stock target
      // must end at mix 0 (the grade arm off), not a hair above it.
      if (gap < 5e-4) this.liveNow = target.slice();
    }
    const v = this.liveNow;
    const gu = paletteGradeUniforms();
    gu.uPalWB.value.fromArray(v, LIVE.wb);
    gu.uPalTone.value.fromArray(v, LIVE.tone);
    gu.uPalShadow.value.fromArray(v, LIVE.shadow);
    gu.uPalHighlight.value.fromArray(v, LIVE.highlight);
    gu.uPalGreen.value.fromArray(v, LIVE.green);
    const su = paletteSkyUniforms();
    su.uPalSkyZenith.value.fromArray(v, LIVE.zenith);
    su.uPalSkyHorizon.value.fromArray(v, LIVE.horizon);

    // Water is one shared material for every sheet, so it wears the look of
    // the zone the player is in (the water in view is almost always local).
    // The stock look restores the shipped Color objects exactly (one tone is
    // authored as linear floats, which a hex round trip would nudge).
    setWaterPalette(look.id === STOCK_LOOK_ID || this.isStockWater(look.water) ? null : look.water);

    const bloom = livePaletteBloomPass();
    if (bloom) {
      bloom.strength = v[LIVE.bloomStrength];
      bloom.threshold = v[LIVE.bloomThreshold];
    }

    // Exposure multiplies whatever the player's brightness setting wrote: a
    // value we did not write ourselves is a new base (the setting moved).
    const live = renderer.webgl.toneMappingExposure;
    if (live !== this.exposureWritten) this.exposureBase = live;
    const next = this.exposureBase * v[LIVE.exposure];
    renderer.webgl.toneMappingExposure = next;
    this.exposureWritten = next;

    setLabRim(
      v[LIVE.rim],
      v[LIVE.rimPower],
      [v[LIVE.rimColor], v[LIVE.rimColor + 1], v[LIVE.rimColor + 2]],
      RIM_ALBEDO,
    );
    this.applyAo(v);
    this.applyShadow(renderer, v[LIVE.shadowStrength]);
    this.applyCanopy(renderer, v[LIVE.canopyLift]);
  }

  /** AO tint and strength (N8AO chains only; other tiers have no AO pass). */
  private applyAo(v: readonly number[]): void {
    const ao = livePaletteAoPass();
    if (!ao) return;
    if (ao !== this.aoPass) {
      this.aoPass = ao;
      this.aoBase = ao.configuration.intensity;
    }
    const hex =
      (Math.round(v[LIVE.aoTint] * 255) << 16) |
      (Math.round(v[LIVE.aoTint + 1] * 255) << 8) |
      Math.round(v[LIVE.aoTint + 2] * 255);
    // In place: a fresh Color would go through the pass's setter, which
    // restarts its accumulation every frame.
    ao.configuration.color.set(hex);
    const intensity = this.aoBase * v[LIVE.aoScale];
    if (ao.configuration.intensity !== intensity) ao.configuration.intensity = intensity;
  }

  /** Sun shadow strength (three mixes the shadow toward lit by 1 - this). */
  private applyShadow(renderer: LabRendererHandle, strength: number): void {
    if (this.sunFor !== renderer) {
      this.sunFor = renderer;
      this.sun = null;
      renderer.scene.traverse((o) => {
        if (!this.sun && (o as THREE.DirectionalLight).isDirectionalLight && o.castShadow) {
          this.sun = o as THREE.DirectionalLight;
        }
      });
    }
    if (this.sun) this.sun.shadow.intensity = strength;
  }

  /** Brighten the canopy materials (their authored colour times the lift). */
  private applyCanopy(renderer: LabRendererHandle, lift: number): void {
    const now = performance.now();
    const sceneChildren = renderer.scene.children.length;
    const needsWalk =
      this.canopyFor !== renderer ||
      sceneChildren !== this.canopySceneChildren ||
      (this.canopyMats.size === 0 && now >= this.canopyRewalkAt);
    if (needsWalk) {
      if (this.canopyFor !== renderer) this.canopyMats.clear();
      this.canopyFor = renderer;
      this.canopySceneChildren = sceneChildren;
      this.canopyRewalkAt = now + CANOPY_REWALK_MS;
      this.canopyLiftWritten = Number.NaN;
      renderer.scene.traverse((o) => {
        const mats = (o as THREE.Mesh).material;
        if (!mats) return;
        for (const m of Array.isArray(mats) ? mats : [mats]) {
          const mat = m as THREE.MeshStandardMaterial;
          if (!mat.color || !CANOPY_MATERIAL.test(mat.name)) continue;
          if (!this.canopyBase.has(mat)) this.canopyBase.set(mat, mat.color.clone());
          this.canopyMats.add(mat);
        }
      });
    }
    if (lift === this.canopyLiftWritten && this.canopyFor === renderer) return;
    for (const mat of this.canopyMats) {
      const base = this.canopyBase.get(mat);
      if (base) mat.color.copy(base).multiplyScalar(lift);
    }
    this.canopyLiftWritten = lift;
  }

  private isStockWater(w: ZoneLook['water']): boolean {
    const s = this.stockWater;
    return (
      w.deep === s.deep && w.shallow === s.shallow && w.sky === s.sky && w.scatter === s.scatter
    );
  }

  /** Every eased GPU value of a look, flat (solved once per look, cached). */
  private liveTargets(look: ZoneLook): number[] {
    const cached = this.targetCache.get(look);
    if (cached) return cached;
    const g = gradeUniformValues(look.grade);
    const sky = skyUniformValues(look.sky, lookDisplayModel(look, this.celSaturation));
    const flat = [
      ...g.wb,
      ...g.tone,
      ...g.shadow,
      ...g.highlight,
      ...g.green,
      ...sky.zenith,
      ...sky.horizon,
      look.grade.exposure,
      look.bloom.strength,
      look.bloom.threshold,
      look.render.rim,
      look.render.rimPower,
      ...rimColorLinear(look),
      ...hexToSrgb01(look.render.aoTint),
      look.render.aoScale,
      look.render.shadowStrength,
      look.render.canopyLift,
    ];
    this.targetCache.set(look, flat);
    return flat;
  }

  // -- ground ----------------------------------------------------------------

  /** Publish the ground override table and queue every zone whose palette moved. */
  private syncGround(): void {
    // Meadow fullness follows the zone the player stands in (the near carpet
    // and band only reach the ground around the player).
    const zone = this.zone;
    const render = zone ? this.groundLook(zone).render : null;
    setMeadowFullness(
      render
        ? {
            coverage: render.meadowCoverage,
            height: render.meadowHeight,
            width: render.meadowWidth,
          }
        : null,
    );
    const table: Record<string, LookGround> = {};
    for (const zone of ZONES) {
      const look = this.groundLook(zone);
      if (look.id !== STOCK_LOOK_ID) table[zone.id] = look.ground;
      const key = groundKey(look.ground);
      const was = this.appliedGround.get(zone.id) ?? groundKey(this.looksFor(zone)[0].ground);
      if (key !== was) this.pendingGroundZones.add(zone.id);
      this.appliedGround.set(zone.id, key);
    }
    const changed = setGroundPaletteOverrides(
      Object.keys(table).length > 0 ? (table as GroundPaletteTable) : null,
    );
    if (!changed && this.pendingGroundZones.size === 0) return;
    // The blades read the palette cache directly: re-place them now.
    recolorLiveBladeGrassView();
    recolorLiveBladeGrassBandView();
    void this.runGround();
  }

  private async runGround(): Promise<void> {
    const run = ++this.groundRun;
    if (this.groundBusy) return; // the running pass picks the new queue up
    this.groundBusy = true;
    try {
      while (this.pendingGroundZones.size > 0) {
        const renderer = this.renderer;
        const at = this.playerPos();
        if (!renderer || !at) break;
        // Nearest zone first, from where the player stands NOW (a teleport
        // between passes re-orders the rest).
        const ids = [...this.pendingGroundZones].sort(
          (a, b) =>
            zoneDistance(this.zonesById.get(a), at.x, at.z) -
            zoneDistance(this.zonesById.get(b), at.x, at.z),
        );
        const zone = this.zonesById.get(ids[0]);
        this.pendingGroundZones.delete(ids[0]);
        if (!zone) continue;
        this.setStatus(`Re-baking ground: ${zone.name}`);
        const latest = this.groundRun;
        try {
          await renderer.editor.recolorGround(
            zoneRect(zone),
            at.x,
            at.z,
            () => this.groundRun !== latest && this.pendingGroundZones.has(zone.id),
          );
        } catch (err) {
          // A failed pass leaves that ground stale (the stale sweep retries the
          // near chunks); it must never wedge the queue or the status line.
          console.warn('[palette-lab] ground re-bake failed', zone.id, err);
        }
      }
    } finally {
      this.groundBusy = false;
      this.setStatus('');
      if (run !== this.groundRun && this.pendingGroundZones.size > 0) void this.runGround();
    }
  }

  /**
   * Re-bake near chunks whose colours predate the live override table: a chunk
   * whose build was queued before a change (streaming in on boot with saved
   * looks, or a camera-LOD re-mesh) lands with the old palette. Cheap when
   * nothing is stale (a filter over the built chunks), so it runs on a timer.
   */
  private sweepStaleGround(now: number): void {
    if (this.groundBusy || this.sweepBusy || now < this.nextSweepAt) return;
    if (groundPaletteVersion() === 0) return; // no override was ever set
    const renderer = this.renderer;
    const at = this.playerPos();
    if (!renderer || !at) return;
    this.nextSweepAt = now + STALE_SWEEP_INTERVAL_MS;
    this.sweepBusy = true;
    renderer.editor
      .recolorStaleGround(at.x, at.z, () => this.groundBusy)
      .catch((err: unknown) => console.warn('[palette-lab] stale ground sweep failed', err))
      .finally(() => {
        this.sweepBusy = false;
      });
  }

  private playerPos(): { x: number; z: number } | null {
    return game()?.world?.player?.pos ?? null;
  }

  // -- panel -----------------------------------------------------------------

  private setStatus(text: string): void {
    if (text === this.status) return;
    this.status = text;
    this.panel?.setStatus(text);
  }

  private refreshPanel(): void {
    if (!this.panel || !this.zone) return;
    this.panel.render({
      zoneName: this.zone.name,
      biome: this.zone.biome,
      sharedWith: ZONES.filter((z) => z.biome === this.zone?.biome && z.id !== this.zone.id).map(
        (z) => z.name,
      ),
      looks: this.looksFor(this.zone),
      selected: this.selectedId(this.zone),
      compare: this.compare,
      timePhase: dayNightPhaseOverride(),
      chosenCount: Object.keys(this.selections).length,
    });
  }
}

/**
 * The ground a zone's palette reaches. A COLUMN zone blends in only around its
 * own rect. A STRIP zone's palette is picked by z alone (terrain_chunk_build
 * paletteAt), so it spans the world's full width, and the first and last strips
 * own everything past the world's ends, out to the far vista's apron.
 */
function zoneRect(zone: ZoneDef): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const strip = STRIP_ZONES.indexOf(zone);
  if (strip < 0) {
    return {
      minX: (zone.xMin ?? STRIP_MIN_X) - GROUND_BLEND_MARGIN,
      maxX: (zone.xMax ?? STRIP_MAX_X) + GROUND_BLEND_MARGIN,
      minZ: zone.zMin - GROUND_BLEND_MARGIN,
      maxZ: zone.zMax + GROUND_BLEND_MARGIN,
    };
  }
  const reach = FAR_WORLD_MARGIN + GROUND_BLEND_MARGIN;
  return {
    minX: WORLD_MIN_X - reach,
    maxX: WORLD_MAX_X + reach,
    minZ: strip === 0 ? WORLD_MIN_Z - reach : zone.zMin - GROUND_BLEND_MARGIN,
    maxZ: strip === STRIP_ZONES.length - 1 ? WORLD_MAX_Z + reach : zone.zMax + GROUND_BLEND_MARGIN,
  };
}

function zoneDistance(zone: ZoneDef | undefined, x: number, z: number): number {
  if (!zone) return Number.POSITIVE_INFINITY;
  const r = zoneRect(zone);
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return dx * dx + dz * dz;
}

let started: PaletteLabRuntime | null = null;

/** Start the lab once (idempotent) and expose it as `window.__paletteLab`. */
export function startPaletteLab(): PaletteLabApi {
  if (!started) {
    started = new PaletteLabRuntime();
    started.start();
    (window as unknown as { __paletteLab?: PaletteLabApi }).__paletteLab = started;
  }
  return started;
}
