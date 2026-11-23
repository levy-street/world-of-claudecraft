// The editor's dungeon mode: edit an authored DungeonLayout (rooms, doors,
// barriers, visual openings, decor, dais) in the live 3D viewport, on top of
// the real interior the Renderer builds. The mode owns its own selection,
// pointer capture, floor-plane picking (interiors are flat at y=0), snapshot
// undo, and side panel; the map editor's tools/inspector never see its events.
// Decision logic lives in the pure cores (dungeon_draft_core, writer, validate)
// so this module stays a thin DOM/three glue layer.
import * as THREE from 'three';
import { t } from '../../ui/i18n';
import { buildDungeonOverlays, disposeDungeonOverlays } from '../3d/dungeon_overlays';
import type { Editor3DViewport } from '../3d/viewport';
import { type AuthoredDungeonEntry, authoredDungeonOrigin } from './authored_dungeons';
import {
  addEntity,
  cloneDraft,
  type DungeonDraft,
  type DungeonEntityKind,
  type DungeonEntityRef,
  draftFromLayout,
  draftToLayout,
  entityBounds,
  moveEntity,
  pickEntityCycle,
  removeEntity,
  snapCoord,
  updateEntityFields,
} from './dungeon_draft_core';
import { formatDungeonLayoutLiteral } from './dungeon_layout_writer_core';
import { validateDraft } from './dungeon_validate_core';

const UNDO_CAP = 100;
const DRAG_REBUILD_MS = 220;
type FieldName =
  | 'id'
  | 'key'
  | 'style'
  | 'x0'
  | 'x1'
  | 'z0'
  | 'z1'
  | 'x'
  | 'z'
  | 'y'
  | 'yaw'
  | 'hw'
  | 'hd'
  | 'r'
  | 'scale'
  | 'scaleX'
  | 'scaleZ'
  | 'innerScale';
const FIELD_SPECS: Record<DungeonEntityKind, FieldName[]> = {
  room: ['x0', 'x1', 'z0', 'z1'],
  door: ['x', 'z', 'hw', 'hd'],
  opening: ['x', 'z', 'hw', 'hd'],
  barrier: ['x', 'z', 'hw', 'hd'],
  decor: ['x', 'z', 'y', 'yaw', 'scale', 'scaleX', 'scaleZ', 'innerScale', 'r', 'hw', 'hd'],
  dais: ['x', 'z', 'r'],
};

export interface DungeonModeDeps {
  viewport: Editor3DViewport;
  /** Host element the side panel mounts into (document.body works). */
  panelHost: HTMLElement;
  onExit(): void;
}

export class DungeonEditorMode {
  private active = false;
  private entry: AuthoredDungeonEntry | null = null;
  private origin = { x: 0, z: 0 };
  private draft: DungeonDraft | null = null;
  private selected: DungeonEntityRef | null = null;
  private undoStack: DungeonDraft[] = [];
  private redoStack: DungeonDraft[] = [];
  private dirty = false;

  private panel: HTMLDivElement | null = null;
  private selectionBody: HTMLDivElement | null = null;
  private issuesEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;

  private overlays: THREE.Group | null = null;
  private raycaster = new THREE.Raycaster();
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private drag: {
    ref: DungeonEntityRef;
    lastX: number;
    lastZ: number;
    moved: boolean;
    before: DungeonDraft;
    lastRebuild: number;
  } | null = null;

  constructor(private readonly deps: DungeonModeDeps) {}

  isActive(): boolean {
    return this.active;
  }

  enter(entry: AuthoredDungeonEntry): void {
    if (this.active) return;
    const port = this.deps.viewport.dungeonStagePort();
    if (!port) return;
    this.active = true;
    this.entry = entry;
    this.origin = authoredDungeonOrigin(entry);
    this.draft = draftFromLayout(entry.layout);
    this.selected = null;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    // Fly the camera into the interior; the viewport teleports its LOD anchor
    // player to the camera target each frame, which is what makes the renderer
    // lazily build this interior and switch to the interior fog/lighting.
    const mid = (entry.layout.zMin + entry.layout.zMax) / 2;
    port.cam.target.set(this.origin.x, 0, this.origin.z + mid);
    port.cam.dist = 140;
    port.cam.pitch = 1.1;
    this.applyOverride();
    this.rebuildOverlays();
    this.buildPanel();
    port.canvas.addEventListener('pointerdown', this.onPointerDown, true);
    port.canvas.addEventListener('pointermove', this.onPointerMove, true);
    port.canvas.addEventListener('pointerup', this.onPointerUp, true);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    const port = this.deps.viewport.dungeonStagePort();
    if (port) {
      port.canvas.removeEventListener('pointerdown', this.onPointerDown, true);
      port.canvas.removeEventListener('pointermove', this.onPointerMove, true);
      port.canvas.removeEventListener('pointerup', this.onPointerUp, true);
      // Back to the module-const layout (drop the live override + rebuild).
      if (this.entry) port.renderer.editor.setDungeonLayoutOverride(this.entry.interior, null);
      port.cam.target.set(0, 0, 0);
      port.cam.dist = 70;
    }
    window.removeEventListener('keydown', this.onKeyDown, true);
    if (this.overlays) {
      disposeDungeonOverlays(this.overlays);
      this.overlays = null;
    }
    this.panel?.remove();
    this.panel = null;
    this.drag = null;
    this.deps.onExit();
  }

  // ---- draft -> live world -------------------------------------------------

  private currentLayout() {
    if (!this.entry || !this.draft) return null;
    return draftToLayout(this.entry.layout, this.draft);
  }

  private applyOverride(): void {
    const port = this.deps.viewport.dungeonStagePort();
    const layout = this.currentLayout();
    if (!port || !layout || !this.entry) return;
    port.renderer.editor.setDungeonLayoutOverride(this.entry.interior, layout);
  }

  private rebuildOverlays(): void {
    const port = this.deps.viewport.dungeonStagePort();
    if (!port || !this.draft) return;
    if (this.overlays) disposeDungeonOverlays(this.overlays);
    this.overlays = buildDungeonOverlays(this.draft, this.selected);
    this.overlays.position.set(this.origin.x, 0, this.origin.z);
    port.renderer.scene.add(this.overlays);
  }

  private changed(rebuildInterior: boolean): void {
    this.dirty = true;
    this.rebuildOverlays();
    if (rebuildInterior) this.applyOverride();
    this.renderStatus();
  }

  private pushUndo(snapshot: DungeonDraft): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > UNDO_CAP) this.undoStack.shift();
    this.redoStack = [];
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev || !this.draft) return;
    this.redoStack.push(cloneDraft(this.draft));
    this.draft = prev;
    this.selected = null;
    this.changed(true);
    this.renderSelection();
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next || !this.draft) return;
    this.undoStack.push(cloneDraft(this.draft));
    this.draft = next;
    this.selected = null;
    this.changed(true);
    this.renderSelection();
  }

  // ---- picking --------------------------------------------------------------

  /** Cursor ray vs the flat interior floor (y=0), in instance-local coords. */
  private floorPoint(clientX: number, clientY: number): { x: number; z: number } | null {
    const port = this.deps.viewport.dungeonStagePort();
    if (!port) return null;
    const rect = port.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    port.renderer.editor.setRaycasterFromCamera(this.raycaster, ndc);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.floorPlane, hit)) return null;
    return { x: hit.x - this.origin.x, z: hit.z - this.origin.z };
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if (!this.active || !this.draft) return;
    // Plain left clicks belong to the mode; every navigation gesture the
    // viewport understands (shift-pan, middle/alt orbit, wheel) passes through.
    if (ev.button !== 0 || ev.shiftKey || ev.altKey || ev.ctrlKey) return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    const p = this.floorPoint(ev.clientX, ev.clientY);
    if (!p) return;
    const hit = pickEntityCycle(this.draft, p.x, p.z, this.selected);
    this.selected = hit;
    if (hit) {
      this.drag = {
        ref: hit,
        lastX: p.x,
        lastZ: p.z,
        moved: false,
        before: cloneDraft(this.draft),
        lastRebuild: performance.now(),
      };
      const port = this.deps.viewport.dungeonStagePort();
      port?.canvas.setPointerCapture(ev.pointerId);
    }
    this.rebuildOverlays();
    this.renderSelection();
  };

  private onPointerMove = (ev: PointerEvent): void => {
    if (!this.active || !this.drag || !this.draft) return;
    ev.stopImmediatePropagation();
    const p = this.floorPoint(ev.clientX, ev.clientY);
    if (!p) return;
    const dx = snapCoord(p.x) - snapCoord(this.drag.lastX);
    const dz = snapCoord(p.z) - snapCoord(this.drag.lastZ);
    if (dx === 0 && dz === 0) return;
    moveEntity(this.draft, this.drag.ref, dx, dz);
    this.drag.lastX += dx;
    this.drag.lastZ += dz;
    this.drag.moved = true;
    this.rebuildOverlays();
    // Throttled interior rebuild while dragging so the walls/decor follow the
    // cursor without a rebuild per pointer event.
    const now = performance.now();
    if (now - this.drag.lastRebuild > DRAG_REBUILD_MS) {
      this.drag.lastRebuild = now;
      this.applyOverride();
    }
    this.renderSelection();
  };

  private onPointerUp = (ev: PointerEvent): void => {
    if (!this.active || !this.drag) return;
    ev.stopImmediatePropagation();
    const drag = this.drag;
    this.drag = null;
    if (drag.moved) {
      this.pushUndo(drag.before);
      this.changed(true);
    }
  };

  private onKeyDown = (ev: KeyboardEvent): void => {
    if (!this.active || !this.draft) return;
    const target = ev.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !ev.shiftKey) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      this.undo();
      return;
    }
    if (
      (ev.ctrlKey || ev.metaKey) &&
      (ev.key.toLowerCase() === 'y' || (ev.shiftKey && ev.key.toLowerCase() === 'z'))
    ) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      this.redo();
      return;
    }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && this.selected) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      this.deleteSelected();
      return;
    }
    const nudge = ev.shiftKey ? 2 : 0.5;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-nudge, 0],
      ArrowRight: [nudge, 0],
      ArrowUp: [0, -nudge],
      ArrowDown: [0, nudge],
    };
    const delta = arrows[ev.key];
    if (delta && this.selected) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      this.pushUndo(cloneDraft(this.draft));
      moveEntity(this.draft, this.selected, delta[0], delta[1]);
      this.changed(true);
      this.renderSelection();
    }
  };

  // ---- edits from the panel --------------------------------------------------

  private deleteSelected(): void {
    if (!this.draft || !this.selected || this.selected.kind === 'dais') return;
    this.pushUndo(cloneDraft(this.draft));
    removeEntity(this.draft, this.selected);
    this.selected = null;
    this.changed(true);
    this.renderSelection();
  }

  private addAtCamera(kind: Exclude<DungeonEntityKind, 'dais'>): void {
    const port = this.deps.viewport.dungeonStagePort();
    if (!port || !this.draft) return;
    this.pushUndo(cloneDraft(this.draft));
    const at = {
      x: snapCoord(port.cam.target.x - this.origin.x),
      z: snapCoord(port.cam.target.z - this.origin.z),
    };
    this.selected = addEntity(this.draft, kind, at);
    this.changed(true);
    this.renderSelection();
  }

  // ---- persistence -------------------------------------------------------------

  private async save(): Promise<void> {
    const layout = this.currentLayout();
    if (!layout || !this.entry || !this.draft) return;
    const issues = validateDraft(this.draft);
    this.renderIssues(issues);
    if (issues.some((issue) => issue.severity === 'error')) return;
    const literal = formatDungeonLayoutLiteral(layout);
    try {
      const res = await fetch('/__dungeon_editor/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ constName: this.entry.constName, literal }),
      });
      if (!res.ok) throw new Error(String(res.status));
      this.dirty = false;
      this.setStatus(t('editor.dungeon.saved'));
    } catch {
      // Not running under the dev server: hand the author the literal instead.
      const blob = new Blob(
        [`export const ${this.entry.constName}: DungeonLayout = ${literal};\n`],
        { type: 'text/plain' },
      );
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${this.entry.id}_layout.ts`;
      a.click();
      URL.revokeObjectURL(a.href);
      this.setStatus(t('editor.dungeon.saveFailed'));
    }
    this.renderStatus();
  }

  // ---- panel -----------------------------------------------------------------

  private buildPanel(): void {
    this.panel?.remove();
    const panel = document.createElement('div');
    panel.className = 'dungeon-panel';
    const header = document.createElement('div');
    header.className = 'dungeon-panel-header';
    const title = document.createElement('span');
    title.textContent = t('editor.dungeon.title');
    // Fold toggle: collapses the panel to its header pill so it never blocks
    // the floor plan or the editor's own inspector.
    const fold = this.button(t('editor.dungeon.collapse'), () => {
      const collapsed = panel.classList.toggle('collapsed');
      fold.textContent = collapsed ? t('editor.dungeon.expand') : t('editor.dungeon.collapse');
    });
    const exit = this.button(t('editor.dungeon.exit'), () => this.exit());
    header.append(title, fold, exit);
    panel.append(header);

    const hint = document.createElement('div');
    hint.className = 'dungeon-panel-hint';
    hint.textContent = t('editor.dungeon.hint');
    panel.append(hint);

    const actions = document.createElement('div');
    actions.className = 'dungeon-panel-actions';
    actions.append(
      this.button(t('editor.dungeon.addRoom'), () => this.addAtCamera('room')),
      this.button(t('editor.dungeon.addDoor'), () => this.addAtCamera('door')),
      this.button(t('editor.dungeon.addBarrier'), () => this.addAtCamera('barrier')),
      this.button(t('editor.dungeon.addOpening'), () => this.addAtCamera('opening')),
      this.button(t('editor.dungeon.addDecor'), () => this.addAtCamera('decor')),
    );
    panel.append(actions);

    this.selectionBody = document.createElement('div');
    this.selectionBody.className = 'dungeon-panel-selection';
    panel.append(this.selectionBody);

    const footer = document.createElement('div');
    footer.className = 'dungeon-panel-actions';
    footer.append(
      this.button(t('editor.dungeon.validate'), () => {
        if (this.draft) this.renderIssues(validateDraft(this.draft));
      }),
      this.button(t('editor.dungeon.save'), () => void this.save()),
    );
    panel.append(footer);

    this.issuesEl = document.createElement('div');
    this.issuesEl.className = 'dungeon-panel-issues';
    panel.append(this.issuesEl);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'dungeon-panel-status';
    panel.append(this.statusEl);

    this.deps.panelHost.append(panel);
    this.panel = panel;
    this.renderSelection();
    this.renderStatus();
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.addEventListener('click', onClick);
    return el;
  }

  private renderStatus(): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = this.dirty ? t('editor.dungeon.unsaved') : '';
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  private renderIssues(issues: ReturnType<typeof validateDraft>): void {
    if (!this.issuesEl) return;
    this.issuesEl.textContent = '';
    if (issues.length === 0) {
      const ok = document.createElement('div');
      ok.className = 'dungeon-issue-ok';
      ok.textContent = t('editor.dungeon.noIssues');
      this.issuesEl.append(ok);
      return;
    }
    for (const issue of issues) {
      const row = document.createElement('div');
      row.className = `dungeon-issue dungeon-issue-${issue.severity}`;
      row.textContent = issue.message;
      this.issuesEl.append(row);
    }
  }

  private renderSelection(): void {
    const body = this.selectionBody;
    if (!body || !this.draft) return;
    body.textContent = '';
    const ref = this.selected;
    if (!ref) {
      const none = document.createElement('div');
      none.className = 'dungeon-panel-hint';
      none.textContent = t('editor.dungeon.none');
      body.append(none);
      return;
    }
    const heading = document.createElement('div');
    heading.className = 'dungeon-selection-kind';
    heading.textContent = t(`editor.dungeon.kind.${ref.kind}`);
    body.append(heading);
    const record = this.selectedRecord(ref) as Record<string, unknown> | null;
    if (!record) return;

    if (ref.kind === 'room') {
      body.append(this.textField('id', String(record.id ?? ''), ref));
    }
    if (ref.kind === 'decor') {
      body.append(this.keyField(String(record.key ?? ''), ref));
    }
    if (ref.kind === 'barrier') {
      body.append(this.styleField(record.style === 'pit' ? 'pit' : 'maze', ref));
    }
    for (const field of FIELD_SPECS[ref.kind]) {
      const raw = record[field];
      body.append(this.numberField(field, typeof raw === 'number' ? raw : undefined, ref));
    }
    if (ref.kind !== 'dais') {
      body.append(this.button(t('editor.dungeon.delete'), () => this.deleteSelected()));
    }
  }

  private selectedRecord(ref: DungeonEntityRef): unknown {
    if (!this.draft) return null;
    switch (ref.kind) {
      case 'room':
        return this.draft.rooms[ref.index] ?? null;
      case 'door':
        return this.draft.doors[ref.index] ?? null;
      case 'barrier':
        return this.draft.barriers[ref.index] ?? null;
      case 'opening':
        return this.draft.visualOpenings[ref.index] ?? null;
      case 'decor':
        return this.draft.decor[ref.index] ?? null;
      case 'dais':
        return this.draft.dais;
    }
  }

  private fieldRow(labelKey: FieldName): { row: HTMLLabelElement } {
    const row = document.createElement('label');
    row.className = 'dungeon-field';
    const label = document.createElement('span');
    label.textContent = t(`editor.dungeon.field.${labelKey}`);
    row.append(label);
    return { row };
  }

  private commitFields(
    ref: DungeonEntityRef,
    fields: Record<string, number | string | undefined>,
  ): void {
    if (!this.draft) return;
    this.pushUndo(cloneDraft(this.draft));
    updateEntityFields(this.draft, ref, fields);
    this.changed(true);
    this.renderSelection();
  }

  private numberField(
    name: FieldName,
    value: number | undefined,
    ref: DungeonEntityRef,
  ): HTMLLabelElement {
    const { row } = this.fieldRow(name);
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.5';
    input.value = value === undefined ? '' : String(Math.round(value * 1000) / 1000);
    input.addEventListener('change', () => {
      const parsed = input.value.trim() === '' ? undefined : Number(input.value);
      if (parsed !== undefined && !Number.isFinite(parsed)) return;
      this.commitFields(ref, { [name]: parsed });
    });
    row.append(input);
    return row;
  }

  private textField(name: FieldName, value: string, ref: DungeonEntityRef): HTMLLabelElement {
    const { row } = this.fieldRow(name);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.addEventListener('change', () => this.commitFields(ref, { [name]: input.value }));
    row.append(input);
    return row;
  }

  private keyField(value: string, ref: DungeonEntityRef): HTMLLabelElement {
    const { row } = this.fieldRow('key');
    const select = document.createElement('select');
    const known = this.entry?.decorKeys ?? [];
    const keys = known.includes(value) ? known : [value, ...known];
    for (const key of keys) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = key;
      opt.selected = key === value;
      select.append(opt);
    }
    select.addEventListener('change', () => this.commitFields(ref, { key: select.value }));
    row.append(select);
    return row;
  }

  private styleField(value: 'maze' | 'pit', ref: DungeonEntityRef): HTMLLabelElement {
    const { row } = this.fieldRow('style');
    const select = document.createElement('select');
    for (const style of ['maze', 'pit'] as const) {
      const opt = document.createElement('option');
      opt.value = style;
      opt.textContent = style;
      opt.selected = style === value;
      select.append(opt);
    }
    select.addEventListener('change', () => this.commitFields(ref, { style: select.value }));
    row.append(select);
    return row;
  }
}

/** Bounds helper re-export for tests and the app glue. */
export { entityBounds };
