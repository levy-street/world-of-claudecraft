import type { TalentAllocation } from '../sim/content/talents';
import type { ResolvedAbility } from '../sim/sim';
import type { Aura, PlayerClass } from '../sim/types';
import {
  type AuraOverlayConfig,
  AuraOverlayConfigStore,
  type AuraOverlayLayoutConfig,
  type AuraOverlayLayoutPatch,
  type AuraOverlayPatch,
  auraOverlayVisualSlot,
} from './aura_overlay_config';
import {
  type AuraOverlayPaintAura,
  AuraOverlayPainter,
  type AuraOverlayPaintTarget,
} from './aura_overlay_painter';
import {
  type AuraOverlayProcDef,
  type AuraOverlayProcId,
  auraOverlayProcIsActive,
  availableAuraProcDefs,
} from './aura_overlay_view';
import type { PainterHostWriters } from './painter_host';

const clampPosition = (value: number): number =>
  Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;
const POSITION_NUDGE = 0.01;
const COUNTERFANG_WINDOW_DURATION = 5;
const NO_SUPPLEMENTAL_AURAS: readonly AuraOverlayPaintAura[] = [];
const snapPosition = (value: number): number =>
  clampPosition(Math.round(value / POSITION_NUDGE) * POSITION_NUDGE);

export type AuraOverlayPart = 'icon' | 'arcs' | 'ground';

export interface AuraGroundRingState {
  id: AuraOverlayProcId;
  visible: boolean;
  color: string;
  opacity: number;
  scale: number;
}

export interface AuraOverlayControllerDeps {
  doc?: Document;
  writers: PainterHostWriters;
  playerClass: PlayerClass;
  playerName: string;
  known(): readonly ResolvedAbility[];
  talents?(): TalentAllocation;
  iconUrl(abilityId: string): string;
  paintGroundRings?(rings: readonly AuraGroundRingState[]): void;
}

export class AuraOverlayController {
  private readonly root: HTMLElement;
  private readonly store: AuraOverlayConfigStore;
  private readonly configById = new Map<AuraOverlayProcId, AuraOverlayConfig>();
  private layout: AuraOverlayLayoutConfig;
  private readonly targets: AuraOverlayPaintTarget[] = [];
  private readonly targetById = new Map<AuraOverlayProcId, AuraOverlayPaintTarget>();
  private readonly painter: AuraOverlayPainter;
  private knownIds: string[] = [];
  private talentAllocation: TalentAllocation | undefined;
  private currentDefs: readonly AuraOverlayProcDef[] = [];
  private orderedGroundDefs: readonly AuraOverlayProcDef[] = [];
  private readonly groundRingStates: AuraGroundRingState[] = [];
  private groundRingsInitialized = false;
  private readonly positionListeners = new Set<
    (id: AuraOverlayProcId, config: AuraOverlayConfig) => void
  >();
  private readonly placementListeners = new Set<
    (id: AuraOverlayProcId, part: AuraOverlayPart) => void
  >();
  private placement: { id: AuraOverlayProcId; part: AuraOverlayPart } | null = null;
  private previewGroundRings = false;
  private readonly counterfangAura: AuraOverlayPaintAura = {
    id: 'counterfang_window',
    kind: 'counterfang_window',
    remaining: 0,
    duration: COUNTERFANG_WINDOW_DURATION,
  };
  private readonly counterfangAuras: readonly AuraOverlayPaintAura[] = [this.counterfangAura];

  constructor(private readonly deps: AuraOverlayControllerDeps) {
    const doc = deps.doc ?? document;
    this.store = new AuraOverlayConfigStore(`${deps.playerClass}:${deps.playerName}`);
    this.layout = this.store.getLayout();
    this.root = doc.createElement('div');
    this.root.id = 'aura-overlays';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.addEventListener('pointerdown', (event) => this.selectCrescent(event));
    this.painter = new AuraOverlayPainter(deps.writers, this.targets);
    this.syncLoadout();
    doc.body.appendChild(this.root);
  }

  private config(id: AuraOverlayProcId): AuraOverlayConfig {
    let config = this.configById.get(id);
    if (!config) {
      config = this.store.get(id);
      this.configById.set(id, config);
    }
    return config;
  }

  private patchConfig(id: AuraOverlayProcId, patch: AuraOverlayPatch): AuraOverlayConfig {
    const config = this.store.patch(id, patch);
    this.configById.set(id, config);
    return config;
  }

  private syncLoadout(): void {
    const known = this.deps.known();
    const talents = this.deps.talents?.();
    let changed = known.length !== this.knownIds.length;
    if (!changed) {
      for (let i = 0; i < known.length; i++) {
        if (known[i].def.id !== this.knownIds[i]) {
          changed = true;
          break;
        }
      }
    }
    if (!changed && talents !== this.talentAllocation) changed = true;
    if (!changed) return;
    this.knownIds = known.map((ability) => ability.def.id);
    this.talentAllocation = talents;
    this.currentDefs = availableAuraProcDefs(this.deps.playerClass, known, talents);
    this.refreshGroundOrder();
    const activeIds = new Set(this.currentDefs.map((def) => def.id));
    for (const target of this.targets) {
      target.el.classList.toggle('loadout-hidden', !activeIds.has(target.def.id));
    }
    for (const def of this.currentDefs) {
      let target = this.targetById.get(def.id);
      if (!target) {
        target = this.buildFrame(this.root.ownerDocument, def);
        this.targetById.set(def.id, target);
        this.targets.push(target);
        this.root.appendChild(target.el);
      }
      target.el.classList.remove('loadout-hidden');
    }
  }

  private buildFrame(doc: Document, def: AuraOverlayProcDef): AuraOverlayPaintTarget {
    const el = doc.createElement('div');
    el.className = `aura-overlay-frame aura-overlay-${def.theme}`;
    el.dataset.proc = def.id;
    const left = doc.createElement('span');
    left.className = 'aura-overlay-arc aura-overlay-arc-left';
    const arcs = doc.createElement('div');
    arcs.className = 'aura-overlay-arcs-shell';
    arcs.appendChild(left);
    const icon = doc.createElement('img');
    icon.className = 'aura-overlay-icon';
    icon.src = this.deps.iconUrl(def.iconAbilityId);
    icon.alt = '';
    icon.draggable = false;
    const timer = doc.createElement('span');
    timer.className = 'aura-overlay-timer';
    timer.setAttribute('aria-hidden', 'true');
    const right = doc.createElement('span');
    right.className = 'aura-overlay-arc aura-overlay-arc-right';
    arcs.appendChild(right);
    const moveHandle = this.buildMoveHandle(doc, def.id);
    el.append(arcs, icon, timer, moveHandle);
    icon.addEventListener('pointerdown', (event) => this.startDrag(event, def.id, 'icon', icon));
    moveHandle.addEventListener('pointerdown', (event) => {
      if (this.placement?.id !== def.id || this.placement.part !== 'icon') return;
      this.startDrag(event, def.id, this.placement.part, moveHandle);
    });
    this.apply(def.id, el, this.config(def.id));
    return { def, el, timer };
  }

  private selectCrescent(event: PointerEvent): void {
    if (!this.placement || event.defaultPrevented || event.button !== 0) return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('.aura-overlay-icon, .aura-overlay-move-handle')
    ) {
      return;
    }
    const bounds = this.rootBounds();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    let closest: { id: AuraOverlayProcId; distance: number } | null = null;
    for (const def of this.currentDefs) {
      const cfg = this.config(def.id);
      const scale = cfg.arcsScale * this.layout.crescentBlockScale;
      const centerX = bounds.left + 0.5 * bounds.width;
      const centerY = bounds.top + 0.56 * bounds.height;
      const localX = (event.clientX - centerX) / scale;
      const localY = (event.clientY - centerY) / scale;
      const horizontalDistance = Math.abs(Math.abs(localX) - 130);
      const verticalOverflow = Math.max(0, Math.abs(localY) - 100);
      const distance = Math.hypot(horizontalDistance, verticalOverflow) * scale;
      if (distance <= Math.max(24, 24 * scale) && (!closest || distance < closest.distance)) {
        closest = { id: def.id, distance };
      }
    }
    if (!closest) return;
    this.beginPlacement(closest.id, 'arcs');
  }

  private buildMoveHandle(doc: Document, id: AuraOverlayProcId): HTMLElement {
    const handle = doc.createElement('span');
    handle.className = 'aura-overlay-move-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.dataset.proc = id;
    return handle;
  }

  private startDrag(
    event: PointerEvent,
    id: AuraOverlayProcId,
    part: AuraOverlayPart,
    el: HTMLElement,
  ): void {
    if (!this.placement || part !== 'icon' || event.button !== 0) return;
    if (this.placement.id !== id || this.placement.part !== part) {
      this.placement = { id, part };
      this.refreshPlacement();
      this.emitPlacement(id, part);
    }
    event.preventDefault();
    el.setPointerCapture(event.pointerId);
    el.classList.add('dragging');
    const bounds = this.rootBounds();
    const move = (next: PointerEvent): void => {
      const posX = snapPosition((next.clientX - bounds.left) / bounds.width);
      const posY = snapPosition((next.clientY - bounds.top) / bounds.height);
      const cfg = this.patchConfig(id, { iconPosX: posX, iconPosY: posY });
      const frame = this.targetById.get(id)?.el;
      if (frame) this.apply(id, frame, cfg);
      this.emitPosition(id, cfg);
    };
    const end = (): void => {
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  private rootBounds(): DOMRect {
    return this.root.getBoundingClientRect();
  }

  private apply(id: AuraOverlayProcId, el: HTMLElement, cfg: AuraOverlayConfig): void {
    const arcsScale = cfg.arcsScale * this.layout.crescentBlockScale;
    el.classList.toggle('disabled', !cfg.enabled);
    el.classList.toggle('hide-icon', !cfg.showIcon);
    el.classList.toggle('hide-arcs', !cfg.showArcs);
    el.style.setProperty('--aura-icon-x', `${Math.round(cfg.iconPosX * 10_000) / 100}%`);
    el.style.setProperty('--aura-icon-y', `${Math.round(cfg.iconPosY * 10_000) / 100}%`);
    el.style.setProperty('--aura-arcs-x', '50%');
    el.style.setProperty('--aura-arcs-y', '56%');
    el.style.setProperty('--aura-opacity', String(cfg.opacity));
    el.style.setProperty('--aura-icon-scale', String(cfg.scale));
    el.style.setProperty('--aura-arcs-scale', String(arcsScale));
    el.style.setProperty('--aura-color', cfg.color);
    el.style.setProperty('--aura-half-width', `${150 * arcsScale + 12}px`);
    el.style.setProperty('--aura-half-height', `${110 * arcsScale + 12}px`);
    el.style.setProperty('--aura-icon-half', `${31 * cfg.scale + 4}px`);
    el.dataset.proc = id;
  }

  get(id: AuraOverlayProcId): AuraOverlayConfig {
    return { ...this.config(id) };
  }

  getLayout(): AuraOverlayLayoutConfig {
    return { ...this.layout };
  }

  patchLayout(patch: AuraOverlayLayoutPatch): void {
    this.layout = this.store.patchLayout(patch);
    for (const target of this.targets) {
      this.apply(target.def.id, target.el, this.config(target.def.id));
    }
  }

  patch(id: AuraOverlayProcId, patch: AuraOverlayPatch): void {
    const target = this.targets.find((item) => item.def.id === id);
    if (target) {
      const cfg = this.patchConfig(id, patch);
      this.apply(id, target.el, cfg);
      if (patch.groundOrder !== undefined) this.refreshGroundOrder();
      if (patch.iconPosX !== undefined || patch.iconPosY !== undefined) {
        this.emitPosition(id, cfg);
      }
    }
  }

  setAll(enabled: boolean): void {
    this.syncLoadout();
    for (const def of this.currentDefs) {
      const target = this.targetById.get(def.id);
      if (!target) continue;
      const cfg = this.patchConfig(def.id, { enabled });
      this.apply(def.id, target.el, cfg);
    }
  }

  reset(id: AuraOverlayProcId): void {
    const target = this.targets.find((item) => item.def.id === id);
    if (target) {
      this.configById.set(id, this.store.resetPosition(id));
      this.normalizeGroundOrder();
      const cfg = this.config(id);
      this.apply(id, target.el, cfg);
      this.refreshGroundOrder();
      this.emitPosition(id, cfg);
    }
  }

  nudge(id: AuraOverlayProcId, part: AuraOverlayPart, deltaX: number, deltaY: number): void {
    if (part === 'ground' || part === 'arcs') {
      const direction = Math.sign(deltaX);
      if (direction === 0) return;
      const ordered = this.currentDefs
        .map((def, index) => ({ def, index, order: this.config(def.id).groundOrder }))
        .sort((a, b) => a.order - b.order || a.index - b.index);
      const index = ordered.findIndex((entry) => entry.def.id === id);
      const neighborIndex = Math.min(ordered.length - 1, Math.max(0, index + direction));
      if (index < 0 || neighborIndex === index) return;
      const neighbor = ordered[neighborIndex];
      this.normalizeGroundOrder(ordered);
      const currentSlot = auraOverlayVisualSlot(this.config(id));
      const neighborSlot = auraOverlayVisualSlot(this.config(neighbor.def.id));
      const currentConfig = this.patchConfig(id, neighborSlot);
      const neighborConfig = this.patchConfig(neighbor.def.id, currentSlot);
      const currentTarget = this.targetById.get(id);
      const neighborTarget = this.targetById.get(neighbor.def.id);
      if (currentTarget) this.apply(id, currentTarget.el, currentConfig);
      if (neighborTarget) this.apply(neighbor.def.id, neighborTarget.el, neighborConfig);
      this.refreshGroundOrder();
      for (const target of this.targets) {
        this.apply(target.def.id, target.el, this.config(target.def.id));
      }
      this.emitPosition(id, currentConfig);
      this.emitPosition(neighbor.def.id, neighborConfig);
      return;
    }
    const target = this.targetById.get(id);
    if (!target) return;
    const cfg = this.config(id);
    const next = this.patchConfig(id, {
      iconPosX: snapPosition(cfg.iconPosX + deltaX * POSITION_NUDGE),
      iconPosY: snapPosition(cfg.iconPosY + deltaY * POSITION_NUDGE),
    });
    this.apply(id, target.el, next);
    this.emitPosition(id, next);
  }

  setPlacement(on: boolean): void {
    this.previewGroundRings = on;
    if (!on) this.endPlacement();
  }

  private refreshGroundOrder(): void {
    this.orderedGroundDefs = this.currentDefs
      .map((def, index) => ({ def, index, order: this.config(def.id).groundOrder }))
      .sort((a, b) => a.order - b.order || a.index - b.index)
      .map(({ def }) => def);
  }

  private normalizeGroundOrder(
    ordered = this.currentDefs
      .map((def, index) => ({ def, index, order: this.config(def.id).groundOrder }))
      .sort((a, b) => a.order - b.order || a.index - b.index),
  ): void {
    for (let order = 0; order < ordered.length; order++) {
      this.patchConfig(ordered[order].def.id, { groundOrder: order });
    }
  }

  beginPlacement(id: AuraOverlayProcId, part: AuraOverlayPart): void {
    this.syncLoadout();
    if (!this.targetById.has(id)) return;
    this.placement = { id, part };
    this.refreshPlacement();
    this.emitPlacement(id, part);
  }

  endPlacement(): void {
    this.placement = null;
    this.refreshPlacement();
  }

  private refreshPlacement(): void {
    this.root.classList.toggle('placement', this.placement !== null);
    for (const target of this.targets) {
      const selected = target.def.id === this.placement?.id;
      const preview = this.placement !== null && !target.el.classList.contains('loadout-hidden');
      target.el.classList.toggle('placement-preview', preview);
      target.el.classList.toggle('placement-target', selected);
      target.el.classList.toggle('placement-icon', selected && this.placement?.part === 'icon');
      target.el.classList.toggle('placement-arcs', selected && this.placement?.part === 'arcs');
      target.el.classList.toggle('placement-ground', selected && this.placement?.part === 'ground');
    }
  }

  paint(auras: readonly Aura[], counterfangRemaining = 0): void {
    this.syncLoadout();
    const counterfangActive = this.deps.playerClass === 'hunter' && counterfangRemaining > 0;
    const supplementalAuras = counterfangActive ? this.counterfangAuras : NO_SUPPLEMENTAL_AURAS;
    if (counterfangActive) {
      this.counterfangAura.remaining = Math.min(COUNTERFANG_WINDOW_DURATION, counterfangRemaining);
    }
    this.painter.paint(auras, supplementalAuras);
    if (!this.deps.paintGroundRings) return;
    const scale = this.layout.groundRingBlockScale;
    let changed = this.groundRingStates.length !== this.orderedGroundDefs.length;
    this.groundRingStates.length = this.orderedGroundDefs.length;
    for (let i = 0; i < this.orderedGroundDefs.length; i++) {
      const def = this.orderedGroundDefs[i];
      const config = this.config(def.id);
      const active =
        auraOverlayProcIsActive(def, auras) || auraOverlayProcIsActive(def, supplementalAuras);
      const visible =
        config.enabled && config.showGroundRing && (this.previewGroundRings || active);
      const previous = this.groundRingStates[i];
      if (
        !previous ||
        previous.id !== def.id ||
        previous.visible !== visible ||
        previous.color !== config.color ||
        previous.opacity !== config.opacity ||
        previous.scale !== scale
      ) {
        this.groundRingStates[i] = {
          id: def.id,
          visible,
          color: config.color,
          opacity: config.opacity,
          scale,
        };
        changed = true;
      }
    }
    if (!this.groundRingsInitialized || changed) {
      this.groundRingsInitialized = true;
      this.deps.paintGroundRings(this.groundRingStates);
    }
  }

  defs(): readonly AuraOverlayProcDef[] {
    this.syncLoadout();
    return this.currentDefs;
  }

  onPositionChange(
    listener: (id: AuraOverlayProcId, config: AuraOverlayConfig) => void,
  ): () => void {
    this.positionListeners.add(listener);
    return () => this.positionListeners.delete(listener);
  }

  onPlacementChange(listener: (id: AuraOverlayProcId, part: AuraOverlayPart) => void): () => void {
    this.placementListeners.add(listener);
    return () => this.placementListeners.delete(listener);
  }

  private emitPosition(id: AuraOverlayProcId, cfg: AuraOverlayConfig): void {
    for (const listener of this.positionListeners) listener(id, cfg);
  }

  private emitPlacement(id: AuraOverlayProcId, part: AuraOverlayPart): void {
    for (const listener of this.placementListeners) listener(id, part);
  }
}
