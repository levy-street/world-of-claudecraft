// The Collision Master modeling toolbar: a floating bar over the 3D stage
// (visible only during a Collision Master session), styled after Blender's
// header. The select-mode cluster (Object / Vertex / Edge / Face) shows an
// icon + its hotkey chip (Tab / Z / V / C), primitives live in an Add
// dropdown (real triangulated solids), then the poly-snap brush toggle and
// Duplicate / Delete. Pure DOM chrome: every action routes through the
// injected deps; the app owns all state.

import { t } from '../ui/i18n';
import type { CmSculptTool } from './cm_mesh_sculpt_core';
import { el } from './dom';

export type CmSelectMode = 'object' | 'vertex' | 'edge' | 'face';
export type CmPrimitive = 'box' | 'plane' | 'cylinder' | 'sphere' | 'wedge';
export type CmTopologyAction = 'weld' | 'subdivide' | 'inset' | 'fill' | 'mirror';

export interface CollisionMasterBarDeps {
  getMode(): CmSelectMode;
  setMode(mode: CmSelectMode): void;
  addPrimitive(kind: CmPrimitive): void;
  duplicateSelection(): void;
  deleteSelection(): void;
  getPolySnap(): boolean;
  setPolySnap(on: boolean): void;
  /** Walkable-ramp flag of the selected volume, or null with no selection. */
  getSelectedRamp(): boolean | null;
  toggleSelectedRamp(): void;
  /** Loop Cut: insert an edge loop through the picked edge's quad ring. Enabled
   *  only in Edge sub-mode with an edge selected (canLoopCut). */
  loopCut(): void;
  canLoopCut(): boolean;
  topology(action: CmTopologyAction): void;
  canTopology(action: CmTopologyAction): boolean;
  /** Poly Build: click-drag a face to extrude it. A pointer-claiming toggle,
   *  mutually exclusive with Poly Snap. */
  getPolyBuild(): boolean;
  setPolyBuild(on: boolean): void;
  getSculpt(): {
    tool: CmSculptTool | null;
    radius: number;
    strength: number;
    dynamicTopology: boolean;
    targetEdgeLength: number;
  };
  setSculptTool(tool: CmSculptTool | null): void;
  setSculptSettings(
    change: Partial<{
      radius: number;
      strength: number;
      dynamicTopology: boolean;
      targetEdgeLength: number;
    }>,
  ): void;
}

// Blender-style mode icons: a wire cube with the relevant component lit.
const ICONS: Record<
  | CmSelectMode
  | CmPrimitive
  | 'add'
  | 'snap'
  | 'dup'
  | 'del'
  | 'walk'
  | 'loopcut'
  | 'polybuild'
  | 'dyntopo'
  | CmTopologyAction,
  string
> = {
  loopcut:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M3 3h10v10H3z"/><path d="M8 2.2v11.6" stroke-dasharray="1.6 1.4" stroke-width="1.4"/></svg>',
  polybuild:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2 11l4-2 4 2-4 2z"/><path d="M6 9V4M6 4l-2 1.4M6 4l2 1.4" stroke-width="1.4"/></svg>',
  dyntopo:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2 13 5 3l4 8 5-7"/><circle cx="5" cy="3" r="1.2" fill="currentColor"/><circle cx="9" cy="11" r="1.2" fill="currentColor"/><circle cx="14" cy="4" r="1.2" fill="currentColor"/></svg>',
  weld: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="4" cy="8" r="2"/><circle cx="12" cy="8" r="2"/><path d="M6 8h4M8 5v6"/></svg>',
  subdivide:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1"><path d="M2 2h12v12H2zM8 2v12M2 8h12"/><path d="m2 2 12 12M14 2 2 14" opacity=".6"/></svg>',
  inset:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2 2h12v12H2zM5 5h6v6H5zM2 2l3 3M14 2l-3 3M2 14l3-3M14 14l-3-3"/></svg>',
  fill: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="m3 12 2-8 8 2-2 7z" fill="currentColor" fill-opacity=".3"/><circle cx="3" cy="12" r="1"/><circle cx="5" cy="4" r="1"/><circle cx="13" cy="6" r="1"/><circle cx="11" cy="13" r="1"/></svg>',
  mirror:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1"><path d="M8 1v14" stroke-dasharray="2 1"/><path d="M6.5 4 2 6v5l4.5 2zM9.5 4 14 6v5l-4.5 2z"/></svg>',
  walk: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2 13h12L2 6z"/><path d="M9 8.5 12 5.5M12 5.5h-2.4M12 5.5v2.4" stroke-width="1.4"/></svg>',
  object:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M8 2 14 5v6l-6 3-6-3V5z"/><path d="M8 8 14 5M8 8 2 5M8 8v6"/></svg>',
  vertex:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1"><path d="M8 2 14 5v6l-6 3-6-3V5z" opacity="0.55"/><path d="M8 8 14 5M8 8 2 5M8 8v6" opacity="0.55"/><circle cx="8" cy="8" r="1.8" fill="currentColor" stroke="none"/></svg>',
  edge: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1"><path d="M8 2 14 5v6l-6 3-6-3V5z" opacity="0.55"/><path d="M8 8 14 5M8 8v6" opacity="0.55"/><path d="M8 8 2 5" stroke-width="2.4"/></svg>',
  face: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1"><path d="M8 2 14 5v6l-6 3-6-3V5z" opacity="0.55"/><path d="M2 5 8 8v6L2 11z" fill="currentColor" stroke="none" opacity="0.85"/></svg>',
  add: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 3v10M3 8h10"/></svg>',
  box: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M8 2 14 5v6l-6 3-6-3V5z"/><path d="M8 8 14 5M8 8 2 5M8 8v6"/></svg>',
  plane:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M3 11 8 8l5 3-5 3z"/></svg>',
  cylinder:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><ellipse cx="8" cy="4" rx="4.5" ry="1.8"/><path d="M3.5 4v8M12.5 4v8"/><ellipse cx="8" cy="12" rx="4.5" ry="1.8"/></svg>',
  sphere:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="8" cy="8" r="5.5"/><ellipse cx="8" cy="8" rx="5.5" ry="2.2"/></svg>',
  wedge:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2 12h12L2 5z"/></svg>',
  snap: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="10" r="3.5"/><path d="M8 2v4M5 3.5 8 6l3-2.5"/></svg>',
  dup: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2.5" y="2.5" width="8" height="8" rx="1"/><rect x="5.5" y="5.5" width="8" height="8" rx="1"/></svg>',
  del: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 4.5h10M6.5 4.5v-2h3v2M4.5 4.5 5 14h6l.5-9.5M6.7 7v4.5M9.3 7v4.5"/></svg>',
};

const MODES: { key: CmSelectMode; hotkey: string; labelKey: string; titleKey: string }[] = [
  {
    key: 'object',
    hotkey: 'Tab',
    labelKey: 'editor.collisionMaster.modeObject',
    titleKey: 'editor.collisionMaster.modeObjectTitle',
  },
  {
    key: 'vertex',
    hotkey: 'Z',
    labelKey: 'editor.collisionMaster.modeVertex',
    titleKey: 'editor.collisionMaster.modeVertexTitle',
  },
  {
    key: 'edge',
    hotkey: 'V',
    labelKey: 'editor.collisionMaster.modeEdge',
    titleKey: 'editor.collisionMaster.modeEdgeTitle',
  },
  {
    key: 'face',
    hotkey: 'C',
    labelKey: 'editor.collisionMaster.modeFace',
    titleKey: 'editor.collisionMaster.modeFaceTitle',
  },
];

const PRIMS: { key: CmPrimitive; labelKey: string }[] = [
  { key: 'box', labelKey: 'editor.collisionMaster.primBox' },
  { key: 'plane', labelKey: 'editor.collisionMaster.primPlane' },
  { key: 'cylinder', labelKey: 'editor.collisionMaster.primCylinder' },
  { key: 'sphere', labelKey: 'editor.collisionMaster.primSphere' },
  { key: 'wedge', labelKey: 'editor.collisionMaster.primWedge' },
];

const SCULPT_TOOLS: { key: CmSculptTool; labelKey: string }[] = [
  { key: 'grab', labelKey: 'editor.collisionMaster.sculptGrab' },
  { key: 'inflate', labelKey: 'editor.collisionMaster.sculptInflate' },
  { key: 'deflate', labelKey: 'editor.collisionMaster.sculptDeflate' },
  { key: 'smooth', labelKey: 'editor.collisionMaster.sculptSmooth' },
  { key: 'pinch', labelKey: 'editor.collisionMaster.sculptPinch' },
  { key: 'crease', labelKey: 'editor.collisionMaster.sculptCrease' },
  { key: 'relax', labelKey: 'editor.collisionMaster.sculptRelax' },
];

const SCULPT_ICONS: Record<CmSculptTool, string> = {
  grab: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 12c2-5 3-7 5-7 2 0 2 3 1 5 2-2 4-1 4 1 0 2-2 3-5 3-3 0-5-1-5-2z"/></svg>',
  inflate:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="5"/><path d="M8 4v8M4 8h8"/></svg>',
  deflate:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="5"/><path d="M4 8h8"/></svg>',
  smooth:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 11c3-6 5 4 8-2 1-2 2-3 4-3"/><path d="M2 14h12" opacity=".5"/></svg>',
  pinch:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="m2 3 5 5-5 5M14 3 9 8l5 5"/></svg>',
  crease:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 4 8 12l6-8M8 12V5"/></svg>',
  relax:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 8h12M4 4l8 8M12 4l-8 8" opacity=".75"/><circle cx="8" cy="8" r="5"/></svg>',
};

export class CollisionMasterBar {
  readonly root: HTMLElement;
  private readonly sculptPalette: HTMLElement;
  private addMenu: HTMLElement | null = null;

  constructor(
    parent: HTMLElement,
    private readonly deps: CollisionMasterBarDeps,
  ) {
    this.root = el('div', 'ed-cm-bar');
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', t('editor.collisionMaster.barLabel'));
    this.root.style.display = 'none';
    this.sculptPalette = el('div', 'ed-cm-sculpt-palette');
    this.sculptPalette.setAttribute('role', 'toolbar');
    this.sculptPalette.setAttribute('aria-label', t('editor.collisionMaster.sculptTitle'));
    this.sculptPalette.style.display = 'none';
    parent.append(this.root, this.sculptPalette);
    this.render();
    // A press anywhere outside the open Add menu closes it.
    document.addEventListener('pointerdown', (ev) => {
      if (this.addMenu && !this.root.contains(ev.target as Node)) this.closeAddMenu();
    });
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
    if (on) this.render();
    else {
      this.closeAddMenu();
      this.sculptPalette.style.display = 'none';
    }
  }

  refresh(): void {
    if (this.root.style.display !== 'none') this.render();
  }

  /** One Blender-style button: icon + label, optional hotkey chip. */
  private btn(
    icon: string,
    label: string,
    title: string,
    active: boolean,
    onClick: () => void,
    hotkey?: string,
    rerender = true,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = active ? 'ed-cm-btn active' : 'ed-cm-btn';
    b.title = title;
    b.setAttribute('aria-label', title);
    if (active) b.setAttribute('aria-pressed', 'true');
    const ic = el('span', 'ed-cm-ico');
    ic.innerHTML = icon;
    ic.setAttribute('aria-hidden', 'true');
    b.appendChild(ic);
    b.appendChild(el('span', 'ed-cm-label', label));
    if (hotkey) {
      const chip = el('kbd', 'ed-cm-key', hotkey);
      chip.setAttribute('aria-hidden', 'true');
      b.appendChild(chip);
    }
    b.addEventListener('click', () => {
      onClick();
      if (rerender) this.render();
    });
    return b;
  }

  private sep(): HTMLElement {
    return el('span', 'ed-cm-sep');
  }

  private closeAddMenu(): void {
    this.addMenu?.remove();
    this.addMenu = null;
    this.root.querySelector('.ed-cm-add')?.classList.remove('active');
  }

  private toggleAddMenu(anchor: HTMLElement): void {
    if (this.addMenu) {
      this.closeAddMenu();
      return;
    }
    const menu = el('div', 'ed-cm-add-menu');
    menu.setAttribute('role', 'menu');
    for (const pr of PRIMS) {
      const label = t(pr.labelKey as Parameters<typeof t>[0]);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'ed-cm-add-item';
      item.setAttribute('role', 'menuitem');
      item.title = t('editor.collisionMaster.primTitle', { name: label });
      const ic = el('span', 'ed-cm-ico');
      ic.innerHTML = ICONS[pr.key];
      ic.setAttribute('aria-hidden', 'true');
      item.append(ic, el('span', undefined, label));
      item.addEventListener('click', () => {
        this.closeAddMenu();
        this.deps.addPrimitive(pr.key);
      });
      menu.appendChild(item);
    }
    anchor.classList.add('active');
    this.addMenu = menu;
    this.root.appendChild(menu);
    // Seat the dropdown under the Add button.
    menu.style.left = `${anchor.offsetLeft}px`;
    menu.style.top = `${anchor.offsetTop + anchor.offsetHeight + 4}px`;
  }

  private render(): void {
    const d = this.deps;
    this.closeAddMenu();
    this.root.innerHTML = '';
    const mode = d.getMode();
    // Select-mode cluster (segmented, Blender header style).
    const modes = el('div', 'ed-cm-modes');
    for (const m of MODES) {
      modes.appendChild(
        this.btn(
          ICONS[m.key],
          t(m.labelKey as Parameters<typeof t>[0]),
          t(m.titleKey as Parameters<typeof t>[0]),
          mode === m.key,
          () => d.setMode(m.key),
          m.hotkey,
        ),
      );
    }
    this.root.appendChild(modes);
    this.root.appendChild(this.sep());
    // Mesh sculpting controls. Off returns the pointer to normal modeling.
    const sculpt = d.getSculpt();
    const sculptSelect = document.createElement('select');
    sculptSelect.className = 'ed-cm-select';
    sculptSelect.title = t('editor.collisionMaster.sculptTitle');
    sculptSelect.setAttribute('aria-label', t('editor.collisionMaster.sculptTitle'));
    const off = document.createElement('option');
    off.value = '';
    off.textContent = t('editor.collisionMaster.sculptOff');
    sculptSelect.appendChild(off);
    for (const tool of SCULPT_TOOLS) {
      const option = document.createElement('option');
      option.value = tool.key;
      option.textContent = t(tool.labelKey as Parameters<typeof t>[0]);
      sculptSelect.appendChild(option);
    }
    sculptSelect.value = sculpt.tool ?? '';
    sculptSelect.addEventListener('change', () => {
      d.setSculptTool((sculptSelect.value || null) as CmSculptTool | null);
      this.render();
    });
    this.root.appendChild(sculptSelect);
    if (sculpt.tool) {
      this.root.appendChild(
        this.btn(
          ICONS.dyntopo,
          t('editor.collisionMaster.dyntopo'),
          t('editor.collisionMaster.dyntopoTitle'),
          sculpt.dynamicTopology,
          () => d.setSculptSettings({ dynamicTopology: !sculpt.dynamicTopology }),
        ),
      );
      this.root.appendChild(this.sep());
    }
    this.renderSculptPalette(sculpt.tool);
    // Add dropdown: the primitives menu.
    // The Add button must NOT rerender on click: rebuilding the bar would
    // destroy the dropdown it just opened.
    const add = this.btn(
      ICONS.add,
      t('editor.collisionMaster.addMenu'),
      t('editor.collisionMaster.addMenuTitle'),
      false,
      () => this.toggleAddMenu(add),
      undefined,
      false,
    );
    add.classList.add('ed-cm-add');
    const caret = el('span', 'ed-cm-caret', '▾');
    caret.setAttribute('aria-hidden', 'true');
    add.appendChild(caret);
    add.setAttribute('aria-haspopup', 'true');
    this.root.appendChild(add);
    this.root.appendChild(this.sep());
    this.root.appendChild(
      this.btn(
        ICONS.snap,
        t('editor.collisionMaster.polySnapShort'),
        t('editor.collisionMaster.polySnapHint'),
        d.getPolySnap(),
        () => d.setPolySnap(!d.getPolySnap()),
      ),
    );
    // Poly Build toggle: click-drag a face to extrude it (mutually exclusive
    // with Poly Snap; both claim the pointer drag).
    this.root.appendChild(
      this.btn(
        ICONS.polybuild,
        t('editor.collisionMaster.polyBuildShort'),
        t('editor.collisionMaster.polyBuildHint'),
        d.getPolyBuild(),
        () => d.setPolyBuild(!d.getPolyBuild()),
      ),
    );
    // Loop Cut: insert an edge loop through the picked edge's ring (Edge mode).
    const loop = this.btn(
      ICONS.loopcut,
      t('editor.collisionMaster.loopCut'),
      t('editor.collisionMaster.loopCutTitle'),
      false,
      () => d.loopCut(),
    );
    if (!d.canLoopCut()) {
      loop.disabled = true;
      loop.classList.add('disabled');
    }
    this.root.appendChild(loop);
    for (const action of ['weld', 'subdivide', 'inset', 'fill', 'mirror'] as const) {
      const control = this.btn(
        ICONS[action],
        t(`editor.collisionMaster.${action}` as Parameters<typeof t>[0]),
        t(`editor.collisionMaster.${action}Title` as Parameters<typeof t>[0]),
        false,
        () => d.topology(action),
      );
      if (!d.canTopology(action)) {
        control.disabled = true;
        control.classList.add('disabled');
      }
      this.root.appendChild(control);
    }
    // Walkable-ramp toggle for the selected volume (dimmed with no selection).
    const rampState = d.getSelectedRamp();
    const walk = this.btn(
      ICONS.walk,
      t('editor.collisionMaster.rampToggle'),
      t('editor.collisionMaster.rampToggleTitle'),
      rampState === true,
      () => d.toggleSelectedRamp(),
    );
    if (rampState === null) {
      walk.disabled = true;
      walk.classList.add('disabled');
    }
    this.root.appendChild(walk);
    this.root.appendChild(
      this.btn(
        ICONS.dup,
        t('editor.collisionMaster.duplicate'),
        t('editor.collisionMaster.duplicateTitle'),
        false,
        () => d.duplicateSelection(),
        '⇧D',
      ),
    );
    this.root.appendChild(
      this.btn(
        ICONS.del,
        t('editor.collisionMaster.delete'),
        t('editor.collisionMaster.deleteTitle'),
        false,
        () => d.deleteSelection(),
        'Del',
      ),
    );
  }

  private renderSculptPalette(active: CmSculptTool | null): void {
    this.sculptPalette.innerHTML = '';
    this.sculptPalette.style.display = active ? '' : 'none';
    if (!active) return;
    for (const tool of SCULPT_TOOLS) {
      const label = t(tool.labelKey as Parameters<typeof t>[0]);
      const control = document.createElement('button');
      control.type = 'button';
      control.className = `ed-cm-sculpt-tool${active === tool.key ? ' active' : ''}`;
      control.title = label;
      control.setAttribute('aria-label', label);
      control.innerHTML = SCULPT_ICONS[tool.key];
      control.addEventListener('click', () => this.deps.setSculptTool(tool.key));
      this.sculptPalette.appendChild(control);
    }
  }
}
